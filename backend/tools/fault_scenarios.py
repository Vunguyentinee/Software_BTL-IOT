r"""Kịch bản lỗi và hiệu năng chạy trên stack Docker thật. Ghi kết quả ra JSON và in bảng PASS/FAIL.

Dùng một project Docker riêng để không đụng hệ thống đang chạy:
    docker compose -p btlfault --env-file <env> --profile sim up -d --build
    backend/.venv/Scripts/python backend/tools/fault_scenarios.py --env <env> --project btlfault --out ket_qua.json

Các kịch bản: F1 restart backend, F2 MQTT mất kết nối, F3 PostgreSQL ngừng, F4 burst telemetry + độ chính xác
đo mất gói/trùng, F5 độ trễ lệnh (bình thường và khi có tải).
CẢNH BÁO: số liệu độ trễ lấy từ ESP32 GIẢ LẬP trên localhost, KHÔNG dùng làm số đo của thiết bị thật.
"""
import argparse
import json
import math
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from load_telemetry import read_env, run_load  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RESULTS: list[dict] = []
TOKEN: dict = {"v": None}


def record(sid, name, criterion, measured, ok):
    RESULTS.append({"id": sid, "name": name, "criterion": criterion, "measured": measured, "pass": bool(ok)})
    print(("PASS" if ok else "FAIL"), "-", sid, name, "|", measured, flush=True)


class Stack:
    def __init__(self, project, env_file):
        self.base = ["docker", "compose", "-p", project, "--env-file", env_file, "--profile", "sim"]
        env = read_env(env_file)
        self.api = f"http://localhost:{env.get('API_PORT', 8000)}"
        self.env = env

    def compose(self, *args):
        return subprocess.run(self.base + list(args), cwd=ROOT, capture_output=True, text=True, timeout=300)

    def http(self, method, path, body=None, auth=False, timeout=40):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.api + path, method=method, data=data)
        req.add_header("Content-Type", "application/json")
        if auth:
            if TOKEN["v"] is None:
                TOKEN["v"] = self.login()
            req.add_header("Authorization", "Bearer " + TOKEN["v"])
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                payload = json.loads(r.read() or b"null")
                return r.status, payload, time.perf_counter() - t0
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read() or b"null")
            except Exception:
                payload = None
            return e.code, payload, time.perf_counter() - t0
        except Exception as e:  # kết nối bị từ chối, timeout...
            return 0, str(e), time.perf_counter() - t0

    def login(self):
        code, body, _ = self.http("POST", "/api/auth/login",
                                  {"username": self.env["UI_USERNAME"], "password": self.env["UI_PASSWORD"]})
        assert code == 200, f"đăng nhập thất bại: {code} {body}"
        return body["access_token"]


def wait_for(pred, timeout, interval=0.25):
    """Trả về số giây đã chờ, hoặc None nếu quá hạn."""
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < timeout:
        try:
            if pred():
                return time.perf_counter() - t0
        except Exception:
            pass
        time.sleep(interval)
    return None


def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    return s[max(1, math.ceil(p / 100 * len(s))) - 1]


def summary_ms(values):
    if not values:
        return {"n": 0}
    return {"n": len(values), "avg_ms": round(sum(values) / len(values) * 1000, 1),
            "p95_ms": round(pct(values, 95) * 1000, 1), "max_ms": round(max(values) * 1000, 1)}


def health(st):
    code, body, _ = st.http("GET", "/api/health", timeout=5)
    return body if code == 200 else None


def device_online(st):
    h = health(st)
    return bool(h and h["device_online"])


def reliability(st, device_id=None):
    q = f"?device_id={device_id}" if device_id else ""
    return st.http("GET", "/api/history/reliability" + q, timeout=10)[1]


# ---------------------------------------------------------------------------
def f0_ready(st):
    t = wait_for(lambda: device_online(st), 90)
    record("F0", "Hệ thống sẵn sàng (simulator online)", "device_online trong 90 s", f"{t and round(t, 1)} s", t is not None)
    if t is None:
        sys.exit("stack chưa sẵn sàng")


