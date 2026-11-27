from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc, func
from typing import List, Dict, Any
import json

from app.database import get_db
from app.models import PackAssemblySlot, MaintenanceEvent, AssemblyMapVersion
from app.schemas import (
    SlotAssignmentRequest,
    BulkSlotAssignmentRequest,
    SlotResponse,
    ProgressResponse,
    CellSwapRequest
)
from app.services.passport_client import passport_client
from app.services.replacement_engine import replacement_engine
from app.config import settings

router = APIRouter(prefix="/pack", tags=["Pack Assembly Map"])


def _position_in_bounds(series: int, parallel: int) -> bool:
    return (
        1 <= series <= settings.series_count
        and 1 <= parallel <= settings.parallel_count
    )


async def _compute_progress(pack_id: str, db: AsyncSession) -> ProgressResponse:
    """
    Single source of truth for assembly progress. Only counts slots that have a
    battery code AND sit inside the physical matrix, so the bulk endpoint and the
    progress endpoint always agree.
    """
    count_res = await db.execute(
        select(func.count()).select_from(PackAssemblySlot).where(
            PackAssemblySlot.pack_id == pack_id,
            PackAssemblySlot.battery_code.isnot(None),
            PackAssemblySlot.battery_code != "",
            PackAssemblySlot.series >= 1,
            PackAssemblySlot.series <= settings.series_count,
            PackAssemblySlot.parallel >= 1,
            PackAssemblySlot.parallel <= settings.parallel_count,
        )
    )
    assigned_count = count_res.scalar_one()
    total = settings.total_cells
    return ProgressResponse(
        pack_id=pack_id,
        total_slots=total,
        assigned_slots=assigned_count,
        unassigned_slots=total - assigned_count,
        completion_percentage=round((assigned_count / total) * 100.0, 1) if total else 0.0
    )


@router.get("/{pack_id}/map", response_model=List[SlotResponse])
async def get_pack_assembly_map(pack_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns the full assembly map for every slot of a pack
    (settings.series_count x settings.parallel_count).
    Unassigned slots are returned with battery_code = null.
    """
    result = await db.execute(
        select(PackAssemblySlot).where(PackAssemblySlot.pack_id == pack_id)
    )
    assigned_slots = {
        f"S{slot.series}-P{slot.parallel}": slot for slot in result.scalars().all()
    }
    legacy_lookup = await passport_client.get_code_to_legacy_map()
    passport_lookup = await passport_client.get_code_to_passport_map(
        [slot.battery_code for slot in assigned_slots.values() if slot.battery_code]
    )

    full_map = []
    for s in range(1, settings.series_count + 1):
        for p in range(1, settings.parallel_count + 1):
            pos = f"S{s}-P{p}"
            slot_obj = assigned_slots.get(pos)
            bcode = slot_obj.battery_code if slot_obj else None
            passport = passport_lookup.get(bcode) if bcode else None
            leg_id = legacy_lookup.get(bcode) if bcode else None
            passport_legacy_id = passport.get("legacy_cell_id") if passport else None
            leg_id = leg_id or (
                str(passport_legacy_id) if passport_legacy_id is not None else None
            )
            full_map.append(SlotResponse(
                series=s,
                parallel=p,
                position=pos,
                battery_code=bcode,
                assigned_at=slot_obj.assigned_at.isoformat() if slot_obj and slot_obj.assigned_at else None,
                legacy_cell_id=leg_id,
                passport_data=passport,
            ))
    return full_map

@router.post("/{pack_id}/map", response_model=SlotResponse)
async def assign_cell_to_slot(
    pack_id: str,
    req: SlotAssignmentRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Assigns a cell to a matrix position.
    🔗 AFTERLIFE API: Validates the battery_code against the Afterlife Intelligence inventory before assigning.
    """
    if not _position_in_bounds(req.series, req.parallel):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Position S{req.series}-P{req.parallel} is outside the {settings.series_count}S{settings.parallel_count}P matrix."
        )

    passport = await passport_client.get_passport_by_code(req.battery_code)
    if not passport:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Battery code '{req.battery_code}' not found in Afterlife Intelligence inventory"
        )

    existing_pos = await db.execute(
        select(PackAssemblySlot).where(
            PackAssemblySlot.pack_id == pack_id,
            PackAssemblySlot.series == req.series,
            PackAssemblySlot.parallel == req.parallel
        )
    )
    slot_entry = existing_pos.scalar_one_or_none()

    existing_code = await db.execute(
        select(PackAssemblySlot).where(
            PackAssemblySlot.pack_id == pack_id,
            PackAssemblySlot.battery_code == req.battery_code
        )
    )
    code_entry = existing_code.scalar_one_or_none()

    if code_entry and (not slot_entry or code_entry.id != slot_entry.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Battery code '{req.battery_code}' is already assigned to position S{code_entry.series}-P{code_entry.parallel}"
        )

    if slot_entry:
        slot_entry.battery_code = req.battery_code
    else:
        slot_entry = PackAssemblySlot(
            pack_id=pack_id,
            series=req.series,
            parallel=req.parallel,
            battery_code=req.battery_code
        )
        db.add(slot_entry)

    await db.commit()
    await db.refresh(slot_entry)

    leg_id = str(passport.get("legacy_cell_id")) if passport and passport.get("legacy_cell_id") else None
    return SlotResponse(
        series=slot_entry.series,
        parallel=slot_entry.parallel,
        position=slot_entry.position,
        battery_code=slot_entry.battery_code,
        assigned_at=slot_entry.assigned_at.isoformat(),
        passport_data=passport,
        legacy_cell_id=leg_id
    )

