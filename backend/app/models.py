from pydantic import BaseModel
from typing import List, Optional


class CalibrationModel(BaseModel):
    px_distance: float
    real_length: float
    unit: str = "m"


class MagicWandModel(BaseModel):
    """Magic wand click — PyMuPDF vector DNA matching."""
    x: int                       # click x in image pixels
    y: int                       # click y in image pixels
    category: str = "Walls"      # "Walls", "Doors", "Windows"


class HybridSelectModel(BaseModel):
    """SAM/WallTracer hybrid click selection."""
    pos_points: List[List[float]]           # [[x,y], ...] in PDF point coords
    neg_points: Optional[List[List[float]]] = None
    category: str = "Walls"
    mask_index: Optional[int] = None        # 0/1/2 to pick SAM mask variant


class ManualPolylineModel(BaseModel):
    """Manual point-to-point polyline measurement."""
    points: List[List[float]]    # [[x,y], ...] in PDF point coords
    category: str = "Walls"


class VectorEraseModel(BaseModel):
    """Erase edges near a drawn path."""
    mask_index: int              # which mask to erase from
    eraser_points: List[float]   # flat [x0,y0,x1,y1,...] in PDF points
    radius: float = 8.0


class LineToolModel(BaseModel):
    """Line tool for doors/windows."""
    p1: List[float]              # [x, y] start point
    p2: List[float]              # [x, y] end point
    category: str = "Doors"


class UpdateProjectStateModel(BaseModel):
    """Save masks and wall height to DB."""
    masks: Optional[List[dict]] = None
    wall_height: Optional[float] = None


class ExportDataModel(BaseModel):
    """Excel export payload."""
    rooms: List[dict]
    summary: dict

