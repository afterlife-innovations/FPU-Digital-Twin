import httpx
import logging
import asyncio
import re
import time
from typing import Dict, Any, Optional, List
from app.config import settings

logger = logging.getLogger(__name__)


def parse_cell_manufacturer(source: Optional[str], raw_mfr: Optional[str] = None) -> Dict[str, str]:
    """
    Parses and standardizes the cell manufacturer, brand, and batch family from the source string.
    Examples:
    'Legacy Excel import (INR - Pink)' -> Brand: 'Samsung SDI', Batch: 'INR - Pink'
    'Live Sheet webhook (LGA - Pink)' -> Brand: 'LG Chem', Batch: 'LGA - Pink'
    'Legacy Excel import (BAK-Grey)' -> Brand: 'BAK Battery', Batch: 'BAK-Grey'
    'Legacy Excel import (SANYO L PURPLE)' -> Brand: 'Sanyo / Panasonic', Batch: 'SANYO L PURPLE'
    'Legacy Excel import (LiFePO4)' -> Brand: 'LiFePO4 PowerCell', Batch: 'LiFePO4'
    """
    raw = (raw_mfr or source or "").strip()
    
    # Extract text inside parentheses if present: 'Legacy Excel import (INR - Pink)' -> 'INR - Pink'
    match = re.search(r"\((.*?)\)", raw)
    batch = match.group(1).strip() if match else raw

    if not batch:
        return {"brand": "Generic / OEM", "batch": "Standard", "display": "Generic / OEM"}

    batch_upper = batch.upper()

    if any(k in batch_upper for k in ["INR", "ICR"]):
        brand = "Samsung SDI"
    elif any(k in batch_upper for k in ["LGA", "LG "]):
        brand = "LG Chem"
    elif any(k in batch_upper for k in ["SANYO", "UR18650"]):
        brand = "Sanyo"
    elif any(k in batch_upper for k in ["CGR", "NCR", "PANASONIC"]):
        brand = "Panasonic"
    elif "BAK" in batch_upper:
        brand = "BAK Battery"
    elif "DSD" in batch_upper:
        brand = "DSD Battery"
    elif any(k in batch_upper for k in ["LIFEPO4", "LFP"]):
        brand = "LiFePO4 PowerCell"
    elif any(k in batch_upper for k in ["SW-", "SONY", "MURATA", "US18650"]):
        brand = "Sony / Murata"
    elif "JDDL" in batch_upper:
        brand = "JDDL Energy"
    elif "SDA" in batch_upper:
        brand = "SDA Battery"
    elif "CMI" in batch_upper:
        brand = "CMI Power"
    elif "XGB" in batch_upper:
        brand = "XGB Battery"
    elif "H1865" in batch_upper:
        brand = "H1865 Cells"
    elif "ISR" in batch_upper:
        brand = "ISR Energy"
    elif "LAPTOP" in batch_upper:
        brand = "OEM Laptop Harvest"
    else:
        brand = batch

    display = f"{brand} ({batch})" if batch != brand else brand

    return {
        "brand": brand,
        "batch": batch,
        "display": display
    }


