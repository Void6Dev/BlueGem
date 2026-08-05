from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import json
import sqlite3
import logging
from contextlib import contextmanager
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# SQLite storage — no external database server required.
DB_PATH = os.environ.get('SQLITE_PATH', str(ROOT_DIR / 'bluegem.db'))

# Desktop build only: Electron passes a shared secret and the path to the built
# frontend, so one process serves both the UI and the API from one origin.
# Empty values keep the plain `uvicorn server:app` dev flow working as before.
API_TOKEN = os.environ.get('BG_TOKEN', '')
STATIC_DIR = Path(os.environ.get('BG_STATIC_DIR', '')) if os.environ.get('BG_STATIC_DIR') else None

# The database lives in the user's profile in the desktop build — create the
# folder before SQLite tries to open a file inside a directory that isn't there.
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def db():
    """Open a SQLite connection, commit on success, always close."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _ensure_columns(conn, table, columns):
    """Add any missing columns to an existing table (lightweight migration)."""
    existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def init_db():
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                settings TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                projectId TEXT NOT NULL,
                typeId TEXT DEFAULT 'note',
                title TEXT DEFAULT '',
                description TEXT DEFAULT '',
                fields TEXT NOT NULL,
                position TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                image TEXT DEFAULT '',
                date TEXT DEFAULT '',
                canvas TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                projectId TEXT NOT NULL,
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                label TEXT DEFAULT '',
                relType TEXT DEFAULT '',
                color TEXT DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(projectId);
            CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(projectId);
            CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
            """
        )
        # Migrate pre-existing databases created before these columns existed.
        _ensure_columns(conn, "nodes", {
            "tags": "TEXT NOT NULL DEFAULT '[]'", "image": "TEXT DEFAULT ''",
            "date": "TEXT DEFAULT ''", "canvas": "TEXT DEFAULT ''",
        })
        _ensure_columns(conn, "edges", {"relType": "TEXT DEFAULT ''", "color": "TEXT DEFAULT ''"})


app = FastAPI(title="BlueGem API", version="1.1.0")
api_router = APIRouter(prefix="/api")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def touch_project(conn, project_id: str):
    """Bump the project's updatedAt so the dashboard can sort by recency."""
    conn.execute("UPDATE projects SET updatedAt = ? WHERE id = ?", (now_iso(), project_id))


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
    "showMiniMap": True,
    "snapToGrid": False,
    "animatedEdges": False,
    "nodeTypes": DEFAULT_NODE_TYPES,
    "canvases": [{"id": "main", "label": "Основной"}],
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
    tags: List[str] = []
    image: str = ""
    # Free-form chronology label ("1024", "3-я эпоха", "перед войной") — never a number.
    date: str = ""
    canvas: str = ""
    createdAt: str = Field(default_factory=now_iso)


class NodeCreate(BaseModel):
    typeId: str = "note"
    title: str = "Новый узел"
    description: str = ""
    fields: List[Field_] = []
    position: NodePosition = Field(default_factory=NodePosition)
    tags: List[str] = []
    image: str = ""
    date: str = ""
    canvas: str = ""


class NodeUpdate(BaseModel):
    typeId: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    fields: Optional[List[Field_]] = None
    position: Optional[NodePosition] = None
    tags: Optional[List[str]] = None
    image: Optional[str] = None
    date: Optional[str] = None
    canvas: Optional[str] = None


class NodePositionPatch(BaseModel):
    id: str
    position: NodePosition


class PositionsUpdate(BaseModel):
    positions: List[NodePositionPatch] = []


class EdgeModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    projectId: str
    source: str
    target: str
    label: str = ""
    relType: str = ""
    color: str = ""


class EdgeCreate(BaseModel):
    source: str
    target: str
    label: str = ""
    relType: str = ""
    color: str = ""


class EdgeUpdate(BaseModel):
    label: Optional[str] = None
    relType: Optional[str] = None
    color: Optional[str] = None
    source: Optional[str] = None
    target: Optional[str] = None


class ProjectModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    settings: Dict[str, Any] = Field(default_factory=lambda: dict(DEFAULT_SETTINGS))
    createdAt: str = Field(default_factory=now_iso)
    updatedAt: str = Field(default_factory=now_iso)
    nodeCount: int = 0
    edgeCount: int = 0


class ProjectCreate(BaseModel):
    name: str
    description: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class ProjectImport(BaseModel):
    """Payload produced by GET /projects/{id}/export."""
    name: Optional[str] = None
    project: Optional[Dict[str, Any]] = None
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []


