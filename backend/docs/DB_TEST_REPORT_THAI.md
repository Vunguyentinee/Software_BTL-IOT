# Báo cáo kiểm thử Database & History

## 1. Phạm vi báo cáo

Báo cáo này tổng hợp hai loại bằng chứng:

1. kiểm thử tự động trong repository;
2. thực nghiệm restart do Người 5 cung cấp.

Các kết luận chỉ đọc từ source được ghi riêng, không được trình bày như kết quả thực nghiệm. Không có ảnh hoặc log giả được tạo trong tài liệu này.

## 2. Kết quả kiểm thử tự động được cung cấp

| Hạng mục | Kết quả |
|---|---|
| Toàn bộ pytest với PostgreSQL test riêng | **138 passed** |
| Cảnh báo | **1 `StarletteDeprecationWarning`** |
| PostgreSQL integration database | `smarthome_test` trên cổng `55432` |
| Commit test persistence | `4bfaf05` – integration test qua Storage instance mới |

Kết quả `138 passed` và một `StarletteDeprecationWarning` là bằng chứng do Người 5 cung cấp; tài liệu này không nhận là đã chạy lại bộ test khi tạo báo cáo. Nguyên văn warning vẫn cần được bổ sung vào artifact kiểm thử.

Các nhóm test liên quan trực tiếp:

| Chức năng | Test/source tiêu biểu | Nội dung đã kiểm tra |
|---|---|---|
| Statistics | `backend/tests/test_storage.py`, `test_postgres_storage.py` – các test `history_stats` | AVG/MIN/MAX/COUNT, `NULL`, giá trị không hữu hạn, kiểu kết quả, biên inclusive và validation |
| Pagination | Các test `history_page` trong hai file Storage test | 120 hàng/5 trang, timestamp trùng, thứ tự ổn định, `NULL`, boolean, biên và input sai |
| CSV | Các test `history_csv` trong hai file Storage test | Header/CRLF/escaping UTF-8, boolean, timestamp int/float, batch 1/1000, nhiều batch, snapshot và đối chiếu hai Storage |
| Persistence qua instance mới | `test_all_data_groups_survive_new_storage_instance()` | Ghi telemetry, event, command, config bằng một `PostgresStorage`; đọc marker bằng instance mới |
| Service/PostgreSQL | `test_service_works_on_postgres()` | Telemetry và command ACK đi qua Service với PostgreSQL |

### Ý nghĩa và giới hạn của test instance mới

`test_all_data_groups_survive_new_storage_instance()` chứng minh dữ liệu đã ghi có thể được một connection pool/Storage instance mới đọc lại trong cùng PostgreSQL test database. Test này bao phủ đủ bốn nhóm dữ liệu và đối chiếu marker cụ thể, không chỉ so sánh `COUNT(*)`.

Test không tự restart process PostgreSQL, container Docker hay Docker daemon. Vì vậy nó là bằng chứng persistence qua vòng đời Storage/connection, không thay thế thực nghiệm restart container.

## 3. Thực nghiệm trên môi trường demo

Theo bằng chứng Người 5 cung cấp:

| Bước/đối tượng | Kết quả thực nghiệm |
|---|---|
| Marker telemetry | `id = 2957`, `temperature_c = 13`, `humidity_pct = 60`, `fan_on = false` |
| Restart backend demo | Marker trên còn tồn tại và các giá trị đối chiếu giữ nguyên |
| Restart PostgreSQL demo | Marker trên còn tồn tại và các giá trị đối chiếu giữ nguyên |
| Đọc qua API | `/api/history` đọc lại được lịch sử tương ứng sau restart |

Thực nghiệm này xác nhận một bản ghi telemetry cụ thể đã commit vẫn đọc được sau restart backend và PostgreSQL demo. Nó không chỉ dựa trên số lượng hàng.

Tại thời điểm kiểm tra, database demo có dữ liệu `telemetry`, còn `events`, `commands`, `config` đều trống. Vì vậy thực nghiệm demo chỉ chứng minh persistence cho telemetry; không được suy rộng thành bằng chứng thực nghiệm cho ba bảng còn lại. Việc đủ bốn bảng được kiểm tra riêng trên database/container test ở mục sau.

## 4. Thực nghiệm trên PostgreSQL test container `btl-iot-testdb`

Theo bằng chứng Người 5 cung cấp, bốn marker đã được tạo trong `telemetry`, `events`, `commands`, `config`; sau `docker restart btl-iot-testdb`, bốn bản ghi trước/sau có nội dung giống nhau.

