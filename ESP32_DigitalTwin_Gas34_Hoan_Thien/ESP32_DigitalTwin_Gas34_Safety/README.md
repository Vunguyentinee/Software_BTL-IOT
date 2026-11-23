# ESP32 Digital Twin Gas34 – firmware mô hình nhà thông minh

Firmware quản lý gas qua AO GPIO34, nhiệt độ, cửa servo, quạt, đèn, LCD và MQTT. ESP32 xử lý cảnh báo tại chỗ ngay khi chấp nhận mẫu cảm biến. MQTT dùng để theo dõi, gửi lệnh và xác nhận cảnh báo.

## Nạp chương trình

1. Giải nén ZIP. Mở thư mục `ESP32_DigitalTwin_Gas34_Safety` và sketch `ESP32_DigitalTwin_Gas34_Safety.ino`.
2. Chọn **ESP32 Dev Module** và đúng cổng USB trong Arduino IDE. Cài Arduino ESP32 core 3.3.6, ArduinoJson 7.4.3, DHT sensor library 1.4.7, Adafruit Unified Sensor 1.1.15, ESP32Servo 3.2.1, LiquidCrystal I2C 1.1.2 của Frank de Brabander và MQTT 2.5.3 của 256dpi.
3. Điền `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_HOST` và thông tin xác thực nếu broker yêu cầu. Khi broker chạy Docker trên laptop, dùng IP LAN của laptop. Dừng simulator hoặc đặt MQTT client ID và các topic riêng để hai thiết bị không giành phiên.
4. Giữ chân đấu dây theo bảng. Khi dùng module gas có AO 5 V, phải bảo đảm điện áp thực tế đưa vào GPIO34 phù hợp với ESP32. Dùng tín hiệu ADC kiểm soát được để thử.
5. Chọn **Verify**, sau đó **Upload**. Mở Serial Monitor **115200 baud**. Đối chiếu `GAS_ADC34`, `ADC_FAULT`, `CUA_LOCK` và log `[ALARM]` với MQTT.

| Thiết bị | GPIO |
|---|---:|
| AO cảm biến gas | 34 |
| DO ánh sáng | 33 |
| PIR | 32 |
| DHT11 | 5 |
| Servo | 18 |
| Quạt, mức bật HIGH | 2 |
| LED1, LED2, LED3 | 12, 14, 27 |
| Còi | 25 |
| LCD SDA và SCL | 21 và 22 |
| Phản hồi cửa mở hết hành trình, tùy chọn | 23 |
| Xung tach của quạt, tùy chọn | 19 |

## Hành vi và thời gian

