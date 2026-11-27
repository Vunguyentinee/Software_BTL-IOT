r"""Kiểm chứng bảo mật trên stack Docker thật. In bảng PASS/FAIL, thoát mã 1 nếu có FAIL.

Chạy (stack đã `docker compose up`, đã có .env), từ thư mục gốc dự án:
    backend\.venv\Scripts\python backend\tools\live_security_check.py .env
Cần file .env có MQTT_PORT, API_PORT và các mật khẩu. Nếu .env không khai báo MQTT_PORT/API_PORT,
thêm vào (mặc định 1883 / 8000). Lưu ý: script thử đăng nhập sai nhiều lần nên tài khoản `ui`
bị khóa 60 giây sau khi chạy.
"""
import json
import sys
import time
import urllib.request
import urllib.error

import paho.mqtt.client as mqtt

ENV = {}
for line in open(sys.argv[1], encoding="utf8"):
    if "=" in line:
        k, v = line.strip().split("=", 1)
        ENV[k] = v
MQTT_PORT = int(ENV.get("MQTT_PORT", 1883))
API = f"http://localhost:{ENV.get('API_PORT', 8000)}"
P = "home/esp32-home/"
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), "-", name, detail)


READ = {"token": None}   # GET không truyền token thì dùng token này (sau khi đăng nhập)


def http(method, path, body=None, token=None, anonymous=False):
    if not anonymous:
        token = token or (READ["token"] if method == "GET" else None)
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except Exception:
            return e.code, None


def mqtt_connect(user, pw, wait=3.0):
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"chk-{user or 'anon'}-{time.time()}")
    state = {"rc": None}
    if user:
        c.username_pw_set(user, pw)
    c.on_connect = lambda cl, u, f, rc, p=None: state.update(rc=rc)
    try:
        c.connect("localhost", MQTT_PORT, 30)
    except Exception as e:
        return c, state, str(e)
    c.loop_start()
    t = time.time()
    while state["rc"] is None and time.time() - t < wait:
        time.sleep(0.05)
    return c, state, None


# ---- MQTT -----------------------------------------------------------------
c, st, err = mqtt_connect(None, None)
check("MQTT-01 client ẩn danh bị từ chối", st["rc"] is None or getattr(st["rc"], "is_failure", True), f"rc={st['rc']}")
c.loop_stop()

c, st, err = mqtt_connect("backend", "mat-khau-sai")
check("MQTT-02 sai mật khẩu bị từ chối", st["rc"] is None or getattr(st["rc"], "is_failure", True), f"rc={st['rc']}")
c.loop_stop()

# Người chứng kiến phải CÓ quyền đọc topic cần kiểm tra (backend không đọc được `cmd`).
def witness(user, pw, topics):
    seen = []
    w, st, _ = mqtt_connect(user, pw)
    w.on_message = lambda cl, u, m: seen.append((m.topic, m.payload))
    for t in topics:
        w.subscribe(P + t)
    time.sleep(0.5)
    return w, seen, st


bk, st, _ = mqtt_connect("backend", ENV["MQTT_BACKEND_PASSWORD"])
check("MQTT-03 backend đăng nhập đúng được chấp nhận", st["rc"] is not None and not st["rc"].is_failure, f"rc={st['rc']}")

# Đối chứng dương: backend publish cmd thì thiết bị (esp32) NHẬN được
w, seen, st = witness("esp32", ENV["MQTT_DEVICE_PASSWORD"], ["cmd", "config/set"])
bk.publish(P + "cmd", json.dumps({"cmd_id": "legit-control", "device": "fan", "action": "auto"}), qos=1)
time.sleep(1.5)
check("MQTT-03b đối chứng: lệnh từ backend đến được esp32", any(b"legit-control" in p for _t, p in seen),
      f"seen={[t for t, _ in seen]}")
w.loop_stop()

# Tài khoản không phải backend cố publish lệnh giả; người chứng kiến cũng không phải người gửi
cases = (("simulator", ENV["MQTT_SIM_PASSWORD"], "esp32", ENV["MQTT_DEVICE_PASSWORD"]),
         ("esp32", ENV["MQTT_DEVICE_PASSWORD"], "simulator", ENV["MQTT_SIM_PASSWORD"]))
for attacker, apw, wit, wpw in cases:
    w, seen, wst = witness(wit, wpw, ["cmd", "config/set"])
    cl, st, _ = mqtt_connect(attacker, apw)
    cl.publish(P + "cmd", json.dumps({"cmd_id": "forged-" + attacker, "device": "fan", "action": "off"}), qos=1)
    cl.publish(P + "config/set", json.dumps({"config_id": "forged-" + attacker, "thresholds": {}}), qos=1)
    time.sleep(2.0)
    forged = [t for t, p in seen if b"forged" in p]
    check(f"MQTT-04 '{attacker}' không publish được cmd/config.set (chứng kiến bởi '{wit}')",
          not forged and st["rc"] is not None and not st["rc"].is_failure, f"nhận được={forged}")
    cl.loop_stop()
    w.loop_stop()

