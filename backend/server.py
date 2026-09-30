from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import json
import re
import sqlite3
import logging
import threading
import atexit
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


# Соединение на поток, а не на запрос.
#
# Раньше каждый запрос открывал файл заново, и одно сохранение узла стоило
# около пяти миллисекунд — из них почти всё уходило на открытие и настройку
# соединения, а не на саму запись. На вставке пачки узлов (Ctrl+V, пример
# кампании, импорт проекта) это складывалось в секунды ожидания на данных,
# которые лежат на том же диске.
#
# Соединение живёт столько же, сколько поток: uvicorn держит для синхронных
# обработчиков ограниченный пул, так что соединений будет десяток, а не по
# одному на запрос. Вместе с журналом WAL запись обходится в сотые доли
# миллисекунды вместо пяти.
#
# WAL здесь имеет смысл только вместе с переиспользованием: на соединение,
# открываемое каждый раз заново, он ложится лишней работой по отображению
# -wal и -shm и выходит медленнее обычного журнала (замерено: 7.4 мс против
# 4.1). Поэтому эти два решения — одно, и врозь их разбирать не стоит.
#
# synchronous = NORMAL: в WAL это значит, что при падении приложения может
# потеряться последняя транзакция, но файл остаётся целым. Для локального
# файла проекта, который к тому же выгружается в JSON, этого достаточно.
_local = threading.local()
_connections = []
_connections_lock = threading.Lock()


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    # Пишущий в WAL один; второй поток должен подождать, а не упасть
    # с «database is locked».
    conn.execute("PRAGMA busy_timeout = 5000")
    with _connections_lock:
        _connections.append(conn)
    return conn


@contextmanager
def db():
    """Соединение этого потока: коммит при успехе, откат при ошибке."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _local.conn = _connect()
    try:
        yield conn
        conn.commit()
    except BaseException:
        # Без отката незакрытая транзакция досталась бы следующему запросу,
        # который придёт в этот же поток.
        conn.rollback()
        raise


def close_connections():
    """Закрыть всё на выходе, чтобы SQLite свернул -wal обратно в файл базы."""
    with _connections_lock:
        while _connections:
            try:
                _connections.pop().close()
            except sqlite3.Error:
                pass


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
                dates TEXT NOT NULL DEFAULT '[]',
                canvas TEXT DEFAULT '',
                cardMode TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                projectId TEXT NOT NULL,
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                label TEXT DEFAULT '',
                relType TEXT DEFAULT '',
                color TEXT DEFAULT '',
                shape TEXT DEFAULT ''
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
            "date": "TEXT DEFAULT ''", "dates": "TEXT NOT NULL DEFAULT '[]'",
            "canvas": "TEXT DEFAULT ''",
            # Ширина карточки на холсте. 0 — «по умолчанию», то есть 260.
            "width": "INTEGER NOT NULL DEFAULT 0",
            # Вид этой карточки: "" — как в настройках проекта, иначе
            # "compact"/"detailed" только для неё одной.
            "cardMode": "TEXT DEFAULT ''",
        })
        _ensure_columns(conn, "edges", {
            "relType": "TEXT DEFAULT ''", "color": "TEXT DEFAULT ''",
            # Форма именно этой линии: "" — как в настройках проекта.
            "shape": "TEXT DEFAULT ''",
            # Точки излома линии: [{"x":…,"y":…}] в координатах холста. Пусто —
            # линия идёт сама, как и раньше.
            "points": "TEXT NOT NULL DEFAULT '[]'",
            # С какой стороны узла выходит и куда приходит линия ("l" / "r").
            # Без этого React Flow цепляет линию к первой точке узла, и связь,
            # проведённая справа, отрисовывается слева.
            "sourceHandle": "TEXT DEFAULT ''", "targetHandle": "TEXT DEFAULT ''",
        })
        migrate_legacy_dates(conn)


# ---------- Chronology ----------
# Дата узла перестала быть строкой: теперь это список записей вида
# {id, key, label, start, end}, где start/end — структурные значения
# (см. frontend/src/lib/chrono/dates.js). Строковое поле `date` остаётся в базе
# нетронутым: по нему восстанавливаются старые проекты и старые файлы экспорта.
_LEADING_YEAR = re.compile(r"^\s*(-?\d{1,9})\s*$")


def legacy_date_entries(text: str) -> List[dict]:
    """Превратить старую свободную строку даты в одну структурную запись.

    Чистое число становится точным годом — это подавляющее большинство
    записей. Всё остальное («перед войной», «Третья эпоха, 412») сохраняется
    как дата без разбора: текст виден пользователю и не теряется, а на шкале
    такая запись живёт в своей эпохе или в списке «без даты».
    """
    text = (text or "").strip()
    if not text:
        return []
    m = _LEADING_YEAR.match(text)
    start = ({"kind": "exact", "y": int(m.group(1)), "m": None, "d": None}
             if m else {"kind": "unknown", "raw": text})
    return [{"id": "legacy", "key": "date", "label": "", "start": start, "end": None}]


def remap_date_refs(entries: Any, id_map: Dict[str, str]) -> List[dict]:
    """Переписать ссылки относительных дат на новые id узлов (копия, импорт).

    Ссылку на узел, которого нет в наборе, оставляем как есть: дата станет
    неразрешённой и будет честно показана как «связь потеряна», а не тихо
    привяжется к чужому узлу.
    """
    if not isinstance(entries, list):
        return []
    out = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        entry = dict(entry)
        for edge in ("start", "end"):
            value = entry.get(edge)
            if isinstance(value, dict) and isinstance(value.get("rel"), dict):
                rel = dict(value["rel"])
                rel["nodeId"] = id_map.get(rel.get("nodeId"), rel.get("nodeId"))
                entry[edge] = {**value, "rel": rel}
        out.append(entry)
    return out


def migrate_legacy_dates(conn):
    """Однократный перенос строковых дат в структурные. Идемпотентен."""
    rows = conn.execute(
        "SELECT id, date FROM nodes WHERE dates = '[]' AND date IS NOT NULL AND date != ''"
    ).fetchall()
    for r in rows:
        entries = legacy_date_entries(r["date"])
        if entries:
            conn.execute("UPDATE nodes SET dates = ? WHERE id = ?",
                         (json.dumps(entries, ensure_ascii=False), r["id"]))


app = FastAPI(title="BlueGem API", version="1.1.0")
api_router = APIRouter(prefix="/api")


def fail(status: int, code: str, message: str) -> HTTPException:
    """Ошибка с кодом: подпись пользователю подбирает интерфейс на своём языке.

    `message` остаётся английским запасным вариантом для тех, кто ходит в API
    напрямую (например, через /docs).
    """
    return HTTPException(status, {"code": code, "message": message})


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def touch_project(conn, project_id: str):
    """Bump the project's updatedAt so the dashboard can sort by recency."""
    conn.execute("UPDATE projects SET updatedAt = ? WHERE id = ?", (now_iso(), project_id))


