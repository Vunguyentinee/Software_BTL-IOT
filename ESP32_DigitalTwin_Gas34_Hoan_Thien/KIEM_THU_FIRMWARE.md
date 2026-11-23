# Kịch bản kiểm thử độ tin cậy firmware

Dùng tín hiệu kiểm soát được thay cho gas thật. Chuẩn bị Serial Monitor 115200 baud, ứng dụng đọc MQTT, nguồn tín hiệu phù hợp đầu vào ADC và video hoặc thiết bị đo thời gian. Với ca phản hồi vật lý, lắp công tắc hành trình hoặc tach trước khi bật cấu hình tương ứng.

## Kiểm thử chương trình trên máy

Chạy tại thư mục giải nén.

```bash
g++ -std=c++11 -Wall -Wextra -Werror -pedantic tests/door_safety_test.cpp tests/safety_monitoring_test.cpp -o safety_tests
./safety_tests
g++ -std=c++11 -Wall -Wextra -Werror -pedantic tests/connection_policy_test.cpp -o connection_tests
./connection_tests
```

Các phép kiểm tra bao gồm ngưỡng gas, 60 giây và thời điểm tràn `millis()`, tín hiệu ADC kẹt biên, phản hồi cửa/quạt, ưu tiên khóa gas, mạng chập chờn, timeout heartbeat và lệnh sai phiên. Các ca dưới đây cần chạy trên board và môi trường MQTT của nhóm.

Đã đạt 108 điều kiện kiểm tra trên máy, gồm 26 điều kiện lúc biên dịch và 82 điều kiện lúc chạy. Đã biên dịch cho **ESP32 Dev Module, Arduino ESP32 core 3.3.6** ở cấu hình mặc định và cấu hình bật cả heartbeat, công tắc hành trình và tach. Thư viện LCD 1.1.2 khai báo AVR và phát cảnh báo tương thích khi biên dịch.

## Kiểm thử trên board

