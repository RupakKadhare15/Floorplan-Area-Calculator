import os
# from motor.motor_asyncio import AsyncIOMotorClient
import motor.motor_asyncio
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URI)
project_collection = client.FloorPlanDB.projects
#client = AsyncIOMotorClient(MONGO_URI)
#database = client.get_database("floorplan_db") # This names your DB in the cloud
#project_collection = database.get_collection("projects")

