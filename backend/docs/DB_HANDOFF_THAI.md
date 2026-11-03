# Bàn giao Database & History

## 1. Phạm vi đã hoàn thành

Các phần đã triển khai ở tầng Storage:

| Commit | Chức năng |
|---|---|
| `d9015e2` | `history_stats()` – COUNT/AVG/MIN/MAX |
| `19748b5` | `history_page()` – phân trang lịch sử |
| `393a3f3` | `history_csv()` – xuất CSV theo batch/keyset |
| `4bfaf05` | Integration test persistence qua Storage instance mới |

Ba method lịch sử mới có trong `Storage` Protocol, `InMemoryStorage` và `PostgresStorage`. `backend/app/api.py` hiện chỉ expose `GET /api/history` dùng method cũ `history()`. Chưa có endpoint REST cho statistics, pagination hoặc CSV trong source hiện tại.

## 2. Contract Storage

### `history_stats()`

```python
history_stats(
    metric: str,
    start: Optional[float],
    end: Optional[float],
) -> HistoryStats
```

`HistoryStats` là `TypedDict`:

```python
{
    "count": int,
    "avg": float | None,
    "min": float | None,
    "max": float | None,
}
```

- Metric hợp lệ: `temperature_c`, `humidity_pct`, `smoke_raw`.
- Bỏ qua `NULL`/`None`, `NaN`, `Infinity`, `-Infinity`; không đổi thành 0.
- Không còn mẫu hợp lệ: `count = 0`, ba giá trị còn lại là `None`.
- `avg`, `min`, `max` được chuẩn hóa thành `float`, kể cả `smoke_raw`; `count` là `int`.
- PostgreSQL dùng allowlist `HISTORY_STATS_SQL`, vì vậy tên cột/predicate không lấy từ chuỗi chưa kiểm tra.

### `history_page()`

```python
history_page(
    metric: str,
    start: Optional[float],
    end: Optional[float],
    limit: int,
    offset: int,
) -> list[dict]
```

Mỗi phần tử có dạng `{"ts": <Unix timestamp giây>, "value": <giá trị metric>}`.

- `limit`: số nguyên, không nhận `bool`, từ 1 đến 1000.
- `offset`: số nguyên, không nhận `bool`, lớn hơn hoặc bằng 0.
- Bỏ hàng có giá trị metric `NULL`.
- Sắp xếp tăng dần theo timestamp; PostgreSQL dùng `ORDER BY ts, id`, InMemory dùng timestamp và thứ tự ghi.
- PostgreSQL thực thi `LIMIT/OFFSET` trong SQL với parameter binding.

### `history_csv()`

```python
history_csv(
    metric: str,
    start: Optional[float],
    end: Optional[float],
    batch_size: int = 1000,
) -> Iterator[bytes]
```

- `batch_size`: số nguyên, không nhận `bool`, từ 1 đến 1000.
- Iterator trả các chunk byte UTF-8.
- Dòng đầu: `ts,value\r\n`.
- Timestamp CSV được ghi dưới dạng `float`, giữ đơn vị Unix giây.
- `csv.writer` xử lý quoting/escaping và CRLF.
- Boolean được biểu diễn đúng contract test hiện tại là `True`/`False`.
- PostgreSQL chốt `max(id)` khi gọi method, sau đó đọc từng batch bằng keyset `(ts,id)`; không `fetchall()` toàn bộ lịch sử.
- InMemory tạo snapshot O(n) của các trường xuất. Đây là giới hạn thiết kế được chấp nhận vì `max_telemetry` giới hạn deque.

## 3. Danh sách 15 metric lịch sử

Allowlist `HISTORY_METRICS` trong `backend/app/storage.py` gồm đúng:

1. `temperature_c`
2. `humidity_pct`
3. `dht_ok`
4. `pir_ready`
5. `motion_detected`
6. `is_dark`
7. `fan_on`
8. `led1_on`
9. `led2_on`
10. `led3_on`
11. `heat_alarm`
12. `uptime_ms`
13. `smoke_raw`
14. `smoke_alarm`
15. `pump_on`

