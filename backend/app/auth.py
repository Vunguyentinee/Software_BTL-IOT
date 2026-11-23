"""Xác thực (username/password -> JWT), phân quyền theo vai trò và giới hạn tốc độ.

Quyết định thiết kế:
- Mật khẩu khai báo ở biến môi trường (file .env nằm ngoài git), được băm bcrypt trong bộ nhớ khi khởi động.
- Chưa cấu hình người dùng hoặc `jwt_secret` yếu (< 32 ký tự) -> coi như CHƯA CẤU HÌNH:
  các route điều khiển trả 503, không bao giờ mở cửa mặc định.
- JWT HS256, bắt buộc có `exp`; quyền hiệu lực lấy từ cấu hình người dùng hiện tại, không tin claim `role`.
- Đồng hồ được tiêm vào (cùng đồng hồ với Service) để test được hết hạn/khóa mà không phải chờ.
"""
import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Callable, Optional

import bcrypt
import jwt
from fastapi import HTTPException

ROLE_LEVEL = {"viewer": 1, "operator": 2, "admin": 3}
MIN_SECRET_LEN = 32
MIN_PASSWORD_LEN = 8
MAX_PASSWORD_BYTES = 72  # giới hạn của bcrypt
_MAX_TRACKED_KEYS = 1000


def parse_users(spec: str) -> dict[str, tuple[str, str]]:
    """'user:password:role,user2:password2:role2' -> {user: (password, role)}.

    Mật khẩu không được chứa ':' hoặc ','. Sai định dạng -> ValueError (không chạy với cấu hình mờ ám).
    """
    users: dict[str, tuple[str, str]] = {}
    for entry in (spec or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) != 3:
            raise ValueError("BTL_USERS: mỗi mục phải có dạng user:password:role")
        name, password, role = (p.strip() for p in parts)
        if not name or role not in ROLE_LEVEL:
            raise ValueError(f"BTL_USERS: tên rỗng hoặc vai trò không hợp lệ (viewer|operator|admin): {role!r}")
        if len(password) < MIN_PASSWORD_LEN or len(password.encode()) > MAX_PASSWORD_BYTES:
            raise ValueError(f"BTL_USERS: mật khẩu của '{name}' phải dài {MIN_PASSWORD_LEN}-{MAX_PASSWORD_BYTES} byte")
        if name in users:
            raise ValueError(f"BTL_USERS: trùng tên người dùng '{name}'")
        users[name] = (password, role)
    return users


class SlidingWindowLimiter:
    """Cho tối đa `max_events` sự kiện trong `window_s` giây cho mỗi khóa."""

    def __init__(self, max_events: int, window_s: float, clock: Callable[[], float] = time.time):
        self.max_events = max_events
        self.window_s = window_s
        self.clock = clock
        self._events: dict[str, deque] = defaultdict(deque)

    def _trim(self, key: str, now: float) -> deque:
        q = self._events[key]
        while q and now - q[0] >= self.window_s:
            q.popleft()
        return q

    def _prune(self, now: float) -> None:
        if len(self._events) <= _MAX_TRACKED_KEYS:
            return
        for k in [k for k in self._events if not self._trim(k, now)]:
            del self._events[k]

    def retry_after(self, key: str) -> float:
        """0 nếu còn được phép; ngược lại số giây phải chờ. KHÔNG ghi nhận sự kiện."""
        now = self.clock()
        q = self._trim(key, now)
        if len(q) < self.max_events:
            return 0.0
        return max(0.0, self.window_s - (now - q[0]))

    def record(self, key: str) -> None:
        now = self.clock()
        self._prune(now)
        self._trim(key, now).append(now)

    def hit(self, key: str) -> float:
        """Ghi nhận nếu được phép; trả 0, hoặc số giây phải chờ nếu vượt giới hạn."""
        wait = self.retry_after(key)
        if wait == 0.0:
            self.record(key)
        return wait

    def reset(self, key: str) -> None:
        self._events.pop(key, None)