# Подписи типов и первого холста — единственный текст, который сервер кладёт
# в данные пользователя. Язык приходит от интерфейса при создании проекта;
# дальше это уже содержимое проекта, и само оно не переводится.
# Палитра нормирована по OKLCH (L 0.62, C 0.17, тон разнесён на 32°+) —
# см. frontend/src/lib/settings.js: TYPE_COLORS. Заметка остаётся нейтральной:
# это тип «по умолчанию», ему цветом выделяться незачем.
NODE_TYPE_COLORS = {
    "character": ("#E8465E", "User"),
    "faction": ("#9A63E8", "Flag"),
    "location": ("#17A46F", "MapPin"),
    "event": ("#C98122", "Calendar"),
    "note": ("#6B7280", "FileText"),
    # Ниже — типы, которые заводит только шаблон кампании. В наборе по
    # умолчанию их нет: пять типов на пустом проекте это уже много.
    "quest": ("#C98122", "Scroll"),
    "creature": ("#5FAC33", "Skull"),
    "item": ("#E45699", "Gem"),
    "lore": ("#00A9AD", "Book"),
}

NODE_TYPE_LABELS = {
    "en": {"character": "Character", "faction": "Faction", "location": "Location",
           "event": "Event", "note": "Note", "quest": "Quest", "creature": "Creature",
           "item": "Item", "lore": "Lore"},
    "ru": {"character": "Персонаж", "faction": "Фракция", "location": "Локация",
           "event": "Событие", "note": "Заметка", "quest": "Квест", "creature": "Существо",
           "item": "Предмет", "lore": "Лор"},
}

MAIN_CANVAS_LABELS = {"en": "Main", "ru": "Основной"}
DEFAULT_LANG = "en"

DEFAULT_TYPE_IDS = ["character", "faction", "location", "event", "note"]

# Заготовка по умолчанию. Объявлена здесь, а не рядом с TEMPLATES, потому что
# входит в DEFAULT_SETTINGS — а те собираются выше самих шаблонов.
DEFAULT_TEMPLATE = "blank"


def node_types_for(lang: str, ids: Optional[List[str]] = None):
    labels = NODE_TYPE_LABELS.get(lang, NODE_TYPE_LABELS[DEFAULT_LANG])
    keys = ids if ids is not None else DEFAULT_TYPE_IDS
    return [
        {"id": key, "label": labels[key], "color": NODE_TYPE_COLORS[key][0],
         "icon": NODE_TYPE_COLORS[key][1]}
        for key in keys if key in NODE_TYPE_COLORS
    ]


def default_settings(lang: str = DEFAULT_LANG) -> dict:
    return {
        **DEFAULT_SETTINGS,
        "nodeTypes": node_types_for(lang),
        "canvases": [{"id": "main", "label": MAIN_CANVAS_LABELS.get(lang, MAIN_CANVAS_LABELS[DEFAULT_LANG])}],
    }


DEFAULT_NODE_TYPES = node_types_for(DEFAULT_LANG)

DEFAULT_SETTINGS = {
    "theme": "dark",
    # Держать в согласии с DEFAULT_SETTINGS.accent во frontend/src/lib/settings.js.
    "accent": "#39BEE6",
    "font": "Manrope",
    "displayFont": "Space Grotesk",
    "edgeType": "smoothstep",
    "showGrid": True,
    "showMiniMap": True,
    "snapToGrid": False,
    "animatedEdges": False,
    "nodeTypes": DEFAULT_NODE_TYPES,
    "canvases": [{"id": "main", "label": MAIN_CANVAS_LABELS[DEFAULT_LANG]}],
    # Типы связей: [{id, label, color}]. Пусто — проект старше настройки,
    # список берётся встроенный и переводится словарём (см. relTypesOf).
    "relTypes": [],
    # Подсказки характеристик по типам узлов: {typeId: [ключи]}. Пусто —
    # значит проект старше этой настройки: подсказки возьмутся из словаря
    # интерфейса, как раньше, и останутся переводимыми.
    "fieldTemplates": {},
    # Из какой заготовки вырос проект. Не настройка и не ограничение: типы,
    # страницы и содержимое правятся как обычно, а это только след того, о чём
    # проект — по нему интерфейс подбирает подсказки. Проекты, созданные до
    # появления шаблонов, получают "blank" через слияние в project_row.
    "template": DEFAULT_TEMPLATE,
    # Календарь мира и его эпохи. null — «пользователь ничего не настраивал»:
    # интерфейс подставит календарь по умолчанию (frontend/src/lib/chrono).
    # Держать эталон в одном месте — в JS — дешевле, чем повторять его здесь.
    "calendar": None,
    "eras": [],
}