def f1_restart_backend(st):
    hist_before = len(st.http("GET", "/api/history?metric=temperature_c")[1])
    rel_before = reliability(st)
    t0 = time.perf_counter()
    st.compose("restart", "backend")
    api_up = wait_for(lambda: health(st) is not None, 60) or math.inf
    online = wait_for(lambda: device_online(st), 60) or math.inf
    total = time.perf_counter() - t0
    hist_after = len(st.http("GET", "/api/history?metric=temperature_c")[1])
    rel_after = reliability(st)
    record("F1a", "Restart backend: API hoạt động lại", "< 30 s", f"{round(api_up + 0, 1)} s sau lệnh restart (đã tính khởi động)", api_up < 30)
    record("F1b", "Restart backend: ESP32 online lại", "< 30 s", f"tổng {round(total, 1)} s", total < 30)
    record("F1c", "Restart backend: lịch sử không mất", "số điểm sau >= trước",
           f"trước={hist_before}, sau={hist_after}", hist_after >= hist_before)
    record("F1d", "Restart backend: không ghi trùng dữ liệu cũ",
           "stored_count tăng đúng bằng bản tin mới, trùng không tăng đột biến",
           f"stored {rel_before['stored_count']}→{rel_after['stored_count']}, "
           f"duplicate {rel_before['duplicate_count']}→{rel_after['duplicate_count']}",
           rel_after["duplicate_count"] <= rel_before["duplicate_count"] + 2)


def f2_mqtt_down(st):
    cmds_before = {c["cmd_id"] for c in st.http("GET", "/api/commands?limit=200")[1]}
    t0 = time.perf_counter()
    st.compose("stop", "mosquitto")
    detect = wait_for(lambda: (health(st) or {}).get("mqtt", {}).get("connected") is False, 20)
    record("F2a", "MQTT ngừng: /api/health báo mất kết nối", "< 10 s", f"{detect and round(detect, 1)} s", detect is not None and detect < 10)
    code, body, dt = st.http("POST", "/api/devices/fan/command", {"action": "on"}, auth=True)
    record("F2b", "MQTT ngừng: lệnh KHÔNG bị xếp hàng, báo lỗi rõ", "HTTP 503 mqtt_publish_failed (hoặc 409 device_offline nếu đã offline)",
           f"{code} {body} ({round(dt, 2)} s)", code == 503 and body.get("detail") == "mqtt_publish_failed" or code == 409)
    off = wait_for(lambda: not device_online(st), 25)
    since_stop = time.perf_counter() - t0
    record("F2c", "MQTT ngừng: thiết bị bị coi là offline", "~10 s không có telemetry (offline_timeout_s=10)",
           f"{round(since_stop, 1)} s kể từ lúc dừng broker", off is not None and since_stop < 20)
    code2, body2, _ = st.http("POST", "/api/devices/fan/command", {"action": "off"}, auth=True)
    record("F2d", "Offline: từ chối lệnh", "HTTP 409 device_offline", f"{code2} {body2}", code2 == 409)
    t1 = time.perf_counter()
    st.compose("start", "mosquitto")
    mq = wait_for(lambda: (health(st) or {}).get("mqtt", {}).get("connected") is True, 60)
    dev = wait_for(lambda: device_online(st), 90)
    record("F2e", "MQTT trở lại: backend nối lại", "< 30 s", f"{mq and round(mq, 1)} s", mq is not None and mq < 30)
    record("F2f", "MQTT trở lại: ESP32 online lại", "< 60 s", f"{round(time.perf_counter() - t1, 1)} s", dev is not None and dev < 60)
    time.sleep(3)
    new = [c for c in st.http("GET", "/api/commands?limit=200")[1] if c["cmd_id"] not in cmds_before]
    state = st.http("GET", "/api/state")[1]
    fan = state["telemetry"]["fan_on"] if state.get("telemetry") else None
    stale = [c for c in new if c["status"] == "ok"]
    record("F2g", "Sau khi MQTT nối lại, lệnh cũ KHÔNG bị thực thi", "không có lệnh `ok` mới; fan_on=false",
           f"lệnh mới={[(c['action'], c['status'], c['detail']) for c in new]}, fan_on={fan}", not stale and fan is False)


def f3_db_down(st):
    st.compose("stop", "db")
    t0 = time.perf_counter()
    bad = wait_for(lambda: (health(st) or {}).get("storage", {}).get("ok") is False, 30)
    record("F3a", "DB ngừng: /api/health báo lỗi lưu trữ", "storage.ok=false trong 30 s", f"{bad and round(bad, 1)} s", bad is not None)
    code, body, dt = st.http("GET", "/api/history?metric=temperature_c", timeout=60)
    record("F3b", "DB ngừng: lịch sử báo lỗi rõ, không trả rỗng giả", "HTTP 503 storage_unavailable, phản hồi < 10 s",
           f"{code} {body} ({round(dt, 1)} s)", code == 503 and dt < 10)
    code, body, dt = st.http("GET", "/api/state")
    record("F3c", "DB ngừng: trạng thái hiện tại vẫn trả được", "HTTP 200, device online", f"{code} online={body.get('online') if isinstance(body, dict) else body} ({round(dt, 2)} s)",
           code == 200 and body.get("online") is True)
    code, body, dt = st.http("POST", "/api/devices/led1/command", {"action": "on"}, auth=True, timeout=60)
    record("F3d", "DB ngừng: lệnh báo lỗi rõ (không báo thành công giả)", "HTTP 503, < 10 s", f"{code} {body} ({round(dt, 1)} s)", code == 503 and dt < 10)
    h = health(st)
    record("F3e", "DB ngừng: số lỗi được đếm", "storage.errors >= 1", f"{h['storage']}", h["storage"]["errors"] >= 1)
    t1 = time.perf_counter()
    st.compose("start", "db")
    back = wait_for(lambda: st.http("GET", "/api/history?metric=temperature_c", timeout=10)[0] == 200, 90)
    ok = wait_for(lambda: (health(st) or {}).get("storage", {}).get("ok") is True, 30)
    record("F3f", "DB trở lại: tự phục hồi không cần restart backend", "< 60 s",
           f"history 200 sau {back and round(back, 1)} s, storage.ok sau {ok and round(ok, 1)} s", back is not None and back < 60 and ok is not None)