`door_command` và `modes` không nằm trong allowlist lịch sử. Không tự mở rộng hoặc thu hẹp danh sách mà không thống nhất lại contract.

## 4. Validation chung

`validate_history_time_range()` được dùng bởi ba method mới:

- `start`/`end` là Unix timestamp giây hoặc `None`;
- nếu có giá trị, phải hữu hạn; `NaN`, `Infinity`, `-Infinity` gây `ValueError`;
- nếu có cả hai, yêu cầu `start <= end`;
- lọc thời gian bao gồm cả `start` và `end`.

Metric được kiểm tra bằng allowlist trước khi nội suy tên cột vào SQL. Các giá trị thời gian, `limit`, `offset`, `batch_size` đều được truyền bằng parameter binding.

Lưu ý: method cũ `history()` được giữ nguyên để tương thích. Validation chặt nêu trên là contract của ba method mới, không nên suy diễn rằng method cũ đã được refactor giống hệt.

## 5. Phối hợp Vũ – tích hợp backend/API

### API hiện có

Source hiện có:

- `GET /api/history?metric=&from=&to=` → `service.storage.history()`;
- `GET /api/events`, `GET /api/commands`, `GET /api/commands/{cmd_id}`;
- API command/config/state và WebSocket `/ws`.

Không có endpoint statistics, paginated history hoặc CSV. Các endpoint dưới đây chỉ là đề xuất contract để Vũ thống nhất, chưa phải chức năng đã tích hợp:

| Đề xuất | Storage method | Kết quả |
|---|---|---|
| `GET /api/history/stats?metric=&from=&to=` | `history_stats()` | JSON `{count,avg,min,max}` |
| `GET /api/history/page?metric=&from=&to=&limit=&offset=` | `history_page()` | JSON `[{ts,value}]` |
| `GET /api/history.csv?metric=&from=&to=&batch_size=` | `history_csv()` | Stream `text/csv` |

Tên endpoint cuối cùng cần Vũ/Đức thống nhất; không nên coi bảng trên là API đã chốt.

### `StreamingResponse` và thời điểm xử lý lỗi

`history_csv()` hiện validation và chốt high-water trước khi trả iterator, nên Vũ cần gọi method trong `try/except` **trước** khi tạo/trả `StreamingResponse`:

```python
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

try:
    chunks = service.storage.history_csv(metric, start, end, batch_size)
except ValueError as exc:
    raise HTTPException(status_code=422, detail=str(exc))

return StreamingResponse(
    chunks,
    media_type="text/csv; charset=utf-8",
    headers={"Content-Disposition": "attachment; filename=history.csv"},
)
```

Không bọc lời gọi `history_csv()` vào một generator khác theo cách trì hoãn việc gọi đến lúc response đã bắt đầu, vì khi đó `ValueError` validation có thể xuất hiện sau khi HTTP headers đã gửi. `_parse_time()` hiện có thể chuyển chuỗi `nan`/`inf` thành float; endpoint mới phải để Storage từ chối và chuyển `ValueError` thành HTTP 422.

Lỗi database phát sinh trong các batch sau vẫn có thể xảy ra sau khi streaming đã bắt đầu; HTTP lúc đó không thể đổi sang response JSON 5xx/422 thông thường. Cần log lỗi, theo dõi download thất bại và để client phát hiện stream bị ngắt.

## 6. Phối hợp Đức – frontend

Các điểm cần chốt trước khi nối UI:

- Biểu đồ: chọn metric trong allowlist; `ts` là Unix giây; `value` có thể là số hoặc boolean tùy metric; hàng `NULL` không xuất hiện.
- Thống kê: UI phải hiển thị trạng thái rỗng khi `count = 0` và `avg/min/max = null`, không hiển thị 0 giả.
- Phân trang: `limit` tối đa 1000; OFFSET không phải cursor ổn định tuyệt đối nếu dữ liệu mới được chèn giữa các request. UI nên tải theo trang và có hành vi refresh rõ ràng.
- CSV: header chính xác `ts,value`, UTF-8, CRLF; boolean là `True`/`False`. Frontend nên dùng filename/content type từ response và không parse toàn bộ file vào RAM chỉ để tải xuống.
- Phải thống nhất tên endpoint/query và cách hiển thị timezone. Dữ liệu truyền là epoch giây; việc đổi sang giờ địa phương thuộc tầng hiển thị.
- Với cửa, không mô tả command/ACK hoặc `door_command` là cảm biến xác nhận vị trí vật lý vì source không có trường xác nhận đó.