# ---------- Шаблоны проектов ----------
# Шаблон — это заготовка настроек и, по желанию, пример содержимого. Нигде не
# сохраняется: после создания проект обычный, и всё в нём правится как всегда.
# Подписи типов и страниц идут отсюда, потому что это данные пользователя;
# названия и описания самих шаблонов — интерфейсный текст и живут в словарях.

PAGE_LABELS = {
    "en": {"campaign": "Campaign", "world": "World", "characters": "Characters",
           "locations": "Locations", "factions": "Factions", "quests": "Quests",
           "timeline": "Timeline", "sessions": "Sessions", "lore": "Lore"},
    "ru": {"campaign": "Кампания", "world": "Мир", "characters": "Персонажи",
           "locations": "Локации", "factions": "Фракции", "quests": "Квесты",
           "timeline": "Хронология", "sessions": "Сессии", "lore": "Лор"},
}

# Типы связей. Цвет проявляется только под курсором и в выделении, поэтому
# держим оттенки разведёнными по тону, а не по яркости. Подпись «обычная»
# (пустой id) сюда не входит: это отсутствие типа, его синтезирует интерфейс.
REL_TYPE_COLORS = {
    "ally": "#17A46F", "enemy": "#E8465E", "family": "#C98122", "owns": "#9A63E8",
    "member": "#2E9BD6", "love": "#E45699", "mentor": "#5FAC33", "knows": "#00A9AD",
    "serves": "#5FAC33", "guards": "#C98122", "hides": "#6B7A8F",
    "owes": "#E45699", "betrayed": "#B4462E",
}

REL_TYPE_LABELS = {
    "en": {"ally": "Ally", "enemy": "Enemy", "family": "Family", "owns": "Owns",
           "member": "Member of", "love": "Love", "mentor": "Mentor", "knows": "Knows of",
           "serves": "Serves", "guards": "Guards", "hides": "Hides",
           "owes": "Owes", "betrayed": "Betrayed"},
    "ru": {"ally": "Союзник", "enemy": "Враг", "family": "Родня", "owns": "Владеет",
           "member": "Состоит в", "love": "Любовь", "mentor": "Наставник", "knows": "Знает о",
           "serves": "Служит", "guards": "Охраняет", "hides": "Скрывает",
           "owes": "Должен", "betrayed": "Предал"},
}

DEFAULT_REL_TYPE_IDS = ["ally", "enemy", "family", "owns", "member", "love", "mentor", "knows"]

# Кампании нужны отношения, которые двигают сюжет: кто кому служит, что кем
# охраняется, кто что скрывает и кто кому должен. «Родня», «любовь» и
# «наставник» отсюда убраны — за столом они почти никогда не рисуются линией.
DND_REL_TYPE_IDS = ["ally", "enemy", "member", "owns", "serves", "guards",
                    "hides", "owes", "betrayed", "knows"]


def rel_types_for(lang: str, ids: List[str]) -> List[Dict[str, str]]:
    labels = REL_TYPE_LABELS.get(lang) or REL_TYPE_LABELS[DEFAULT_LANG]
    return [{"id": key, "label": labels[key], "color": REL_TYPE_COLORS[key]}
            for key in ids if key in REL_TYPE_COLORS]


# Подсказки характеристик: что предлагается вписать в узел одним нажатием.
# Живут в настройках проекта, а не в словарях интерфейса, потому что это
# заготовка под конкретный мир — её правят, а не переводят. Словарь остаётся
# запасным вариантом для проектов, созданных до этого (см. NodeEditorPanel).
FIELD_TEMPLATES = {
    "en": {
        "character": ["Age", "Role", "Status", "Appearance", "Goal"],
        "faction": ["Leader", "Headquarters", "Size", "Goal"],
        "location": ["Region", "Population", "Climate", "Ruler"],
        "event": ["Place", "Participants", "Outcome"],
        "note": ["Source", "Status"],
    },
    "ru": {
        "character": ["Возраст", "Роль", "Статус", "Внешность", "Цель"],
        "faction": ["Лидер", "Штаб", "Численность", "Цель"],
        "location": ["Регион", "Население", "Климат", "Правитель"],
        "event": ["Место", "Участники", "Итог"],
        "note": ["Источник", "Статус"],
    },
}