| Điều kiện | Hành động của ESP32 | Thời gian |
|---|---|---|
| ADC ≥ 2.000 | Phát lệnh mở cửa, kể cả MANUAL. LED2 theo lệnh mở. LED3 và còi báo. Từ chối đóng. | Ngay trong lượt xác nhận, lấy mẫu ADC mỗi 200 ms. Mỗi mẫu là trung vị 5 lần đọc. |
| ADC giảm xuống 1–1.500 | Cảnh báo gas có thể kết thúc và cửa tiếp tục được giữ mở. | Nhả về AUTO khi có 60 giây mẫu thấp hợp lệ liên tục. Nếu đã quá 10 giây từ lần PIR HIGH cuối, AUTO có thể đóng ngay khi nhả. |
| ADC lên 1.501–1.999 trong lúc giữ | Giữ cửa và hủy thời gian thấp đã tích lũy. Từ mẫu thấp tiếp theo, đếm lại. | Biên trên/dưới dùng các ngưỡng thực tế đang cấu hình. |
| ADC ≥ 2.000 trở lại hoặc mất mẫu quá 600 ms | Mẫu cao kích hoạt lại cảnh báo. Mất mẫu hủy khoảng thời gian thấp đang đếm. | Bắt đầu lại 60 giây từ mẫu thấp hợp lệ tiếp theo. |
| Các mẫu ADC liên tục ở biên 0/4.095 | Báo lỗi ADC và giữ cửa mở. ADC 0 không được dùng để xóa báo động. ADC 4.095 vẫn đã kích báo gas trong lượt đầu. | Chẩn đoán lỗi sau 2 giây mẫu ở biên. Phục hồi sau 2 giây mẫu trong dải 1–4.094, sau đó vẫn cần đủ 60 giây mẫu thấp để nhả cửa. |
| Nhiệt độ ≥ 40 °C | LED3 và còi báo, ESP32 yêu cầu quạt chạy bất kể AUTO hay MANUAL, khi cửa không bị khóa theo gas. Từ chối lệnh tắt quạt khi còn cảnh báo nhiệt. | Ngay khi có mẫu DHT11 hợp lệ, đọc theo chu kỳ 2 giây. Cảnh báo nhiệt xóa ở ≤ 37 °C. |
| Gas và nhiệt đồng thời | Cửa theo bảo vệ gas. Quạt giữ nguyên trạng thái đầu ra tại thời điểm khóa gas có hiệu lực. Cửa khóa thì lệnh tay bật/tắt quạt bị từ chối. Khi nhả khóa, quạt quay về nhu cầu thật của chế độ hiện tại, kể cả nhu cầu do cảnh báo nhiệt. | Ưu tiên khóa gas nếu hai điều kiện cùng được phát hiện trong một vòng lặp. |
| DHT11 lỗi | Telemetry nhiệt độ và độ ẩm thành `null`. Giữ trạng thái cảnh báo nhiệt và nhu cầu quạt AUTO gần nhất. | Lỗi được báo từ mẫu DHT11 lỗi và kết thúc khi có mẫu hợp lệ. |
| Mất Wi‑Fi hoặc MQTT | Cảm biến, cảnh báo và khóa tại chỗ vẫn chạy. Điều khiển tay giữ trong khoảng chờ, rồi thiết bị chuyển sang AUTO tại chỗ. | Chuyển AUTO sau 10 giây từ khi firmware phát hiện mất kết nối. Wi‑Fi thử lại mỗi 10 giây, MQTT mỗi 5 giây khi Wi‑Fi có kết nối. |
| Reset trong lúc khóa cửa | Khôi phục khóa cửa và ngưỡng gas từ bộ nhớ NVS. GPIO quạt khởi tạo OFF. Tạo `boot_id` mới. | Nếu ADC đã xuống thấp, bắt đầu lại đủ 60 giây. Serial và telemetry báo khi NVS gặp lỗi. |

Các ngưỡng trên là mặc định của mô hình. Quạt AUTO bật ở ≥ 35 °C và tắt ở ≤ 34 °C. Còi phát nhịp 300 ms bật, 300 ms tắt. LED1 AUTO theo ánh sáng. PIR chờ 60 giây sau boot và AUTO giữ cửa 10 giây kể từ lần PIR HIGH cuối.

Dải cấu hình gas cho phép `1 ≤ smoke_low < smoke_high ≤ 4094`. Ngưỡng gas lưu cũ ngoài dải sẽ dùng lại mặc định. Cấu hình ngưỡng gas bị từ chối trong thời gian khóa cửa. Hở dây hoặc cảm biến sai lệch vẫn có thể sinh giá trị trong dải và vượt qua kiểm tra biên. Firmware đọc ADC từ lúc boot. Khi đo ổn định trên board, cho module gas đủ thời gian ổn định theo hướng dẫn của module và ghi lại số đọc lúc khởi động.

## Khi mất kết nối và khi kết nối lại

