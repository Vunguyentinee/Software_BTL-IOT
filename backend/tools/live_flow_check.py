r"""Kiểm chứng luồng điều khiển theo hợp đồng firmware trên stack Docker thật (với ESP32 GIẢ LẬP).

    backend/.venv/Scripts/python backend/tools/live_flow_check.py <env>

LƯU Ý: simulator mô phỏng hợp đồng của firmware ESP32_DigitalTwin_Gas34_Safety; đây KHÔNG phải kiểm thử trên
firmware/phần cứng thật.
"""
import json
import sys
import time
import urllib.error
import urllib.request

from load_telemetry import read_env

ENV = read_env(sys.argv[1])
API = f"http://localhost:{ENV.get('API_PORT', 8000)}"
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), "-", name, detail)


def http(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except Exception:
            return e.code, None


def login(user, pw):
    return http("POST", "/api/auth/login", {"username": user, "password": pw})[1]["access_token"]


def wait(pred, timeout=15):
    t = time.time()
    while time.time() - t < timeout:
        try:
            v = pred()
            if v:
                return v
        except Exception:
            pass
        time.sleep(0.4)
    return None


op = login(ENV["UI_USERNAME"], ENV["UI_PASSWORD"])
adm = login("admin", ENV["ADMIN_PASSWORD"])

state = wait(lambda: (lambda s: s if s["telemetry"] and s["telemetry"].get("connection_id") else None)(http("GET", "/api/state")[1]))
tel = state["telemetry"]
check("FLOW-01 telemetry có phiên (boot_id, connection_id) và control_mode", bool(tel.get("boot_id")) and tel.get("connection_id") is not None
      and tel.get("control_mode") == "remote_available", f"boot={tel.get('boot_id', '')[:8]} conn={tel.get('connection_id')} mode={tel.get('control_mode')}")

code, body = http("POST", "/api/devices/led1/command", {"action": "on"}, op)
cmd = wait(lambda: (lambda c: c if c["status"] != "pending" else None)(http("GET", f"/api/commands/{body['cmd_id']}")[1]))
check("FLOW-02 lệnh mang phiên đích được thiết bị chấp nhận", code == 200 and cmd and cmd["status"] == "ok", f"{cmd and (cmd['status'], cmd['detail'])}")
check("FLOW-03 nhật ký ghi người gửi lệnh", cmd and cmd.get("source") == "web:" + ENV["UI_USERNAME"], f"source={cmd and cmd.get('source')}")

code, cfg = http("PUT", "/api/config", {"fan_on": 36, "fan_off": 33}, adm)
applied = wait(lambda: http("GET", "/api/config")[1]["status"] == "applied")
check("FLOW-04 đổi ngưỡng (mang phiên đích) được thiết bị áp dụng", code == 200 and bool(applied), f"status={http('GET', '/api/config')[1]['status']}")

# Khói/gas: cảnh báo, khóa cửa, từ chối lệnh xung đột, xác nhận cảnh báo
http("POST", "/api/sim/scenario", {"scenario": "smoke_danger"}, op)
locked = wait(lambda: (lambda s: s if s["telemetry"].get("door_safety_lock") and s["telemetry"].get("smoke_alarm") else None)(http("GET", "/api/state")[1]), 20)
check("FLOW-05 kịch bản khói: smoke_alarm + door_safety_lock + cửa mở", bool(locked) and locked["telemetry"]["door_command"] == "open")
code, body = http("POST", "/api/devices/door/command", {"action": "close"}, op)
check("FLOW-06 backend chặn đóng cửa khi đang khóa (409, lý do rõ), không gửi xuống thiết bị", code == 409 and body.get("detail") == "safety_override", f"{code} {body}")
alarms = (locked or {}).get("telemetry", {}).get("active_alarms") or []
sm = [a for a in alarms if a["alarm"] == "smoke_alarm"]
check("FLOW-07 telemetry liệt kê cảnh báo hiện hành với event_id", bool(sm), f"{[a['event_id'][-17:] for a in sm]}")
if sm:
    code, body = http("POST", f"/api/alarms/{sm[0]['event_id']}/ack", None, op)
    check("FLOW-08 operator xác nhận cảnh báo (200, ghi người xác nhận)", code == 200 and body.get("by") == ENV["UI_USERNAME"], f"{code} {body}")
code, _ = http("POST", "/api/alarms/khong-ton-tai/ack", None, op)
check("FLOW-09 xác nhận cảnh báo không tồn tại -> 404", code == 404, f"{code}")
code, body = http("POST", "/api/devices/fan/command", {"action": "on"}, op)
check("FLOW-10 lệnh quạt thủ công bị chặn khi khóa cửa (gas_fan_hold)", code == 409 and body.get("reason") == "gas_fan_hold", f"{code} {body}")

http("POST", "/api/sim/scenario", {"scenario": "normal"}, op)
print(f"\nTỔNG: {sum(results)}/{len(results)} PASS")
sys.exit(0 if all(results) else 1)
