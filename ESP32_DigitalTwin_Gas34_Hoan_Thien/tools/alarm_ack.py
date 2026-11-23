"""Send application acknowledgements for the smart-home firmware demo."""

import argparse
import json
import os
import sys
import time
import uuid

import paho.mqtt.client as mqtt
from paho.mqtt import publish


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="MQTT broker host")
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--device", default="esp32-home")
    parser.add_argument("--user", help="MQTT username. Set MQTT_PASSWORD in the environment.")
    modes = parser.add_subparsers(dest="mode", required=True)
    modes.add_parser("backend", help="Log alarm events and acknowledge application receipt")
    operator = modes.add_parser("operator", help="Acknowledge one event after viewing it")
    operator.add_argument("event_id")
    modes.add_parser("heartbeat", help="Publish test backend heartbeat for the current connection")
    command = modes.add_parser("command", help="Send a command using fresh ESP32 telemetry")
    command.add_argument("device_name", choices=("door", "fan", "led1"))
    command.add_argument("action", choices=("open", "close", "on", "off", "auto"))
    return parser.parse_args()


def ack_payload(event_id, source):
    return json.dumps({"event_id": event_id, "source": source})


def run_backend(args, event_topic, ack_topic, auth):
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    if auth:
        client.username_pw_set(auth["username"], auth["password"])

    def on_connect(client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            print(f"Broker rejected connection: {reason_code}", file=sys.stderr, flush=True)
            return
        client.subscribe(event_topic, qos=1)
        print(f"Listening on {event_topic}", flush=True)

    def on_message(client, userdata, message):
        try:
            event = json.loads(message.payload)
        except ValueError:
            return
        if not isinstance(event, dict) or event.get("type") != "alarm_response":
            return
        print(json.dumps(event, ensure_ascii=False), flush=True)
        event_id = event.get("event_id")
        if (
            isinstance(event_id, str)
            and event.get("state") in ("start", "retry", "escalated")
            and event.get("backend_ack") is False
        ):
            result = client.publish(ack_topic, ack_payload(event_id, "backend"), qos=1)
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                print(f"Could not enqueue ACK for {event_id}", file=sys.stderr, flush=True)

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(args.host, args.port)
    try:
        client.loop_forever()
    except KeyboardInterrupt:
        client.disconnect()


def run_link_client(args, auth):
    root = f"home/{args.device}"
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    if auth:
        client.username_pw_set(auth["username"], auth["password"])
    command_id = uuid.uuid4().hex
    target = None
    sent = False
    received_at = last_heartbeat = 0.0
    result = None

    def on_connect(client, userdata, flags, reason_code, properties):
        if not reason_code.is_failure:
            client.subscribe(f"{root}/telemetry", qos=0)
            if args.mode == "command":
                client.subscribe(f"{root}/cmd/ack", qos=1)

    def on_message(client, userdata, message):
        nonlocal target, received_at, result
        try:
            data = json.loads(message.payload)
        except ValueError:
            return
        if not isinstance(data, dict):
            return
        if message.topic == f"{root}/cmd/ack":
            if (sent and data.get("cmd_id") == command_id and target
                    and data.get("boot_id") == target["target_boot_id"]
                    and data.get("connection_id") == target["target_connection_id"]):
                result = data
            return
        if sent or message.retain:
            return
        boot_id, session = data.get("boot_id"), data.get("connection_id")
        if data.get("device_id") != args.device or not isinstance(boot_id, str):
            return
        if type(session) is not int or session <= 0:
            return
        if args.mode == "command" and data.get("control_mode") != "remote_available":
            return
        target = {"target_boot_id": boot_id, "target_connection_id": session}
        received_at = time.monotonic()

    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(args.host, args.port)
    deadline = time.monotonic() + 10
    try:
        while True:
            if client.loop(timeout=0.2) != mqtt.MQTT_ERR_SUCCESS:
                return "MQTT disconnected; check device state before sending another command."
            now = time.monotonic()
            if args.mode == "heartbeat":
                if target and now - received_at <= 6 and now - last_heartbeat >= 2:
                    client.publish(f"{root}/backend/heartbeat", json.dumps(target), qos=1)
                    last_heartbeat = now
            elif result is not None:
                print(json.dumps(result, ensure_ascii=False))
                return None if result.get("result") == "ok" else "ESP32 rejected the command."
            elif now >= deadline:
                return ("Command sent, but no matching ACK; reconcile telemetry before retrying."
                        if sent else "No current telemetry permitting remote control; no command sent.")
            elif target and not sent:
                payload = {**target, "cmd_id": command_id, "device": args.device_name,
                           "action": args.action}
                info = client.publish(f"{root}/cmd", json.dumps(payload), qos=1)
                if info.rc != mqtt.MQTT_ERR_SUCCESS:
                    return "MQTT did not accept the command for publishing."
                sent = True
    except KeyboardInterrupt:
        return None
    finally:
        client.disconnect()


def main():
    args = parse_args()
    event_topic = f"home/{args.device}/event"
    ack_topic = f"{event_topic}/ack"
    auth = {"username": args.user, "password": os.environ.get("MQTT_PASSWORD")} if args.user else None
    if args.mode == "backend":
        run_backend(args, event_topic, ack_topic, auth)
        return
    if args.mode in ("command", "heartbeat"):
        error = run_link_client(args, auth)
        if error:
            raise SystemExit(error)
        return
    publish.single(ack_topic, ack_payload(args.event_id, "operator"), qos=1,
                   hostname=args.host, port=args.port, auth=auth)
    print(f"Operator ACK sent for {args.event_id}")


if __name__ == "__main__":
    main()
