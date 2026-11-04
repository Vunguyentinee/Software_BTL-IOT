Đặc tả hệ thống nhà thông minh ESP32

Tài liệu bàn giao cho người phát triển phần mềm

Tài liệu mô tả chân kết nối, logic điều khiển tại ESP32, nội dung hiển thị và dữ liệu đề xuất cho tích hợp phần mềm. Hệ thống hiện vận hành tự động tại chỗ; kết nối mạng và nhận lệnh từ ứng dụng chưa được triển khai.

# **1 Thiết bị và các cổng sử dụng**

Bộ điều khiển trung tâm: ESP32, lập trình bằng Arduino IDE.

| Thiết bị | Chân thiết bị | GPIO | Chức năng |
| :---- | :---- | :---- | :---- |
| DHT11 | DATA | 5 | Đọc nhiệt độ và độ ẩm |
| Cảm biến chuyển động PIR | OUT | 32 | Nhận biết chuyển động |
| Cảm biến ánh sáng | DO | 34 | Nhận trạng thái sáng/tối |
| Servo cửa | Signal | 18 | Điều khiển đóng/mở cửa |
| LED1 | Điều khiển | 12 | Đèn chiếu sáng khi trời tối |
| LED2 | Điều khiển | 14 | Báo có chuyển động |
| LED3 | Điều khiển | 27 | Báo nhiệt độ cao |
| Buzzer | Điều khiển | 25 | Còi cảnh báo nhiệt độ cao |
| Module điều khiển quạt | IN / Signal | 2 | Bật/tắt quạt |
| LCD I2C 16×2 | SDA | 21 | Dữ liệu hiển thị |
| LCD I2C 16×2 | SCL | 22 | Xung giao tiếp |

   
LCD được kiểm tra tại địa chỉ I2C 0x27 hoặc 0x3F. Các thiết bị dùng chung GND. Quạt được điều khiển qua module MOSFET/relay.

# **2 Logic nghiệp vụ**

| Chức năng | Điều kiện | Hành động |
| :---- | :---- | :---- |
| Chiếu sáng tự động | Cảm biến báo tối | Bật LED1 |
| Chiếu sáng tự động | Cảm biến báo sáng | Tắt LED1 |
| Đón người về | PIR chuyển 0 → 1 | Bật LED2; servo quay đến 90° — mở cửa |
| Đóng cửa | PIR chuyển 1 → 0 | Tắt LED2; servo quay về 0° — đóng cửa |
| Làm mát | Nhiệt độ ≥ 35°C | Bật quạt |
| Dừng làm mát | Nhiệt độ ≤ 34°C | Tắt quạt |
| Cảnh báo nhiệt | Nhiệt độ ≥ 40°C | Bật LED3; còi kêu ngắt quãng |
| Kết thúc cảnh báo nhiệt | Nhiệt độ ≤ 37°C | Tắt LED3 và còi |

   
Quạt và cảnh báo nhiệt có hai ngưỡng bật/tắt để tránh dao động liên tục:

·        34°C \< nhiệt độ \< 35°C: quạt giữ trạng thái trước đó.  
·        37°C \< nhiệt độ \< 40°C: cảnh báo nhiệt giữ trạng thái trước đó.  
·        Khi nhiệt độ cao gây cảnh báo, quạt vẫn chạy.  
·        PIR chỉ điều khiển LED2 và cửa, không kích còi.

Trong mô hình, chuyển động được dùng để mô phỏng người về nhà. PIR thực tế phát hiện chuyển động, không xác định danh tính hoặc khẳng định có người đang ở trong phòng.

# **3 Khởi động thời gian xử lý và lỗi**