# Mosquitto trả SUBACK thành công cả khi ACL từ chối đọc (chỉ không giao tin), nên kiểm tra bằng việc tin CÓ ĐƯỢC GIAO.
# Thiết bị phải nhận được: cmd, config/set, event/ack, backend/heartbeat; KHÔNG được nhận sim/scenario.
w, seen, wst = witness("esp32", ENV["MQTT_DEVICE_PASSWORD"], ["cmd", "config/set", "sim/scenario"])
for topic in ("cmd", "config/set", "sim/scenario"):
    bk.publish(P + topic, json.dumps({"probe": "from-backend-" + topic.replace("/", "_")}), qos=1)
time.sleep(1.5)
got = {t[len(P):] for t, _p in seen}
check("MQTT-06 esp32 nhận được cmd và config/set từ backend", {"cmd", "config/set"} <= got, f"got={sorted(got)}")
check("MQTT-06b esp32 KHÔNG nhận được sim/scenario (không có quyền đọc)", "sim/scenario" not in got, f"got={sorted(got)}")
w.loop_stop()

for topic in ("event/ack", "backend/heartbeat"):
    w, seen, wst = witness("esp32", ENV["MQTT_DEVICE_PASSWORD"], [topic])
    bk.publish(P + topic, json.dumps({"event_id": "legit", "source": "backend"}), qos=1)
    for attacker, apw in (("simulator", ENV["MQTT_SIM_PASSWORD"]),):
        cl, st, _ = mqtt_connect(attacker, apw)
        cl.publish(P + topic, json.dumps({"event_id": "forged-" + attacker, "source": "operator"}), qos=1)
        time.sleep(1.5)
        forged = [p for _t, p in seen if b"forged" in p]
        check(f"MQTT-07 '{attacker}' không giả mạo được {topic}", not forged)
        cl.loop_stop()
    check(f"MQTT-07b đối chứng: backend publish {topic} đến được esp32", any(b"legit" in p for _t, p in seen))
    w.loop_stop()

# thiết bị được publish topic của chính nó, backend (có quyền đọc) nhận được
rec = []
bk.on_message = lambda cl, u, m: rec.append((m.topic, m.payload))
bk.subscribe(P + "event")
time.sleep(0.5)
cl, st, _ = mqtt_connect("esp32", ENV["MQTT_DEVICE_PASSWORD"])
cl.publish(P + "event", json.dumps({"type": "fan", "state": "start", "uptime_ms": 1, "reason": "acl-probe"}), qos=1)
time.sleep(1.5)
check("MQTT-05 esp32 publish được event của mình, backend nhận được",
      any(t == P + "event" and b"acl-probe" in p for t, p in rec))
cl.loop_stop()
bk.loop_stop()

# ---- API ------------------------------------------------------------------
code, _ = http("POST", "/api/devices/fan/command", {"action": "on"})
check("API-01 lệnh không có token -> 401", code == 401, f"code={code}")
code, _ = http("POST", "/api/devices/fan/command", {"action": "on"}, token="not.a.jwt")
check("API-02 token rác -> 401", code == 401, f"code={code}")
code, _ = http("PUT", "/api/config", {"fan_on": 36, "fan_off": 33})
check("API-03 đổi ngưỡng không token -> 401", code == 401, f"code={code}")
code, body = http("POST", "/api/auth/login", {"username": "admin", "password": "sai-mat-khau"})
check("API-04 đăng nhập sai -> 401", code == 401, f"code={code}")
code, body = http("POST", "/api/auth/login", {"username": "ui", "password": ENV["UI_PASSWORD"]})
check("API-05 đăng nhập ui (operator) -> 200 + JWT", code == 200 and body.get("role") == "operator", f"code={code}")
op = body["access_token"]
READ["token"] = op
code, body = http("POST", "/api/auth/login", {"username": "admin", "password": ENV["ADMIN_PASSWORD"]})
adm = body["access_token"]
code, _ = http("PUT", "/api/config", {"fan_on": 36, "fan_off": 33}, token=op)
check("API-06 operator đổi ngưỡng -> 403", code == 403, f"code={code}")
code, body = http("POST", "/api/devices/fan/command", {"action": 123}, token=op)
check("API-07 body sai kiểu -> 422", code == 422, f"code={code}")
code, body = http("POST", "/api/devices/fan/command", {"action": "x" * 10000}, token=op)
check("API-08 body quá dài -> 422", code == 422, f"code={code}")

