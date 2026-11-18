from fastapi import APIRouter, Query, HTTPException
from typing import Dict, Any, Optional
from app.services.passport_client import passport_client

router = APIRouter(prefix="/passport", tags=["Afterlife Passport Proxy"])


@router.get("/inventory/grades")
async def get_inventory_grades(refresh: bool = Query(False, description="Force fresh query to Afterlife API")):
    """
    🔗 AFTERLIFE API Proxy: Queries all cell passports from Afterlife Intelligence API,
    returning the aggregated count of cells in each grade accompanied by their respective
    manufacturer, legacy ID, battery code, and vitals.
    """
    data = await passport_client.get_all_inventory_grades(force_refresh=refresh)
    return data


@router.get("/search")
async def search_passports(q: str = Query(..., description="Search query")):
    """
    🔗 AFTERLIFE API Proxy: Searches battery passports by code, legacy ID, chemistry, or source.
    """
    data = await passport_client.search_passports(q)
    return data


@router.get("/list")
async def list_passports(page: int = 1, page_size: int = 50):
    """
    🔗 AFTERLIFE API Proxy: Lists battery passports from the platform inventory.
    """
    data = await passport_client.list_passports(page=page, page_size=page_size)
    return data


@router.get("/{battery_code}")
async def get_passport(battery_code: str):
    """
    🔗 AFTERLIFE API Proxy: Gets full passport details for a specific cell.
    """
    passport = await passport_client.get_passport_by_code(battery_code)
    if not passport:
        raise HTTPException(status_code=404, detail=f"Passport for '{battery_code}' not found")
    return passport


@router.get("/{battery_code}/tests")
async def get_passport_tests(battery_code: str):
    """
    🔗 AFTERLIFE API Proxy: Gets test history for a specific cell.
    """
    tests = await passport_client.get_cell_tests(battery_code)
    return tests