| Nội dung | Hành vi hiện tại |
| :---- | :---- |
| Cửa lúc khởi động | Gửi lệnh servo về 0° — đóng |
| Quạt, LED3, còi lúc khởi động | Tắt |
| PIR lúc khởi động | Chờ ổn định 60 giây; trong lúc chờ coi như chưa có chuyển động |
| Đọc DHT11 | Mỗi 2 giây |
| Đọc PIR và ánh sáng | Liên tục trong vòng lặp |
| Đóng cửa khi PIR về 0 | Gửi lệnh đóng ngay, không thêm thời gian chờ trong code |
| Thời gian PIR giữ mức 1 | Phụ thuộc núm TIME trên cảm biến |
| Còi cảnh báo | Kêu 300 ms, nghỉ 300 ms, lặp lại |
| DHT11 đọc lỗi | Báo lỗi; giữ trạng thái quạt và cảnh báo nhiệt trước đó |
| LCD không kết nối | Báo lỗi qua Serial; các chức năng còn lại tiếp tục chạy |

   
Trạng thái “cửa mở/đóng” hiện là lệnh đã gửi cho servo. Hệ thống chưa có cảm biến xác nhận cửa thực sự mở hoặc đóng.

# **4 Nội dung hiển thị**

LCD luân phiên 3 trang, mỗi trang 3 giây:

| Trang | Nội dung |
| :---- | :---- |
| 1 | Nhiệt độ, độ ẩm và trạng thái quạt |
| 2 | Sáng/tối, trạng thái PIR hoặc thời gian chờ khởi động |
| 3 | Lệnh cửa mở/đóng, trạng thái cảnh báo |

   
Khi cảnh báo nhiệt đang bật, LCD ưu tiên hiển thị cảnh báo nhiệt. Khi DHT11 lỗi, hiển thị thông báo lỗi thay cho số đo hiện tại.

# **5 Dữ liệu phần mềm cần nhận**

Đây là cấu trúc dữ liệu đề xuất cho bước tích hợp. Code hiện tại chưa truyền JSON qua mạng.

| Trường | Kiểu dữ liệu | Ý nghĩa |
| :---- | :---- | :---- |
| temperature\_c | Số hoặc null | Nhiệt độ °C; null nếu đọc lỗi |
| humidity\_pct | Số hoặc null | Độ ẩm %; null nếu đọc lỗi |
| dht\_ok | Boolean | DHT11 có dữ liệu hợp lệ |
| pir\_ready | Boolean | PIR đã hết thời gian khởi động |
| motion\_detected | Boolean | PIR đang báo chuyển động |
| is\_dark | Boolean | Cảm biến đang báo tối |
| door\_command | "open" / "closed" | Lệnh vị trí cửa |
| fan\_on | Boolean | Lệnh bật/tắt quạt |
| led1\_on | Boolean | Trạng thái LED1 |
| led2\_on | Boolean | Trạng thái LED2 |
| led3\_on | Boolean | Trạng thái LED3 |
| heat\_alarm | Boolean | Cảnh báo nhiệt đang hoạt động |
| uptime\_ms | Số nguyên | Thời gian ESP32 chạy từ lần khởi động |

   
Ví dụ một bản tin:

{  
   "temperature\_c": 36.0,  
   "humidity\_pct": 70.0,  
   "dht\_ok": true,  
   "pir\_ready": true,  
   "motion\_detected": true,  
   "is\_dark": true,  
   "door\_command": "open",  
   "fan\_on": true,  
   "led1\_on": true,  
   "led2\_on": true,  
   "led3\_on": false,  
   "heat\_alarm": false,  
   "uptime\_ms": 120000  
 }

# **6 Phạm vi tích hợp phần mềm**

Hiện tại ESP32 tự điều khiển tại chỗ và xuất thông tin qua Serial 115200 baud. Chưa có Wi-Fi, MQTT, API hay nhận lệnh từ ứng dụng.

Người phát triển phần mềm có thể dùng đặc tả trên để xây dựng:

·        Dashboard hiển thị số đo, trạng thái thiết bị và lỗi cảm biến.  
·        Biểu đồ lịch sử nhiệt độ, độ ẩm.  
·        Nhật ký chuyển động, lệnh cửa, quạt và cảnh báo nhiệt.  
·        Cảnh báo khi nhiệt độ cao hoặc DHT11 mất dữ liệu.