# Заточка под кампанию: поля отвечают на вопросы, которые мастер задаёт себе за
# столом, а не на те, что задаёт движок правил. Хитов и КД здесь нет намеренно —
# это данные боя, их место в книге и в VTT; у существа стоит ссылка на статблок,
# потому что мастер всё равно смотрит в книгу.
DND_FIELD_TEMPLATES = {
    "en": {
        "character": ["Wants", "Fears", "Knows", "Voice", "Attitude"],
        "faction": ["Wants", "Opposed by", "Leader", "Reach", "If unchecked"],
        "location": ["First look", "What's wrong", "Hooks", "In charge"],
        "quest": ["Hook", "Giver", "Reward", "Complication", "If ignored"],
        "creature": ["Statblock", "Number", "Tactics", "Wants", "Weakness"],
        "item": ["Effect", "Where it is", "Who wants it", "History", "Attunement"],
        "lore": ["Who tells it", "How true", "What it explains", "Where written"],
        "note": ["Session", "Status"],
    },
    "ru": {
        "character": ["Хочет", "Боится", "Знает", "Голос", "Отношение"],
        "faction": ["Хочет", "Кто мешает", "Лидер", "Влияние", "Если не мешать"],
        "location": ["С порога", "Что не так", "Зацепки", "Кто здесь главный"],
        "quest": ["Зацепка", "Кто дал", "Награда", "Осложнение", "Если не придут"],
        "creature": ["Статблок", "Сколько", "Тактика", "Чего хочет", "Слабость"],
        "item": ["Что делает", "Где сейчас", "Кому нужен", "История", "Требует настройки"],
        "lore": ["Кто рассказывает", "Насколько правда", "Что объясняет", "Где записано"],
        "note": ["Сессия", "Статус"],
    },
}

TEMPLATE_FIELD_TEMPLATES = {"dnd": DND_FIELD_TEMPLATES}

TEMPLATES = {
    # Пустой мир: ровно то, что создавалось раньше без всякого выбора.
    "blank": {"types": DEFAULT_TYPE_IDS, "rels": DEFAULT_REL_TYPE_IDS,
              "pages": ["main"], "starter": False},
    "dnd": {
        "types": ["character", "faction", "location", "quest", "creature", "item", "lore", "note"],
        "rels": DND_REL_TYPE_IDS,
        "pages": ["campaign", "world", "characters", "locations", "factions",
                  "quests", "timeline", "sessions", "lore"],
        "starter": True,
    },
    # Свой набор: типы узлов человек заводит сам с первого экрана, а связи —
    # общие: это отношения между чем угодно, они от набора типов не зависят.
    "custom": {"types": [], "rels": DEFAULT_REL_TYPE_IDS,
               "pages": ["main"], "starter": False},
}


def canvases_for(template: str, lang: str) -> List[Dict[str, str]]:
    pages = TEMPLATES.get(template, TEMPLATES[DEFAULT_TEMPLATE])["pages"]
    labels = PAGE_LABELS.get(lang, PAGE_LABELS[DEFAULT_LANG])
    main = MAIN_CANVAS_LABELS.get(lang, MAIN_CANVAS_LABELS[DEFAULT_LANG])
    return [{"id": p, "label": main if p == "main" else labels[p]} for p in pages]


def field_templates_for(template: str, lang: str, type_ids: List[str]) -> Dict[str, List[str]]:
    """Подсказки характеристик для типов узлов этого шаблона.

    Тип без своей заготовки в набор не попадает: интерфейс сам откатится на
    общую подсказку, а лишний пустой ключ в настройках только мешал бы.
    """
    def pick(source: Dict[str, Dict[str, List[str]]]) -> Dict[str, List[str]]:
        return source.get(lang) or source.get(DEFAULT_LANG) or {}

    base = pick(FIELD_TEMPLATES)
    special = pick(TEMPLATE_FIELD_TEMPLATES.get(template, {}))
    out: Dict[str, List[str]] = {}
    for type_id in type_ids:
        keys = special.get(type_id) or base.get(type_id)
        if keys:
            out[type_id] = list(keys)
    return out


def settings_for_template(template: str, lang: str = DEFAULT_LANG) -> dict:
    if template not in TEMPLATES:
        template = DEFAULT_TEMPLATE
    spec = TEMPLATES[template]
    return {
        **DEFAULT_SETTINGS,
        "nodeTypes": node_types_for(lang, spec["types"]),
        "relTypes": rel_types_for(lang, spec["rels"]),
        "canvases": canvases_for(template, lang),
        "fieldTemplates": field_templates_for(template, lang, spec["types"]),
        "template": template,
    }


# Пример содержимого для шаблона кампании: девять узлов и девять связей —
# столько, чтобы стало видно, ради чего здесь связи, и не столько, чтобы
# это пришлось разбирать. Удаляется одним выделением.
# Всё кладём на первую страницу шаблона, а не раскладываем по профильным:
# смысл примера в том, что связи видно, а связь между страницами линией не
# рисуется — второй её конец не на этом холсте. Разложенный «правильно»
# пример открывался на пустой странице и показывал по два узла на остальных.
# Формат: (ключ, тип, x, y, теги).
DND_STARTER_NODES = [
    ("vale", "location", 80, 40, ["region"]),
    ("town", "location", 420, 40, ["town"]),
    ("barrow", "location", 760, 40, ["dungeon"]),
    ("harbourmaster", "character", 420, 300, ["npc"]),
    ("warden", "character", 80, 300, ["npc"]),
    ("pact", "faction", 760, 300, ["cult"]),
    ("villain", "character", 420, 560, ["villain"]),
    ("crown", "item", 80, 560, ["artefact"]),
    ("quest", "quest", 760, 560, ["active"]),
]