class AfterlifePassportClient:
    def __init__(self):
        self.base_url = settings.afterlife_api_base_url
        self.timeout = 15.0
        self._inventory_cache: Optional[Dict[str, Any]] = None
        self._cache_timestamp: float = 0
        self._cache_ttl_seconds: float = 60.0

    async def search_passports(self, query: str, page_size: int = 10) -> Dict[str, Any]:
        """
        ðŸ”— AFTERLIFE API: Calls GET /passport/?search={query}
        Searches passports by battery_code, legacy_cell_id, chemistry, or source.
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.get(
                    f"{self.base_url}/passport/",
                    params={"search": query, "page_size": page_size}
                )
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Error searching Afterlife API for '{query}': {e}")
                return {"count": 0, "passports": []}

    async def list_passports(self, page: int = 1, page_size: int = 50) -> Dict[str, Any]:
        """
        ðŸ”— AFTERLIFE API: Calls GET /passport/?page={page}&page_size={page_size}
        Lists registered battery passports from the platform inventory.
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.get(
                    f"{self.base_url}/passport/",
                    params={"page": page, "page_size": page_size}
                )
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Error listing Afterlife API passports: {e}")
                return {"count": 0, "passports": []}

    async def get_all_inventory_grades(self, force_refresh: bool = False) -> Dict[str, Any]:
        """
        ðŸ”— AFTERLIFE API: Queries all pages from Afterlife Intelligence API,
        extracts the number of cells in each grade accompanied by their respective
        manufacturer, legacy ID, and battery code.
        """
        now = time.time()
        if not force_refresh and self._inventory_cache and (now - self._cache_timestamp < self._cache_ttl_seconds):
            return self._inventory_cache

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                # 1. Fetch first page to discover total count and total pages
                first_res = await client.get(
                    f"{self.base_url}/passport/",
                    params={"page": 1, "page_size": 100}
                )
                first_res.raise_for_status()
                first_data = first_res.json()

                total_count = first_data.get("count", 0)
                total_pages = first_data.get("total_pages", 1)
                all_raw_passports = list(first_data.get("passports", []))

                # 2. Concurrently fetch remaining pages
                if total_pages > 1:
                    async def fetch_page(page_num: int):
                        try:
                            res = await client.get(
                                f"{self.base_url}/passport/",
                                params={"page": page_num, "page_size": 100}
                            )
                            res.raise_for_status()
                            return res.json().get("passports", [])
                        except Exception as ex:
                            logger.error(f"Failed to fetch page {page_num}: {ex}")
                            return []

                    tasks = [fetch_page(p) for p in range(2, total_pages + 1)]
                    pages_results = await asyncio.gather(*tasks)
                    for p_list in pages_results:
                        all_raw_passports.extend(p_list)

            except Exception as e:
                logger.error(f"Error querying Afterlife Intelligence API inventory: {e}")
                return {
                    "total_cells": 0,
                    "total_graded": 0,
                    "total_faulty": 0,
                    "total_ungraded": 0,
                    "grade_counts": {"A": 0, "B": 0, "C": 0, "D": 0, "E": 0, "FAULTY": 0, "Ungraded": 0},
                    "grade_breakdown": {},
                    "passports": [],
                    "api_url": self.base_url,
                    "queried_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "error": str(e)
                }

        # 3. Process, normalize, and aggregate grade, status, and pattern statistics
        grade_order = ["A", "B", "C", "D", "E", "FAULTY", "Ungraded"]
        grade_counts = {g: 0 for g in grade_order}
        status_counts = {"graded": 0, "in_pack": 0, "intake": 0, "tested": 0}
        grade_breakdown = {
            g: {
                "grade": g,
                "count": 0,
                "percentage": 0.0,
                "manufacturers": {},
                "chemistry_counts": {},
                "capacity_values": [],
                "cells": []
            }
            for g in grade_order
        }

        normalized_passports = []
        total_graded = 0
        total_faulty = 0

        # Collections for pattern rummaging (Capacity & DCIR)
        cap_values = []
        dcir_values = []
        pattern_clusters = {
            "optimal_match": [],
            "low_dcir": [],
            "mod_dcir": [],
            "high_dcir_outlier": [],
            "prismatic": [],
        }
        cap_distribution = {
            "lt_2_2ah": 0,
            "bw_2_2_2_5ah": 0,
            "bw_2_6_3_0ah": 0,
            "gt_3_0ah_prismatic": 0,
        }
        dcir_distribution = {
            "lt_20mohm": 0,
            "bw_20_35mohm": 0,
            "bw_35_65mohm": 0,
            "gt_65mohm_outlier": 0,
        }

        for p in all_raw_passports:
            battery_code = p.get("battery_code", "")
            legacy_id = str(p.get("legacy_cell_id") or "N/A")
            raw_grade = p.get("current_grade") or p.get("grade")
            raw_state = str(p.get("current_state") or "intake").strip().lower()
            raw_grade_str = str(raw_grade).strip().upper() if raw_grade else ""

            # Vitals
            dcir = p.get("dcir_mohm")
            ocv = p.get("intake_ocv_v")
            soh = p.get("soh_percent")
            nom_cap = p.get("nominal_capacity_ah")
            chem = p.get("chemistry") or "Li-ion"
            ff = p.get("form_factor") or "18650"

            parsed_dcir = round(float(dcir), 2) if dcir is not None else None
            parsed_ocv = round(float(ocv), 4) if ocv is not None else None
            parsed_soh = round(float(soh), 2) if soh is not None else None
            parsed_cap = round(float(nom_cap), 2) if nom_cap is not None else None

            # Measured (actual) capacity = SOH% Ã— Nominal Capacity
            measured_cap = round((parsed_soh / 100.0) * parsed_cap, 3) if (parsed_soh is not None and parsed_cap is not None) else None

            # -------------------------------------------------------------
            # Canonical Grade & Status Classification
            # Rule 1: FAULTY takes absolute priority
            # Rule 2: Cells in intake phase are strictly 'Ungraded' / 'intake'
            # Rule 3: Only certified states ('graded', 'in_pack', 'deployed')
            #         with valid letter grades qualify as Grade A-E
            # Rule 4: Malformed, null, or unverified values default to 'Ungraded'
            # -------------------------------------------------------------
            if raw_grade_str == "FAULTY" or raw_state == "faulty":
                norm_grade = "FAULTY"
                norm_status = "tested" if raw_state != "faulty" else "faulty"
                total_faulty += 1
            elif raw_state == "intake" or raw_grade_str in ["NONE", "", "UNGRADED", "N/A", "UNKNOWN"]:
                norm_grade = "Ungraded"
                norm_status = "intake"
            elif raw_state in ["graded", "in_pack", "deployed"] and raw_grade_str in ["A", "B", "C", "D", "E"]:
                norm_grade = raw_grade_str
                norm_status = raw_state
                total_graded += 1
            elif raw_state == "tested" and raw_grade_str not in ["A", "B", "C", "D", "E"]:
                norm_grade = "Ungraded"
                norm_status = "tested"
            else:
                norm_grade = "Ungraded"
                norm_status = raw_state

            # Parse manufacturer
            mfr_info = parse_cell_manufacturer(p.get("source"), p.get("manufacturer"))
            manufacturer_name = mfr_info["display"]
            brand_name = mfr_info["brand"]

            # Pattern tags determination
            is_prismatic = parsed_cap is not None and parsed_cap >= 40.0
            is_outlier = (parsed_dcir is not None and parsed_dcir > 65.0) or (parsed_ocv is not None and 0.0 < parsed_ocv < 2.5) or norm_grade == "FAULTY"
            is_optimal = parsed_cap is not None and (2.0 <= parsed_cap <= 2.6) and (parsed_dcir is not None and 15.0 <= parsed_dcir <= 32.0) and norm_grade in ["A", "B"] and not is_outlier
            is_low_dcir = parsed_dcir is not None and parsed_dcir < 20.0 and not is_prismatic
            is_mod_dcir = parsed_dcir is not None and 35.0 <= parsed_dcir <= 65.0 and not is_outlier

            cell_entry = {
                "battery_code": battery_code,
                "legacy_cell_id": legacy_id,
                "current_grade": norm_grade,
                "current_state": norm_status,
                "canonical_grade": norm_grade,
                "canonical_status": norm_status,
                "manufacturer": manufacturer_name,
                "brand": brand_name,
                "batch_family": mfr_info["batch"],
                "raw_source": p.get("source", ""),
                "chemistry": chem,
                "form_factor": ff,
                "nominal_capacity_ah": parsed_cap,
                "measured_capacity_ah": measured_cap,
                "dcir_mohm": parsed_dcir,
                "intake_ocv_v": parsed_ocv,
                "soh_percent": parsed_soh,
                "needs_review": p.get("needs_review", False),
                "intake_date": p.get("intake_date", ""),
                "is_outlier": is_outlier,
                "is_optimal_match": is_optimal,
                "pattern_cluster": (
                    "high_dcir_outlier" if is_outlier else
                    "prismatic" if is_prismatic else
                    "optimal_match" if is_optimal else
                    "low_dcir" if is_low_dcir else
                    "mod_dcir" if is_mod_dcir else
                    "standard"
                )
            }

            normalized_passports.append(cell_entry)

            # Update aggregations
            grade_counts[norm_grade] += 1
            status_counts[norm_status] = status_counts.get(norm_status, 0) + 1

            gb = grade_breakdown[norm_grade]
            gb["count"] += 1
            gb["manufacturers"][brand_name] = gb["manufacturers"].get(brand_name, 0) + 1
            gb["chemistry_counts"][chem] = gb["chemistry_counts"].get(chem, 0) + 1
            if measured_cap is not None:
                gb["capacity_values"].append(measured_cap)
            gb["cells"].append(cell_entry)

            # Rummage pattern metrics
            if parsed_cap is not None:
                cap_values.append(parsed_cap)
                if parsed_cap < 2.2:
                    cap_distribution["lt_2_2ah"] += 1
                elif 2.2 <= parsed_cap <= 2.5:
                    cap_distribution["bw_2_2_2_5ah"] += 1
                elif 2.6 <= parsed_cap <= 3.0:
                    cap_distribution["bw_2_6_3_0ah"] += 1
                elif parsed_cap > 3.0:
                    cap_distribution["gt_3_0ah_prismatic"] += 1
            if parsed_dcir is not None:
                dcir_values.append(parsed_dcir)
                if parsed_dcir < 20.0:
                    dcir_distribution["lt_20mohm"] += 1
                elif 20.0 <= parsed_dcir <= 35.0:
                    dcir_distribution["bw_20_35mohm"] += 1
                elif 35.0 < parsed_dcir <= 65.0:
                    dcir_distribution["bw_35_65mohm"] += 1
                elif parsed_dcir > 65.0:
                    dcir_distribution["gt_65mohm_outlier"] += 1

            if is_outlier:
                pattern_clusters["high_dcir_outlier"].append(battery_code)
            elif is_prismatic:
                pattern_clusters["prismatic"].append(battery_code)
            elif is_optimal:
                pattern_clusters["optimal_match"].append(battery_code)
            elif is_low_dcir:
                pattern_clusters["low_dcir"].append(battery_code)
            elif is_mod_dcir:
                pattern_clusters["mod_dcir"].append(battery_code)

        total_cells = len(normalized_passports)
        for g in grade_order:
            pct = round((grade_counts[g] / total_cells * 100.0), 1) if total_cells > 0 else 0.0
            grade_breakdown[g]["percentage"] = pct
            # Compute per-grade measured capacity statistics (SOH% Ã— Nominal)
            cap_vals = grade_breakdown[g]["capacity_values"]
            if cap_vals:
                grade_breakdown[g]["avg_measured_capacity_ah"] = round(sum(cap_vals) / len(cap_vals), 3)
                grade_breakdown[g]["min_measured_capacity_ah"] = round(min(cap_vals), 3)
                grade_breakdown[g]["max_measured_capacity_ah"] = round(max(cap_vals), 3)
            else:
                grade_breakdown[g]["avg_measured_capacity_ah"] = None
                grade_breakdown[g]["min_measured_capacity_ah"] = None
                grade_breakdown[g]["max_measured_capacity_ah"] = None
            # Remove raw list to keep payload lean
            del grade_breakdown[g]["capacity_values"]

        # -------------------------------------------------------------
        # Statistical & Cluster Pattern Analytics
        # -------------------------------------------------------------
        avg_cap = round(sum(cap_values) / len(cap_values), 2) if cap_values else None
        avg_dcir = round(sum(dcir_values) / len(dcir_values), 2) if dcir_values else None
        min_dcir = min(dcir_values) if dcir_values else None
        max_dcir = max(dcir_values) if dcir_values else None
        min_cap = min(cap_values) if cap_values else None
        max_cap = max(cap_values) if cap_values else None

        # Cylindrical only correlation (cap <= 5.0 Ah)
        cyl_pairs = [(c["nominal_capacity_ah"], c["dcir_mohm"]) for c in normalized_passports if c["nominal_capacity_ah"] and c["dcir_mohm"] and c["nominal_capacity_ah"] <= 5.0]
        correlation = None
        if len(cyl_pairs) > 10:
            xs = [p[0] for p in cyl_pairs]
            ys = [p[1] for p in cyl_pairs]
            mean_x = sum(xs) / len(xs)
            mean_y = sum(ys) / len(ys)
            num = sum((x - mean_x) * (y - mean_y) for x, y in cyl_pairs)
            den = (sum((x - mean_x) ** 2 for x in xs) * sum((y - mean_y) ** 2 for y in ys)) ** 0.5
            correlation = round(num / den, 3) if den != 0 else 0.0

        pattern_analytics = {
            "metrics": {
                "total_analyzed": total_cells,
                "paired_cap_dcir_count": len(cyl_pairs),
                "capacity": {
                    "count": len(cap_values),
                    "mean_ah": avg_cap,
                    "min_ah": min_cap,
                    "max_ah": max_cap,
                    "distribution": {
                        "lt_2_2ah": {"label": "< 2.2 Ah", "count": cap_distribution["lt_2_2ah"], "percentage": round(cap_distribution["lt_2_2ah"] / total_cells * 100.0, 1) if total_cells else 0.0},
                        "bw_2_2_2_5ah": {"label": "2.2 - 2.5 Ah", "count": cap_distribution["bw_2_2_2_5ah"], "percentage": round(cap_distribution["bw_2_2_2_5ah"] / total_cells * 100.0, 1) if total_cells else 0.0},
                        "bw_2_6_3_0ah": {"label": "2.6 - 3.0 Ah", "count": cap_distribution["bw_2_6_3_0ah"], "percentage": round(cap_distribution["bw_2_6_3_0ah"] / total_cells * 100.0, 1) if total_cells else 0.0},
                        "gt_3_0ah_prismatic": {"label": "> 3.0 Ah / 50Ah LFP", "count": cap_distribution["gt_3_0ah_prismatic"], "percentage": round(cap_distribution["gt_3_0ah_prismatic"] / total_cells * 100.0, 1) if total_cells else 0.0},
                    },
                },
                "dcir": {
                    "count": len(dcir_values),
                    "mean_mohm": avg_dcir,
                    "min_mohm": min_dcir,
                    "max_mohm": max_dcir,
                    "outlier_threshold_mohm": 65.0,
                    "distribution": {
                        "lt_20mohm": {"label": "< 20 mÎ© (Low Impedance)", "count": dcir_distribution["lt_20mohm"], "percentage": round(dcir_distribution["lt_20mohm"] / total_cells * 100.0, 1) if total_cells else 0.0},
                        "bw_20_35mohm": {"label": "20 - 35 mÎ© (Tight Match)", "count": dcir_distribution["bw_20_35mohm"], "percentage": round(dcir_distribution["bw_20_35mohm"] / total_cells * 100.0, 1) if total_cells else 0.0},
                        "bw_35_65mohm": {"label": "35 - 65 mÎ© (Moderate)", "count": dcir_distribution["bw_35_65mohm"], "percentage": round(dcir_distribution["bw_35_65mohm"] / total_cells * 100.0, 1) if total_cells else 0.0},
                        "gt_65mohm_outlier": {"label": "> 65 mÎ© Outliers", "count": dcir_distribution["gt_65mohm_outlier"], "percentage": round(dcir_distribution["gt_65mohm_outlier"] / total_cells * 100.0, 1) if total_cells else 0.0},
                    },
                },
                "capacity_dcir_correlation": correlation,
            },
            "clusters": {
                "optimal_match": {
                    "label": "Optimal Assembly Match (Tight DCIR & Cap)",
                    "count": len(pattern_clusters["optimal_match"]),
                    "percentage": round(len(pattern_clusters["optimal_match"]) / total_cells * 100.0, 1) if total_cells else 0.0,
                    "criteria": "2.0-2.6 Ah, 15-32 mÎ©, Grade A/B",
                    "pack_implication": "Minimal circulating parallel currents; highest parallel group thermal balance.",
                },
                "low_dcir": {
                    "label": "Low Impedance (High C-Rate)",
                    "count": len(pattern_clusters["low_dcir"]),
                    "percentage": round(len(pattern_clusters["low_dcir"]) / total_cells * 100.0, 1) if total_cells else 0.0,
                    "criteria": "DCIR < 20 mÎ©",
                    "pack_implication": "Lowest internal dissipation under continuous discharge; pair together to avoid parallel current hogging.",
                },
                "mod_dcir": {
                    "label": "Moderate Impedance (Low C-Rate ESS)",
                    "count": len(pattern_clusters["mod_dcir"]),
                    "percentage": round(len(pattern_clusters["mod_dcir"]) / total_cells * 100.0, 1) if total_cells else 0.0,
                    "criteria": "DCIR 35-65 mÎ©",
                    "pack_implication": "Suitable for secondary energy storage; avoid high instantaneous discharge rates.",
                },
                "high_dcir_outlier": {
                    "label": "High-DCIR Outliers (Imbalance Risk)",
                    "count": len(pattern_clusters["high_dcir_outlier"]),
                    "percentage": round(len(pattern_clusters["high_dcir_outlier"]) / total_cells * 100.0, 1) if total_cells else 0.0,
                    "criteria": "DCIR > 65 mÎ© or OCV < 2.5V or FAULTY",
                    "pack_implication": "High risk of localized heating and string current starvation. Quarantine from pack assembly.",
                },
                "prismatic": {
                    "label": "Large Format Prismatic (50Ah LFP)",
                    "count": len(pattern_clusters["prismatic"]),
                    "percentage": round(len(pattern_clusters["prismatic"]) / total_cells * 100.0, 1) if total_cells else 0.0,
                    "criteria": "Nominal Cap >= 40 Ah (LiFePO4)",
                    "pack_implication": "Form factor and chemistry incompatible with 18650 6S22P array; dedicated ESS use only.",
                },
            },
            "advisory_disclaimer": "Advisory engineering analytics based on recorded intake & test vitals; dynamic impedance and thermal behavior must be validated under load before pack assembly.",
        }

        result = {
            "total_cells": total_cells,
            "total_graded": total_graded,
            "total_faulty": total_faulty,
            "total_ungraded": grade_counts["Ungraded"],
            "grade_counts": grade_counts,
            "status_counts": status_counts,
            "grade_breakdown": grade_breakdown,
            "pattern_analytics": pattern_analytics,
            "passports": normalized_passports,
            "api_url": self.base_url,
            "queried_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "cached": False
        }

        self._inventory_cache = {**result, "cached": True}
        self._cache_timestamp = now

        return result

    async def get_code_to_legacy_map(self) -> Dict[str, str]:
        """Returns a dict mapping battery_code -> legacy_cell_id."""
        try:
            inv = await self.get_all_inventory_grades()
            lookup = {}
            for p in inv.get("passports", []):
                bc = p.get("battery_code")
                leg = p.get("legacy_cell_id")
                if bc and leg is not None and str(leg) != "N/A":
                    lookup[bc] = str(leg)
            if not lookup:
                pmap = await self.get_code_to_passport_map()
                for bc, p in pmap.items():
                    lookup[bc] = str(p.get("legacy_cell_id", "N/A"))
            return lookup
        except Exception as e:
            logger.warning(f"Error building legacy cell ID map: {e}")
            return {}

    async def get_code_to_passport_map(self) -> Dict[str, Dict[str, Any]]:
        """Returns a dict mapping battery_code -> full passport object."""
        try:
            inv = await self.get_all_inventory_grades()
            passports = {p.get("battery_code"): p for p in inv.get("passports", []) if p.get("battery_code")}
            return passports
        except Exception as e:
            logger.warning(f"Error building passport map: {e}")
            return {}

    def _empty_passport(self, battery_code: str) -> Dict[str, Any]:
        """Return an empty passport shell without synthesizing unverified data."""
        return {"battery_code": battery_code}

    async def get_passport_by_code(self, battery_code: str) -> Optional[Dict[str, Any]]:
        """
        ðŸ”— AFTERLIFE API: Searches for exact battery_code match.
        Workaround for 500 error on GET /passport/{battery_code}.
        """
        data = await self.search_passports(battery_code, page_size=5)
        passports = data.get("passports", [])
        for p in passports:
            if p.get("battery_code") == battery_code:
                if p.get("measured_capacity_ah") is None:
                    soh = p.get("soh_percent")
                    nom = p.get("nominal_capacity_ah") or p.get("nominal_capacity")
                    if soh is not None and nom is not None:
                        try:
                            p["measured_capacity_ah"] = round((float(soh) / 100.0) * float(nom), 3)
                        except (ValueError, TypeError):
                            pass
                return p
        if passports:
            p = passports[0]
            if p.get("measured_capacity_ah") is None:
                soh = p.get("soh_percent")
                nom = p.get("nominal_capacity_ah") or p.get("nominal_capacity")
                if soh is not None and nom is not None:
                    try:
                        p["measured_capacity_ah"] = round((float(soh) / 100.0) * float(nom), 3)
                    except (ValueError, TypeError):
                        pass
            return p
        # Do not synthesize passport data when Afterlife is unreachable or has no match.
        return None

    async def get_cell_tests(self, battery_code: str) -> Dict[str, Any]:
        """
        ðŸ”— AFTERLIFE API: Calls GET /passport/{battery_code}/tests
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.get(f"{self.base_url}/passport/{battery_code}/tests")
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Error fetching tests for {battery_code}: {e}")
                return {"battery_code": battery_code, "test_count": 0, "tests": []}

    async def update_passport_state(self, battery_code: str, new_state: str) -> Dict[str, Any]:
        """
        ðŸ”— AFTERLIFE API: Calls POST /passport/{battery_code}/state
        Updates cell lifecycle state (e.g. DEPLOYED_IN_PACK, RETIRED_FROM_PACK).
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(
                    f"{self.base_url}/passport/{battery_code}/state",
                    json={"current_state": new_state, "state": new_state}
                )
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.warning(f"Note: Could not update passport state remotely for {battery_code} ({e}). Applied locally.")
                return {"status": "simulated", "battery_code": battery_code, "current_state": new_state}

    async def get_pack_sessions(self) -> Dict[str, Any]:
        """
        ðŸ”— AFTERLIFE API: Calls GET /pack/sessions
        Lists pack sessions created by the Pack Builder.
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.get(f"{self.base_url}/pack/sessions")
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Error fetching pack sessions from Afterlife API: {e}")
                return {"sessions": []}

    async def get_pack_session(self, session_id: int) -> Optional[Dict[str, Any]]:
        """
        ðŸ”— AFTERLIFE API: Calls GET /pack/sessions/{session_id}
        Gets detailed pack session including assignments with series/parallel positions.
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.get(f"{self.base_url}/pack/sessions/{session_id}")
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Error fetching pack session {session_id} from Afterlife API: {e}")
                return None

    async def match_pack(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        ðŸ”— AFTERLIFE API: Calls POST /pack/match
        Runs the Pack Builder matching engine with tolerances and SX/PX requirements.
        """
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(
                    f"{self.base_url}/pack/match",
                    json=payload
                )
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Error running pack match on Afterlife API: {e}")
                raise

passport_client = AfterlifePassportClient()