| Thiết bị | Trong 10 giây chờ | Sau 10 giây mất kết nối |
|---|---|---|
| Cửa servo, PIR, LED2 | Cửa đang MANUAL giữ chế độ hiện tại. Cửa AUTO vẫn chạy theo PIR. Khóa gas được ưu tiên ngay. | Cửa về AUTO theo PIR. Cửa đang mở do lệnh tay được giữ thêm ít nhất một chu kỳ 10 giây trước khi có thể đóng. Khóa gas vẫn giữ cửa theo điều kiện riêng. LED2 theo lệnh cửa. |
| Quạt, DHT11 | DHT11 tiếp tục đo và áp dụng các ưu tiên gas, nhiệt. Chế độ quạt hiện tại được duy trì. | Quạt về AUTO theo nhiệt độ. Nếu đang chuyển từ MANUAL mà DHT11 lỗi, giữ đầu ra hiện tại tới khi có dữ liệu nhiệt hợp lệ. Các ưu tiên khóa gas và cảnh báo nhiệt vẫn áp dụng. |
| LED1, cảm biến ánh sáng | AUTO tiếp tục theo ánh sáng. MANUAL giữ đầu ra. | LED1 về AUTO theo ánh sáng. |
| ADC gas, LED3, còi, phản hồi cửa và quạt nếu đã bật | Tiếp tục đọc tín hiệu, kiểm tra phản hồi và báo động tại chỗ. | Tiếp tục cùng logic bảo vệ và timeout. |
| LCD và Serial | Hiển thị lỗi kết nối xen với trạng thái mô hình. Cảnh báo an toàn luôn được ưu tiên trên LCD. | LCD hiện OFFLINE: AUTO xen với trạng thái. Serial ghi mốc chuyển chế độ và kết nối lại. |

ESP32 tính khoảng chờ từ khi phát hiện Wi‑Fi hoặc MQTT không còn hoạt động. Khi broker im lặng, thời gian phát hiện phụ thuộc TCP/MQTT keepalive. Mạng trở lại trước khi hết thời gian chờ thì giữ chế độ thiết bị hiện tại. Nếu đã chuyển AUTO, ESP32 giữ chế độ AUTO khi kết nối lại cho đến khi nhận lệnh mới hợp lệ.

### Đồng bộ dashboard và lệnh

1. Dashboard hiển thị trạng thái kết nối từ `home/esp32-home/status` (MQTT online/offline) và kiểm tra độ mới của telemetry. Sau mỗi lần nối lại, dùng telemetry của phiên vừa kết nối để đồng bộ cửa, quạt, đèn và cảnh báo. Khi dữ liệu đã cũ, hiển thị thời điểm cập nhật cuối và trạng thái chưa xác định.
2. Đặt `target_boot_id` và `target_connection_id` theo `boot_id` và `connection_id` trong telemetry mới có `control_mode=remote_available` khi gửi lệnh hoặc cấu hình. Ví dụ lệnh cửa trên `home/esp32-home/cmd`:

   ```json
   {"cmd_id":"open-unique-01","device":"door","action":"open","target_boot_id":"<boot_id từ telemetry>","target_connection_id":5}
   ```

3. Gửi lệnh hoặc cấu hình với QoS 1 và retain=false. Firmware từ chối yêu cầu thiếu phiên đích, sai boot hoặc sai kết nối. `config/set` dùng hai trường phiên đích tương tự. Payload cũ cần bổ sung hai trường này.
4. Khi mất mạng trước lúc ESP32 nhận lệnh, ESP32 không thực thi lệnh đó. Khi lệnh đã xử lý nhưng ACK chưa gửi được, hàng đợi RAM cố gửi lại khi có MQTT. ACK có `cmd_id` hoặc `config_id`, `boot_id` và `connection_id` của kết nối nhận yêu cầu. Dashboard ghép ACK theo các trường này và không dùng ACK cũ để ghi đè trạng thái hiện tại. Với lệnh không rõ kết quả, đọc telemetry và phản hồi vị trí trước khi quyết định gửi lệnh mới.
5. Telemetry có `control_mode` với các giá trị `remote_available`, `offline_grace`, `local_auto`. Thiết bị có thể ở chế độ AUTO riêng lẻ ngay cả khi `control_mode=remote_available`. ACK và sự kiện tồn trong RAM với dung lượng hữu hạn. Khi khởi động lại, dùng `boot_id` mới và trạng thái thực hiện tại để đối soát.