# (откуда, куда, тип связи) — типы из REL_TYPES во фронтенде.
DND_STARTER_EDGES = [
    ("town", "vale", ""), ("barrow", "vale", ""), ("harbourmaster", "town", ""),
    ("warden", "town", ""), ("pact", "barrow", ""), ("villain", "pact", "member"),
    ("harbourmaster", "pact", ""), ("crown", "warden", "owns"), ("quest", "barrow", ""),
]

# Даты примера. Без них шкала времени в свежем проекте открывалась пустой, и
# хронология — одна из главных вещей в программе — с первого запуска не была
# видна вовсе. Здесь по одной дате на каждый вид оговорки (точно, около, до,
# между, относительно другого узла), чтобы шкала сразу показала, что умеет.
# Формат записи — как в frontend/src/lib/chrono/dates.js; в "rel" вместо id
# стоит ключ узла примера, настоящий id подставляет insert_starter.
DND_STARTER_DATES = {
    "barrow": [("construction", {"kind": "before", "y": 900})],
    "crown": [("created", {"kind": "approx", "y": 1020, "spread": {"amount": 30, "unit": "year"}})],
    "town": [("created", {"kind": "between", "y": 1080, "y2": 1110})],
    "villain": [("birth", {"kind": "exact", "y": 1141})],
    "warden": [("birth", {"kind": "exact", "y": 1149})],
    "harbourmaster": [("birth", {"kind": "exact", "y": 1158, "m": 4, "d": 12})],
    "pact": [("created", {"kind": "exact", "y": 1179, "m": 11})],
    "quest": [("date", {"kind": "exact", "rel": {"node": "pact", "amount": 6, "unit": "year", "dir": "after"}})],
}


def starter_dates(key: str, ids: Dict[str, str]) -> List[dict]:
    """Записи дат узла примера с настоящими id в относительных ссылках."""
    out = []
    for i, (entry_key, start) in enumerate(DND_STARTER_DATES.get(key, [])):
        start = dict(start)
        rel = start.get("rel")
        if rel:
            start["rel"] = {"nodeId": ids[rel["node"]], "entryId": None, "edge": "start",
                            "amount": rel["amount"], "unit": rel["unit"], "dir": rel["dir"]}
        out.append({"id": f"s{i}", "key": entry_key, "label": "", "start": start, "end": None})
    return out


DND_STARTER_TEXT = {
    "en": {
        "vale": ("Thundertree Vale", "Pine-dark valley between the coast road and the barrow hills. Everything in this campaign happens inside it."),
        "town": ("Brackenford", "Fishing town of nine hundred. One inn, one temple, one harbourmaster — and every one of them owes somebody."),
        "barrow": ("Ashen Barrow", "Sealed tomb under the ridge. Something inside has started counting days."),
        "harbourmaster": ("Maelor Vance", "Harbourmaster of Brackenford. Sells the party passage north; sells word of their passage the same evening."),
        "warden": ("Sister Ilva", "Temple warden who knows what was buried and will not say it aloud."),
        "pact": ("The Ember Pact", "Smugglers turned zealots. They want the barrow open before midwinter."),
        "villain": ("Korrath the Hollow", "The Pact's founder. Was a knight of the crown before the crown broke."),
        "crown": ("The Sundered Crown", "Half a circlet of pale gold. The other half is in the barrow."),
        "quest": ("Silence the Barrow", "Reach the tomb before the Pact finishes the seal-breaking rite."),
    },
    "ru": {
        "vale": ("Громовая долина", "Тёмная от сосен долина между прибрежной дорогой и курганными холмами. Всё в этой кампании происходит внутри неё."),
        "town": ("Брекенфорд", "Рыбацкий городок на девятьсот душ. Одна таверна, один храм, один начальник порта — и каждый из них кому-то должен."),
        "barrow": ("Пепельный курган", "Запечатанная гробница под хребтом. Что-то внутри начало считать дни."),
        "harbourmaster": ("Мейлор Вэнс", "Начальник порта Брекенфорда. Продаёт отряду проход на север; тем же вечером продаёт весть об этом проходе."),
        "warden": ("Сестра Ильва", "Хранительница храма. Знает, что похоронено под хребтом, и вслух не скажет."),
        "pact": ("Пакт Углей", "Контрабандисты, ставшие фанатиками. Хотят вскрыть курган до середины зимы."),
        "villain": ("Коррат Полый", "Основатель Пакта. Был рыцарем короны, пока корона не раскололась."),
        "crown": ("Расколотая корона", "Половина венца из бледного золота. Вторая половина — в кургане."),
        "quest": ("Заставить курган молчать", "Добраться до гробницы раньше, чем Пакт закончит обряд снятия печати."),
    },
}


