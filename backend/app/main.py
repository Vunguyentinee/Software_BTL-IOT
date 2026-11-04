import asyncio
import logging
from contextlib import asynccontextmanager

from .api import WsHub, create_app
from .config import load_settings
from .mqtt_bridge import MqttBridge
from .service import Service
from .storage import InMemoryStorage

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

settings = load_settings()
if settings.database_url:
    from .pg_storage import PostgresStorage
    storage = PostgresStorage(settings.database_url)
    log.info("storage: PostgreSQL")
else:
    storage = InMemoryStorage(settings.data_file)
    log.info("storage: in-memory + %s", settings.data_file)
hub = WsHub()


class _LatePublisher:
    """Service cần publisher trước khi bridge tồn tại; bridge gắn vào sau."""
    target = None

    def publish_cmd(self, payload):
        self.target.publish_cmd(payload)

    def publish_config(self, payload):
        self.target.publish_config(payload)

    def publish_sim_scenario(self, payload):
        self.target.publish_sim_scenario(payload)


_pub = _LatePublisher()
service = Service(settings, storage, _pub, broadcast=hub.threadsafe_broadcast)
bridge = MqttBridge(service, settings)
_pub.target = bridge


@asynccontextmanager
async def _run():
    async def ticker():
        while True:
            try:
                service.tick()
            except Exception:
                log.exception("tick failed")
            await asyncio.sleep(1)

    bridge.start()
    task = asyncio.create_task(ticker())
    try:
        yield
    finally:
        task.cancel()
        bridge.stop()


app = create_app(service, hub, lifespan_extra=_run)
