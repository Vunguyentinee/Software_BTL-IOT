import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .models import CommandRequest, ScenarioRequest, Telemetry, Thresholds
from .service import DeviceOffline, PublishFailed, SafetyOverride, Service, SimulatorNotActive

log = logging.getLogger(__name__)

try:  # lỗi hạ tầng lưu trữ (PostgreSQL ngừng, hết pool...) -> 503, không che giấu bằng 200 rỗng
    import psycopg
    import psycopg_pool
    STORAGE_ERRORS: tuple = (psycopg.Error, psycopg_pool.PoolTimeout, psycopg_pool.PoolClosed)
except ImportError:  # pragma: no cover
    STORAGE_ERRORS = ()

METRICS = {
    name for name, f in Telemetry.model_fields.items()
    if name not in ("modes", "door_command", "device_id", "boot_id", "seq", "safety_mode", "safety_reason")
}


class WsHub:
    def __init__(self):
        self.clients: list = []
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    async def broadcast(self, msg: dict) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                log.info("dropping dead websocket client")
                if ws in self.clients:
                    self.clients.remove(ws)

    def threadsafe_broadcast(self, msg: dict) -> None:
        """Gọi được từ luồng khác (paho)."""
        if self.loop is not None and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(msg), self.loop)


def _parse_time(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        raise HTTPException(422, f"invalid time: {value}")


def create_app(service: Service, hub: Optional[WsHub] = None, lifespan_extra=None) -> FastAPI:
    hub = hub or WsHub()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        if lifespan_extra is not None:
            async with lifespan_extra():
                yield
        else:
            yield

    app = FastAPI(title="Smart Home Backend", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                       allow_headers=["*"])
    app.state.hub = hub

    async def storage_unavailable(request, exc):
        log.error("storage unavailable on %s: %s", request.url.path, exc)
        return JSONResponse({"detail": "storage_unavailable"}, status_code=503)

    for err_type in STORAGE_ERRORS:
        app.add_exception_handler(err_type, storage_unavailable)

    @app.get("/api/state")
    def get_state():
        return service.get_state()

    @app.get("/api/health")
    def health():
        return service.health()

    @app.get("/api/history")
    def history(metric: str, from_: Optional[str] = Query(None, alias="from"),
                to: Optional[str] = None):
        if metric not in METRICS:
            raise HTTPException(422, f"unknown metric: {metric}")
        return service.storage.history(metric, _parse_time(from_), _parse_time(to))

    # Ba endpoint dưới đây dùng contract Storage của Người 5. Storage tự kiểm tra
    # metric, khoảng thời gian (nan/inf, start > end) và giới hạn; ValueError -> 422.
    def _history_range(from_: Optional[str], to: Optional[str]):
        return _parse_time(from_), _parse_time(to)

    @app.get("/api/history/stats")
    def history_stats(metric: str, from_: Optional[str] = Query(None, alias="from"),
                      to: Optional[str] = None):
        start, end = _history_range(from_, to)
        try:
            return service.storage.history_stats(metric, start, end)
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.get("/api/history/page")
    def history_page(metric: str, from_: Optional[str] = Query(None, alias="from"),
                     to: Optional[str] = None, limit: int = Query(100, ge=1, le=1000),
                     offset: int = Query(0, ge=0)):
        start, end = _history_range(from_, to)
        try:
            return service.storage.history_page(metric, start, end, limit, offset)
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.get("/api/history.csv")
    def history_csv(metric: str, from_: Optional[str] = Query(None, alias="from"),
                    to: Optional[str] = None, batch_size: int = Query(1000, ge=1, le=1000)):
        start, end = _history_range(from_, to)
        # Gọi (và kiểm tra) TRƯỚC khi tạo StreamingResponse để lỗi hợp lệ còn trả được 422.
        try:
            chunks = service.storage.history_csv(metric, start, end, batch_size)
        except ValueError as e:
            raise HTTPException(422, str(e))
        return StreamingResponse(
            chunks, media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{metric}.csv"'})

    @app.get("/api/history/reliability")
    def history_reliability(device_id: Optional[str] = None,
                            from_: Optional[str] = Query(None, alias="from"),
                            to: Optional[str] = None):
        start, end = _history_range(from_, to)
        try:
            return service.storage.reliability_stats(device_id, start, end)
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.get("/api/history/commands/stats")
    def history_command_stats(from_: Optional[str] = Query(None, alias="from"),
                              to: Optional[str] = None):
        start, end = _history_range(from_, to)
        try:
            return service.storage.command_stats(start, end)
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.get("/api/history/connections")
    def history_connections(limit: int = Query(100, ge=1, le=1000),
                            from_: Optional[str] = Query(None, alias="from"),
                            to: Optional[str] = None):
        start, end = _history_range(from_, to)
        return service.storage.list_connection_events(limit, start, end)

    @app.get("/api/history/errors")
    def history_errors(limit: int = Query(100, ge=1, le=1000),
                       from_: Optional[str] = Query(None, alias="from"),
                       to: Optional[str] = None):
        start, end = _history_range(from_, to)
        return service.storage.list_error_events(limit, start, end)

    @app.get("/api/metrics/latency")
    def metrics_latency():
        return service.latency_stats()

    @app.get("/api/events")
    def events(limit: int = Query(100, ge=1, le=1000)):
        return service.storage.list_events(limit)

    @app.get("/api/commands")
    def commands(limit: int = Query(100, ge=1, le=1000)):
        return service.storage.list_commands(limit)

    @app.get("/api/commands/{cmd_id}")
    def get_command(cmd_id: str):
        cmd = service.get_command(cmd_id)
        if cmd is None:
            raise HTTPException(404, "command not found")
        return cmd

    @app.post("/api/devices/{device}/command")
    def send_command(device: str, body: CommandRequest):
        try:
            rec = service.send_command(device, body.action)
        except ValueError as e:
            raise HTTPException(422, str(e))
        except DeviceOffline:
            raise HTTPException(409, "device_offline")
        except SafetyOverride as e:
            return JSONResponse({"detail": "safety_override", "reason": e.reason}, status_code=409)
        except PublishFailed:
            raise HTTPException(503, "mqtt_publish_failed")
        out = {"cmd_id": rec["cmd_id"], "status": rec["status"]}
        if rec.get("duplicate"):
            out["duplicate"] = True
        return out

    @app.get("/api/config")
    def get_config():
        return service.get_config()

    @app.put("/api/config")
    def put_config(thresholds: Thresholds):
        return service.set_config(thresholds)

    @app.get("/api/sim")
    def get_sim():
        return service.get_sim()

    @app.post("/api/sim/scenario")
    def set_sim_scenario(body: ScenarioRequest):
        try:
            service.set_sim_scenario(body.scenario)
        except SimulatorNotActive:
            raise HTTPException(409, "simulator_not_active")
        except ValueError as e:
            raise HTTPException(422, str(e))
        # Kịch bản thực sự đổi khi simulator xác nhận (tin `sim` qua WebSocket)
        return {"requested": body.scenario, **service.get_sim()}

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        hub.clients.append(ws)
        try:
            await ws.send_json({"kind": "snapshot", "data": service.get_state()})
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception:
            log.info("websocket error", exc_info=True)
        finally:
            if ws in hub.clients:
                hub.clients.remove(ws)

    return app
