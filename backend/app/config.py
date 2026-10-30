import os
from dataclasses import dataclass


@dataclass
class Settings:
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    device_id: str = "esp32-home"
    offline_timeout_s: float = 10.0
    cmd_timeout_s: float = 5.0
    data_file: str = "data/store.json"


def load_settings() -> Settings:
    s = Settings()
    s.mqtt_host = os.environ.get("BTL_MQTT_HOST", s.mqtt_host)
    s.mqtt_port = int(os.environ.get("BTL_MQTT_PORT", s.mqtt_port))
    s.device_id = os.environ.get("BTL_DEVICE_ID", s.device_id)
    s.data_file = os.environ.get("BTL_DATA_FILE", s.data_file)
    return s
