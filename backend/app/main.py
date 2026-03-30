"""
BygAI.dk — FastAPI Backend
Endpoints:
  /upload                          - PDF upload
  /project/{id}                    - Get project
  /pdf/{id}                        - Serve raw PDF for PDF.js
  /project/{id}/state              - Save masks/state
  /project/{id}/calibrate          - Set scale factor
  /project/{id}/magic-wand         - PyMuPDF vector DNA click
  /project/{id}/hybrid-select      - SAM/WallTracer click
  /project/{id}/draw-opening       - Line tool for doors/windows
  /project/{id}/manual-polyline    - Manual polyline length calc
  /project/{id}/auto-detect        - CubiCasa5K full auto
  /project/{id}/segregate-rooms    - Room segregation
  /project/export                  - Excel export
"""

# ════════════════════════ IMPORTS ════════════════════════════════

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from bson.objectid import ObjectId
import base64
import traceback
import io
import math
import os
import logging

import cv2
import numpy as np
import pandas as pd
from PIL import Image
from pdf2image import convert_from_bytes

from .database import project_collection
from .models import (
    CalibrationModel, 
    MagicWandModel, 
    LineToolModel,
    UpdateProjectStateModel,
    HybridSelectModel,
    ManualPolylineModel,
    ExportDataModel,
    VectorEraseModel
)
from .vector_processing import (
    process_vector_wand,
    process_vector_line,
    perform_room_segmentation,
)

# ════════════════════════ CONFIG ════════════════════════════════

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="BygAI.dk Precision Takeoff Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CATEGORY_COLORS = {
    "Walls": (0, 0, 255),
    "Doors": (0, 255, 0),
    "Windows": (255, 165, 0),
}

# ════════════════════════ ENGINE CACHES ══════════════════════════

_hybrid_engine_cache = {}

def _get_hybrid_engine(project_id: str, project: dict):
    """Lazy-load WallTracer + optional SAM for a project."""
    if project_id in _hybrid_engine_cache:
        return _hybrid_engine_cache[project_id]
    try:
        from .hybrid_engine import HybridEngine

        pdf_bytes = base64.b64decode(project["pdf_data"])
        engine = HybridEngine(
            pdf_bytes,
            page_num=0,
            sam_checkpoint=os.getenv("SAM_CHECKPOINT", None),
            sam_model_type=os.getenv("SAM_MODEL_TYPE", "vit_b"),
            sam_device=os.getenv("SAM_DEVICE", "auto"),
        )
        _hybrid_engine_cache[project_id] = engine
        return engine
    except Exception as e:
        logger.warning(f"HybridEngine unavailable: {e}")
        return None

# ════════════════════════ ENDPOINTS ═════════════════════════════

# ── Upload ──────────────────────────────────────────────────────

@app.post("/upload")
async def upload_image(file: UploadFile = File(...), pdf_page: int = 0):
    try:
        content = await file.read()
        if file.content_type != "application/pdf":
            raise HTTPException(400, "Only PDF uploads supported")

        b64_pdf = base64.b64encode(content).decode("utf-8")

        images = convert_from_bytes(
            content, dpi=200,
            first_page=pdf_page + 1, last_page=pdf_page + 1,
        )
        if not images:
            raise HTTPException(400, "Could not read PDF page")

        buf = io.BytesIO()
        images[0].save(buf, format="JPEG", quality=85)
        b64_image = base64.b64encode(buf.getvalue()).decode("utf-8")

        project = {
            "filename": file.filename,
            "image_data": b64_image,
            "pdf_data": b64_pdf,
            "dpi": 200,
            "scale_factor": None,
            "unit": "m",
            "masks": [],
            "wall_height": 2.4,
        }
        result = await project_collection.insert_one(project)
        project["_id"] = str(result.inserted_id)
        return project

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

# ── Get Project ─────────────────────────────────────────────────

@app.get("/project/{project_id}")
async def get_project(project_id: str):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404, "Project not found")
    project["_id"] = str(project["_id"])
    return project

