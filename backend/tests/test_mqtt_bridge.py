from app.config import Settings
from app.mqtt_bridge import MqttBridge

P = "home/esp32-home/"


class FakeClient:
    def __init__(self):
        self.published = []
        self.subscribed = []
        self.on_connect = None
        self.on_message = None
        self.started = False

    def publish(self, topic, payload=None, qos=0, retain=False):
        self.published.append((topic, payload, qos, retain))

    def subscribe(self, topic, qos=0):
        self.subscribed.append(topic)

    def connect_async(self, host, port, keepalive=60):
        self.host, self.port = host, port

    def reconnect_delay_set(self, min_delay=1, max_delay=30):
        pass

    def loop_start(self):
        self.started = True

    def loop_stop(self):
        self.started = False

    def disconnect(self):
        pass


class FakeService:
    def __init__(self):
        self.calls = []
        self.raise_on = None

    def _rec(self, name):
        def f(payload):
            self.calls.append((name, payload))
            if self.raise_on == name:
                raise RuntimeError("boom")
        return f

    def __getattr__(self, name):
        if name.startswith("on_") and name != "on_connected":
            return self._rec(name)
        raise AttributeError(name)

    def on_connected(self):
        self.calls.append(("on_connected", None))


def make():
    svc, client = FakeService(), FakeClient()
    return MqttBridge(svc, Settings(), client=client), svc, client


def test_handle_message_routes_by_topic():
    b, svc, _ = make()
    for suffix, fn in [("telemetry", "on_telemetry"), ("event", "on_event"),
                       ("status", "on_status"), ("cmd/ack", "on_cmd_ack"),
                       ("config/ack", "on_config_ack")]:
        b.handle_message(P + suffix, b"{}")
        assert svc.calls[-1] == (fn, b"{}")


def test_unknown_topic_ignored():
    b, svc, _ = make()
    b.handle_message(P + "whatever", b"{}")
    b.handle_message("other/topic", b"{}")
    assert svc.calls == []


def test_service_exception_does_not_propagate():
    b, svc, _ = make()
    svc.raise_on = "on_telemetry"
    b.handle_message(P + "telemetry", b"{}")


def test_publish_config_is_retained_qos1_on_config_set_topic():
    b, _, c = make()
    b.publish_config({"config_id": "k"})
    topic, payload, qos, retain = c.published[0]
    assert topic == P + "config/set" and qos == 1 and retain is True
    assert '"config_id": "k"' in payload


def test_publish_cmd_not_retained():
    b, _, c = make()
    b.publish_cmd({"cmd_id": "c"})
    topic, _, qos, retain = c.published[0]
    assert topic == P + "cmd" and qos == 1 and retain is False


def test_on_connect_subscribes_and_notifies_service():
    b, svc, c = make()
    b.start()
    assert c.started
    c.on_connect(c, None, None, 0, None)
    assert sorted(c.subscribed) == sorted(P + t for t in
                                          ["telemetry", "event", "cmd/ack", "config/ack", "status"])
    assert svc.calls.count(("on_connected", None)) == 1


def test_failed_connect_does_not_notify_service():
    b, svc, c = make()
    b.start()
    c.on_connect(c, None, None, 5, None)
    assert svc.calls == []
