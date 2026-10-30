from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

DEVICES: dict[str, set[str]] = {
    "led1": {"on", "off", "auto"},
    "fan": {"on", "off", "auto"},
    "door": {"open", "close", "auto"},
}

Mode = Literal["auto", "manual"]


class Telemetry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    temperature_c: Optional[float]
    humidity_pct: Optional[float]
    dht_ok: bool
    pir_ready: bool
    motion_detected: bool
    is_dark: bool
    door_command: Literal["open", "closed"]
    fan_on: bool
    led1_on: bool
    led2_on: bool
    led3_on: bool
    heat_alarm: bool
    uptime_ms: int
    smoke_raw: Optional[int] = None
    smoke_alarm: bool = False
    pump_on: bool = False
    modes: dict[str, Mode] = Field(default_factory=dict)


class Event(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: Literal["heat_alarm", "smoke_alarm", "pump", "fan", "door", "led1", "dht_error"]
    state: Literal["start", "end"]
    value: Optional[float] = None
    threshold: Optional[float] = None
    reason: Optional[str] = None
    uptime_ms: int


class CmdAck(BaseModel):
    model_config = ConfigDict(extra="ignore")

    cmd_id: str
    result: Literal["ok", "failed"]
    detail: Optional[str] = None


class ConfigAck(BaseModel):
    model_config = ConfigDict(extra="ignore")

    config_id: str
    result: Literal["ok", "rejected"]
    detail: Optional[str] = None


class Thresholds(BaseModel):
    fan_on: float = 35
    fan_off: float = 34
    heat_alarm_on: float = 40
    heat_alarm_off: float = 37
    smoke_high: float = 2000
    smoke_low: float = 1500

    @model_validator(mode="after")
    def _check_hysteresis(self):
        if self.fan_off >= self.fan_on:
            raise ValueError("fan_off must be < fan_on")
        if self.heat_alarm_off >= self.heat_alarm_on:
            raise ValueError("heat_alarm_off must be < heat_alarm_on")
        if self.smoke_low >= self.smoke_high:
            raise ValueError("smoke_low must be < smoke_high")
        return self


class CommandRequest(BaseModel):
    action: str


def validate_command(device: str, action: str) -> None:
    if device not in DEVICES:
        raise ValueError(f"unknown device: {device}")
    if action not in DEVICES[device]:
        raise ValueError(f"invalid action '{action}' for {device}")
