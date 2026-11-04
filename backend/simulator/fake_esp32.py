"""Giả lập ESP32: phát telemetry và sự kiện, nhận lệnh/ngưỡng, đổi được kịch bản khi đang chạy.

Chạy: python -m simulator.fake_esp32 --host localhost

Kịch bản đổi qua MQTT: topic `home/<device>/sim/scenario`, payload {"scenario": "<id>"}.
Simulator thông báo mình đang chạy bằng `home/<device>/sim/state` (retained, gửi lại mỗi 5 giây)
để backend và giao diện biết có thể điều khiển kịch bản.
"""
import argparse
import json
import logging
import random
import time
from typing import Callable, Optional

from app.models import DEVICES, Thresholds

log = logging.getLogger("fake_esp32")

PIR_WARMUP_S = 60.0
SIM_STATE_PERIOD_S = 5.0

# id -> (nhãn hiển thị, thông số). Các id trùng với danh sách kịch bản của giao diện.
_DEFAULTS = dict(temp=28.0, hum=60.0, smoke=300, dark=False, motion=False,
                 dht_ok=True, pir_warmup=False, silent=False)
SCENARIOS: dict[str, tuple[str, dict]] = {
    "normal": ("Bình thường", {}),
    "cooling_fan": ("Nhiệt độ cao: quạt tự bật", dict(temp=36.2)),
    "heat_alarm": ("Nhiệt độ rất cao: cảnh báo nhiệt", dict(temp=41.5, hum=55.0)),
    "smoke_danger": ("Khói/cháy: cảnh báo và bơm", dict(temp=32.0, smoke=3000)),
    "motion_door": ("Có người về: mở cửa", dict(motion=True)),
    "dark_light": ("Trời tối: bật đèn", dict(dark=True)),
    "dht_error": ("Lỗi cảm biến DHT11", dict(dht_ok=False)),
    "pir_warming_up": ("PIR đang khởi động (60 giây)", dict(pir_warmup=True, motion=True)),
    "esp32_offline": ("Mất kết nối ESP32", dict(silent=True)),
}