| Mã | Tình huống và thao tác | Kết quả kỳ vọng |
|---|---|---|
| F01 | Cửa đóng MANUAL. Đưa ADC từ dưới lên đúng ngưỡng báo. Không gửi lệnh hoặc ACK. | ESP32 tự phát lệnh mở ngay khi nhận mẫu hợp lệ. LED2 theo lệnh mở, LED3 và còi báo. |
| F02 | Chặn riêng Wi‑Fi, broker hoặc backend. Kích cảnh báo trong từng ca. | Cửa và báo động tại chỗ tiếp tục chạy. Khi kết nối lại, trạng thái đang có trên ESP32 xuất hiện trong telemetry. Ghi độ trễ và những sự kiện bị thiếu hoặc đến muộn. |
| F03 | Có MQTT, dừng chương trình gửi ACK. Giữ cảnh báo quá 10 giây. | Có `start`, retry cùng ID khoảng 3 giây khi chưa có ACK backend, sau 10 giây có `escalated` và LCD nhắc chưa xác nhận. |
| F04 | Chạy ACK backend, chưa gửi ACK operator. Sau khi nhắc, gửi ACK operator đúng ID. | Retry dừng sau ACK backend. LCD vẫn nhắc ở mốc 10 giây nếu operator chưa xác nhận. ACK operator xóa nhắc nhưng không tắt báo động hoặc đóng cửa. |
| F05 | Gửi ACK operator sớm khi không có ACK backend. Thử ACK sai ID, ID cũ sau reset. | Xác nhận đúng ID chặn nhắc người dùng nhưng retry vẫn chạy. ID sai, cũ hoặc thuộc sự kiện đã kết thúc không có tác dụng. |
| F06 | Gửi `door/close` ở lúc đang báo gas và lúc giữ cửa. Gửi lệnh bật/tắt quạt khi khóa gas. | Các lệnh xung đột bị từ chối. Cửa giữ mở. Quạt giữ đầu ra trước khóa. |
| F07 | Từ 2.000 hạ ADC xuống 1.500 liên tục. Kiểm tra ở mốc ngay trước và sau 60 giây. | Giữ mở trước hạn, nhả về AUTO ở mẫu đủ điều kiện từ 60 giây. Đối chiếu thời điểm PIR gần nhất để xác định lệnh đóng. |
| F08 | Khi đang giữ, tại giây 59 đưa ADC lần lượt lên 2.000 ở ca 1 và lên 1.750 ở ca 2 rồi hạ. | Ca 1 kích báo lại. Ca 2 tiếp tục giữ cửa. Cả hai đếm đủ 60 giây mới từ lần ADC hợp lệ trở lại vùng thấp. |
| F09 | Giữ ADC ở 0 và 4.095 trong hai ca. Sau đó trả về giá trị thấp hợp lệ. | ADC 0 không xóa báo động, ADC 4.095 kích báo ngay. Sau 2 giây ở biên, lỗi ADC báo và giữ cửa. Sau 2 giây trong dải, lỗi được xóa, rồi cần đủ 60 giây thấp để nhả. |
| F10 | Mô phỏng gián đoạn đọc ADC trên 600 ms trong lúc giữ bằng bản debug bench. | Đồng hồ giữ cửa bắt đầu lại khi có mẫu thấp hợp lệ tiếp theo. Ghi thời gian gián đoạn thực tế. |
| F11 | Tạo cảnh báo nhiệt khi gas bình thường. Sau đó thử hai thứ tự gas → nhiệt và nhiệt → gas. | Nhiệt đơn độc bật quạt và từ chối quạt OFF. Khi khóa gas xuất hiện, giữ trạng thái quạt đã có, kể cả đang chạy. Khi nhả khóa, quạt trở lại logic nhiệt và chế độ hiện tại. |
| F12 | Mô phỏng DHT11 lỗi lúc nhiệt bình thường và lúc cảnh báo nhiệt. | Có `dht_error`, nhiệt độ và độ ẩm thành `null`. Giữ trạng thái cảnh báo nhiệt trước đó. Khi dữ liệu hợp lệ, xử lý lại ngưỡng. |
| F13 | Bật cấu hình phản hồi cửa, giả lập cửa mở chậm hoặc công tắc không đóng. | Có `waiting` rồi `unconfirmed` ở khoảng 2 giây. LED3 và còi báo, lệnh giữ mở vẫn duy trì. Khi có phản hồi ổn định, trạng thái thành `confirmed`. |
| F14 | Bật tach, giữ quạt có lệnh chạy và ngắt xung phản hồi bằng thiết bị mô phỏng. | Báo `unconfirmed` sau 3 giây từ khi chờ, hoặc sau thời gian phát hiện mất xung cộng thêm 3 giây nếu quạt từng được xác nhận. Phản hồi hợp lệ phục hồi trạng thái. |
| F15 | Reset lúc gas đang báo, lúc giữ và sau nhả khóa. Lặp lại với mất điện sau khi log xác nhận trạng thái, rồi thử riêng cắt nguồn sát thời điểm ghi NVS hoặc giả lập lỗi ghi. | Vị trí khóa đã ghi NVS phục hồi. ADC đã thấp thì đếm lại 60 giây. Có `boot_id` mới. Ghi lại những lượt dữ liệu chưa kịp lưu và hành vi khi NVS lỗi. |
| F16 | Kích gas khi PIR đang khởi động. Sau khi nhả khóa, thử có và không có PIR HIGH trong 10 giây gần nhất. | Gas vẫn giữ cửa trong thời gian PIR khởi động. Sau khi nhả, cửa theo chế độ AUTO và thời điểm PIR cuối. |
| F17 | Gửi lặp cùng `cmd_id` trong phiên hiện tại, lệnh sai `target_boot_id` và lệnh đã chờ quá 1 giây trong queue của thiết bị. | Lệnh trùng hợp lệ nhận lại kết quả đã lưu. Lệnh sai boot hoặc quá hạn bị từ chối. Dùng bản debug để tạo độ trễ queue có kiểm soát. |
| F18 | Tắt broker, tạo nhiều sự kiện hơn dung lượng hàng đợi rồi bật lại. | Phản ứng tại chỗ vẫn đúng. Đối soát sự kiện với Serial. Dùng `boot_id`, `event_id` và telemetry đang hoạt động để nhận biết sự kiện cũ, trùng hoặc thiếu. |
| F19 | Tạo treo có kiểm soát bằng bản debug bench và kiểm tra cấu hình watchdog của core đang dùng. | Ghi rõ watchdog đã được đăng ký hay chưa, trạng thái sau treo, có reboot không và thời gian tới khi điều khiển cục bộ trở lại. |
| F20 | Đặt cửa mở MANUAL, LED1 và quạt MANUAL. Ngắt Wi‑Fi. Lặp lại với Wi‑Fi còn nhưng broker ngắt. | Log phân biệt Wi‑Fi và MQTT. Trước mốc 10 giây từ khi phát hiện lỗi, chế độ tay được giữ trừ trường hợp quy tắc an toàn có hiệu lực. Sau mốc này cả ba về AUTO. Cửa MANUAL đang mở được giữ ít nhất 10 giây tiếp theo trước khi PIR có thể cho đóng. |
| F21 | Lặp mất mạng ngắn hơn 10 giây rồi mất lại. Sau đó để một lượt mất dài hơn 10 giây và khôi phục MQTT. | Lượt ngắn giữ MANUAL. Lượt dài để lại AUTO trên ESP32 sau khi reconnect. Dashboard nhận snapshot mới mang `connection_id` mới. |
| F22 | Ngắt Wi‑Fi trước khi ESP32 nhận lệnh. Lặp lại ngắt sau khi Serial báo lệnh đã xử lý nhưng trước khi dashboard nhận ACK. | Lượt đầu thiết bị không thực hiện lệnh. Lượt hai có thể đổi đầu ra và gửi ACK muộn nếu bản tin còn trong RAM. ACK muộn mang phiên nhận lệnh. Hai lượt đối chiếu thêm phản hồi vật lý hoặc quan sát cửa. |
| F23 | Lưu lại lệnh đúng phiên, ngắt và nối lại, phát lại payload cũ. Thử cả lệnh/cấu hình thiếu mã phiên và lệnh mới có phiên hiện tại. | Payload cũ hoặc thiếu phiên bị từ chối. Lệnh mới hợp lệ được xử lý theo quy tắc an toàn. |
| F24 | Bật giám sát heartbeat, chạy công cụ heartbeat qua MQTT, rồi tắt riêng heartbeat trong khi broker vẫn chạy. Gửi heartbeat sai phiên, sau đó gửi lại heartbeat đúng phiên. | Sau 8 giây im lặng, `backend_state=timeout` và chặn lệnh mới. Sau 10 giây tiếp theo, về AUTO. Heartbeat sai phiên bị bỏ qua. Heartbeat đúng phiên phục hồi điều khiển từ xa và các chế độ AUTO vẫn giữ. |
| F25 | Khi quạt MANUAL đang chạy, mô phỏng DHT11 lỗi và làm mất kết nối quá 10 giây. Sau đó trả dữ liệu DHT11 hợp lệ. | Quạt chuyển AUTO nhưng giữ đầu ra đang chạy đến khi có mẫu hợp lệ, trong giới hạn ưu tiên gas/nhiệt. Khi có dữ liệu hợp lệ, AUTO trở lại xử lý theo ngưỡng. |
| F26 | Trong lúc offline, kích gas, nhiệt và lỗi phản hồi vật lý ở các lượt riêng có đủ cảm biến. Ngắt kết nối suốt 10 giây rồi quan sát LCD, LED3, còi và thiết bị. | Cảnh báo, phản hồi và bảo vệ tại chỗ vẫn diễn ra theo từng loại. Thông báo lỗi kết nối trên LCD nhường chỗ cho cảnh báo an toàn. |

## Ghi số liệu

| Lượt | Ca | Thời điểm tín hiệu vào | Firmware báo | GPIO/PWM đổi trạng thái | Thiết bị phản hồi thật | MQTT/dashboard nhận | Đạt hoặc lỗi |
|---|---|---|---|---|---|---|---|
| 1 | F01 |  |  |  |  |  |  |

Tính thời gian từ đầu vào tới lệnh đầu ra, từ lệnh tới phản hồi vật lý và từ sự kiện đến dashboard. Ghi số lượt đạt trên tổng số lượt cho từng ca. Chọn số lần lặp theo thời gian thực nghiệm của nhóm và công bố số lượt đã thực hiện. Các mốc 200 ms, 2 giây, 3 giây, 10 giây và 60 giây là thông số của firmware hoặc chu kỳ gọi hàm. Kết quả độ trễ của mô hình cần đo trên phần cứng thật.
