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
    database_url: str = ""  # rỗng = lưu trong bộ nhớ + file JSON
    # --- bảo mật API ---
    users_spec: str = ""      # BTL_USERS="user:password:role,..." (role: viewer|operator|admin)
    jwt_secret: str = ""      # BTL_JWT_SECRET, tối thiểu 32 ký tự
    jwt_ttl_s: int = 3600
    bcrypt_rounds: int = 12
    rate_limit_max: int = 30          # số yêu cầu điều khiển / cửa sổ / người dùng
    rate_limit_window_s: float = 10.0
    login_max_failures: int = 5       # số lần đăng nhập sai trước khi khóa
    login_lockout_s: float = 60.0
    # --- bảo mật MQTT ---
    mqtt_username: str = ""
    mqtt_password: str = ""


def load_settings() -> Settings:
    s = Settings()
    s.mqtt_host = os.environ.get("BTL_MQTT_HOST", s.mqtt_host)
    s.mqtt_port = int(os.environ.get("BTL_MQTT_PORT", s.mqtt_port))
    s.device_id = os.environ.get("BTL_DEVICE_ID", s.device_id)
    s.data_file = os.environ.get("BTL_DATA_FILE", s.data_file)
    s.database_url = os.environ.get("BTL_DATABASE_URL", s.database_url)
    s.users_spec = os.environ.get("BTL_USERS", s.users_spec)
    s.jwt_secret = os.environ.get("BTL_JWT_SECRET", s.jwt_secret)
    s.jwt_ttl_s = int(os.environ.get("BTL_JWT_TTL_S", s.jwt_ttl_s))
    s.rate_limit_max = int(os.environ.get("BTL_RATE_LIMIT_MAX", s.rate_limit_max))
    s.rate_limit_window_s = float(os.environ.get("BTL_RATE_LIMIT_WINDOW_S", s.rate_limit_window_s))
    s.mqtt_username = os.environ.get("BTL_MQTT_USERNAME", s.mqtt_username)
    s.mqtt_password = os.environ.get("BTL_MQTT_PASSWORD", s.mqtt_password)
    return s