@dataclass(frozen=True)
class Principal:
    name: str
    role: str


class AuthManager:
    def __init__(self, settings, clock: Callable[[], float] = time.time):
        self.clock = clock
        self.ttl_s = settings.jwt_ttl_s
        self._secret = settings.jwt_secret or ""
        self._users: dict[str, tuple[bytes, str]] = {}
        self._dummy = bcrypt.hashpw(b"dummy-password", bcrypt.gensalt(settings.bcrypt_rounds))
        self.config_error: Optional[str] = None
        try:
            for name, (password, role) in parse_users(settings.users_spec).items():
                self._users[name] = (bcrypt.hashpw(password.encode(), bcrypt.gensalt(settings.bcrypt_rounds)), role)
        except ValueError as e:
            self._users = {}
            self.config_error = str(e)
        self._login_failures = SlidingWindowLimiter(settings.login_max_failures, settings.login_lockout_s, clock)
        self._control_limiter = SlidingWindowLimiter(settings.rate_limit_max, settings.rate_limit_window_s, clock)

    @property
    def configured(self) -> bool:
        return bool(self._users) and len(self._secret) >= MIN_SECRET_LEN

    # ---- đăng nhập -----------------------------------------------------
    def login(self, username: str, password: str) -> dict:
        key = username.lower()
        wait = self._login_failures.retry_after(key)
        if wait > 0:
            raise HTTPException(429, "too_many_login_attempts",
                                headers={"Retry-After": str(max(1, math.ceil(wait)))})
        entry = self._users.get(username)
        stored = entry[0] if entry else self._dummy   # luôn băm một lần: tránh lộ user tồn tại qua thời gian
        try:
            ok = bcrypt.checkpw(password.encode(), stored) and entry is not None
        except ValueError:   # mật khẩu quá dài với bcrypt
            ok = False
        if not ok:
            self._login_failures.record(key)
            raise HTTPException(401, "invalid_credentials", headers={"WWW-Authenticate": "Bearer"})
        self._login_failures.reset(key)
        role = entry[1]
        now = int(self.clock())
        token = jwt.encode({"sub": username, "role": role, "iat": now, "exp": now + self.ttl_s},
                           self._secret, algorithm="HS256")
        return {"access_token": token, "token_type": "bearer", "expires_in": self.ttl_s, "role": role}

    # ---- xác thực mỗi yêu cầu --------------------------------------------
    def authenticate(self, authorization: Optional[str]) -> Principal:
        unauthorized = HTTPException(401, "not_authenticated", headers={"WWW-Authenticate": "Bearer"})
        if not authorization:
            raise unauthorized
        scheme, _, token = authorization.partition(" ")
        token = token.strip()
        if scheme.lower() != "bearer" or not token:
            raise unauthorized
        try:
            claims = jwt.decode(token, self._secret, algorithms=["HS256"],
                                options={"verify_exp": False, "verify_iat": False,
                                         "require": ["exp", "sub", "role"]})
        except jwt.PyJWTError:
            raise unauthorized
        exp, sub, role = claims.get("exp"), claims.get("sub"), claims.get("role")
        if (not isinstance(exp, (int, float)) or exp <= self.clock()
                or not isinstance(sub, str) or role not in ROLE_LEVEL):
            raise unauthorized
        entry = self._users.get(sub)
        if entry is None:
            raise unauthorized
        return Principal(name=sub, role=entry[1])   # quyền hiệu lực = cấu hình hiện tại

    def require(self, authorization: Optional[str], min_role: str) -> Principal:
        if not self.configured:
            raise HTTPException(503, "auth_not_configured")
        principal = self.authenticate(authorization)
        if ROLE_LEVEL[principal.role] < ROLE_LEVEL[min_role]:
            raise HTTPException(403, "forbidden")
        wait = self._control_limiter.hit(principal.name)
        if wait > 0:
            raise HTTPException(429, "rate_limited", headers={"Retry-After": str(max(1, math.ceil(wait)))})
        return principal
