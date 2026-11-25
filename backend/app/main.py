import logging
import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import telemetry, pack, passport, alerts, bms
from app.routers.telemetry import register_sio
from app.services.telemetry_store import telemetry_store

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*"
)

# Share the Socket.IO server with the telemetry router for live broadcast
register_sio(sio)

# FastAPI application
fastapi_app = FastAPI(
    title="8S11P Battery Pack Digital Twin API",
    description="Backend service providing real-time telemetry, BMS live data ingestion, Pack Assembly Map CRUD, and Afterlife API proxy.",
    version="4.0.0",
)

# CORS middleware
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
fastapi_app.include_router(telemetry.router)
fastapi_app.include_router(pack.router)
fastapi_app.include_router(passport.router)
fastapi_app.include_router(alerts.router)
fastapi_app.include_router(bms.router)


@fastapi_app.get("/")
async def root():
    return {"status": "8S11P Digital Twin Backend is running — live telemetry mode"}

# Socket.IO Event Handlers
@sio.event
async def connect(sid, environ):
    logger.info(f"Client connected: {sid}")
    latest = await telemetry_store.get_latest()
    if latest:
        await sio.emit("telemetry", latest.model_dump(), to=sid)

@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}")

# Vercel's FastAPI runtime loads `app`; keep the Socket.IO wrapper for local ASGI hosting.
app = fastapi_app
socketio_app = socketio.ASGIApp(sio, fastapi_app)
