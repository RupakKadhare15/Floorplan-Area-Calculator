from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from bson.objectid import ObjectId
import base64
import traceback

from .database import project_collection
from .models import CalibrationModel, MagicWandModel
from .image_processing import process_magic_wand

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
            "masks": [] 
        }
        new_project = await project_collection.insert_one(project)
        project["_id"] = str(new_project.inserted_id)
        
        # Return the FULL project so the frontend can display it immediately
        return project
        #return {"id": str(new_project.inserted_id)}
    except Exception as e:
        print("Error during upload:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/project/{project_id}")
async def get_project(project_id: str):
    project = await project_collection.find_one({"_id": ObjectId(project_id)})
    if project:
        project["_id"] = str(project["_id"])
        return project
    raise HTTPException(status_code=404, detail="Project not found")

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
    mask_b64, pixel_area = process_magic_wand(image_data, payload.x, payload.y, payload.tolerance)
    
    real_area = None
    if project.get("scale_factor"):
        sf = project["scale_factor"]
        real_area = pixel_area / (sf ** 2)

    return {
        "mask_image": f"data:image/png;base64,{mask_b64}",
        "pixel_area": pixel_area,
        "real_area": real_area,
        "unit": project.get("unit", "px"),
        "category": payload.category
    }