def f2p_partition(st):
    """Cắt mạng broker (kết nối TCP thành bán-mở: không ai biết đã đứt). Lệnh gửi lúc này không được thực thi muộn."""
    project = st.base[3]
    container, network = f"{project}-mosquitto-1", f"{project}_default"
    cmds_before = {c["cmd_id"] for c in st.http("GET", "/api/commands?limit=200")[1]}
    subprocess.run(["docker", "network", "disconnect", network, container], capture_output=True)
    code, body, _ = st.http("POST", "/api/devices/fan/command", {"action": "on"}, auth=True)
    cid = body.get("cmd_id") if isinstance(body, dict) else None
    record("F2h-a", "Cắt mạng bán-mở: lệnh gửi khi thiết bị còn 'online'", "nhận 200 pending hoặc báo lỗi rõ (không treo)",
           f"{code} {body}", code in (200, 409, 503))
    time.sleep(7)
    cmd = st.http("GET", f"/api/commands/{cid}")[1] if cid else None
    record("F2h-b", "Cắt mạng: lệnh không ACK chuyển `timeout` (không kẹt pending)", "status=timeout sau ~5 s",
           f"{cmd and (cmd['status'], cmd['detail'])}", cid is None or (cmd and cmd["status"] in ("timeout", "failed")))
    off = wait_for(lambda: not device_online(st), 25)
    record("F2h-c", "Cắt mạng: thiết bị bị coi offline", "< 25 s", f"{off and round(off, 1)} s sau", off is not None)
    t1 = time.perf_counter()
    subprocess.run(["docker", "network", "connect", "--alias", "mosquitto", network, container], capture_output=True)
    rec_s = wait_for(lambda: device_online(st) and (health(st) or {}).get("mqtt", {}).get("connected"), 180)
    record("F2h-d", "Nối mạng lại: hệ thống tự phục hồi", "< 120 s (không cần restart tay)",
           f"{rec_s and round(rec_s, 1)} s", rec_s is not None and rec_s < 120)
    time.sleep(4)
    state = st.http("GET", "/api/state")[1]
    fan = state["telemetry"]["fan_on"] if state.get("telemetry") else None
    cmds = {c["cmd_id"]: c for c in st.http("GET", "/api/commands?limit=200")[1] if c["cmd_id"] not in cmds_before}
    executed = [c for c in cmds.values() if c["status"] == "ok"]
    record("F2h-e", "Sau khi nối lại, lệnh cũ KHÔNG bị thực thi muộn", "không lệnh `ok` mới; fan_on=false",
           f"lệnh={[(c['action'], c['status'], c['detail']) for c in cmds.values()]}, fan_on={fan}", not executed and fan is False)


def sample_stats(st, container_suffix, stop, out):
    name = f"{st.base[3]}-{container_suffix}-1"
    while not stop.is_set():
        r = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}} {{.MemUsage}}", name],
                           capture_output=True, text=True, timeout=30)
        parts = r.stdout.split()
        if len(parts) >= 2:
            try:
                out.append((float(parts[0].strip("%")), parts[1]))
            except ValueError:
                pass


def command_burst(st, n, spacing=0.5):
    """Gửi n lệnh led1 on/off xen kẽ; trả về (danh sách độ trễ ack, độ trễ xác nhận, lỗi)."""
    ack, conf, errors, ids = [], [], 0, []
    for i in range(n):
        action = "on" if i % 2 == 0 else "off"
        code, body, _ = st.http("POST", "/api/devices/led1/command", {"action": action}, auth=True)
        if code == 200:
            ids.append(body["cmd_id"])
        else:
            errors += 1
        time.sleep(spacing)
    time.sleep(6)
    for cid in ids:
        c = st.http("GET", f"/api/commands/{cid}")[1]
        if c["status"] == "ok" and c.get("ack_ts"):
            ack.append(c["ack_ts"] - c["sent_ts"])
            if c.get("confirmed_ts"):
                conf.append(c["confirmed_ts"] - c["sent_ts"])
    return ack, conf, errors


