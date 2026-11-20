from typing import Literal, Optional
from pydantic import BaseModel
from pydantic_settings import BaseSettings

class HealthThresholds(BaseModel):
    # Voltage thresholds (Volts)
    voltage_min_green: float = 3.0
    voltage_max_green: float = 4.2
    voltage_min_yellow: float = 2.8
    voltage_max_yellow: float = 4.25
    voltage_drift_yellow_mv: float = 50.0  # mV deviation from string mean

    # Temperature thresholds (Celsius)
    temp_max_green: float = 45.0
    temp_max_yellow: float = 55.0

    # DCIR thresholds (mΩ)
    dcir_max_green: float = 50.0
    dcir_max_yellow: float = 75.0

    # SOH thresholds (%)
    soh_min_green: float = 80.0
    soh_min_yellow: float = 60.0


class PackConfig(BaseSettings):
    pack_id: str = "PACK-8S11P-001"
    series_count: int = 8
    parallel_count: int = 11
    total_cells: int = 88
    charging_current_limit_a: Optional[float] = None
    afterlife_api_base_url: str = "https://afterlife-int-production.up.railway.app"
    database_backend: Literal["sqlite", "postgresql"] = "sqlite"
    database_url: str = "sqlite+aiosqlite:///./digital_twin.db"
    twin_api_key: Optional[str] = "a9c613d862383fe5fdf3d1d45030150edb77965ccba85773fc190c281a1e5253"
    callmebot_api_key: Optional[str] = None
    callmebot_phone: Optional[str] = None

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = PackConfig()
thresholds = HealthThresholds()