# ---------- Row -> dict helpers ----------
def project_row(r, counts=None) -> dict:
    settings = json.loads(r["settings"])
    # Older projects were stored before some settings keys existed.
    merged = {**DEFAULT_SETTINGS, **settings}
    return {
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "settings": merged,
        "createdAt": r["createdAt"],
        "updatedAt": r["updatedAt"],
        "nodeCount": (counts or {}).get("nodes", 0),
        "edgeCount": (counts or {}).get("edges", 0),
    }


def node_row(r) -> dict:
    return {
        "id": r["id"],
        "projectId": r["projectId"],
        "typeId": r["typeId"],
        "title": r["title"],
        "description": r["description"],
        "fields": json.loads(r["fields"]),
        "position": json.loads(r["position"]),
        "tags": json.loads(r["tags"] or "[]"),
        "image": (r["image"] if "image" in r.keys() else "") or "",
        # Legacy rows may hold an integer here — the API contract is a string.
        "date": str((r["date"] if "date" in r.keys() else "") or ""),
        "canvas": (r["canvas"] if "canvas" in r.keys() else "") or "",
        "createdAt": r["createdAt"],
    }


def edge_row(r) -> dict:
    return {
        "id": r["id"],
        "projectId": r["projectId"],
        "source": r["source"],
        "target": r["target"],
        "label": r["label"],
        "relType": r["relType"] or "",
        "color": r["color"] or "",
    }


def _counts(conn) -> Dict[str, Dict[str, int]]:
    """{projectId: {"nodes": n, "edges": m}} in two queries instead of 2N."""
    out: Dict[str, Dict[str, int]] = {}
    for table, key in (("nodes", "nodes"), ("edges", "edges")):
        for r in conn.execute(f"SELECT projectId, COUNT(*) AS c FROM {table} GROUP BY projectId"):
            out.setdefault(r["projectId"], {})[key] = r["c"]
    return out


# ---------- Project routes ----------
@api_router.get("/projects", response_model=List[ProjectModel])
def list_projects():
    with db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY updatedAt DESC").fetchall()
        counts = _counts(conn)
    return [project_row(r, counts.get(r["id"])) for r in rows]


@api_router.post("/projects", response_model=ProjectModel)
def create_project(payload: ProjectCreate):
    project = ProjectModel(**payload.model_dump())
    d = project.model_dump()
    with db() as conn:
        conn.execute(
            "INSERT INTO projects (id, name, description, settings, createdAt, updatedAt) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (d["id"], d["name"], d["description"], json.dumps(d["settings"]),
             d["createdAt"], d["updatedAt"]),
        )
    return d


@api_router.get("/projects/{project_id}", response_model=ProjectModel)
def get_project(project_id: str):
    with db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Проект не найден")
        counts = _counts(conn).get(project_id)
    return project_row(row, counts)


@api_router.put("/projects/{project_id}", response_model=ProjectModel)
def update_project(project_id: str, payload: ProjectUpdate):
    with db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Проект не найден")
        doc = project_row(row)
        updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        updates["updatedAt"] = now_iso()
        doc.update(updates)
        conn.execute(
            "UPDATE projects SET name = ?, description = ?, settings = ?, updatedAt = ? "
            "WHERE id = ?",
            (doc["name"], doc["description"], json.dumps(doc["settings"]),
             doc["updatedAt"], project_id),
        )
    return doc


@api_router.delete("/projects/{project_id}")
def delete_project(project_id: str):
    with db() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.execute("DELETE FROM nodes WHERE projectId = ?", (project_id,))
        conn.execute("DELETE FROM edges WHERE projectId = ?", (project_id,))
    return {"ok": True}


# ---------- Export / import / duplicate ----------
@api_router.get("/projects/{project_id}/export")
def export_project(project_id: str):
    """Full project snapshot — the same shape POST /projects/import accepts."""
    with db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Проект не найден")
        project = project_row(row)
        nodes = [node_row(r) for r in conn.execute(
            "SELECT * FROM nodes WHERE projectId = ?", (project_id,)).fetchall()]
        edges = [edge_row(r) for r in conn.execute(
            "SELECT * FROM edges WHERE projectId = ?", (project_id,)).fetchall()]
    return {
        "format": "bluegem-project",
        "version": 1,
        "exportedAt": now_iso(),
        "project": project,
        "nodes": nodes,
        "edges": edges,
    }