# lệnh hợp lệ đi đến simulator và có ACK + xác nhận vật lý
time.sleep(3)
code, body = http("POST", "/api/devices/led1/command", {"action": "on"}, token=op)
check("API-09 operator gửi lệnh hợp lệ -> 200", code == 200, f"code={code} body={body}")
cmd_id = body.get("cmd_id") if isinstance(body, dict) else None
time.sleep(5)
code, cmd = http("GET", f"/api/commands/{cmd_id}")
check("CMD-01 lệnh được simulator xác nhận (status ok)", code == 200 and cmd.get("status") == "ok", f"{cmd}")
check("CMD-02 có confirmed_ts (suy ra từ telemetry sau ACK)", code == 200 and cmd.get("confirmed_ts") is not None)
if cmd and cmd.get("ack_ts"):
    print("   ack_ms =", round((cmd["ack_ts"] - cmd["sent_ts"]) * 1000, 1),
          " confirm_ms =", round(((cmd.get("confirmed_ts") or 0) - cmd["sent_ts"]) * 1000, 1))
code, h = http("GET", "/api/health")
check("API-10 /api/health báo MQTT và DB bình thường",
      code == 200 and h["mqtt"]["connected"] is True and h["storage"]["ok"] is True, f"{h}")
code, lat = http("GET", "/api/metrics/latency")
check("LAT-01 /api/metrics/latency có số liệu ack", code == 200 and lat["ack"]["count"] >= 1, f"{lat['ack']}")
for path in ("/api/history/reliability", "/api/history/commands/stats",
             "/api/history/connections", "/api/history/errors"):
    code, _ = http("GET", path)
    check(f"REL-0x GET {path} -> 200", code == 200, f"code={code}")

# xem dữ liệu cũng phải đăng nhập (trừ /api/health); WebSocket xác thực bằng tin đầu tiên
for path in ("/api/state", "/api/commands", "/api/events", "/api/config", "/api/history?metric=temperature_c"):
    code, _ = http("GET", path, anonymous=True)
    check(f"READ-01 GET {path} không token -> 401", code == 401, f"code={code}")
code, me = http("GET", "/api/auth/me")
check("READ-02 /api/auth/me trả đúng người dùng", code == 200 and me.get("username") == "ui", f"{me}")


def ws_try(first_msg):
    import asyncio
    import websockets

    async def run():
        async with websockets.connect(API.replace("http", "ws") + "/ws", open_timeout=5) as ws:
            if first_msg is not None:
                await ws.send(json.dumps(first_msg))
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=8)
                return "data", json.loads(msg).get("kind")
            except websockets.ConnectionClosed as e:
                return "closed", e.rcvd.code if e.rcvd else None
    try:
        return asyncio.run(run())
    except Exception as e:
        return "error", repr(e)


r = ws_try(None)
check("WS-01 WebSocket không gửi token -> bị đóng 4401, không nhận dữ liệu", r == ("closed", 4401), f"{r}")
r = ws_try({"kind": "auth", "token": "rac"})
check("WS-02 WebSocket token rác -> đóng 4401", r == ("closed", 4401), f"{r}")
r = ws_try({"kind": "auth", "token": op})
check("WS-03 WebSocket token hợp lệ -> nhận snapshot", r == ("data", "snapshot"), f"{r}")

WEB = f"http://localhost:{ENV.get('WEB_PORT', 3000)}"
try:
    with urllib.request.urlopen(WEB + "/config.js", timeout=10) as resp:
        cfg = resp.read().decode("utf8", "replace")
    leaked = [k for k in ("UI_PASSWORD", "ADMIN_PASSWORD") if ENV.get(k) and ENV[k] in cfg]
    check("WEB-01 trang web không chứa mật khẩu nào (config.js)", not leaked, f"lộ={leaked}")
except urllib.error.HTTPError as e:
    check("WEB-01 trang web không chứa mật khẩu nào (config.js)", e.code == 404, f"code={e.code}")
except Exception as e:
    check("WEB-01 trang web không chứa mật khẩu nào (config.js)", False, f"không tải được web: {e}")

# giới hạn đăng nhập
codes = [http("POST", "/api/auth/login", {"username": "ui", "password": "sai-sai-sai"})[0] for _ in range(7)]
check("API-11 dò mật khẩu bị khóa (xuất hiện 429)", 429 in codes, f"codes={codes}")

failed = [n for n, ok, _ in results if not ok]
print(f"\nTỔNG: {len(results) - len(failed)}/{len(results)} PASS")
sys.exit(1 if failed else 0)
