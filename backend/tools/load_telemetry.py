r"""Tạo tải telemetry giả để đo hiệu năng và độ chính xác của đo mất gói/trùng.

Gửi bản tin telemetry hợp lệ với `device_id` riêng (mặc định "loadtest") để không lẫn vào số liệu của
thiết bị thật/simulator; đánh dấu `is_sim` để không chiếm quyền của ESP32 thật.

Ví dụ (từ thư mục gốc dự án, stack đã chạy, đã có .env):
    backend/.venv/Scripts/python backend/tools/load_telemetry.py --env .env --rate 200 --count 4000 \
        --drop-every 100 --dup-every 250
`--drop-every N`: bỏ qua mỗi bản tin thứ N (tạo khoảng hở seq có chủ đích).
`--dup-every N`:  gửi lặp mỗi bản tin thứ N (tạo bản tin trùng có chủ đích).
"""
import argparse
import json
import time
import uuid

import paho.mqtt.client as mqtt

TEMPLATE = {
    "temperature_c": 28.0, "humidity_pct": 60.0, "dht_ok": True, "pir_ready": True,
    "motion_detected": False, "is_dark": False, "door_command": "closed", "fan_on": False,
    "led1_on": False, "led2_on": False, "led3_on": False, "heat_alarm": False, "uptime_ms": 0,
    "smoke_raw": 300, "smoke_alarm": False, "pump_on": False,
    "gas_raw": 400, "gas_alarm": False, "gas_sensor_ok": True,
    "safety_mode": "normal", "safety_reason": None, "modes": {}, "is_sim": True,
}


def read_env(path: str) -> dict:
    env = {}
    with open(path, encoding="utf8") as f:
        for line in f:
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v
    return env


def run_load(host: str, port: int, username: str, password: str, rate: float, count: int,
             device_id: str = "loadtest", drop_every: int = 0, dup_every: int = 0,
             topic_device: str = "esp32-home") -> dict:
    """Gửi `count` bản tin ở tốc độ ~`rate`/giây. Trả về số liệu phía người gửi."""
    boot_id = uuid.uuid4().hex
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"load-{boot_id[:8]}")
    client.username_pw_set(username, password)
    client.connect(host, port, 30)
    client.loop_start()
    topic = f"home/{topic_device}/telemetry"
    sent = dropped = duplicated = 0
    dropped_seqs = []
    t0 = time.perf_counter()
    interval = 1.0 / rate if rate > 0 else 0.0
    for seq in range(1, count + 1):
        # Không bỏ gói cuối: mất gói ở CUỐI luồng không thể phát hiện bằng khoảng hở seq (cần gói sau)
        if drop_every and seq % drop_every == 0 and seq != count:
            dropped += 1
            dropped_seqs.append(seq)
        else:
            payload = dict(TEMPLATE, device_id=device_id, boot_id=boot_id, seq=seq, uptime_ms=seq * 5)
            info = client.publish(topic, json.dumps(payload), qos=1)
            sent += 1
            if dup_every and seq % dup_every == 0:
                client.publish(topic, json.dumps(payload), qos=1)
                duplicated += 1
        nxt = t0 + seq * interval
        delay = nxt - time.perf_counter()
        if delay > 0:
            time.sleep(delay)
    info.wait_for_publish(10)
    elapsed = time.perf_counter() - t0
    client.loop_stop()
    client.disconnect()
    return {"device_id": device_id, "boot_id": boot_id, "sent_unique": sent, "dropped": dropped,
            "duplicated": duplicated, "dropped_seqs": dropped_seqs[:20], "elapsed_s": round(elapsed, 2),
            "achieved_rate": round((sent + duplicated) / elapsed, 1)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", default=".env", help="file .env (lấy MQTT_PORT, MQTT_DEVICE_PASSWORD)")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--rate", type=float, default=50.0, help="bản tin/giây")
    ap.add_argument("--count", type=int, default=500)
    ap.add_argument("--device-id", default="loadtest")
    ap.add_argument("--drop-every", type=int, default=0)
    ap.add_argument("--dup-every", type=int, default=0)
    a = ap.parse_args()
    env = read_env(a.env)
    result = run_load(a.host, int(env.get("MQTT_PORT", 1883)), "esp32", env["MQTT_DEVICE_PASSWORD"],
                      a.rate, a.count, a.device_id, a.drop_every, a.dup_every)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
