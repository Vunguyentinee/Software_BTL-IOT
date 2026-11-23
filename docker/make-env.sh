#!/bin/sh
# Sinh .env với mật khẩu/khóa ngẫu nhiên (chỉ thêm khóa còn thiếu, không ghi đè). Chạy từ thư mục gốc dự án:
#   sh docker/make-env.sh
set -eu
ENV_FILE=.env
touch "$ENV_FILE"

secret() { LC_ALL=C tr -dc 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' </dev/urandom | head -c "$1"; }
has() { grep -q "^$1=" "$ENV_FILE"; }
get() { grep "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2-; }
add() { if ! has "$1"; then echo "$1=$2" >> "$ENV_FILE"; echo "đã thêm $1"; fi; }

add MQTT_BACKEND_PASSWORD "$(secret 24)"
add MQTT_DEVICE_PASSWORD "$(secret 24)"
add MQTT_SIM_PASSWORD "$(secret 24)"
add BTL_JWT_SECRET "$(secret 48)"
add ADMIN_PASSWORD "$(secret 20)"
add UI_USERNAME ui
add UI_PASSWORD "$(secret 20)"
add BTL_USERS "admin:$(get ADMIN_PASSWORD):admin,ui:$(get UI_PASSWORD):operator"
echo "Xong. Tài khoản quản trị: admin (mật khẩu: ADMIN_PASSWORD trong .env). KHÔNG commit file .env."
