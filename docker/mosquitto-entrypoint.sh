#!/bin/sh
# Tạo file mật khẩu Mosquitto từ biến môi trường rồi chạy broker.
# File mật khẩu nằm trong container (không ghi ra máy chủ, không vào git).
set -eu

: "${MQTT_BACKEND_PASSWORD:?Chưa đặt MQTT_BACKEND_PASSWORD (chạy docker/make-env.ps1 để sinh .env)}"
: "${MQTT_DEVICE_PASSWORD:?Chưa đặt MQTT_DEVICE_PASSWORD}"
: "${MQTT_SIM_PASSWORD:?Chưa đặt MQTT_SIM_PASSWORD}"

PASSWD=/mosquitto/passwd
: > "$PASSWD"
mosquitto_passwd -b "$PASSWD" backend   "$MQTT_BACKEND_PASSWORD"
mosquitto_passwd -b "$PASSWD" esp32     "$MQTT_DEVICE_PASSWORD"
mosquitto_passwd -b "$PASSWD" simulator "$MQTT_SIM_PASSWORD"
chown mosquitto:mosquitto "$PASSWD" 2>/dev/null || true
chmod 0600 "$PASSWD"

exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