## 7. Giới hạn và rủi ro còn lại

| Chủ đề | Hiện trạng/giới hạn |
|---|---|
| Telemetry QoS 0 | Telemetry có thể mất khi broker/backend không nhận được bản tin; đây là mất trước khi commit, khác với mất dữ liệu PostgreSQL đã commit |
| Event dedup | Event dùng QoS 1 nhưng schema không có event ID/idempotency key; bản tin phát lại có thể tạo hàng trùng |
| Online/offline | Trạng thái connection nằm trong bộ nhớ Service và WebSocket, không có bảng persistence; restart backend dựng lại trạng thái ban đầu |
| Command ACK | Không có hàng ACK riêng; ACK hợp lệ cập nhật `status`, `detail`, `ack_ts` của hàng `commands`. ACK lặp, không rõ ID hoặc đến sau trạng thái cuối bị bỏ qua |
| CSV MVCC snapshot | High-water ID loại insert ID mới, nhưng các batch là transaction autocommit riêng; không phải snapshot MVCC duy nhất cho toàn phiên |
| Config ACK runtime | Bảng chỉ lưu `config_id`, thresholds và `ts`; trạng thái `applied/rejected/timeout` cùng detail không được lưu bền. Sau restart cấu hình được coi là `pending` |
| Index | Chỉ có `telemetry(ts)`, `events(ts)`, `commands(sent_ts)`; chưa có benchmark cho keyset `(ts,id)` hoặc truy vấn khối lượng lớn |
| Retention | Chưa có TTL, archive, partition hoặc giới hạn dung lượng PostgreSQL trong source |
| OFFSET | Offset lớn tốn chi phí và có thể lặp/bỏ vị trí giữa các request nếu dữ liệu thay đổi; keyset pagination là hướng mở rộng, chưa triển khai cho API trang |
| Backend security | `api.py` cho CORS `*`; source chưa có authentication/authorization, rate limiting hay giới hạn export theo người dùng |
| Cửa vật lý | Không có sensor-confirmed door position trong schema/model |

## 8. Chạy test PostgreSQL an toàn

Integration test chỉ được phép trỏ tới database test `smarthome_test` trên cổng `55432`. Fixture trong `backend/tests/test_postgres_storage.py` có guard kiểm tra cả port và tên database, sau đó mới dùng `reset()` cho test isolation.

Ví dụ PowerShell từ thư mục repository:

```powershell
$env:BTL_TEST_DATABASE_URL = 'postgresql://smarthome:smarthome@localhost:55432/smarthome_test'
python -m pytest backend/tests --basetemp='D:\IOT-BTL\_pytest_thai_temp'
```

Trước khi chạy, kiểm tra URL không trỏ đến cổng demo `5432` và database không phải `smarthome`. Không chạy integration test bằng credential/URL production hoặc demo. Sau khi chạy có thể xóa biến môi trường khỏi phiên shell:

```powershell
Remove-Item Env:BTL_TEST_DATABASE_URL
```

## 9. Điểm vào source để tiếp tục tích hợp

| Thành phần | File/class/method |
|---|---|
| Contract và validation | `backend/app/storage.py`: `Storage`, `HistoryStats`, `validate_history_*` |
| In-memory reference | `backend/app/storage.py`: `InMemoryStorage.history_stats/history_page/history_csv` |
| PostgreSQL | `backend/app/pg_storage.py`: `PostgresStorage.history_stats/history_page/history_csv`, `_history_csv_rows` |
| API hiện hành | `backend/app/api.py`: `create_app()`, route `history()` và `_parse_time()` |
| Service | `backend/app/service.py`: `Service` |
| Model/metric API | `backend/app/models.py`: `Telemetry`, `Thresholds`; `backend/app/api.py`: `METRICS` |
| Integration test | `backend/tests/test_postgres_storage.py` |