# ── Serve Raw PDF ───────────────────────────────────────────────

@app.get("/pdf/{project_id}")
async def serve_pdf(project_id: str):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project or "pdf_data" not in project:
        raise HTTPException(404)
    pdf_bytes = base64.b64decode(project["pdf_data"])
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{project["filename"]}"'
        },
    )

# ── Save State ──────────────────────────────────────────────────

@app.put("/project/{project_id}/state")
async def update_state(project_id: str, payload: UpdateProjectStateModel):
    update = {}
    if payload.masks is not None:
        update["masks"] = payload.masks
    if payload.wall_height is not None:
        update["wall_height"] = payload.wall_height
    if not update:
        return {"status": "no_change"}
    await project_collection.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": update},
    )
    return {"status": "success"}

# ── Calibrate ───────────────────────────────────────────────────

@app.post("/project/{project_id}/calibrate")
async def calibrate(project_id: str, payload: CalibrationModel):
    sf = payload.px_distance / payload.real_length
    await project_collection.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {"scale_factor": sf, "unit": payload.unit}},
    )
    return {"scale_factor": sf, "unit": payload.unit}

# ── Vector DNA Magic Wand (PyMuPDF) ────────────────────────────

@app.post("/project/{project_id}/magic-wand")
async def magic_wand(project_id: str, payload: MagicWandModel):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project or "pdf_data" not in project:
        raise HTTPException(404, "Valid PDF project not found")

    color = CATEGORY_COLORS.get(payload.category, (0, 0, 255))
    pdf_bytes = base64.b64decode(project["pdf_data"])

    result = process_vector_wand(
        pdf_bytes,
        payload.x,
        payload.y,
        dpi=project.get("dpi", 200),
        category=payload.category,
        color=color,
    )

    if not result[0]:
        return {
            "mask_image": None,
            "pixel_area": 0,
            "real_area": 0,
            "real_length": 0,
            "category": payload.category,
        }

    mask_b64, pixel_area, pixel_length = result
    sf = project.get("scale_factor")

    return {
        "mask_image": mask_b64,
        "pixel_area": pixel_area,
        "real_area": pixel_area / (sf ** 2) if sf else None,
        "real_length": pixel_length / sf if sf else 0,
        "unit": project.get("unit", "px"),
        "category": payload.category,
    }

# ── SAM / WallTracer Hybrid Selection ──────────────────────────

@app.post("/project/{project_id}/hybrid-select")
async def hybrid_select(project_id: str, payload: HybridSelectModel):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404)

    engine = _get_hybrid_engine(project_id, project)
    if not engine:
        raise HTTPException(500, "Hybrid engine not available")

    pos = [tuple(p) for p in payload.pos_points]
    neg = [tuple(p) for p in payload.neg_points] if payload.neg_points else None

    result = engine.select(
        pos_points_pt=pos,
        neg_points_pt=neg,
        category=payload.category,
        mask_index=payload.mask_index,
    )

    sf = project.get("scale_factor")
    real_length = result["total_length_pts"] / sf if sf else None

    cat_color = CATEGORY_COLORS.get(payload.category, (0, 0, 255))

    return {
        "svg_groups": result.get("svg_groups", []),
        "edge_indices": result.get("edge_indices", []),
        "edge_count": result.get("edge_count", 0),
        "total_length_pts": result.get("total_length_pts", 0),
        "real_length": real_length,
        "sam_score": result.get("sam_score", 1.0),
        "mask_b64": result.get("mask_b64", ""),
        "all_masks": result.get("all_masks", []),
        "mask_width": result.get("mask_width", 0),
        "mask_height": result.get("mask_height", 0),
        "category": payload.category,
        "color": f"rgba({cat_color[0]},{cat_color[1]},{cat_color[2]},0.55)",
    }

# ── Line Tool (Doors / Windows) ────────────────────────────────

