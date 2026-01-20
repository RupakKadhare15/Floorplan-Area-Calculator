from pydantic import BaseModel
from typing import Optional

class CalibrationModel(BaseModel):
    px_distance: float
    real_length: float
    unit: str = "m"

class MagicWandModel(BaseModel):
    x: int
    y: int
    tolerance: int = 30
    category: str