class FakeEsp32:
    def __init__(self, client, device_id: str = "esp32-home", fail_door: bool = False,
                 clock: Callable[[], float] = time.monotonic):
        self.client = client
        self.prefix = f"home/{device_id}/"
        self.fail_door = fail_door
        self.clock = clock
        self.started = clock()
        self.thresholds = Thresholds()
        self.modes = {"led1": "auto", "fan": "auto", "door": "auto"}
        self.fan_on = False
        self.led1_on = False
        self.door = "closed"
        self.heat_alarm = False
        self.smoke_alarm = False
        self.pump_on = False
        self._reported = {"heat_alarm": False, "smoke_alarm": False, "pump": False,
                          "fan": False, "dht_error": False}
        self.scenario = "normal"
        self.pir_until: Optional[float] = None
        self._apply_scenario("normal")

    # ---- kịch bản ------------------------------------------------------
    def _apply_scenario(self, name: str) -> None:
        params = {**_DEFAULTS, **SCENARIOS[name][1]}
        self.scenario = name
        self.base_temp = params["temp"]
        self.temperature = params["temp"]
        self.humidity = params["hum"]
        self.smoke_raw = params["smoke"]
        self.is_dark = params["dark"]
        self.motion = params["motion"]
        self.dht_ok = params["dht_ok"]
        self.silent = params["silent"]
        self.pir_until = self.clock() + PIR_WARMUP_S if params["pir_warmup"] else None

    def set_scenario(self, name: str) -> None:
        if name not in SCENARIOS:
            raise ValueError(f"unknown scenario: {name}")
        self._apply_scenario(name)
        self.publish_sim_state()

    def publish_sim_state(self) -> None:
        body = {"active": True, "scenario": self.scenario,
                "scenarios": [{"id": k, "label": v[0]} for k, v in SCENARIOS.items()]}
        self.client.publish(self.prefix + "sim/state", json.dumps(body), qos=1, retain=True)

    # ---- trạng thái ----------------------------------------------------
    @property
    def pir_ready(self) -> bool:
        return self.pir_until is None or self.clock() >= self.pir_until

    def _apply_auto(self) -> None:
        t = self.temperature
        # DHT11 lỗi: giữ nguyên trạng thái quạt và cảnh báo nhiệt trước đó (đặc tả mục 3)
        if self.dht_ok:
            if self.modes["fan"] == "auto":
                if t >= self.thresholds.fan_on:
                    self.fan_on = True
                elif t <= self.thresholds.fan_off:
                    self.fan_on = False
            if t >= self.thresholds.heat_alarm_on:
                self.heat_alarm = True
            elif t <= self.thresholds.heat_alarm_off:
                self.heat_alarm = False
        if self.smoke_raw >= self.thresholds.smoke_high:
            self.smoke_alarm = True
        elif self.smoke_raw <= self.thresholds.smoke_low:
            self.smoke_alarm = False
        self.pump_on = self.smoke_alarm
        if self.modes["led1"] == "auto":
            self.led1_on = self.is_dark
        if self.modes["door"] == "auto":
            self.door = "open" if self._motion() else "closed"
        self._emit_changes()

    def _motion(self) -> bool:
        return self.motion and self.pir_ready

    def _emit_changes(self) -> None:
        t = self.thresholds
        now = {"heat_alarm": self.heat_alarm, "smoke_alarm": self.smoke_alarm,
               "pump": self.pump_on, "fan": self.fan_on, "dht_error": not self.dht_ok}
        details = {
            "heat_alarm": (self.temperature, t.heat_alarm_on if self.heat_alarm else t.heat_alarm_off, "high_temp"),
            "smoke_alarm": (self.smoke_raw, t.smoke_high if self.smoke_alarm else t.smoke_low, "smoke"),
            "pump": (None, None, "smoke"),
            "fan": (self.temperature, t.fan_on if self.fan_on else t.fan_off,
                    "manual" if self.modes["fan"] == "manual" else "high_temp"),
            "dht_error": (None, None, "dht_read_failed"),
        }
        for kind, active in now.items():
            if active == self._reported[kind]:
                continue
            self._reported[kind] = active
            value, threshold, reason = details[kind]
            self._send("event", {"type": kind, "state": "start" if active else "end",
                                 "value": None if value is None else round(float(value), 1),
                                 "threshold": threshold, "reason": reason,
                                 "uptime_ms": self._uptime_ms()})

    def _uptime_ms(self) -> int:
        return int((self.clock() - self.started) * 1000)

    def build_telemetry(self) -> dict:
        self._apply_auto()
        motion = self._motion()
        return {
            "temperature_c": round(self.temperature, 1) if self.dht_ok else None,
            "humidity_pct": self.humidity if self.dht_ok else None,
            "dht_ok": self.dht_ok,
            "pir_ready": self.pir_ready, "motion_detected": motion, "is_dark": self.is_dark,
            "door_command": self.door, "fan_on": self.fan_on, "led1_on": self.led1_on,
            "led2_on": motion, "led3_on": self.heat_alarm, "heat_alarm": self.heat_alarm,
            "uptime_ms": self._uptime_ms(),
            "smoke_raw": self.smoke_raw, "smoke_alarm": self.smoke_alarm, "pump_on": self.pump_on,
            "modes": dict(self.modes),
        }

    def publish_telemetry(self) -> None:
        if self.silent:  # kịch bản "mất kết nối ESP32": im lặng để backend tự phát hiện
            return
        self.client.publish(self.prefix + "telemetry", json.dumps(self.build_telemetry()), qos=0)

    def drift(self) -> None:
        self.temperature = self.base_temp + random.uniform(-0.3, 0.3)

    # ---- nhận tin ------------------------------------------------------
    def _send(self, suffix: str, body: dict) -> None:
        self.client.publish(self.prefix + suffix, json.dumps(body), qos=1)

    def _ack(self, suffix: str, body: dict) -> None:
        self._send(suffix, body)

    def handle_message(self, topic: str, payload: bytes) -> None:
        try:
            data = json.loads(payload)
            if topic == self.prefix + "cmd":
                self._on_cmd(data)
            elif topic == self.prefix + "config/set":
                self._on_config(data)
            elif topic == self.prefix + "sim/scenario":
                self._on_scenario(data)
        except Exception:
            log.exception("bad message on %s", topic)

    def _on_scenario(self, data: dict) -> None:
        try:
            self.set_scenario(data["scenario"])
        except ValueError:
            log.warning("unknown scenario requested: %s", data.get("scenario"))
            self.publish_sim_state()

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
    ap.add_argument("--scenario", default="normal", choices=list(SCENARIOS),
                    help="kịch bản ban đầu (đổi được khi chạy từ giao diện hoặc API)")
    ap.add_argument("--silent-after", type=float, default=None,
                    help="ngừng gửi sau N giây (giả lập mất kết nối)")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="fake-" + a.device_id)
    sim = FakeEsp32(client, a.device_id, a.fail_door)
    sim._apply_scenario(a.scenario)
    status = sim.prefix + "status"
    client.will_set(status, "offline", qos=1, retain=True)

    def on_connect(c, userdata, flags, rc, props=None):
        c.subscribe(sim.prefix + "cmd", qos=1)
        c.subscribe(sim.prefix + "config/set", qos=1)
        c.subscribe(sim.prefix + "sim/scenario", qos=1)
        c.publish(status, "online", qos=1, retain=True)
        sim.publish_sim_state()

    client.on_connect = on_connect
    client.on_message = lambda c, u, m: sim.handle_message(m.topic, m.payload)
    client.connect(a.host, a.port, 60)
    client.loop_start()
    t0 = time.monotonic()
    last_state = 0.0
    try:
        while True:
            now = time.monotonic()
            if now - last_state >= SIM_STATE_PERIOD_S:
                sim.publish_sim_state()  # nhịp tim: để backend biết simulator còn sống
                last_state = now
            if a.silent_after is not None and now - t0 > a.silent_after:
                time.sleep(1)
                continue
            sim.drift()
            sim.publish_telemetry()
            time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        client.publish(sim.prefix + "sim/state", json.dumps({"active": False}), qos=1, retain=True).wait_for_publish(2)
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
