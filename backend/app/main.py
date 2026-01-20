from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from bson.objectid import ObjectId
from pydantic import BaseModel
from typing import List, Optional
import base64
import traceback

# Import your modules
from .database import project_collection
from .models import CalibrationModel, MagicWandModel, LineToolModel
from .image_processing import process_magic_wand, process_linear_opening, perform_room_segmentation

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- COLOR DEFINITIONS (R, G, B) ---
CATEGORY_COLORS = {
    "Walls": (0, 0, 255),      # Blue
    "Ceiling": (255, 0, 0),    # Red
    "Doors": (0, 255, 0),      # Green
    "Windows": (255, 165, 0)   # Orange
}

# --- DATA MODELS ---
class UpdateProjectStateModel(BaseModel):
    masks: Optional[List[dict]] = None
    wall_height: Optional[float] = None
    window_height: Optional[float] = None
    door_height: Optional[float] = None

@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    try:
        content = await file.read()
        b64_image = base64.b64encode(content).decode('utf-8')
        project = {
            "filename": file.filename,
            "image_data": b64_image,
            "scale_factor": None, 
            "unit": "m",
            "masks": [],
            "wall_height": 2.4 # Default height
        }
        new_project = await project_collection.insert_one(project)
        project["_id"] = str(new_project.inserted_id)
        return project
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/project/{project_id}")
async def get_project(project_id: str):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if project:
        project["_id"] = str(project["_id"])
        return project
    raise HTTPException(status_code=404, detail="Project not found")

# --- AUTO-SAVE ENDPOINT ---
@app.put("/project/{project_id}/state")
async def update_project_state(project_id: str, payload: UpdateProjectStateModel):
    update_data = {}
    if payload.masks is not None:
        update_data["masks"] = payload.masks
    if payload.wall_height is not None:
        update_data["wall_height"] = payload.wall_height
        
    if not update_data:
        return {"status": "no_change"}

    try:
        await project_collection.update_one(
            {"_id": ObjectId(project_id)},
            {"$set": update_data}
        )
        return {"status": "success", "updated_fields": list(update_data.keys())}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/project/{project_id}/calibrate")
async def calibrate(project_id: str, payload: CalibrationModel):
    scale_factor = payload.px_distance / payload.real_length
    await project_collection.update_one(
        {"_id": ObjectId(project_id)},
        {"$set": {"scale_factor": scale_factor, "unit": payload.unit}}
    )
    return {"scale_factor": scale_factor, "unit": payload.unit}

@app.post("/project/{project_id}/magic-wand")
async def magic_wand(project_id: str, payload: MagicWandModel):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    image_data = base64.b64decode(project["image_data"])
    target_color = CATEGORY_COLORS.get(payload.category, (0, 0, 255))
    
    # Returns 3 values now (Mask, Area, Length)
    mask_b64, pixel_area, pixel_length = process_magic_wand(
        image_data, 
        payload.x, 
        payload.y, 
        payload.tolerance,
        category=payload.category,
        color=target_color
    )
    
    real_area = None
    real_length = 0

    if project.get("scale_factor"):
        sf = project["scale_factor"]
        real_area = pixel_area / (sf ** 2)
        # Convert pixel length to real length (meters)
        real_length = pixel_length / sf

    return {
        "mask_image": mask_b64,
        "pixel_area": pixel_area,
        "real_area": real_area,
        "real_length": real_length,
        "unit": project.get("unit", "px"),
        "category": payload.category
    }

@app.post("/project/{project_id}/draw-opening")
async def draw_opening(project_id: str, payload: LineToolModel):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    image_data = base64.b64decode(project["image_data"])
    target_color = CATEGORY_COLORS.get(payload.category, (0, 255, 0))

    # Extract existing Wall masks
    wall_masks_bytes = []
    if "masks" in project:
        for m in project["masks"]:
            if m.get("category") == "Walls":
                b64_clean = m["src"].replace("data:image/png;base64,", "")
                wall_masks_bytes.append(base64.b64decode(b64_clean))

    # Returns 3 values now
    mask_b64, pixel_area, pixel_length = process_linear_opening(
        image_data,
        wall_masks_bytes,
        payload.p1,
        payload.p2,
        payload.category,
        color=target_color
    )

    real_area = None
    real_length = 0
    
    if project.get("scale_factor"):
        sf = project["scale_factor"]
        real_area = pixel_area / (sf ** 2)
        real_length = pixel_length / sf

    return {
        "mask_image": mask_b64,
        "pixel_area": pixel_area,
        "real_area": real_area,
        "real_length": real_length,
        "category": payload.category
    }

@app.post("/project/{project_id}/segregate-rooms")
async def segregate_rooms(project_id: str):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    image_data = base64.b64decode(project["image_data"])
    
    # Separate masks into Wall-type and Opening-type
    wall_masks = []
    opening_masks = []
    
    if "masks" in project:
        for m in project["masks"]:
            b64_clean = m["src"].replace("data:image/png;base64,", "")
            decoded = base64.b64decode(b64_clean)
            
            if m["category"] == "Walls":
                wall_masks.append(decoded)
            elif m["category"] in ["Doors", "Windows"]:
                opening_masks.append(decoded)

    # Process
    rooms = perform_room_segmentation(image_data, wall_masks, opening_masks)
    
    # Calculate Real Area if scale exists
    sf = project.get("scale_factor")
    if sf:
        for r in rooms:
            r["real_area"] = r["pixel_area"] / (sf ** 2)
            
    return {"rooms": rooms}

    
"""
async def magic_wand(project_id: str, payload: MagicWandModel):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    image_data = base64.b64decode(project["image_data"])
    
    target_color = CATEGORY_COLORS.get(payload.category, (0, 0, 255))
    
    # 👇 LOGIC: If category is 'Walls', enable strict structure isolation
    # This prevents leaking into furniture/text
    use_isolation = (payload.category == "Walls")

    mask_b64, pixel_area = process_magic_wand(
        image_data, 
        payload.x, 
        payload.y, 
        payload.tolerance,
        color=target_color,
        isolate_structure=use_isolation # <--- Pass the flag here
    )
    
    real_area = None
    if project.get("scale_factor"):
        sf = project["scale_factor"]
        real_area = pixel_area / (sf ** 2)

    return {
        "mask_image": mask_b64,
        "pixel_area": pixel_area,
        "real_area": real_area,
        "unit": project.get("unit", "px"),
        "category": payload.category
    }"""