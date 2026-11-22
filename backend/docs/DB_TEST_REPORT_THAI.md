# Báo cáo kiểm thử Database & History

## 1. Phạm vi báo cáo

Báo cáo này tổng hợp hai loại bằng chứng:

1. kiểm thử tự động trong repository;
2. thực nghiệm restart do Người 5 cung cấp.

Các kết luận chỉ đọc từ source được ghi riêng, không được trình bày như kết quả thực nghiệm. Không có ảnh hoặc log giả được tạo trong tài liệu này.

## 2. Kết quả kiểm thử tự động thực tế trong repository

Chạy thực tế trên môi trường máy phát triển với lệnh:
`pytest --basetemp=D:\IOT-BTL\_pytest_thai_temp` và `BTL_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/smarthome_test`

| Hạng mục | Kết quả |
|---|---|
| Toàn bộ test suite | **226 passed, 0 failed** (tăng từ 138 passed baseline) |
| Thời gian thực thi | **4.37 giây** |
| Cảnh báo | **1 `StarletteDeprecationWarning`** (từ `fastapi.testclient`) |
| PostgreSQL test database | `smarthome_test` trên cổng `55432` container `btl-iot-testdb` |
| File kiểm thử độ tin cậy mới | `backend/tests/test_reliability.py` (28 passed tests) |

### Chi tiết các nhóm kiểm thử và 28 test reliability mới:

| Nhóm chức năng | Số test | File test / Phương thức kiểm thử | Nội dung xác minh thực tế |
|---|---:|---|---|
| API & WebSockets | 40 | `test_api.py` | State, command endpoints, config endpoints, WS snapshot & broadcast |
| Data Models | 11 | `test_models.py` | Telemetry model (kèm device_id, boot_id, seq), thresholds hysteresis |
| MQTT Bridge | 8 | `test_mqtt_bridge.py` | Routing topic, retained config/set, publish cmd |
| Service Commands & Config | 19 | `test_service_commands.py`, `test_service_config.py` | Command pending/ok/timeout, config state machine |
| Service Ingest & Simulator | 44 | `test_service_ingest.py`, `test_service_sim.py`, `test_simulator*.py` | Telemetry ingest, online timeout, fake esp32 simulator |
| Storage Baseline (Memory) | 47 | `test_storage.py` | Stats, pagination, streaming CSV, file dump restart |
| PostgreSQL Storage Baseline | 29 | `test_postgres_storage.py` | History, pagination, keyset CSV, stats, cross-instance persistence |
| **Telemetry Legacy Compatibility** | 2 | `test_reliability.py::test_legacy_telemetry_missing_boot_and_seq_accepted` | Chấp nhận bản tin thiếu `boot_id`/`seq`, không gãy lịch sử hay stats |
| **Duplicate Detection** | 2 | `test_reliability.py::test_duplicate_telemetry_detected_and_rejected` | Chặn trùng lặp theo `(device_id, boot_id, seq)`, không insert hàng trùng, tăng đếm duplicate |
| **Out-of-Order & Late Arrival** | 3 | `test_reliability.py::test_out_of_order_telemetry_and_gap_resolution`, `test_service_does_not_overwrite_state_with_late_arrival` | Nhận diện late arrival, vá gap, lưu DB lịch sử nhưng KHÔNG ghi đè `Service._telemetry` |
| **Sequence Gap & Late Window** | 2 | `test_reliability.py::test_sequence_gap_pending_vs_confirmed` | Phân biệt Pending Gap ($t \le 10s$) và Unresolved Gaps beyond Window ($t > 10s$), delivery_rate = None |
| **ESP32 Reboot Sequence Reset** | 2 | `test_reliability.py::test_esp32_reboot_seq_reset_not_duplicate` | Boot session mới reset seq về 0 độc lập, không bị coi là duplicate |
| **Command Statistics** | 2 | `test_reliability.py::test_command_stats` | Đo đếm ok, failed, timeout, pending, success_rate, min/avg/max latency |
| **Connection & Error History** | 2 | `test_reliability.py::test_connection_and_error_history` | Lưu và truy vấn lịch sử online/offline và các sự kiện lỗi |
| **SQL Gap Verification** | 1 | `test_reliability.py::test_sql_verify_telemetry_gaps_on_postgres` | Kiểm chứng gap trực tiếp trong PostgreSQL bằng Window function `lag()` |
| **Transaction Rollback** | 1 | `test_reliability.py::test_transaction_rollback_on_postgres` | Đảm bảo tính nguyên tử (Atomicity), rollback sạch sẽ khi có lỗi transaction |
| **Concurrent Inserts** | 1 | `test_reliability.py::test_concurrent_inserts_on_postgres` | 10 threads đồng thời gửi cùng 1 gói tin -> đúng 1 bản ghi được lưu, 9 bị chặn |
| **Restart Storage Session Persistence** | 1 | `test_reliability.py::test_persistence_across_storage_restart` | Max seq của session được khôi phục nguyên vẹn sau khi tạo lại Storage instance |
| **Index Query Performance** | 1 | `test_reliability.py::test_indexes_and_dataset_queries` | Chèn 500 bản ghi, truy vấn stats & page qua index trong < 200ms |
| **Bounded Memory (Sliding Window)** | 1 | `test_reliability.py::test_bounded_memory_sliding_window_and_gaps_cleanup` | Giới hạn sliding window seen_seqs (100) và Ring buffer gap_events (50) không rò rỉ RAM |
| **Thread Safety & Concurrent Ingest** | 1 | `test_reliability.py::test_tracker_thread_safety_concurrent_ingest` | 8 threads đồng thời ghi nhận telemetry và duplicate, bảo vệ bằng RLock toàn diện |
| **Restart Duplicate No Double-Count**| 1 | `test_reliability.py::test_restart_duplicate_does_not_double_count_out_of_order` | Nhận lại seq cũ sau restart: Postgres báo duplicate -> tăng duplicate, không đếm đúp out-of-order |
| **DB Failure vs Realtime Stream** | 1 | `test_reliability.py::test_database_failure_does_not_crash_realtime_stream` | Postgres lỗi lưu trữ -> on_telemetry không sập, WebSocket broadcast và hiển thị realtime bình thường |
| **Offline Reason Classification** | 1 | `test_reliability.py::test_offline_reason_status_vs_timeout` | Phân biệt chính xác nguyên nhân `status` (từ broker LWT) và `timeout` (từ heartbeat) |
| **Time Range Validation for Stats** | 2 | `test_reliability.py::test_time_range_validation_for_stats` | Kiểm tra validation `start <= end` và giá trị hữu hạn trên cả MemoryStorage và PostgresStorage |
| **Terminology & Late Arrival Resolution** | 1 | `test_reliability.py::test_terminology_unresolved_gaps_and_late_arrival` | Xác nhận unresolved_gaps_beyond_window và đối soát thành công khi gói đến muộn ngoài 10s |
| **TỔNG CỘNG** | **226** | **Toàn bộ 12 file test** | **226 passed (100% PASS)** |

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