def _insert_snapshot(conn, name: str, description: str, settings: dict,
                     nodes: List[dict], edges: List[dict]) -> dict:
    """Insert a project plus its graph under fresh ids; returns the new project."""
    project = ProjectModel(name=name, description=description,
                           settings={**DEFAULT_SETTINGS, **(settings or {})})
    d = project.model_dump()
    conn.execute(
        "INSERT INTO projects (id, name, description, settings, createdAt, updatedAt) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (d["id"], d["name"], d["description"], json.dumps(d["settings"]),
         d["createdAt"], d["updatedAt"]),
    )
    id_map = {}
    for n in nodes:
        new_id = str(uuid.uuid4())
        id_map[n.get("id")] = new_id
        pos = n.get("position") or {}
        conn.execute(
            "INSERT INTO nodes (id, projectId, typeId, title, description, fields, position, "
            "tags, image, date, canvas, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id, d["id"], n.get("typeId", "note"), n.get("title", ""),
             n.get("description", ""), json.dumps(n.get("fields") or []),
             json.dumps({"x": pos.get("x", 0), "y": pos.get("y", 0)}),
             json.dumps(n.get("tags") or []), n.get("image", "") or "",
             str(n.get("date", "") or ""), n.get("canvas", "") or "",
             n.get("createdAt") or now_iso()),
        )
    for e in edges:
        src, tgt = id_map.get(e.get("source")), id_map.get(e.get("target"))
        if not src or not tgt:
            continue  # dangling edge in the imported file — drop it
        conn.execute(
            "INSERT INTO edges (id, projectId, source, target, label, relType, color) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), d["id"], src, tgt, e.get("label", "") or "",
             e.get("relType", "") or "", e.get("color", "") or ""),
        )
    d["nodeCount"] = len(id_map)
    return d


@api_router.post("/projects/import", response_model=ProjectModel)
def import_project(payload: ProjectImport):
    src = payload.project or {}
    name = (payload.name or src.get("name") or "Импортированный проект").strip()
    if not name:
        raise HTTPException(400, "У проекта должно быть название")
    with db() as conn:
        return _insert_snapshot(conn, name, src.get("description", ""),
                                src.get("settings") or {}, payload.nodes, payload.edges)


@api_router.post("/projects/{project_id}/duplicate", response_model=ProjectModel)
def duplicate_project(project_id: str):
    snapshot = export_project(project_id)
    p = snapshot["project"]
    with db() as conn:
        return _insert_snapshot(conn, f"{p['name']} (копия)", p["description"],
                                p["settings"], snapshot["nodes"], snapshot["edges"])


# ---------- Graph routes ----------
@api_router.get("/projects/{project_id}/graph")
def get_graph(project_id: str):
    with db() as conn:
        nodes = [node_row(r) for r in conn.execute(
            "SELECT * FROM nodes WHERE projectId = ?", (project_id,)
        ).fetchall()]
        edges = [edge_row(r) for r in conn.execute(
            "SELECT * FROM edges WHERE projectId = ?", (project_id,)
        ).fetchall()]
    return {"nodes": nodes, "edges": edges}


@api_router.post("/projects/{project_id}/nodes", response_model=NodeModel)
def create_node(project_id: str, payload: NodeCreate):
    node = NodeModel(projectId=project_id, **payload.model_dump())
    d = node.model_dump()
    with db() as conn:
        conn.execute(
            "INSERT INTO nodes (id, projectId, typeId, title, description, fields, position, tags, image, date, canvas, createdAt) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (d["id"], d["projectId"], d["typeId"], d["title"], d["description"],
             json.dumps(d["fields"]), json.dumps(d["position"]),
             json.dumps(d["tags"]), d["image"], d["date"], d["canvas"], d["createdAt"]),
        )
        touch_project(conn, project_id)
    return d


@api_router.put("/projects/{project_id}/nodes/positions")
def update_node_positions(project_id: str, payload: PositionsUpdate):
    """Bulk position write — one request for a whole auto-layout pass."""
    with db() as conn:
        for p in payload.positions:
            conn.execute(
                "UPDATE nodes SET position = ? WHERE id = ? AND projectId = ?",
                (json.dumps(p.position.model_dump()), p.id, project_id),
            )
        touch_project(conn, project_id)
    return {"ok": True, "updated": len(payload.positions)}


@api_router.put("/nodes/{node_id}", response_model=NodeModel)
def update_node(node_id: str, payload: NodeUpdate):
    with db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Узел не найден")
        doc = node_row(row)
        updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        doc.update(updates)
        conn.execute(
            "UPDATE nodes SET typeId = ?, title = ?, description = ?, fields = ?, position = ?, tags = ?, image = ?, date = ?, canvas = ? "
            "WHERE id = ?",
            (doc["typeId"], doc["title"], doc["description"],
             json.dumps(doc["fields"]), json.dumps(doc["position"]),
             json.dumps(doc.get("tags", [])), doc.get("image", ""),
             doc.get("date", ""), doc.get("canvas", ""), node_id),
        )
        touch_project(conn, doc["projectId"])
    return doc


