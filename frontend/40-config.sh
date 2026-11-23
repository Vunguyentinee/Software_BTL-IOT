#!/bin/sh
# Chạy tự động khi nginx khởi động (thư mục /docker-entrypoint.d/).
# Sinh /config.js để giao diện tự đăng nhập bằng tài khoản operator (không ghi vào mã nguồn / git).
set -eu

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = { uiUsername: "$(esc "${UI_USERNAME:-}")", uiPassword: "$(esc "${UI_PASSWORD:-}")" };
EOF
