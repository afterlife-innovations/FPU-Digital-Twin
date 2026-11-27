from typing import Literal, Optional
from pydantic_settings import BaseSettings

class PackConfig(BaseSettings):
    pack_id: str = "PACK-8S11P-001"
    series_count: int = 8
    parallel_count: int = 11
    total_cells: int = 88
    charging_current_limit_a: Optional[float] = None
    afterlife_api_base_url: str = "https://afterlife-int-production.up.railway.app"
    database_backend: Literal["sqlite", "postgresql"] = "sqlite"
    database_url: str = "sqlite+aiosqlite:///./digital_twin.db"
    twin_api_key: Optional[str] = None
    callmebot_api_key: Optional[str] = None
    callmebot_phone: Optional[str] = None

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = PackConfig()