@app.post("/project/{project_id}/draw-opening")
async def draw_opening(project_id: str, payload: LineToolModel):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404)

    color = CATEGORY_COLORS.get(payload.category, (0, 255, 0))
    image_shape = (2000, 2000)

    mask_b64, pixel_area, pixel_length = process_vector_line(
        payload.p1, payload.p2, image_shape, color,
    )

    sf = project.get("scale_factor")

    return {
        "mask_image": mask_b64,
        "pixel_area": pixel_area,
        "real_area": pixel_area / (sf ** 2) if sf else None,
        "real_length": pixel_length / sf if sf else 0,
        "category": payload.category,
    }

# ── Manual Polyline ─────────────────────────────────────────────

# ── AI Door Click (CAD arc detection) ──────────────────────────

@app.post("/project/{project_id}/click-door")
async def click_door(project_id: str, payload: HybridSelectModel):
    """Click near a door → auto-detect arc swing + frame."""
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404)

    engine = _get_hybrid_engine(project_id, project)
    if not engine:
        raise HTTPException(500, "Engine not available")

    click_x, click_y = payload.pos_points[0]
    result = engine.select_door(click_x, click_y)

    if not result:
        return {"svg_groups": [], "real_length": 0, "category": "Doors", "found": False}

    sf = project.get("scale_factor")
    return {
        "svg_groups": result["svg_groups"],
        "edge_indices": [],
        "edge_count": 0,
        "total_length_pts": result["total_length_pts"],
        "real_length": result["total_length_pts"] / sf if sf else None,
        "category": "Doors",
        "found": True,
    }


# ── AI Window Click (parallel line detection) ──────────────────

@app.post("/project/{project_id}/click-window")
async def click_window(project_id: str, payload: HybridSelectModel):
    """Click near a window → auto-detect parallel glass lines."""
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404)

    engine = _get_hybrid_engine(project_id, project)
    if not engine:
        raise HTTPException(500, "Engine not available")

    click_x, click_y = payload.pos_points[0]
    result = engine.select_window(click_x, click_y)

    if not result:
        return {"svg_groups": [], "real_length": 0, "category": "Windows", "found": False}

    sf = project.get("scale_factor")
    return {
        "svg_groups": result["svg_groups"],
        "edge_indices": [],
        "edge_count": 0,
        "total_length_pts": result["total_length_pts"],
        "real_length": result["total_length_pts"] / sf if sf else None,
        "category": "Windows",
        "found": True,
    }


@app.post("/project/{project_id}/manual-polyline")
async def manual_polyline(project_id: str, payload: ManualPolylineModel):
    """Compute length for a manually drawn polyline."""
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404)

    pts = payload.points
    if len(pts) < 2:
        raise HTTPException(400, "Need at least 2 points")

    total_px = sum(
        math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        for i in range(len(pts) - 1)
    )

    sf = project.get("scale_factor")

    return {
        "pixel_length": total_px,
        "real_length": total_px / sf if sf else None,
        "category": payload.category,
        "point_count": len(pts),
    }

# ── Eraser Tool ────────────────────────────────────────────────

@app.post("/project/{project_id}/erase")
async def erase_vectors(project_id: str, payload: VectorEraseModel):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404, "Project not found")

    masks = project.get("masks", [])
    if payload.mask_index >= len(masks) or payload.mask_index < 0:
        raise HTTPException(400, "Invalid mask index")

    current_indices = masks[payload.mask_index].get("edge_indices", [])
    if not current_indices:
        return {"status": "empty", "edge_indices": []}

    engine = _get_hybrid_engine(project_id, project)
    if not engine:
        raise HTTPException(500, "Hybrid engine not available")

    kept_indices = engine.erase(
        current_indices=current_indices, 
        eraser_points_pt=payload.eraser_points, 
        radius_pt=payload.radius
    )

    svg_data = engine.vector.edges_to_svg_data(kept_indices)
    total_length = engine.vector.compute_length(kept_indices)
    
    sf = project.get("scale_factor")
    real_length = total_length / sf if sf else None

    return {
        "svg_groups": svg_data["svg_groups"] if svg_data else [],
        "edge_indices": kept_indices,
        "edge_count": len(kept_indices),
        "total_length_pts": total_length,
        "real_length": real_length
    }