@api_router.delete("/nodes/{node_id}")
def delete_node(node_id: str):
    with db() as conn:
        row = conn.execute("SELECT * FROM nodes WHERE id = ?", (node_id,)).fetchone()
        conn.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
        if row:
            conn.execute("DELETE FROM edges WHERE source = ? OR target = ?", (node_id, node_id))
            touch_project(conn, row["projectId"])
    return {"ok": True}


@api_router.post("/projects/{project_id}/edges", response_model=EdgeModel)
def create_edge(project_id: str, payload: EdgeCreate):
    if payload.source == payload.target:
        raise HTTPException(400, "Нельзя связать узел с самим собой")
    with db() as conn:
        existing = conn.execute(
            "SELECT * FROM edges WHERE projectId = ? AND source = ? AND target = ?",
            (project_id, payload.source, payload.target),
        ).fetchone()
        if existing:
            return edge_row(existing)
        edge = EdgeModel(projectId=project_id, **payload.model_dump())
        d = edge.model_dump()
        conn.execute(
            "INSERT INTO edges (id, projectId, source, target, label, relType, color) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (d["id"], d["projectId"], d["source"], d["target"], d["label"],
             d["relType"], d["color"]),
        )
        touch_project(conn, project_id)
    return d


@api_router.put("/edges/{edge_id}", response_model=EdgeModel)
def update_edge(edge_id: str, payload: EdgeUpdate):
    with db() as conn:
        row = conn.execute("SELECT * FROM edges WHERE id = ?", (edge_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Связь не найдена")
        doc = edge_row(row)
        updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        doc.update(updates)
        conn.execute(
            "UPDATE edges SET label = ?, relType = ?, color = ?, source = ?, target = ? WHERE id = ?",
            (doc["label"], doc["relType"], doc["color"], doc["source"], doc["target"], edge_id),
        )
        touch_project(conn, doc["projectId"])
    return doc


@api_router.delete("/edges/{edge_id}")
def delete_edge(edge_id: str):
    with db() as conn:
        row = conn.execute("SELECT projectId FROM edges WHERE id = ?", (edge_id,)).fetchone()
        conn.execute("DELETE FROM edges WHERE id = ?", (edge_id,))
        if row:
            touch_project(conn, row["projectId"])
    return {"ok": True}


@api_router.get("/health")
def health():
    with db() as conn:
        projects = conn.execute("SELECT COUNT(*) AS c FROM projects").fetchone()["c"]
    return {"status": "ok", "db": DB_PATH, "projects": projects}


@api_router.get("/")
def root():
    return {"message": "BlueGem API", "version": app.version}


app.include_router(api_router)


# ---------- Desktop: single-origin static hosting ----------
if STATIC_DIR and STATIC_DIR.is_dir():
    # CRA puts hashed assets under build/static; everything else (favicon,
    # manifest…) is served by the catch-all below.
    if (STATIC_DIR / "static").is_dir():
        app.mount("/static", StaticFiles(directory=STATIC_DIR / "static"), name="assets")

    _INDEX = STATIC_DIR / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """Serve a real file when it exists, otherwise index.html (client routing)."""
        # An unknown /api path must stay a 404 JSON error, not the HTML shell.
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(404, "Не найдено")
        candidate = (STATIC_DIR / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(candidate)
        if not _INDEX.is_file():
            raise HTTPException(500, "Интерфейс не собран")
        # index.html must never be cached: a stale shell would point at
        # asset names that no longer exist after an update.
        return FileResponse(_INDEX, headers={"Cache-Control": "no-store"})


# ---------- Middleware ----------
# Order matters: whatever is added last runs first. CORS has to be outermost so
# preflight requests are answered before the token check ever sees them.
if API_TOKEN:
    @app.middleware("http")
    async def require_token(request: Request, call_next):
        """The API only listens on the loopback interface, but any local process —
        including a web page in the user's browser — could still reach it. The
        token is known only to the Electron shell that started this server."""
        path = request.url.path
        if path.startswith("/api") and request.method != "OPTIONS":
            sent = request.headers.get("x-bg-token") or request.query_params.get("token")
            if sent != API_TOKEN:
                return JSONResponse({"detail": "Доступ запрещён"}, status_code=403)
        return await call_next(request)

_origins = [o for o in os.environ.get('CORS_ORIGINS', '*').split(',') if o]
app.add_middleware(
    CORSMiddleware,
    # Credentials plus a wildcard origin is not a valid combination, and the app
    # authenticates with a header rather than cookies.
    allow_credentials="*" not in _origins,
    allow_origins=_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Ensure tables exist as soon as the app is imported.
init_db()
