# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
from fastapi import APIRouter, HTTPException

from app.services.statistics_analytics_service import (
    get_defects_last_day, get_defects_last_hour, get_latest_defect,
    get_most_common_defect, get_quality_distribution, get_system_info)

router = APIRouter()

@router.get("/system_information")
async def system_information():
    try:
        return {
            "data": get_system_info()
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Error retrieving system information: {error}")

@router.get("/latest_defect")
async def latest_defect():
    try:
        return {
            "data": get_latest_defect()
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Error retrieving latest defect: {error}")

@router.get("/defects_last_hour")
async def defects_last_hour():
    try:
        return {
            "data": get_defects_last_hour()
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Error retrieving defects from the last hour: {error}")

@router.get("/defects_last_day")
async def defects_last_day():
    try:
        return {
            "data": get_defects_last_day()
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Error retrieving defects from the last day: {error}")

@router.get("/most_common_defect")
async def most_common_defect():
    try:
        return {
            "data": get_most_common_defect()
        }
    except Exception as error:  
        raise HTTPException(status_code=500, detail=f"Error retrieving most common defect: {error}")

@router.get("/quality_statistics")
async def quality_statistics():
    try:
        return {
            "data": get_quality_distribution()
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Error retrieving quality statistics: {error}")