def insert_starter(conn, project_id: str, template: str, lang: str) -> None:
    """Разложить пример шаблона по таблицам. Пустой шаблон — ничего не делает."""
    if not TEMPLATES.get(template, {}).get("starter"):
        return
    text = DND_STARTER_TEXT.get(lang, DND_STARTER_TEXT[DEFAULT_LANG])
    ids = {row[0]: str(uuid.uuid4()) for row in DND_STARTER_NODES}
    stamp = now_iso()
    canvas = canvases_for(template, lang)[0]["id"]
    for key, type_id, x, y, tags in DND_STARTER_NODES:
        title, desc = text[key]
        conn.execute(
            "INSERT INTO nodes (id, projectId, typeId, title, description, fields, position, "
            "tags, image, date, dates, canvas, width, cardMode, createdAt) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ids[key], project_id, type_id, title, desc, "[]",
             json.dumps({"x": x, "y": y}), json.dumps(tags, ensure_ascii=False),
             "", "", json.dumps(starter_dates(key, ids), ensure_ascii=False), canvas, 0, "", stamp),
        )
    for a, b, rel in DND_STARTER_EDGES:
        conn.execute(
            "INSERT INTO edges (id, projectId, source, target, label, relType, color, points, "
            "sourceHandle, targetHandle, shape) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), project_id, ids[a], ids[b], "", rel, "", "[]", "", "", ""),
        )


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
    # Настоящее название подставляет интерфейс — здесь только запасное значение.
    title: str = "New node"
    description: str = ""
    fields: List[Field_] = []
    position: NodePosition = Field(default_factory=NodePosition)
    tags: List[str] = []
    image: str = ""
    # Legacy free-form chronology label. Kept so old exports still import;
    # the app writes `dates` instead.
    date: str = ""
    # Structured chronology: [{id, key, label, start, end}] — see chrono/dates.js.
    dates: List[Dict[str, Any]] = []
    canvas: str = ""
    # Ширина карточки на холсте; 0 — значение по умолчанию из интерфейса.
    width: int = 0
    # Вид карточки, заданный для неё одной; "" — общий из настроек проекта.
    cardMode: str = ""
    createdAt: str = Field(default_factory=now_iso)


class NodeCreate(BaseModel):
    typeId: str = "note"
    title: str = "New node"
    description: str = ""
    fields: List[Field_] = []
    position: NodePosition = Field(default_factory=NodePosition)
    tags: List[str] = []
    image: str = ""
    date: str = ""
    dates: List[Dict[str, Any]] = []
    canvas: str = ""
    width: int = 0
    cardMode: str = ""


class NodeUpdate(BaseModel):
    typeId: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    fields: Optional[List[Field_]] = None
    position: Optional[NodePosition] = None
    tags: Optional[List[str]] = None
    image: Optional[str] = None
    date: Optional[str] = None
    dates: Optional[List[Dict[str, Any]]] = None
    canvas: Optional[str] = None
    width: Optional[int] = None
    cardMode: Optional[str] = None


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
    points: List[Dict[str, float]] = []
    sourceHandle: str = ""
    targetHandle: str = ""
    # Форма линии для этой связи; "" — общая из настроек проекта.
    shape: str = ""


class EdgeCreate(BaseModel):
    source: str
    target: str
    label: str = ""
    relType: str = ""
    color: str = ""
    points: List[Dict[str, float]] = []
    sourceHandle: str = ""
    targetHandle: str = ""
    shape: str = ""


class EdgeUpdate(BaseModel):
    label: Optional[str] = None
    relType: Optional[str] = None
    color: Optional[str] = None
    source: Optional[str] = None
    target: Optional[str] = None
    # Пустой список — осмысленное значение «сбросить излом», поэтому проверка
    # на None, а не на ложность: иначе сброс молча не сохранялся бы.
    points: Optional[List[Dict[str, float]]] = None
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None
    shape: Optional[str] = None


class ProjectModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    settings: Dict[str, Any] = Field(default_factory=lambda: dict(DEFAULT_SETTINGS))
    createdAt: str = Field(default_factory=now_iso)
    updatedAt: str = Field(default_factory=now_iso)
    nodeCount: int = 0
    edgeCount: int = 0
    # Состав по типам узлов для полоски на карточке проекта: [{color, count}].
    typeMix: List[Dict[str, Any]] = Field(default_factory=list)


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    # Язык интерфейса: на нём заводятся типы узлов и первый холст.
    lang: str = DEFAULT_LANG
    # Заготовка: набор типов, страниц и, при starter, пример содержимого.
    template: str = DEFAULT_TEMPLATE
    starter: bool = False


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
        "typeMix": type_mix(merged, (counts or {}).get("byType") or {}),
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
        "dates": json.loads((r["dates"] if "dates" in r.keys() else None) or "[]"),
        "canvas": (r["canvas"] if "canvas" in r.keys() else "") or "",
        "width": (r["width"] if "width" in r.keys() else 0) or 0,
        "cardMode": (r["cardMode"] if "cardMode" in r.keys() else "") or "",
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
        "points": json.loads((r["points"] if "points" in r.keys() else None) or "[]"),
        "sourceHandle": (r["sourceHandle"] if "sourceHandle" in r.keys() else "") or "",
        "targetHandle": (r["targetHandle"] if "targetHandle" in r.keys() else "") or "",
        "shape": (r["shape"] if "shape" in r.keys() else "") or "",
    }


def _counts(conn) -> Dict[str, Dict[str, Any]]:
    """{projectId: {"nodes": n, "edges": m, "byType": {typeId: k}}}.

    Три запроса на весь список вместо трёх на проект: панель проектов рисует
    состав каждой карточки, и на два десятка проектов это была бы шестёрка
    десятков обращений к базе на каждое открытие.
    """
    out: Dict[str, Dict[str, Any]] = {}
    for table, key in (("nodes", "nodes"), ("edges", "edges")):
        for r in conn.execute(f"SELECT projectId, COUNT(*) AS c FROM {table} GROUP BY projectId"):
            out.setdefault(r["projectId"], {})[key] = r["c"]
    for r in conn.execute("SELECT projectId, typeId, COUNT(*) AS c FROM nodes GROUP BY projectId, typeId"):
        out.setdefault(r["projectId"], {}).setdefault("byType", {})[r["typeId"]] = r["c"]
    return out


