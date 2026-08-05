from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


DEFAULT_NODE_TYPES = [
    {"id": "character", "label": "Персонаж", "color": "#e11d48", "icon": "User"},
    {"id": "faction", "label": "Фракция", "color": "#7c3aed", "icon": "Flag"},
    {"id": "location", "label": "Локация", "color": "#059669", "icon": "MapPin"},
    {"id": "event", "label": "Событие", "color": "#d97706", "icon": "Calendar"},
    {"id": "note", "label": "Заметка", "color": "#64748b", "icon": "FileText"},
]

DEFAULT_SETTINGS = {
    "theme": "dark",
    "accent": "#6366f1",
    "font": "Manrope",
    "edgeType": "smoothstep",
    "showGrid": True,
    "nodeTypes": DEFAULT_NODE_TYPES,
}


# ---------- Models ----------
class Field_(BaseModel):
    key: str = ""
    value: str = ""


class NodePosition(BaseModel):
    x: float = 0
    y: float = 0


class NodeModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    projectId: str
    typeId: str = "note"
    title: str = "Новый узел"
    description: str = ""
    fields: List[Field_] = []
    position: NodePosition = Field(default_factory=NodePosition)
    createdAt: str = Field(default_factory=now_iso)


class NodeCreate(BaseModel):
    typeId: str = "note"
    title: str = "Новый узел"
    description: str = ""
    fields: List[Field_] = []
    position: NodePosition = Field(default_factory=NodePosition)


class NodeUpdate(BaseModel):
    typeId: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    fields: Optional[List[Field_]] = None
    position: Optional[NodePosition] = None


class EdgeModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    projectId: str
    source: str
    target: str
    label: str = ""


class EdgeCreate(BaseModel):
    source: str
    target: str
    label: str = ""


class ProjectModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    settings: Dict[str, Any] = Field(default_factory=lambda: dict(DEFAULT_SETTINGS))
    createdAt: str = Field(default_factory=now_iso)
    updatedAt: str = Field(default_factory=now_iso)


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


def clean(doc):
    doc.pop("_id", None)
    return doc


# ---------- Project routes ----------
@api_router.get("/projects", response_model=List[ProjectModel])
async def list_projects():
    docs = await db.projects.find({}, {"_id": 0}).sort("updatedAt", -1).to_list(1000)
    return docs


@api_router.post("/projects", response_model=ProjectModel)
async def create_project(payload: ProjectCreate):
    project = ProjectModel(**payload.model_dump())
    await db.projects.insert_one(project.model_dump())
    return project


@api_router.get("/projects/{project_id}", response_model=ProjectModel)
async def get_project(project_id: str):
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Проект не найден")
    return doc


@api_router.put("/projects/{project_id}", response_model=ProjectModel)
async def update_project(project_id: str, payload: ProjectUpdate):
    doc = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Проект не найден")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updatedAt"] = now_iso()
    await db.projects.update_one({"id": project_id}, {"$set": updates})
    doc.update(updates)
    return doc


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    await db.projects.delete_one({"id": project_id})
    await db.nodes.delete_many({"projectId": project_id})
    await db.edges.delete_many({"projectId": project_id})
    return {"ok": True}


# ---------- Graph routes ----------
@api_router.get("/projects/{project_id}/graph")
async def get_graph(project_id: str):
    nodes = await db.nodes.find({"projectId": project_id}, {"_id": 0}).to_list(5000)
    edges = await db.edges.find({"projectId": project_id}, {"_id": 0}).to_list(5000)
    return {"nodes": nodes, "edges": edges}


@api_router.post("/projects/{project_id}/nodes", response_model=NodeModel)
async def create_node(project_id: str, payload: NodeCreate):
    node = NodeModel(projectId=project_id, **payload.model_dump())
    await db.nodes.insert_one(node.model_dump())
    await db.projects.update_one({"id": project_id}, {"$set": {"updatedAt": now_iso()}})
    return node


@api_router.put("/nodes/{node_id}", response_model=NodeModel)
async def update_node(node_id: str, payload: NodeUpdate):
    doc = await db.nodes.find_one({"id": node_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Узел не найден")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    await db.nodes.update_one({"id": node_id}, {"$set": updates})
    doc.update(updates)
    return doc


@api_router.delete("/nodes/{node_id}")
async def delete_node(node_id: str):
    doc = await db.nodes.find_one({"id": node_id}, {"_id": 0})
    await db.nodes.delete_one({"id": node_id})
    if doc:
        await db.edges.delete_many({"$or": [{"source": node_id}, {"target": node_id}]})
    return {"ok": True}


@api_router.post("/projects/{project_id}/edges", response_model=EdgeModel)
async def create_edge(project_id: str, payload: EdgeCreate):
    existing = await db.edges.find_one(
        {"projectId": project_id, "source": payload.source, "target": payload.target}, {"_id": 0}
    )
    if existing:
        return existing
    edge = EdgeModel(projectId=project_id, **payload.model_dump())
    await db.edges.insert_one(edge.model_dump())
    return edge


@api_router.put("/edges/{edge_id}", response_model=EdgeModel)
async def update_edge(edge_id: str, label: str = ""):
    doc = await db.edges.find_one({"id": edge_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Связь не найдена")
    await db.edges.update_one({"id": edge_id}, {"$set": {"label": label}})
    doc["label"] = label
    return doc


@api_router.delete("/edges/{edge_id}")
async def delete_edge(edge_id: str):
    await db.edges.delete_one({"id": edge_id})
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "StoryWeave API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.lifespan("shutdown")
async def shutdown_db_client():
    client.close()