**Giám sát mất backend khi MQTT còn hoạt động.** Đặt `MONITOR_BACKEND_HEARTBEAT=true` sau khi backend đã gửi heartbeat khoảng mỗi 2 giây. Gửi lên `home/esp32-home/backend/heartbeat`, QoS 1, retain=false, với hai trường phiên đích như lệnh. Khi chưa có heartbeat hợp lệ hoặc đúng 8 giây không nhận heartbeat mới, ESP32 từ chối lệnh từ xa. Sau 10 giây kể từ khi phát hiện backend không sẵn sàng, thiết bị chuyển AUTO tại chỗ. Heartbeat chỉ chứng minh dịch vụ gửi nó còn hoạt động. Mặc định theo dõi heartbeat tắt để firmware dùng được với broker hoặc dashboard chưa tích hợp.

Sau khi cài `paho-mqtt` theo hướng dẫn bên dưới, dùng hai lệnh mẫu để thử heartbeat và lệnh điều khiển từ terminal:

```text
python tools/alarm_ack.py --host 192.168.1.20 heartbeat
python tools/alarm_ack.py --host 192.168.1.20 command door open
```

## Xác nhận cảnh báo

Mỗi lần gas, nhiệt hoặc lỗi ADC chuyển sang trạng thái cảnh báo, firmware tạo một sự kiện riêng. `event_id` gồm mã lần khởi động và số thứ tự. Các loại xác nhận độc lập với nhau.

| Mốc từ khi ESP32 ghi nhận sự cố | Hành động |
|---|---|
| **0 giây** | Đầu ra bảo vệ chạy cục bộ. Thông báo `start` được xếp hàng để gửi. |
| **3 giây**, backend chưa ACK | `backend_overdue=true`. Khi có MQTT, ESP32 gửi lại cùng `event_id` khoảng mỗi 3 giây. Nếu đang mất mạng, firmware đánh dấu quá hạn và gửi khi có thể. |
| **10 giây**, người dùng chưa ACK | LCD hiển thị `CHUA XAC NHAN`, telemetry có `operator_overdue=true` và firmware xếp một thông báo `escalated`. |
| Nhận ACK người dùng | Xóa nhắc quá hạn cho sự kiện tương ứng. Cửa, quạt, đèn và còi vẫn tuân theo trạng thái cảm biến và điều kiện nhả khóa. |
| Điều kiện cảnh báo kết thúc | Gửi `end` theo cùng `event_id`. Cảnh báo tái diễn dùng ID mới. |

- ESP32 phát sự kiện trên `home/esp32-home/event`. Thông báo xác nhận của firmware có `type=alarm_response`, `alarm`, `state`, `event_id`, `started_ms`, `uptime_ms` và trạng thái ACK. `state` có thể là `start`, `retry`, `escalated` hoặc `end`.
- Backend hoặc giao diện gửi ACK ứng dụng lên `home/esp32-home/event/ack`, QoS 1, **retain=false**. Ví dụ `{"event_id":"<ID nhận được>","source":"backend"}`. Khi người dùng xác nhận, gửi `{"event_id":"<ID nhận được>","source":"operator"}`. ACK thuộc sự kiện cũ hoặc boot cũ không áp dụng cho sự kiện hiện hành.
- `active_alarms` trong telemetry liệt kê các sự kiện còn hiệu lực. `smoke_alarm`, `heat_alarm`, `door_command`, `fan_on` và các topic cũ vẫn có mặt để dashboard đọc được.
- `home/esp32-home/cmd/ack` là kết quả xử lý **lệnh điều khiển**, khác ACK cảnh báo. Firmware lưu kết quả 32 `cmd_id` gần nhất đã xử lý trong phiên boot. Lệnh nằm trong hàng đợi thiết bị từ 1 giây trở lên hoặc thuộc kết nối cũ bị từ chối. Trường `result=ok` xác nhận firmware đã xử lý lệnh. Vị trí cửa thật được xác nhận bằng cảm biến hành trình nếu đã lắp và bật.
- Hàng đợi sự kiện có 24 chỗ trong RAM. Mất điện làm mất hàng đợi. Trong thời gian offline dài, sự kiện chuyển tiếp có thể thiếu hoặc đến trễ. Ứng dụng đối chiếu `active_alarms` theo telemetry khi kết nối lại và xử lý trùng dựa trên `event_id` cùng loại trạng thái. Telemetry dùng QoS 0 và chỉ giữ bản mới nhất chờ phát.
- Trên broker có xác thực, phân quyền topic để thiết bị nhận lệnh từ tài khoản đã được cấp quyền. Backend chỉ báo người dùng đã xác nhận sau khi có thao tác tương ứng trên giao diện.