# Цвет для узла, чей тип удалён из настроек: серый «заметки» из палитры.
ORPHAN_TYPE_COLOR = "#6E6E7A"
# Больше шести долей полоска состава не различает — остальное в «прочее».
TYPE_MIX_LIMIT = 6


def type_mix(settings: Dict[str, Any], by_type: Dict[str, int]) -> List[Dict[str, Any]]:
    """Состав проекта по типам узлов: [{color, count}], крупные доли первыми."""
    if not by_type:
        return []
    colors = {t.get("id"): t.get("color") for t in settings.get("nodeTypes") or []}
    merged: Dict[str, int] = {}
    for type_id, count in by_type.items():
        color = colors.get(type_id) or ORPHAN_TYPE_COLOR
        merged[color] = merged.get(color, 0) + count
    ordered = sorted(merged.items(), key=lambda kv: -kv[1])
    head = [{"color": c, "count": n} for c, n in ordered[:TYPE_MIX_LIMIT]]
    tail = sum(n for _, n in ordered[TYPE_MIX_LIMIT:])
    if tail:
        head.append({"color": ORPHAN_TYPE_COLOR, "count": tail})
    return head


# ---------- Project routes ----------
@api_router.get("/projects", response_model=List[ProjectModel])
def list_projects():
    with db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY updatedAt DESC").fetchall()
        counts = _counts(conn)
    return [project_row(r, counts.get(r["id"])) for r in rows]


@api_router.get("/templates")
def list_templates(lang: str = DEFAULT_LANG):
    """Что именно заводит каждый шаблон. Названия самих шаблонов сюда не идут:
    это интерфейсный текст, он живёт в словарях фронтенда."""
    return [{
        "id": key,
        "types": node_types_for(lang, spec["types"]),
        "pages": [c["label"] for c in canvases_for(key, lang)],
        "starter": spec["starter"],
    } for key, spec in TEMPLATES.items()]


@api_router.post("/projects", response_model=ProjectModel)
def create_project(payload: ProjectCreate):
    data = payload.model_dump()
    lang = data.pop("lang", DEFAULT_LANG)
    template = data.pop("template", DEFAULT_TEMPLATE)
    if template not in TEMPLATES:
        template = DEFAULT_TEMPLATE
    # Пример просят только там, где он есть: флаг с чужого шаблона молча гасим.
    starter = bool(data.pop("starter", False)) and TEMPLATES[template]["starter"]
    project = ProjectModel(**data, settings=settings_for_template(template, lang))
    d = project.model_dump()
    with db() as conn:
        conn.execute(
            "INSERT INTO projects (id, name, description, settings, createdAt, updatedAt) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (d["id"], d["name"], d["description"], json.dumps(d["settings"]),
             d["createdAt"], d["updatedAt"]),
        )
        if starter:
            insert_starter(conn, d["id"], template, lang)
            counts = _counts(conn).get(d["id"]) or {}
            d["nodeCount"] = counts.get("nodes", 0)
            d["edgeCount"] = counts.get("edges", 0)
            d["typeMix"] = type_mix(d["settings"], counts.get("byType") or {})
    return d


@api_router.get("/projects/{project_id}", response_model=ProjectModel)
def get_project(project_id: str):
    with db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise fail(404, "projectNotFound", "Project not found")
        counts = _counts(conn).get(project_id)
    return project_row(row, counts)


@api_router.put("/projects/{project_id}", response_model=ProjectModel)
def update_project(project_id: str, payload: ProjectUpdate):
    with db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise fail(404, "projectNotFound", "Project not found")
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
            raise fail(404, "projectNotFound", "Project not found")
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
    # Идентификаторы раздаём заранее: относительные даты ссылаются на другие
    # узлы, и эти ссылки надо переписать на новые id — иначе копия проекта
    # потеряет всю цепочку «через 5 дней после...».
    id_map = {n.get("id"): str(uuid.uuid4()) for n in nodes}
    for n in nodes:
        new_id = id_map[n.get("id")]
        pos = n.get("position") or {}
        entries = n.get("dates")
        if not entries:
            entries = legacy_date_entries(str(n.get("date", "") or ""))
        conn.execute(
            "INSERT INTO nodes (id, projectId, typeId, title, description, fields, position, "
            "tags, image, date, dates, canvas, width, cardMode, createdAt) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id, d["id"], n.get("typeId", "note"), n.get("title", ""),
             n.get("description", ""), json.dumps(n.get("fields") or []),
             json.dumps({"x": pos.get("x", 0), "y": pos.get("y", 0)}),
             json.dumps(n.get("tags") or []), n.get("image", "") or "",
             str(n.get("date", "") or ""),
             json.dumps(remap_date_refs(entries, id_map), ensure_ascii=False),
             n.get("canvas", "") or "", int(n.get("width", 0) or 0),
             n.get("cardMode", "") or "", n.get("createdAt") or now_iso()),
        )
    for e in edges:
        src, tgt = id_map.get(e.get("source")), id_map.get(e.get("target"))
        if not src or not tgt:
            continue  # dangling edge in the imported file — drop it
        conn.execute(
            "INSERT INTO edges (id, projectId, source, target, label, relType, color, points, "
            "sourceHandle, targetHandle, shape) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), d["id"], src, tgt, e.get("label", "") or "",
             e.get("relType", "") or "", e.get("color", "") or "",
             json.dumps(e.get("points", []) or []),
             e.get("sourceHandle", "") or "", e.get("targetHandle", "") or "",
             e.get("shape", "") or ""),
        )
    d["nodeCount"] = len(id_map)
    return d