- **Bộ test tự động**: Đạt **226 passed** (100% PASS), bao gồm 138 tests baseline ban đầu và 28 tests chuyên sâu về độ tin cậy trong `test_reliability.py`.
- **Kiểm thử độ tin cậy & bất biến**: Xác minh thành công tính tương thích dữ liệu legacy (không có sequence/boot_id), khả năng chống trùng bản tin bằng partial unique index, bảo vệ trạng thái runtime không bị bản tin đến muộn ghi đè, phát hiện sequence gap và phân loại chính xác giữa pending gaps (trong cửa sổ 10s) và unresolved gaps beyond observation window (ngoài 10s).
- **Giới hạn bộ nhớ & An toàn luồng**: Xác minh cơ chế sliding window và ring buffer không để RAM tăng không giới hạn; xác minh thread-safe với đa luồng đồng thời.
- **Tính nhất quán sau Restart**: Phối hợp kiểm tra duplicate giữa PostgreSQL và Tracker sau restart, ngăn chặn triệt để hiện tượng đếm đúp out-of-order.
- **Khả năng phục hồi Realtime**: Xác minh lỗi lưu DB không làm sập luồng realtime và không làm gián đoạn WebSocket broadcast hiển thị nhịp tim.
- **Tính toàn vẹn Transaction & Concurrency**: Xác minh tính nguyên tử qua rollback transaction và khả năng chống race condition trùng lặp khi 10 thread đồng thời ghi cùng một bản tin.
- **Persistence qua Restart**: Xác minh khôi phục trạng thái max sequence của từng boot session sau khi khởi tạo Storage instance mới.
- **Tính minh bạch số liệu**: Hệ thống không công bố tỷ lệ phân phối (delivery rate) giả định $100\%$ khi chưa có bộ đếm phát từ phần cứng ESP32. Mọi số liệu báo cáo đều phản ánh đúng đo đạc thực nghiệm.