### Thử ACK trên broker có sẵn

Tại thư mục giải nén, chạy các lệnh sau. Đổi địa chỉ IP sang broker đang dùng.

```text
python -m pip install paho-mqtt==2.1.0
python tools/alarm_ack.py --host 192.168.1.20 backend
python tools/alarm_ack.py --host 192.168.1.20 operator <event_id>
```

Chế độ `backend` in sự kiện và tự gửi ACK nhận sự kiện. Lệnh `operator` gửi ACK cho đúng ID sau khi người dùng đã xem. Để thử mất phản hồi, dừng chế độ `backend` và quan sát topic sự kiện bằng `mosquitto_sub` hoặc MQTT Explorer. Nếu backend nhóm đã có giao diện, triển khai cùng hợp đồng topic và payload để nút xác nhận gọi được firmware.

## Xác nhận cửa mở và quạt quay

Đặt `DOOR_FEEDBACK_ENABLED` hoặc `FAN_FEEDBACK_ENABLED` thành `true` trong sketch sau khi đã lắp và kiểm tra tín hiệu tương ứng. Mặc định cả hai là `false`. Khi đó telemetry hiển thị `disabled`.

- **Cửa** dùng công tắc hành trình ở vị trí mở hết, kéo GPIO23 xuống GND khi chạm hành trình. Mặc định chờ 2 giây sau lệnh mở, chống dội công tắc 30 ms. Nếu hết hạn, báo `door_open_unconfirmed` và vẫn giữ lệnh mở. Cửa nhận xác nhận lại khi công tắc ổn định ở vị trí mở.
- **Quạt** dùng xung tach với mức logic phù hợp GPIO19. Mặc định chờ 3 giây sau lệnh bật. Chỉ tính xung quan sát trong thời gian quạt nhận lệnh chạy. Sau khi đã xác nhận, mất xung liên tục trên 1 giây làm khởi động lại cửa sổ kiểm tra 3 giây. Nếu hết hạn, báo `fan_rotation_unconfirmed` và giữ đầu ra hiện tại. Quạt hai dây thiếu phản hồi cần bộ đo vòng quay bên ngoài để bật chế độ này.
- **Quan sát kết quả** qua `door_open_feedback`, `fan_rotation_feedback`, Serial, LCD và LED3. `confirmed` là phản hồi đo được, còn `door_command` và `fan_on` là trạng thái đầu ra ESP32 đã ra lệnh.

Đây là firmware thực hành cho mô hình. Khi nghiệm thu, dùng nguồn tín hiệu kiểm soát được để mô phỏng gas, không xả gas thật. Bộ Công an hướng dẫn tránh bật hoặc tắt thiết bị điện ở khu vực phát hiện rò rỉ gas. Xem [hướng dẫn phòng tránh cháy, nổ khi sử dụng bếp gas](https://bocongan.gov.vn/chinh-sach-phap-luat/chi-tiet-cau-hoi/af4ad41b-17dd-423c-8d6f-bfbcbc4e9f97).

Xem [bảng kiểm thử và cách ghi kết quả](../KIEM_THU_FIRMWARE.md) ở thư mục gốc.