@api_router.post("/projects/import", response_model=ProjectModel)
def import_project(payload: ProjectImport):
    src = payload.project or {}
    name = (payload.name or src.get("name") or "Imported project").strip()
    if not name:
        raise fail(400, "projectNameRequired", "A project needs a name")
    with db() as conn:
        return _insert_snapshot(conn, name, src.get("description", ""),
                                src.get("settings") or {}, payload.nodes, payload.edges)


@api_router.post("/projects/{project_id}/duplicate", response_model=ProjectModel)
def duplicate_project(project_id: str):
    snapshot = export_project(project_id)
    p = snapshot["project"]
    with db() as conn:
        return _insert_snapshot(conn, f"{p['name']} (copy)", p["description"],
                                p["settings"], snapshot["nodes"], snapshot["edges"])


# ---------- Graph routes ----------
@api_router.get("/projects/{project_id}/graph")
def get_graph(project_id: str):
    """Весь граф проекта одним ответом.

    Отдаём готовый JSON, а не словарь: FastAPI прогнал бы словарь через
    jsonable_encoder, то есть обошёл бы рекурсивно все узлы со всеми их полями,
    датами и тегами — на графе в тысячу узлов это десятки миллисекунд на
    ровном месте. node_row/edge_row и так возвращают только те типы, которые
    json умеет сериализовать сам.
    """
    with db() as conn:
        nodes = [node_row(r) for r in conn.execute(
            "SELECT * FROM nodes WHERE projectId = ?", (project_id,)
        ).fetchall()]
        edges = [edge_row(r) for r in conn.execute(
            "SELECT * FROM edges WHERE projectId = ?", (project_id,)
        ).fetchall()]
    return Response(
        content=json.dumps({"nodes": nodes, "edges": edges}, ensure_ascii=False),
        media_type="application/json",
    )


@api_router.post("/projects/{project_id}/nodes", response_model=NodeModel)
def create_node(project_id: str, payload: NodeCreate):
    node = NodeModel(projectId=project_id, **payload.model_dump())
    d = node.model_dump()
    with db() as conn:
        conn.execute(
            "INSERT INTO nodes (id, projectId, typeId, title, description, fields, position, tags, image, date, dates, canvas, width, cardMode, createdAt) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (d["id"], d["projectId"], d["typeId"], d["title"], d["description"],
             json.dumps(d["fields"]), json.dumps(d["position"]),
             json.dumps(d["tags"]), d["image"], d["date"],
             json.dumps(d["dates"], ensure_ascii=False), d["canvas"], d["width"],
             d["cardMode"], d["createdAt"]),
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
            raise fail(404, "nodeNotFound", "Node not found")
        doc = node_row(row)
        updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        doc.update(updates)
        conn.execute(
            "UPDATE nodes SET typeId = ?, title = ?, description = ?, fields = ?, position = ?, tags = ?, image = ?, date = ?, dates = ?, canvas = ?, width = ?, cardMode = ? "
            "WHERE id = ?",
            (doc["typeId"], doc["title"], doc["description"],
             json.dumps(doc["fields"]), json.dumps(doc["position"]),
             json.dumps(doc.get("tags", [])), doc.get("image", ""),
             doc.get("date", ""), json.dumps(doc.get("dates", []), ensure_ascii=False),
             doc.get("canvas", ""), int(doc.get("width", 0) or 0),
             doc.get("cardMode", ""), node_id),
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
        raise fail(400, "selfLink", "A node cannot be linked to itself")
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
            "INSERT INTO edges (id, projectId, source, target, label, relType, color, points, "
            "sourceHandle, targetHandle, shape) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (d["id"], d["projectId"], d["source"], d["target"], d["label"],
             d["relType"], d["color"], json.dumps(d["points"]),
             d["sourceHandle"], d["targetHandle"], d["shape"]),
        )
        touch_project(conn, project_id)
    return d


@api_router.put("/edges/{edge_id}", response_model=EdgeModel)
def update_edge(edge_id: str, payload: EdgeUpdate):
    with db() as conn:
        row = conn.execute("SELECT * FROM edges WHERE id = ?", (edge_id,)).fetchone()
        if not row:
            raise fail(404, "edgeNotFound", "Link not found")
        doc = edge_row(row)
        updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        doc.update(updates)
        conn.execute(
            "UPDATE edges SET label = ?, relType = ?, color = ?, source = ?, target = ?, "
            "points = ?, sourceHandle = ?, targetHandle = ?, shape = ? WHERE id = ?",
            (doc["label"], doc["relType"], doc["color"], doc["source"], doc["target"],
             json.dumps(doc.get("points", [])),
             doc.get("sourceHandle", ""), doc.get("targetHandle", ""),
             doc.get("shape", ""), edge_id),
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
            raise fail(404, "notFound", "Not found")
        candidate = (STATIC_DIR / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(candidate)
        if not _INDEX.is_file():
            raise fail(500, "uiNotBuilt", "The interface has not been built")
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
                return JSONResponse(
                    {"detail": {"code": "accessDenied", "message": "Access denied"}},
                    status_code=403,
                )
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

# Соединения живут по потокам и сами не закрываются — закрываем на выходе,
# иначе рядом с базой останется незавершённый -wal.
atexit.register(close_connections)


@app.on_event("shutdown")
def _close_db():
    close_connections()
