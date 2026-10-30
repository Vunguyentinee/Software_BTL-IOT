import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .models import CommandRequest, Telemetry, Thresholds
from .service import DeviceOffline, Service

log = logging.getLogger(__name__)

METRICS = {
    name for name, f in Telemetry.model_fields.items()
    if name != "modes" and name != "door_command"
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

    @app.get("/api/state")
    def get_state():
        return service.get_state()

    @app.get("/api/history")
    def history(metric: str, from_: Optional[str] = Query(None, alias="from"),
                to: Optional[str] = None):
        if metric not in METRICS:
            raise HTTPException(422, f"unknown metric: {metric}")
        return service.storage.history(metric, _parse_time(from_), _parse_time(to))

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
        return {"cmd_id": rec["cmd_id"], "status": rec["status"]}

    @app.get("/api/config")
    def get_config():
        return service.get_config()

    @app.put("/api/config")
    def put_config(thresholds: Thresholds):
        return service.set_config(thresholds)

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