# ── CubiCasa5K Auto-Detection ──────────────────────────────────

@app.post("/project/{project_id}/auto-detect")
async def auto_detect(project_id: str):
    """Run CubiCasa5K with preprocessing pipeline."""
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404)

    try:
        from .cubicasa_engine import auto_detect as cubicasa_auto_detect

        # 1. Get the HybridEngine (has both original RGB and cleaned gray)
        engine = _get_hybrid_engine(project_id, project)
        if not engine:
            raise HTTPException(500, "Hybrid engine not available for cleaning")

        # 2. Pass ORIGINAL RGB image (not gray→RGB which loses color context)
        #    Plus the cleaned gray from PDFCleaner for annotation removal
        original_rgb = engine.image_rgb       # Full color render
        clean_gray = engine.tracer.gray       # Cleaned by PDFCleaner

        sf = project.get("scale_factor")
        
        # 3. CubiCasa pipeline: auto-crop → clean → model → postprocess
        result = cubicasa_auto_detect(
            original_rgb,
            scale_factor=sf,
            clean_gray=clean_gray,
        )

        return result

    except ImportError as e:
        logger.error(f"CubiCasa5K import failed: {e}")
        raise HTTPException(
            500,
            "CubiCasa5K not installed. Run:\n"
            "  git clone https://github.com/EmanuelKuhn/CubiCasa5k.git cubicasa\n"
            "  Download weights from Google Drive\n"
            f"  Original error: {e}",
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Auto-detection failed: {e}")

# ── Room Segregation ────────────────────────────────────────────

@app.post("/project/{project_id}/segregate-rooms")
async def segregate_rooms(project_id: str):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(404)

    image_data = base64.b64decode(project["image_data"])
    wall_masks = []
    opening_masks = []

    for m in project.get("masks", []):
        # ── FIX BUG 3: Handle ALL mask formats ──
        # Format A: src="data:image/png;base64,..." (magic-wand)
        # Format B: mask_b64="..." (hybrid-select / auto-detect)
        # Format C: polyline_points (manual draw — no raster, skip)
        mask_bytes = None
        
        src = m.get("src", "")
        if src:
            b64_clean = src.replace("data:image/png;base64,", "")
            try:
                mask_bytes = base64.b64decode(b64_clean)
            except Exception:
                pass
        
        if mask_bytes is None and m.get("mask_b64"):
            try:
                mask_bytes = base64.b64decode(m["mask_b64"])
            except Exception:
                pass
        
        if mask_bytes is None:
            continue

        if m.get("category") == "Walls":
            wall_masks.append(mask_bytes)
        elif m.get("category") in ("Doors", "Windows"):
            opening_masks.append(mask_bytes)

    rooms = perform_room_segmentation(image_data, wall_masks, opening_masks)

    sf = project.get("scale_factor")
    if sf:
        for r in rooms:
            r["real_area"] = r["pixel_area"] / (sf ** 2)
            r["real_perimeter"] = r.get("pixel_perimeter", 0) / sf

    return {"rooms": rooms}

# ── Excel Export ────────────────────────────────────────────────

@app.post("/project/export")
async def export_excel(data: ExportDataModel):
    df_rooms = pd.DataFrame(data.rooms)
    summary_list = [{"Metric": k, "Value": v} for k, v in data.summary.items()]
    df_summary = pd.DataFrame(summary_list)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df_rooms.to_excel(writer, sheet_name="Report", startrow=0, index=False)
        start = len(df_rooms) + 3
        df_summary.to_excel(writer, sheet_name="Report", startrow=start, index=False)

    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="measurements.xlsx"'},
    )