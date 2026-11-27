#!/bin/sh
# Thêm / đổi / xóa tài khoản đăng nhập web trong BTL_USERS của .env (mỗi thành viên một tài khoản).
#   sh docker/add-user.sh vu admin            # sinh mật khẩu ngẫu nhiên, in ra một lần
#   sh docker/add-user.sh thai operator 'MatKhau123'
#   sh docker/add-user.sh khach --remove
# Sau đó: docker compose up -d backend
set -eu
[ -f .env ] || { echo "Chưa có .env - chạy docker/make-env.sh trước." >&2; exit 1; }
name="${1:?Thiếu tên}"; role="${2:-viewer}"; pw="${3:-}"
echo "$name" | grep -Eq '^[A-Za-z0-9_.-]{1,32}$' || { echo "Tên không hợp lệ." >&2; exit 1; }
current=$(grep -E '^BTL_USERS=' .env | tail -n 1 | cut -d= -f2- || true)
kept=$(printf '%s' "$current" | tr ',' '\n' | grep -v "^$name:" | grep -v '^$' | paste -sd, - || true)
if [ "$role" = "--remove" ]; then
  new="$kept"; msg="Đã xóa tài khoản '$name'."
else
  case "$role" in viewer|operator|admin) ;; *) echo "Vai trò: viewer|operator|admin" >&2; exit 1;; esac
  [ -n "$pw" ] || pw=$(LC_ALL=C tr -dc 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' </dev/urandom | head -c 16)
  case "$pw" in *:*|*,*|*" "*) echo "Mật khẩu không được chứa : , hoặc khoảng trắng." >&2; exit 1;; esac
  [ ${#pw} -ge 8 ] || { echo "Mật khẩu tối thiểu 8 ký tự." >&2; exit 1; }
  new="${kept:+$kept,}$name:$pw:$role"; msg="Tài khoản: $name (vai trò: $role)  Mật khẩu: $pw"
fi
tmp=$(mktemp)
grep -vE '^BTL_USERS=' .env > "$tmp" || true
printf 'BTL_USERS=%s\n' "$new" >> "$tmp"
cat "$tmp" > .env && rm -f "$tmp"
echo "$msg"
echo "Áp dụng: docker compose up -d backend"
