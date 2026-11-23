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
import uuid
from typing import Callable, Optional

from app.models import DEVICES, Thresholds

log = logging.getLogger("fake_esp32")

PIR_WARMUP_S = 60.0
SIM_STATE_PERIOD_S = 5.0

# Quy tắc cửa (đã thống nhất, firmware phải khớp):
DOOR_HOLD_PIR_S = 10.0   # auto: giữ mở 10 s sau lần cuối PIR phát hiện chuyển động
DOOR_HOLD_GAS_S = 60.0   # giữ mở 60 s sau khi cảnh báo gas hết; bật lại thì hủy và đếm lại từ lần hết kế tiếp
# Ngưỡng gas (ADC 0-4095). GIẢ ĐỊNH của simulator, chưa phải số liệu hiệu chuẩn của firmware.
GAS_ALARM_ON = 2000
GAS_ALARM_OFF = 1500

# id -> (nhãn hiển thị, thông số). Các id trùng với danh sách kịch bản của giao diện.
_DEFAULTS = dict(temp=28.0, hum=60.0, smoke=300, gas=400, dark=False, motion=False,
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
    "gas_leak": ("Rò rỉ gas: cảnh báo và mở cửa", dict(gas=3000)),
}


class FakeEsp32:
    def __init__(self, client, device_id: str = "esp32-home", fail_door: bool = False,
                 clock: Callable[[], float] = time.monotonic):
        self.client = client
        self.device_id = device_id
        self.boot_id = uuid.uuid4().hex   # mới ở mỗi lần khởi động
        self.seq = 0
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
        self.gas_alarm = False
        self.gas_sensor_ok = True
        self.pir_hold_until: Optional[float] = None
        self.gas_hold_until: Optional[float] = None
        self._reported = {"heat_alarm": False, "smoke_alarm": False, "pump": False,
                          "fan": False, "dht_error": False, "gas_alarm": False}
        self.scenario = "normal"
        self.pir_until: Optional[float] = None
        self.last_real_device_ts: Optional[float] = None
        self._apply_scenario("normal")

    @property
    def is_real_device_active(self) -> bool:
        """Đã phát hiện ESP32 thật gửi telemetry trong vòng 10 giây qua."""
        return self.last_real_device_ts is not None and (self.clock() - self.last_real_device_ts) < 10.0

    # ---- kịch bản ------------------------------------------------------
    def _apply_scenario(self, name: str) -> None:
        params = {**_DEFAULTS, **SCENARIOS[name][1]}
        self.scenario = name
        self.base_temp = params["temp"]
        self.temperature = params["temp"]
        self.humidity = params["hum"]
        self.smoke_raw = params["smoke"]
        self.gas_raw = params["gas"]
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
        real_active = self.is_real_device_active
        body = {
            "active": not real_active,
            "paused": real_active,
            "reason": "real_device_active" if real_active else None,
            "scenario": self.scenario,
            "scenarios": [{"id": k, "label": v[0]} for k, v in SCENARIOS.items()]
        }
        self.client.publish(self.prefix + "sim/state", json.dumps(body), qos=1, retain=True)

    # ---- trạng thái ----------------------------------------------------
    @property
    def pir_ready(self) -> bool:
        return self.pir_until is None or self.clock() >= self.pir_until

    def _apply_auto(self) -> None:
        t = self.temperature
        now = self.clock()
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
        # Cảnh báo nhiệt: quạt bắt buộc chạy, kể cả khi đang ở chế độ thủ công
        if self.heat_alarm:
            self.fan_on = True
        self._apply_gas(now)
        if self.modes["led1"] == "auto":
            self.led1_on = self.is_dark
        if self._motion():
            self.pir_hold_until = now + DOOR_HOLD_PIR_S
        if self.gas_alarm:
            self.door = "open"   # an toàn: cảnh báo gas luôn mở cửa, kể cả chế độ thủ công
        elif self.modes["door"] == "auto":
            holding = ((self.pir_hold_until is not None and now < self.pir_hold_until)
                       or (self.gas_hold_until is not None and now < self.gas_hold_until))
            self.door = "open" if holding else "closed"
        self._emit_changes()

    def _apply_gas(self, now: float) -> None:
        was = self.gas_alarm
        if self.gas_sensor_ok:
            if self.gas_raw >= GAS_ALARM_ON:
                self.gas_alarm = True
            elif self.gas_raw <= GAS_ALARM_OFF:
                self.gas_alarm = False
        if self.gas_alarm and not was:
            self.gas_hold_until = None                      # bật lại: hủy bộ đếm đang chạy
        elif was and not self.gas_alarm:
            self.gas_hold_until = now + DOOR_HOLD_GAS_S     # hết cảnh báo: bắt đầu đếm 60 s

    def _safety(self) -> tuple[str, Optional[str]]:
        if self.smoke_alarm:
            return "fire_alert", "smoke"
        if self.gas_alarm:
            return "gas_alert", "gas_leak"
        return "normal", None

    def _safety_block(self, device: str, action: str) -> Optional[str]:
        """Ràng buộc an toàn thi hành tại chỗ (kể cả khi mất mạng)."""
        if device == "fan" and action == "off":
            if self.heat_alarm:
                return "heat_alarm"
            if self.smoke_alarm:
                return "smoke_alarm"
        if device == "door" and action == "close" and self.gas_alarm:
            return "gas_alarm"
        return None

    def _motion(self) -> bool:
        return self.motion and self.pir_ready

    def _emit_changes(self) -> None:
        t = self.thresholds
        now = {"heat_alarm": self.heat_alarm, "smoke_alarm": self.smoke_alarm,
               "pump": self.pump_on, "fan": self.fan_on, "dht_error": not self.dht_ok,
               "gas_alarm": self.gas_alarm}
        details = {
            "heat_alarm": (self.temperature, t.heat_alarm_on if self.heat_alarm else t.heat_alarm_off, "high_temp"),
            "smoke_alarm": (self.smoke_raw, t.smoke_high if self.smoke_alarm else t.smoke_low, "smoke"),
            "pump": (None, None, "smoke"),
            "fan": (self.temperature, t.fan_on if self.fan_on else t.fan_off,
                    "manual" if self.modes["fan"] == "manual" else "high_temp"),
            "dht_error": (None, None, "dht_read_failed"),
            "gas_alarm": (self.gas_raw, GAS_ALARM_ON if self.gas_alarm else GAS_ALARM_OFF, "gas_leak"),
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
        self.seq += 1
        safety_mode, safety_reason = self._safety()
        return {
            "is_sim": True,
            "device_id": self.device_id, "boot_id": self.boot_id, "seq": self.seq,
            "temperature_c": round(self.temperature, 1) if self.dht_ok else None,
            "humidity_pct": self.humidity if self.dht_ok else None,
            "dht_ok": self.dht_ok,
            "pir_ready": self.pir_ready, "motion_detected": motion, "is_dark": self.is_dark,
            "door_command": self.door, "fan_on": self.fan_on, "led1_on": self.led1_on,
            "led2_on": motion, "led3_on": self.heat_alarm, "heat_alarm": self.heat_alarm,
            "uptime_ms": self._uptime_ms(),
            "smoke_raw": self.smoke_raw, "smoke_alarm": self.smoke_alarm, "pump_on": self.pump_on,
            "gas_raw": self.gas_raw, "gas_alarm": self.gas_alarm, "gas_sensor_ok": self.gas_sensor_ok,
            "safety_mode": safety_mode, "safety_reason": safety_reason,
            "modes": dict(self.modes),
        }

    def publish_telemetry(self) -> None:
        if self.silent or self.is_real_device_active:  # ngắt nếu mất kết nối hoặc ESP32 thật đang hoạt động
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
            if topic == self.prefix + "telemetry":
                # Nhận telemetry: nếu không có cờ is_sim, chứng tỏ ESP32 THẬT đang phát!
                if not data.get("is_sim"):
                    was_active = not self.is_real_device_active
                    self.last_real_device_ts = self.clock()
                    if was_active:
                        log.info("Phát hiện ESP32 thật hoạt động! Simulator tự động tạm dừng phát và nhường quyền.")
                        self.publish_sim_state()
                return

            # Nếu ESP32 thật đang hoạt động, simulator KHÔNG xử lý lệnh hay cấu hình để tránh xung đột
            if self.is_real_device_active:
                return

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
        blocked = self._safety_block(device, action)
        if blocked:
            self._ack("cmd/ack", {"cmd_id": cmd_id, "result": "failed",
                                  "detail": f"safety_override:{blocked}",
                                  "device_id": self.device_id, "boot_id": self.boot_id})
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


def apply_credentials(client, username: str, password: str) -> None:
    """Đăng nhập MQTT nếu broker yêu cầu tài khoản."""
    if username:
        client.username_pw_set(username, password or None)


def main() -> None:
    import os

    import paho.mqtt.client as mqtt

    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--username", default=os.environ.get("BTL_MQTT_USERNAME", ""),
                    help="tài khoản MQTT (mặc định lấy từ biến BTL_MQTT_USERNAME)")
    ap.add_argument("--password", default=os.environ.get("BTL_MQTT_PASSWORD", ""),
                    help="mật khẩu MQTT (mặc định lấy từ biến BTL_MQTT_PASSWORD)")
    ap.add_argument("--device-id", default="esp32-home")
    ap.add_argument("--fail-door", action="store_true")
    ap.add_argument("--scenario", default="normal", choices=list(SCENARIOS),
                    help="kịch bản ban đầu (đổi được khi chạy từ giao diện hoặc API)")
    ap.add_argument("--silent-after", type=float, default=None,
                    help="ngừng gửi sau N giây (giả lập mất kết nối)")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="fake-" + a.device_id)
    apply_credentials(client, a.username, a.password)
    sim = FakeEsp32(client, a.device_id, a.fail_door)
    sim._apply_scenario(a.scenario)
    status = sim.prefix + "status"
    client.will_set(status, "offline", qos=1, retain=True)

    def on_connect(c, userdata, flags, rc, props=None):
        c.subscribe(sim.prefix + "telemetry", qos=0)
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
