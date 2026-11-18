from sqlalchemy import String, Integer, Float, DateTime, UniqueConstraint, func, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class PackAssemblySlot(Base):
    __tablename__ = "pack_assembly_slots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pack_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    series: Mapped[int] = mapped_column(Integer, nullable=False)      # 1-8
    parallel: Mapped[int] = mapped_column(Integer, nullable=False)    # 1-11
    battery_code: Mapped[str] = mapped_column(String(100), nullable=False)
    assigned_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("pack_id", "series", "parallel", name="uq_pack_position"),
        UniqueConstraint("pack_id", "battery_code", name="uq_pack_battery_code"),
    )

    @property
    def position(self) -> str:
        return f"S{self.series}-P{self.parallel}"


class TelemetryRecord(Base):
    __tablename__ = "telemetry_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    pack_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    position: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    battery_code: Mapped[str] = mapped_column(String(100), nullable=True)
    voltage_v: Mapped[float] = mapped_column(Float, nullable=False)
    temperature_c: Mapped[float] = mapped_column(Float, nullable=False)
    dcir_mohm: Mapped[float] = mapped_column(Float, nullable=False)
    soh_percent: Mapped[float] = mapped_column(Float, nullable=False)
    health_status: Mapped[str] = mapped_column(String(20), default="green")


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_name: Mapped[str] = mapped_column(String(100), nullable=False)
    metric: Mapped[str] = mapped_column(String(50), nullable=False)
    condition: Mapped[str] = mapped_column(String(10), nullable=False)  # 'gt', 'lt', 'gte', 'lte'
    threshold_value: Mapped[float] = mapped_column(Float, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), default="warning")  # 'warning', 'critical'
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class AlertLog(Base):
    """Phase 3: Extended with acknowledge, snooze, and resolution tracking (FR-9.4, FR-9.5)."""
    __tablename__ = "alert_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    pack_id: Mapped[str] = mapped_column(String(50), nullable=False)
    position: Mapped[str] = mapped_column(String(20), nullable=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    is_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    acknowledged_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    snoozed_until: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_note: Mapped[str] = mapped_column(String(500), nullable=True)


class MaintenanceEvent(Base):
    """Phase 3: Cell replacement event log (FR-10.3)."""
    __tablename__ = "maintenance_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    pack_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    position: Mapped[str] = mapped_column(String(20), nullable=False)
    old_battery_code: Mapped[str] = mapped_column(String(100), nullable=False)
    new_battery_code: Mapped[str] = mapped_column(String(100), nullable=False)
    operator: Mapped[str] = mapped_column(String(100), nullable=True)
    reason: Mapped[str] = mapped_column(String(500), nullable=True)


class AssemblyMapVersion(Base):
    """Phase 3: Assembly map versioning for traceability (FR-7.8)."""
    __tablename__ = "assembly_map_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    pack_id: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    change_type: Mapped[str] = mapped_column(String(20), nullable=False)  # 'assign', 'unassign', 'replace', 'bulk'
    changed_position: Mapped[str] = mapped_column(String(20), nullable=True)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)  # Full map snapshot as JSON


class BmsFrameLog(Base):
    """Phase 3: Raw BMS frame storage for forensic analysis (FR-2.8)."""
    __tablename__ = "bms_frame_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    protocol: Mapped[str] = mapped_column(String(20), nullable=False)  # 'RS485'
    raw_hex: Mapped[str] = mapped_column(Text, nullable=False)
    decoded_json: Mapped[str] = mapped_column(Text, nullable=True)
    frame_type: Mapped[str] = mapped_column(String(50), nullable=True)  # 'telemetry', 'heartbeat', 'config'