| Bảng | Đối chiếu marker sau restart cùng container |
|---|---|
| `telemetry` | Khớp |
| `events` | Khớp |
| `commands` | Khớp |
| `config` | Khớp |

Đây là kiểm thử restart **cùng container**. Container `btl-iot-testdb` không được cấu hình named volume riêng, nên kết quả này chỉ chứng minh dữ liệu còn nguyên khi dừng và khởi động lại chính container đó. Nó không chứng minh dữ liệu sống qua thao tác xóa rồi tạo lại test container.

Kịch bản `docker compose down` rồi `docker compose up -d` không kèm `-v` đối với stack demo là phép kiểm tra khác: Compose sẽ tạo lại container và dùng lại named volume `pgdata` theo `docker-compose.yml`. Theo thông tin được cung cấp, kịch bản này **chưa thực hiện**; báo cáo không ghi down/up là đã thành công. Không được dùng kết quả của `btl-iot-testdb` để thay thế bằng chứng cho kịch bản volume của stack demo.

## 5. Đối chiếu từ source, không phải thực nghiệm

Các điểm sau được xác nhận bằng cách đọc source:

- `docker-compose.yml` mount named volume `pgdata` vào `/var/lib/postgresql/data` của PostgreSQL 16.
- `PostgresStorage.__init__()` chạy `CREATE TABLE/INDEX IF NOT EXISTS`; không reset dữ liệu khi backend khởi động bình thường.
- Các thao tác ghi dùng pool `autocommit=True`, nên statement thành công được commit khi hoàn tất.
- `config` giữ một hàng bằng `id = 1`; các lần lưu sau là upsert.
- `Service._initial_config()` đọc cấu hình đã lưu sau khi Service được tạo lại và chuyển trạng thái runtime về `pending` để chờ publish/ACK mới.

Các điểm source trên giải thích cơ chế, nhưng không tự thân là bằng chứng một thao tác Docker cụ thể đã chạy thành công.

## 6. Danh mục minh chứng cần bổ sung

Không tạo file ảnh/log giả. Khi hoàn thiện hồ sơ, bổ sung các artifact thật vào vị trí do nhóm thống nhất, ví dụ:

| Minh chứng | Trạng thái/đường dẫn |
|---|---|
| Output pytest đầy đủ, gồm dòng `138 passed` và nguyên văn `StarletteDeprecationWarning` | TODO: `<đường-dẫn-log-pytest>` |
| Ảnh/SQL hàng telemetry `id = 2957`, `temperature_c = 13`, `humidity_pct = 60`, `fan_on = false` trước restart demo | TODO: `<đường-dẫn-ảnh-trước-demo>` |
| Ảnh container status trước/sau restart backend và PostgreSQL demo | TODO: `<đường-dẫn-ảnh-container-demo>` |
| Ảnh/SQL telemetry `id = 2957` sau restart | TODO: `<đường-dẫn-ảnh-sau-demo>` |
| Kết quả gọi `/api/history` sau restart | TODO: `<đường-dẫn-log-api-history>` |
| SQL và nội dung cụ thể của bốn marker trước/sau `docker restart btl-iot-testdb` | TODO: `<đường-dẫn-log-marker-test>` |
| `docker inspect btl-iot-testdb` ghi nhận cấu hình lưu trữ thực tế, gồm việc không có named volume riêng | TODO: `<đường-dẫn-log-inspect-test-container>` |
| SHA commit và `git status` khi chạy test | TODO: `<đường-dẫn-log-git>` |

Mỗi ảnh/log nên có thời gian, tên container/database, câu lệnh đã chạy và ID/config ID/cmd ID dùng để đối chiếu. Không đưa mật khẩu hoặc connection URL chứa credential vào artifact công khai.

## 7. Kết luận kiểm thử

- Bộ test tự động được báo cáo đạt 138 test, gồm integration test đọc lại đủ bốn nhóm qua Storage instance mới.
- Thực nghiệm demo đã xác minh telemetry `id = 2957` với các giá trị đối chiếu cụ thể và API history sau restart backend/PostgreSQL; ba bảng còn lại khi đó trống.
- Thực nghiệm `btl-iot-testdb` đã xác minh marker đủ bốn bảng qua `docker restart` cùng container, không phải qua xóa/tạo lại container.
- Chưa có bằng chứng thực nghiệm `docker compose down/up` tạo lại container nhưng giữ volume.
- Chưa có dữ liệu demo cho `events`, `commands`, `config` để xác minh restart đủ bốn bảng ngay trên môi trường demo.
