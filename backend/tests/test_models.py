import pytest
from pydantic import ValidationError

from app.models import Telemetry, Thresholds, validate_command

EXAMPLE = {
    "temperature_c": 36.0, "humidity_pct": 70.0, "dht_ok": True,
    "pir_ready": True, "motion_detected": True, "is_dark": True,
    "door_command": "open", "fan_on": True, "led1_on": True,
    "led2_on": True, "led3_on": False, "heat_alarm": False,
    "uptime_ms": 120000,
}


def test_telemetry_accepts_spec_example():
    t = Telemetry.model_validate(EXAMPLE)
    assert t.fan_on is True


def test_telemetry_allows_null_temperature_when_dht_error():
    d = dict(EXAMPLE, temperature_c=None, humidity_pct=None, dht_ok=False)
    t = Telemetry.model_validate(d)
    assert t.temperature_c is None


def test_telemetry_rejects_missing_required_field():
    d = dict(EXAMPLE)
    del d["uptime_ms"]
    with pytest.raises(ValidationError):
        Telemetry.model_validate(d)


def test_thresholds_defaults():
    t = Thresholds()
    assert t.fan_on == 35 and t.heat_alarm_off == 37


def test_thresholds_reject_inverted_hysteresis():
    with pytest.raises(ValidationError):
        Thresholds(fan_on=30, fan_off=31)


@pytest.mark.parametrize("device,action", [("door", "open"), ("fan", "auto"), ("led1", "on")])
def test_validate_command_ok(device, action):
    validate_command(device, action)


@pytest.mark.parametrize("device,action", [("door", "on"), ("pump", "on"), ("led2", "on")])
def test_validate_command_bad(device, action):
    with pytest.raises(ValueError):
        validate_command(device, action)
