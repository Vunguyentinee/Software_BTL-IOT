import json
import logging

from .config import Settings

log = logging.getLogger(__name__)

SUBSCRIBE_SUFFIXES = ["telemetry", "event", "cmd/ack", "config/ack", "status"]
ROUTES = {
    "telemetry": "on_telemetry",
    "event": "on_event",
    "status": "on_status",
    "cmd/ack": "on_cmd_ack",
    "config/ack": "on_config_ack",
}


class MqttBridge:
    """Nối MQTT (paho) với Service; đồng thời là Publisher của Service."""

    def __init__(self, service, settings: Settings, client=None):
        self.service = service
        self.settings = settings
        self.prefix = f"home/{settings.device_id}/"
        if client is None:
            import paho.mqtt.client as mqtt
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                 client_id=f"backend-{settings.device_id}")
        self.client = client
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    # ---- lifecycle -----------------------------------------------------
    def start(self) -> None:
        self.client.reconnect_delay_set(1, 30)
        self.client.connect_async(self.settings.mqtt_host, self.settings.mqtt_port, 60)
        self.client.loop_start()

    def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()

    # ---- paho callbacks ------------------------------------------------
    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        failed = getattr(reason_code, "is_failure", None)
        if failed is None:
            failed = reason_code != 0
        if failed:
            log.error("mqtt connect failed: %s", reason_code)
            return
        for suffix in SUBSCRIBE_SUFFIXES:
            client.subscribe(self.prefix + suffix, qos=1)
        self.service.on_connected()

    def _on_message(self, client, userdata, msg):
        self.handle_message(msg.topic, msg.payload)

    def handle_message(self, topic: str, payload: bytes) -> None:
        if not topic.startswith(self.prefix):
            return
        method = ROUTES.get(topic[len(self.prefix):])
        if method is None:
            return
        try:
            getattr(self.service, method)(payload)
        except Exception:
            log.exception("error handling %s", topic)

    # ---- Publisher -----------------------------------------------------
    def publish_cmd(self, payload: dict) -> None:
        self.client.publish(self.prefix + "cmd", json.dumps(payload), qos=1, retain=False)

    def publish_config(self, payload: dict) -> None:
        self.client.publish(self.prefix + "config/set", json.dumps(payload), qos=1, retain=True)
