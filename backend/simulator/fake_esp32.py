"""Giả lập ESP32: phát telemetry, nhận lệnh/ngưỡng và trả ack.

Chạy: python -m simulator.fake_esp32 --host localhost
"""
import argparse
import json
import logging
import random
import time

from app.models import DEVICES, Thresholds

log = logging.getLogger("fake_esp32")


class FakeEsp32:
    def __init__(self, client, device_id: str = "esp32-home", fail_door: bool = False):
        self.client = client
        self.prefix = f"home/{device_id}/"
        self.fail_door = fail_door
        self.started = time.monotonic()
        self.temperature = 28.0
        self.smoke_raw = 300
        self.is_dark = False
        self.motion = False
        self.fan_on = False
        self.led1_on = False
        self.door = "closed"
        self.thresholds = Thresholds()
        self.modes = {"led1": "auto", "fan": "auto", "door": "auto"}

    # ---- trạng thái ----------------------------------------------------
    def _apply_auto(self) -> None:
        if self.modes["fan"] == "auto":
            if self.temperature >= self.thresholds.fan_on:
                self.fan_on = True
            elif self.temperature <= self.thresholds.fan_off:
                self.fan_on = False
        if self.modes["led1"] == "auto":
            self.led1_on = self.is_dark
        if self.modes["door"] == "auto":
            self.door = "open" if self.motion else "closed"

    def build_telemetry(self) -> dict:
        self._apply_auto()
        heat = self.temperature >= self.thresholds.heat_alarm_on
        smoke = self.smoke_raw >= self.thresholds.smoke_high
        return {
            "temperature_c": round(self.temperature, 1), "humidity_pct": 60.0, "dht_ok": True,
            "pir_ready": True, "motion_detected": self.motion, "is_dark": self.is_dark,
            "door_command": self.door, "fan_on": self.fan_on, "led1_on": self.led1_on,
            "led2_on": self.motion, "led3_on": heat, "heat_alarm": heat,
            "uptime_ms": int((time.monotonic() - self.started) * 1000),
            "smoke_raw": self.smoke_raw, "smoke_alarm": smoke, "pump_on": smoke,
            "modes": dict(self.modes),
        }

    def publish_telemetry(self) -> None:
        self.client.publish(self.prefix + "telemetry", json.dumps(self.build_telemetry()), qos=0)

    def drift(self) -> None:
        self.temperature += random.uniform(-0.3, 0.3)

    # ---- nhận tin ------------------------------------------------------
    def _ack(self, suffix: str, body: dict) -> None:
        self.client.publish(self.prefix + suffix, json.dumps(body), qos=1)

    def handle_message(self, topic: str, payload: bytes) -> None:
        try:
            data = json.loads(payload)
            if topic == self.prefix + "cmd":
                self._on_cmd(data)
            elif topic == self.prefix + "config/set":
                self._on_config(data)
        except Exception:
            log.exception("bad message on %s", topic)

    def _on_cmd(self, data: dict) -> None:
        cmd_id, device, action = data["cmd_id"], data.get("device"), data.get("action")
        if device not in DEVICES or action not in DEVICES[device] or (device == "door" and self.fail_door):
            self._ack("cmd/ack", {"cmd_id": cmd_id, "result": "failed", "detail": "rejected by device"})
            return
        if action == "auto":
            self.modes[device] = "auto"
        else:
            self.modes[device] = "manual"
            if device == "fan":
                self.fan_on = action == "on"
            elif device == "led1":
                self.led1_on = action == "on"
            else:
                self.door = "open" if action == "open" else "closed"
        self._ack("cmd/ack", {"cmd_id": cmd_id, "result": "ok"})
        self.publish_telemetry()

    def _on_config(self, data: dict) -> None:
        config_id = data["config_id"]
        try:
            self.thresholds = Thresholds.model_validate(data["thresholds"])
        except Exception as e:
            self._ack("config/ack", {"config_id": config_id, "result": "rejected", "detail": str(e)[:80]})
            return
        self._ack("config/ack", {"config_id": config_id, "result": "ok"})


def main() -> None:
    import paho.mqtt.client as mqtt

    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--device-id", default="esp32-home")
    ap.add_argument("--fail-door", action="store_true")
    ap.add_argument("--silent-after", type=float, default=None,
                    help="ngừng gửi sau N giây (giả lập mất kết nối)")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="fake-" + a.device_id)
    sim = FakeEsp32(client, a.device_id, a.fail_door)
    status = sim.prefix + "status"
    client.will_set(status, "offline", qos=1, retain=True)

    def on_connect(c, userdata, flags, rc, props=None):
        c.subscribe(sim.prefix + "cmd", qos=1)
        c.subscribe(sim.prefix + "config/set", qos=1)
        c.publish(status, "online", qos=1, retain=True)

    client.on_connect = on_connect
    client.on_message = lambda c, u, m: sim.handle_message(m.topic, m.payload)
    client.connect(a.host, a.port, 60)
    client.loop_start()
    t0 = time.monotonic()
    try:
        while True:
            if a.silent_after is not None and time.monotonic() - t0 > a.silent_after:
                time.sleep(1)
                continue
            sim.drift()
            sim.publish_telemetry()
            time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
