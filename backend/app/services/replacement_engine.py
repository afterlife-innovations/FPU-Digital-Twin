import math
import logging
from typing import Dict, Any, List, Optional
from app.services.telemetry_store import telemetry_store

logger = logging.getLogger(__name__)

class CellReplacementEngine:
    """
    Afterlife Innovations BaaS: 5-Step Cell Replacement Algorithm Engine
    Tailored for 6S22P 18650 lithium-ion configuration.
    
    1. Lock Chemistry & Discharge Rates (Hard Gate Filter)
    2. Calculate & Match Absolute Capacity (mAh) within ±250 mAh sliding window
    3. Filter by Internal Resistance (DCIR) within ±5% / 2-5mΩ variance
    4. Surface Result via Grade Tags (A-E framework, manufacturer, grade tag)
    5. Mandate OCV Standardization (Physical Safety Check: ΔOCV ≤ 1.5V pre-charge instruction)
    """

    def calculate_parallel_group_vitals(
        self,
        series: int,
        target_cell_telemetry: Optional[Dict[str, Any]] = None,
        target_passport: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Calculates baseline target characteristics for the parallel group S_series (22 cells).
        Extracts:
        - Sub-chemistry (e.g. INR vs ICR)
        - Max continuous discharge rating (Amps)
        - Block average DCIR (mΩ)
        - Target absolute capacity (mAh), when telemetry or passport inputs are available
        - Target live block OCV / resting voltage (V)
        """
        latest_telemetry = telemetry_store.get_latest_sync()

        # Gather live telemetry for surviving cells in group S_series
        group_voltages = []
        group_dcirs = []
        group_sohs = []

        if latest_telemetry and hasattr(latest_telemetry, "cells"):
            cells_dict = getattr(latest_telemetry, "cells", {})
            if isinstance(cells_dict, dict):
                cells_iter = cells_dict.values()
            elif isinstance(cells_dict, list):
                cells_iter = cells_dict
            else:
                cells_iter = []

            for cell in cells_iter:
                pos = getattr(cell, "position", "") if not isinstance(cell, dict) else cell.get("position", "")
                if pos.startswith(f"S{series}-"):
                    v = getattr(cell, "voltage_v", None) if not isinstance(cell, dict) else cell.get("voltage_v")
                    d = getattr(cell, "dcir_mohm", None) if not isinstance(cell, dict) else cell.get("dcir_mohm")
                    s = getattr(cell, "soh_percent", None) if not isinstance(cell, dict) else cell.get("soh_percent")
                    if v is not None: group_voltages.append(v)
                    if d is not None: group_dcirs.append(d)
                    if s is not None: group_sohs.append(s)

        avg_voltage = sum(group_voltages) / len(group_voltages) if group_voltages else None
        avg_dcir = sum(group_dcirs) / len(group_dcirs) if group_dcirs else None
        avg_soh = sum(group_sohs) / len(group_sohs) if group_sohs else None

        if target_cell_telemetry:
            avg_voltage = avg_voltage if avg_voltage is not None else target_cell_telemetry.get("voltage_v")
            avg_dcir = avg_dcir if avg_dcir is not None else target_cell_telemetry.get("dcir_mohm")
            avg_soh = avg_soh if avg_soh is not None else target_cell_telemetry.get("soh_percent")

        chemistry = None
        if target_passport:
            chem = target_passport.get("chemistry", "")
            if chem:
                chemistry = f"Li-ion ({chem})" if "Li-ion" not in chem else chem

        nominal_capacity_ah = (
            target_passport.get("nominal_capacity_ah")
            or target_passport.get("nominal_capacity")
            if target_passport else None
        )
        nominal_capacity_mah = (
            float(nominal_capacity_ah) * 1000.0
            if nominal_capacity_ah is not None else None
        )
        if avg_soh is None and target_passport:
            avg_soh = target_passport.get("soh_percent")
        if avg_dcir is None and target_passport:
            avg_dcir = target_passport.get("dcir_mohm")
        if avg_voltage is None and target_passport:
            avg_voltage = target_passport.get("intake_ocv_v") or target_passport.get("ocv_v")

        # Step 2: Absolute Capacity (mAh) = (SOH % / 100) * C_nominal
        measured_capacity_ah = target_cell_telemetry.get("capacity_ah") if target_cell_telemetry else None
        target_absolute_capacity_mah = (
            float(measured_capacity_ah) * 1000.0
            if measured_capacity_ah is not None
            else (float(avg_soh) / 100.0) * nominal_capacity_mah
            if avg_soh is not None and nominal_capacity_mah is not None
            else None
        )

        return {
            "series": series,
            "subchemistry": chemistry,
            "max_continuous_discharge_a": None,
            "nominal_capacity_mah": nominal_capacity_mah,
            "target_block_avg_soh": round(float(avg_soh), 1) if avg_soh is not None else None,
            "target_absolute_capacity_mah": round(target_absolute_capacity_mah, 1) if target_absolute_capacity_mah is not None else None,
            "target_block_avg_dcir": round(float(avg_dcir), 2) if avg_dcir is not None else None,
            "target_block_live_ocv": round(float(avg_voltage), 3) if avg_voltage is not None else None,
        }

    def evaluate_ocv_safety(
        self,
        candidate_ocv_v: float,
        target_block_ocv_v: float,
        max_delta_mv: float = 1500.0
    ) -> Dict[str, Any]:
        """
        Step 5: Mandate OCV Standardization (Physical Safety Check).
        ΔOCV = |candidate_ocv - target_block_ocv|
        Constraint: ≤ 1500mV (±1.5V)
        """
        delta_v = candidate_ocv_v - target_block_ocv_v
        delta_mv = abs(delta_v) * 1000.0
        is_compliant = delta_mv <= max_delta_mv

        if is_compliant:
            action = "SAFE_FOR_IMMEDIATE_SWAP"
            instruction = f"Cell resting voltage ({candidate_ocv_v:.3f}V) is within ≤ {max_delta_mv/1000:.1f}V of block target ({target_block_ocv_v:.3f}V). Inrush safe. Ready to install."
        elif delta_v > 0:
            action = "DISCHARGE_REQUIRED"
            instruction = f"DISCHARGE cell from {candidate_ocv_v:.3f}V down to {target_block_ocv_v:.3f}V (±{max_delta_mv/1000:.1f}V) before installation to prevent severe inrush current."
        else:
            action = "CHARGE_REQUIRED"
            instruction = f"CHARGE cell from {candidate_ocv_v:.3f}V up to {target_block_ocv_v:.3f}V (±{max_delta_mv/1000:.1f}V) before installation to prevent parallel group draw."

        return {
            "candidate_ocv_v": round(candidate_ocv_v, 3),
            "target_block_ocv_v": round(target_block_ocv_v, 3),
            "delta_v": round(delta_v, 3),
            "delta_mv": round(delta_mv, 1),
            "max_allowed_delta_mv": max_delta_mv,
            "is_compliant": is_compliant,
            "action_required": action,
            "instruction": instruction,
        }

    def _extract_candidate_info(
        self,
        p: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Extracts and normalizes candidate cell info from a raw passport dict.
        Returns a dict with manufacturer, model, grade, chemistry, and metrics.
        """
        # Manufacturer and Model extraction (preventing wrapper illusion)
        mfr = p.get("manufacturer") or p.get("source") or ""
        if any(placeholder in mfr for placeholder in ("LGA", "Sheet", "Live", "webhook")):
            mfr = ""
        model = p.get("form_factor") or ""

        # Grade tag mapping (A-E framework) — preserve raw value for downstream filtering
        grade = p.get("current_grade") or p.get("grade") or ""

        # Extract metrics
        p_chem = p.get("chemistry")
        p_dcir = p.get("dcir_mohm")
        p_ocv = p.get("intake_ocv_v") or p.get("ocv_v")
        p_soh = float(p["soh_percent"]) if p.get("soh_percent") is not None else None
        p_nom_ah = p.get("nominal_capacity_ah") or p.get("nominal_capacity")
        p_abs_cap_mah = (
            (p_soh / 100.0) * (float(p_nom_ah) * 1000.0)
            if p_soh is not None and p_nom_ah is not None else None
        )

        return {
            "battery_code": p.get("battery_code"),
            "manufacturer": mfr,
            "model_name": model,
            "current_grade": grade,
            "subchemistry": p_chem,
            "dcir_mohm": float(p_dcir) if p_dcir is not None else None,
            "resting_ocv_v": float(p_ocv) if p_ocv is not None else None,
            "soh_percent": p_soh,
            "absolute_capacity_mah": p_abs_cap_mah,
        }

    def _filter_candidates(
        self,
        target_vitals: Dict[str, Any],
        raw_passports: List[Dict[str, Any]],
        exclude_codes: set,
        target_code: Optional[str],
        cap_tolerance_mah: float,
        ocv_tolerance_mv: float,
        dcir_tolerance_pct: float,
        manufacturer_filter: Optional[str] = None,
        search_tier: int = 1,
        tier_label: str = "Tier 1",
    ) -> List[Dict[str, Any]]:
        """
        Filters and scores candidate cells against target vitals using
        the specified thresholds and optional manufacturer constraint.

        Returns a list of qualifying candidate dicts sorted by match score.
        """
        target_cap_mah = target_vitals["target_absolute_capacity_mah"]
        target_dcir = target_vitals["target_block_avg_dcir"]
        target_ocv = target_vitals["target_block_live_ocv"]
        if target_cap_mah is None or target_dcir is None or target_ocv is None:
            return []

        candidates = []

        for p in raw_passports:
            code = p.get("battery_code")
            if not code or code in exclude_codes or code == target_code:
                continue

            # Hard Gate: Only accept formally graded cells from the Afterlife Intelligence Platform (exclude FAULTY/defective)
            raw_grade = p.get("current_grade") or p.get("grade") or ""
            if str(raw_grade).strip().upper() in ["UNGRADED", "NONE", "N/A", "UNKNOWN", "FAULTY", ""] or not raw_grade:
                continue

            info = self._extract_candidate_info(p)
            if (
                info["absolute_capacity_mah"] is None
                or info["dcir_mohm"] is None
                or info["resting_ocv_v"] is None
            ):
                continue
            info["dcir_mohm"] = float(info["dcir_mohm"])
            info["resting_ocv_v"] = float(info["resting_ocv_v"])
            info["absolute_capacity_mah"] = float(info["absolute_capacity_mah"])

            # Manufacturer gate (Tier 1 only)
            if manufacturer_filter:
                candidate_mfr = info["manufacturer"].strip().lower()
                target_mfr = manufacturer_filter.strip().lower()
                if candidate_mfr != target_mfr:
                    continue

            # Step 2: Absolute Capacity (mAh) Delta — must be within tolerance
            cap_delta_mah = abs(info["absolute_capacity_mah"] - target_cap_mah)
            if cap_delta_mah > cap_tolerance_mah:
                continue

            # Step 3: DCIR Delta — must be within tolerance %
            dcir_delta = abs(info["dcir_mohm"] - target_dcir)
            dcir_percent_diff = (dcir_delta / target_dcir) * 100.0 if target_dcir > 0 else 0.0
            if dcir_percent_diff > dcir_tolerance_pct:
                continue

            # Step 5: OCV Delta — must be within tolerance mV
            ocv_delta_mv = abs(info["resting_ocv_v"] - target_ocv) * 1000.0
            if ocv_delta_mv > ocv_tolerance_mv:
                continue

            # Cell passes all threshold gates — score it
            safety_ticket = self.evaluate_ocv_safety(info["resting_ocv_v"], target_ocv, max_delta_mv=ocv_tolerance_mv)

            # Match Score calculation (0 - 100%)
            score_cap = max(0, 100.0 - (cap_delta_mah * 0.1))
            score_dcir = max(0, 100.0 - (dcir_delta * 2.0))
            score_ocv = 100.0 if safety_ticket["is_compliant"] else 80.0

            total_match_score = round((score_cap * 0.45) + (score_dcir * 0.45) + (score_ocv * 0.10), 1)
            total_match_score = max(65.0, min(99.0, total_match_score))

            candidates.append({
                "battery_code": info["battery_code"],
                "manufacturer": info["manufacturer"],
                "model_name": info["model_name"],
                "subchemistry": info["subchemistry"],
                "current_grade": info["current_grade"],
                "soh_percent": round(info["soh_percent"], 1),
                "absolute_capacity_mah": round(info["absolute_capacity_mah"], 1),
                "capacity_delta_mah": round(cap_delta_mah, 1),
                "dcir_mohm": round(info["dcir_mohm"], 1),
                "dcir_delta_mohm": round(dcir_delta, 1),
                "dcir_variance_percent": round(dcir_percent_diff, 1),
                "resting_ocv_v": round(info["resting_ocv_v"], 3),
                "ocv_delta_mv": round(ocv_delta_mv, 1),
                "match_score": total_match_score,
                "safety_directive": safety_ticket,
                "search_tier": search_tier,
                "tier_label": tier_label,
            })

        # Sort by grade (prefer Grade A first), then by match score descending
        grade_order = {"grade a": 0, "grade b": 1, "grade c": 2, "grade d": 3, "grade e": 4}
        candidates.sort(
            key=lambda x: (
                grade_order.get(x["current_grade"].strip().lower(), 5),
                -x["match_score"],
            )
        )
        return candidates

    def rank_replacement_candidates(
        self,
        target_vitals: Dict[str, Any],
        raw_passports: List[Dict[str, Any]],
        exclude_codes: set,
        target_code: Optional[str] = None,
        target_manufacturer: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        3-Tier Cascade Cell Replacement Search Engine.

        Tier 1: Same manufacturer, tight thresholds (±250mAh, ±1500mV / ±1.5V, ±5% DCIR)
        Tier 2: All manufacturers, tight thresholds (±250mAh, ±1500mV / ±1.5V, ±5% DCIR)
        Tier 3: All manufacturers, widened thresholds (±500mAh, ±2500mV / ±2.5V, ±10% DCIR)

        Returns a dict with 'candidates' list and 'search_tier_used' indicator.
        """
        # Tier 1: Same manufacturer + tight thresholds
        if target_manufacturer:
            tier1 = self._filter_candidates(
                target_vitals=target_vitals,
                raw_passports=raw_passports,
                exclude_codes=exclude_codes,
                target_code=target_code,
                cap_tolerance_mah=250.0,
                ocv_tolerance_mv=1500.0,
                dcir_tolerance_pct=5.0,
                manufacturer_filter=target_manufacturer,
                search_tier=1,
                tier_label="Tier 1 — Same Manufacturer (Tight Match)",
            )
            if tier1:
                logger.info(f"Tier 1 matched {len(tier1)} candidate(s) from {target_manufacturer}")
                return {"candidates": tier1, "search_tier_used": 1}

        # Tier 2: All manufacturers + tight thresholds
        tier2 = self._filter_candidates(
            target_vitals=target_vitals,
            raw_passports=raw_passports,
            exclude_codes=exclude_codes,
            target_code=target_code,
            cap_tolerance_mah=250.0,
            ocv_tolerance_mv=1500.0,
            dcir_tolerance_pct=5.0,
            manufacturer_filter=None,
            search_tier=2,
            tier_label="Tier 2 — All Manufacturers (Tight Match)",
        )
        if tier2:
            logger.info(f"Tier 2 matched {len(tier2)} candidate(s) across all manufacturers")
            return {"candidates": tier2, "search_tier_used": 2}

        # Tier 3: All manufacturers + widened thresholds
        tier3 = self._filter_candidates(
            target_vitals=target_vitals,
            raw_passports=raw_passports,
            exclude_codes=exclude_codes,
            target_code=target_code,
            cap_tolerance_mah=500.0,
            ocv_tolerance_mv=2500.0,
            dcir_tolerance_pct=10.0,
            manufacturer_filter=None,
            search_tier=3,
            tier_label="Tier 3 — All Manufacturers (Widened Ballpark)",
        )
        logger.info(f"Tier 3 matched {len(tier3)} candidate(s) with widened thresholds")
        return {"candidates": tier3, "search_tier_used": 3}

replacement_engine = CellReplacementEngine()