def f4_f5_burst_and_latency(st):
    env = st.env
    # F5a: độ trễ lệnh khi mạng bình thường
    ack, conf, err = command_burst(st, 30)
    record("F5a", "Độ trễ lệnh (bình thường, 30 lệnh, SIMULATOR)", "100% lệnh ok; ghi avg/P95/max",
           {"ack": summary_ms(ack), "confirm": summary_ms(conf), "errors": err}, len(ack) == 30 - err and err == 0)

    # F4: burst + chính xác đo mất gói/trùng, đồng thời lệnh và đo CPU/RAM
    before = reliability(st, "loadtest")
    stop, samples = threading.Event(), []
    th = threading.Thread(target=sample_stats, args=(st, "backend", stop, samples), daemon=True)
    th.start()
    load_result: dict = {}

    def do_load():
        load_result.update(run_load("localhost", int(env.get("MQTT_PORT", 1883)), "esp32",
                                    env["MQTT_DEVICE_PASSWORD"], rate=200, count=4000,
                                    drop_every=100, dup_every=250))
    lt = threading.Thread(target=do_load)
    t0 = time.perf_counter()
    lt.start()
    time.sleep(2)
    ack2, conf2, err2 = command_burst(st, 15)       # lệnh trong lúc đang có tải
    lt.join()
    stop.set()
    th.join(timeout=35)
    wait_for(lambda: False, 12.5)                    # chờ qua cửa sổ muộn 10 s để gap thành "mất xác nhận"
    after = reliability(st, "loadtest")
    d = {k: after[k] - before[k] for k in ("received_count", "stored_count", "duplicate_count")}
    missing = after["missing_packets_confirmed"] - before["missing_packets_confirmed"]
    sent_unique, dropped, dups = load_result["sent_unique"], load_result["dropped"], load_result["duplicated"]
    record("F4a", "Burst 200 bản tin/s: nhận đủ", f"received tăng {sent_unique + dups}",
           f"gửi {load_result['achieved_rate']}/s, received +{d['received_count']}", d["received_count"] == sent_unique + dups)
    record("F4b", "Burst: lưu đủ, không lưu trùng", f"stored tăng {sent_unique}",
           f"stored +{d['stored_count']}", d["stored_count"] == sent_unique)
    record("F4c", "Burst: đếm đúng bản tin trùng", f"duplicate tăng {dups}", f"+{d['duplicate_count']}", d["duplicate_count"] == dups)
    record("F4d", "Burst: đếm đúng gói mất (bỏ seq có chủ đích)", f"missing_confirmed tăng {dropped}",
           f"+{missing}; tỷ lệ mất {round(missing / (sent_unique + dropped) * 100, 2)} %", missing == dropped)
    cpu = max((c for c, _ in samples), default=None)
    record("F4e", "Burst: tài nguyên backend (CPU/RAM, docker stats)", "ghi nhận; backend còn phản hồi",
           f"CPU max={cpu}% ; RAM mẫu cuối={samples[-1][1] if samples else None} ; {len(samples)} mẫu", cpu is not None)
    record("F5b", "Độ trễ lệnh KHI CÓ TẢI 200 msg/s (15 lệnh, SIMULATOR)", "lệnh vẫn ok; ghi avg/P95/max",
           {"ack": summary_ms(ack2), "confirm": summary_ms(conf2), "errors": err2}, len(ack2) >= 14 and err2 == 0)
    h = health(st)
    record("F4f", "Sau burst: hệ thống bình thường", "mqtt.connected, storage.ok, device_online",
           f"{h}", h["mqtt"]["connected"] and h["storage"]["ok"] and h["device_online"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", required=True)
    ap.add_argument("--project", default="btlfault")
    ap.add_argument("--out", default="fault_results.json")
    ap.add_argument("--only", default="", help="chạy một phần: f1,f2,f2p,f3,f4")
    a = ap.parse_args()
    st = Stack(a.project, a.env)
    only = {x for x in a.only.split(",") if x}
    f0_ready(st)
    for key, fn in (("f1", f1_restart_backend), ("f2", f2_mqtt_down), ("f2p", f2p_partition),
                    ("f3", f3_db_down), ("f4", f4_f5_burst_and_latency)):
        if not only or key in only:
            print(f"--- {key} ---", flush=True)
            fn(st)
            wait_for(lambda: device_online(st), 60)
    Path(a.out).write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2), encoding="utf8")
    failed = [r["id"] for r in RESULTS if not r["pass"]]
    print(f"\nTỔNG: {len(RESULTS) - len(failed)}/{len(RESULTS)} PASS", ("; FAIL: " + ", ".join(failed)) if failed else "")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