@router.post("/{pack_id}/map/bulk", response_model=ProgressResponse)
async def bulk_assign_cells(
    pack_id: str,
    req: BulkSlotAssignmentRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Bulk assigns cells to matrix positions.
    🔗 AFTERLIFE API: Validates submitted battery codes and assigns positions cleanly.
    """
    if not req.mappings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bulk assignment payload contains no mappings."
        )

    # 0. Validate positions: in-bounds, and no position targeted twice in the payload.
    #    (Without this, a repeated position silently overwrites the earlier cell and the
    #    pack ends up one slot short.)
    seen_positions = {}
    for idx, mapping in enumerate(req.mappings):
        if not _position_in_bounds(mapping.series, mapping.parallel):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Mapping at index {idx} ('{mapping.battery_code}') targets "
                    f"S{mapping.series}-P{mapping.parallel}, which is outside the "
                    f"{settings.series_count}S{settings.parallel_count}P matrix."
                )
            )
        pos_key = (mapping.series, mapping.parallel)
        if pos_key in seen_positions:
            prev_idx, prev_code = seen_positions[pos_key]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Position S{mapping.series}-P{mapping.parallel} is assigned twice in this import "
                    f"(index {prev_idx} '{prev_code}' and index {idx} '{mapping.battery_code.strip()}'). "
                    f"Each slot holds one cell."
                )
            )
        seen_positions[pos_key] = (idx, mapping.battery_code.strip())

    # 1. Check for duplicate battery codes within the submitted payload
    seen_in_payload = {}
    for idx, mapping in enumerate(req.mappings):
        code = mapping.battery_code.strip()
        if code in seen_in_payload:
            prev = seen_in_payload[code]
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Duplicate battery code '{code}' in bulk import at index {idx} (also assigned to S{prev.series}-P{prev.parallel})"
            )
        seen_in_payload[code] = mapping

    # 2. Fetch existing slots in pack
    existing_slots_res = await db.execute(
        select(PackAssemblySlot).where(PackAssemblySlot.pack_id == pack_id)
    )
    existing_slots = existing_slots_res.scalars().all()
    slot_map = {(s.series, s.parallel): s for s in existing_slots}
    code_map = {s.battery_code: s for s in existing_slots}

    # 2b. Cross-reference: reject codes already deployed at positions NOT being overwritten
    positions_in_batch = {(m.series, m.parallel) for m in req.mappings}
    for mapping in req.mappings:
        code = mapping.battery_code.strip()
        if code in code_map:
            existing_slot = code_map[code]
            existing_pos = (existing_slot.series, existing_slot.parallel)
            target_pos = (mapping.series, mapping.parallel)
            if existing_pos != target_pos and existing_pos not in positions_in_batch:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Battery code '{code}' is already assigned to position S{existing_slot.series}-P{existing_slot.parallel}. Each cell can only occupy one slot. Remove it first or use a different cell."
                )

    # 3. Temporarily detach any conflicting existing codes that will be moved
    for mapping in req.mappings:
        code = mapping.battery_code.strip()
        pos_key = (mapping.series, mapping.parallel)
        if code in code_map:
            prev_slot = code_map[code]
            if (prev_slot.series, prev_slot.parallel) != pos_key:
                # Code is being moved from another slot
                prev_slot.battery_code = f"__REASSIGN_TEMP_{prev_slot.id}__"
                await db.flush()

    # 4. Assign mappings to target slots
    for mapping in req.mappings:
        code = mapping.battery_code.strip()
        pos_key = (mapping.series, mapping.parallel)
        slot = slot_map.get(pos_key)
        if slot:
            slot.battery_code = code
        else:
            new_slot = PackAssemblySlot(
                pack_id=pack_id,
                series=mapping.series,
                parallel=mapping.parallel,
                battery_code=code
            )
            db.add(new_slot)
            slot_map[pos_key] = new_slot

    await db.commit()

    # Same bounded count the /progress endpoint uses, so the two always agree
    return await _compute_progress(pack_id, db)

@router.delete("/{pack_id}/map/S{series}-P{parallel}")
async def unassign_cell(
    pack_id: str,
    series: int,
    parallel: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Removes cell assignment from a position.
    """
    await db.execute(
        delete(PackAssemblySlot).where(
            PackAssemblySlot.pack_id == pack_id,
            PackAssemblySlot.series == series,
            PackAssemblySlot.parallel == parallel
        )
    )
    await db.commit()
    return {"status": "unassigned", "position": f"S{series}-P{parallel}"}


@router.delete("/{pack_id}/map")
async def clear_pack_assignments(pack_id: str, db: AsyncSession = Depends(get_db)):
    """Remove every current cell assignment for a pack in one operation."""
    result = await db.execute(
        delete(PackAssemblySlot).where(PackAssemblySlot.pack_id == pack_id)
    )
    await db.commit()
    return {
        "status": "cleared",
        "pack_id": pack_id,
        "assignments_removed": result.rowcount or 0,
    }


@router.get("/{pack_id}/progress", response_model=ProgressResponse)
async def get_assembly_progress(pack_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns pack assembly progress (assigned vs total).
    Only counts slots that are within physical boundaries and have an assigned cell code.
    """
    return await _compute_progress(pack_id, db)

# --- Phase 3 Operations Endpoints ---

@router.get("/{pack_id}/replacements/{position}")
async def get_replacement_candidates(
    pack_id: str,
    position: str,
    db: AsyncSession = Depends(get_db)
):
    """
    FR-10.1 & FR-10.2: Cell Replacement Wizard Candidate Ranking.
    Queries Afterlife inventory and ranks candidate cells using 5-Step BaaS Engine:
    1. Lock Chemistry & Discharge Rates
    2. Capacity Matching (mAh ±250mAh)
    3. DCIR Variance Filtering (±5% / 2-5mΩ)
    4. Grade Tag Mapping (Formally graded cells only)
    5. OCV Safety Directive Verification (ΔOCV ≤ 1.5V)
    """
    try:
        series_num = int(position.split("-")[0].replace("S", ""))
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid position format '{position}'")

    assigned_res = await db.execute(
        select(PackAssemblySlot.battery_code).where(PackAssemblySlot.pack_id == pack_id)
    )
    assigned_codes = set(assigned_res.scalars().all())

    target_slot_res = await db.execute(
        select(PackAssemblySlot).where(
            PackAssemblySlot.pack_id == pack_id,
            PackAssemblySlot.series == series_num,
            PackAssemblySlot.parallel == int(position.split("-")[1].replace("P", ""))
        )
    )
    target_slot = target_slot_res.scalar_one_or_none()
    target_code = target_slot.battery_code if target_slot else None

    target_passport = await passport_client.get_passport_by_code(target_code) if target_code else None

    inv_data = await passport_client.list_passports(page=1, page_size=50)
    all_passports = inv_data.get("passports", [])

    # 1. Calculate target group vitals
    target_vitals = replacement_engine.calculate_parallel_group_vitals(
        series=series_num,
        target_cell_telemetry=None,
        target_passport=target_passport
    )

    # Extract manufacturer from target cell's passport for Tier 1 filtering
    target_manufacturer = None
    if target_passport:
        mfr = target_passport.get("manufacturer") or target_passport.get("source")
        if mfr and not any(kw in mfr for kw in ["LGA", "Sheet", "Live", "webhook"]):
            target_manufacturer = mfr

    # 2. Evaluate and rank candidates via 3-Tier Cascade BaaS replacement engine
    result = replacement_engine.rank_replacement_candidates(
        target_vitals=target_vitals,
        raw_passports=all_passports,
        exclude_codes=assigned_codes,
        target_code=target_code,
        target_manufacturer=target_manufacturer
    )

    return {
        "pack_id": pack_id,
        "position": position,
        "target_battery_code": target_code,
        "target_manufacturer": target_manufacturer,
        "target_vitals": target_vitals,
        "search_tier_used": result.get("search_tier_used", 1),
        "candidates": result.get("candidates", [])[:5]  # Top 5 candidates
    }

@router.post("/{pack_id}/replace-cell")
async def execute_cell_replacement(
    pack_id: str,
    req: CellSwapRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    FR-10.1 - FR-10.5: Executes cell swap.
    1. Updates PackAssemblySlot with new battery code.
    2. Logs event in MaintenanceEvent table.
    3. Appends version entry in AssemblyMapVersion table.
    4. Updates old cell state to RETIRED_FROM_PACK and new cell state to DEPLOYED_IN_PACK.
    5. Clears live simulator anomaly offset for position.
    """
    try:
        parts = req.position.split("-")
        s = int(parts[0].replace("S", ""))
        p = int(parts[1].replace("P", ""))
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid position format '{req.position}'")

    # 1. Update PackAssemblySlot
    existing = await db.execute(
        select(PackAssemblySlot).where(
            PackAssemblySlot.pack_id == pack_id,
            PackAssemblySlot.series == s,
            PackAssemblySlot.parallel == p
        )
    )
    slot = existing.scalar_one_or_none()
    if slot:
        slot.battery_code = req.new_battery_code
    else:
        slot = PackAssemblySlot(
            pack_id=pack_id,
            series=s,
            parallel=p,
            battery_code=req.new_battery_code
        )
        db.add(slot)

    # 2. Record Maintenance Event (FR-10.3)
    maint_event = MaintenanceEvent(
        pack_id=pack_id,
        position=req.position,
        old_battery_code=req.old_battery_code,
        new_battery_code=req.new_battery_code,
        operator=req.operator,
        reason=req.reason
    )
    db.add(maint_event)

    # 3. Create Assembly Map Version Snapshot (FR-7.8)
    ver_count_res = await db.execute(
        select(AssemblyMapVersion).where(AssemblyMapVersion.pack_id == pack_id)
    )
    ver_num = len(ver_count_res.scalars().all()) + 1

    # Snapshot current slots
    all_slots_res = await db.execute(
        select(PackAssemblySlot).where(PackAssemblySlot.pack_id == pack_id)
    )
    snapshot = {
        f"S{item.series}-P{item.parallel}": item.battery_code
        for item in all_slots_res.scalars().all()
    }
    snapshot[req.position] = req.new_battery_code

    version_entry = AssemblyMapVersion(
        pack_id=pack_id,
        version_number=ver_num,
        change_type="replace",
        changed_position=req.position,
        snapshot_json=json.dumps(snapshot)
    )
    db.add(version_entry)

    await db.commit()

    # 4. Passport Lifecycle State Updates (FR-10.4, FR-10.5)
    old_res = await passport_client.update_passport_state(req.old_battery_code, "RETIRED_FROM_PACK")
    new_res = await passport_client.update_passport_state(req.new_battery_code, "DEPLOYED_IN_PACK")

    # 5. Clear simulator fault/anomaly for replaced position if active
    anomaly_cleared = False
    try:
        from app.main import simulator
        anomaly_cleared = simulator.clear_cell_anomaly(req.position)
    except Exception:
        pass

    return {
        "status": "success",
        "message": f"Successfully replaced cell at {req.position} with {req.new_battery_code}",
        "maintenance_event_id": maint_event.id,
        "version_number": ver_num,
        "anomaly_cleared": anomaly_cleared,
        "passport_updates": {
            "old_cell": old_res,
            "new_cell": new_res
        }
    }

@router.get("/{pack_id}/maintenance")
async def get_maintenance_history(
    pack_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    FR-10.6: Returns maintenance history view per pack.
    """
    res = await db.execute(
        select(MaintenanceEvent)
        .where(MaintenanceEvent.pack_id == pack_id)
        .order_by(desc(MaintenanceEvent.timestamp))
    )
    events = res.scalars().all()
    return [
        {
            "id": e.id,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
            "pack_id": e.pack_id,
            "position": e.position,
            "old_battery_code": e.old_battery_code,
            "new_battery_code": e.new_battery_code,
            "operator": e.operator,
            "reason": e.reason,
        }
        for e in events
    ]

@router.get("/{pack_id}/map/history")
async def get_map_version_history(
    pack_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    FR-7.8: Assembly map versioning history.
    """
    res = await db.execute(
        select(AssemblyMapVersion)
        .where(AssemblyMapVersion.pack_id == pack_id)
        .order_by(desc(AssemblyMapVersion.version_number))
    )
    versions = res.scalars().all()
    return [
        {
            "id": v.id,
            "version_number": v.version_number,
            "timestamp": v.timestamp.isoformat() if v.timestamp else None,
            "change_type": v.change_type,
            "changed_position": v.changed_position,
        }
        for v in versions
    ]


# ─── Afterlife Pack Builder Proxy Endpoints ───

@router.get("/sessions")
@router.get("/afterlife/sessions")
async def get_afterlife_pack_sessions():
    """
    🔗 AFTERLIFE API Proxy: Fetches list of pack sessions created by Afterlife Pack Builder.
    """
    return await passport_client.get_pack_sessions()


@router.get("/sessions/{session_id}")
@router.get("/afterlife/sessions/{session_id}")
async def get_afterlife_pack_session(session_id: int):
    """
    🔗 AFTERLIFE API Proxy: Fetches a specific pack session with cell assignments in their respective series/parallel positions.
    """
    session = await passport_client.get_pack_session(session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pack Builder session #{session_id} not found in Afterlife API"
        )
    return session


@router.post("/match")
async def match_pack_proxy(payload: Dict[str, Any]):
    """
    🔗 AFTERLIFE API Proxy: Executes the Pack Builder matching algorithm across available inventory.
    """
    # Normalize chemistry if shorthand is passed (e.g. LIION -> Li-ion)
    chem = str(payload.get("chemistry", "")).strip()
    if chem.upper() in ["LIION", "LI-ION", "LITHIUM-ION"]:
        payload["chemistry"] = "Li-ion"
    elif chem.upper() in ["LIFEPO4", "LFP"]:
        payload["chemistry"] = "LiFePO4"

    try:
        result = await passport_client.match_pack(payload)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Afterlife Pack Builder match failed: {str(e)}"
        )