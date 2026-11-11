"""Новый сервер открывает базу, созданную BlueGem 1.5.0 (Python-сервер).

fixtures/v1.5.0.db создана настоящим сервером из тега 1.5.0: проект с
картинкой внутри узла (base64), дата старым строковым видом, связь с подписью
и пример кампании. Это то, что лежит у людей на дисках прямо сейчас.
"""
import shutil

from conftest import FIXTURES

PROJECT = "d698231e-2ac5-44a6-af70-568011eb7f25"
ANNA = "86e87e9c-4d03-4fed-8ab6-e1464fff6d9b"
BORIS = "72dcf9e8-998e-4a2a-9af0-5c3135e6b7ed"


def test_opens_v150_database(start, tmp_root):
    db = tmp_root / "upgrade.db"
    shutil.copy(FIXTURES / "v1.5.0.db", db)
    c = start(db).client

    projects = {p["name"]: p for p in c.get("/api/projects").json()}
    assert set(projects) == {"Мир 1.5.0", "Кампания 1.5.0"}
    assert projects["Мир 1.5.0"]["nodeCount"] == 2
    assert projects["Мир 1.5.0"]["edgeCount"] == 1
    assert projects["Кампания 1.5.0"]["nodeCount"] == 9
    # Настройки, появившиеся после 1.5.0, подставлены по умолчанию.
    assert projects["Мир 1.5.0"]["settings"]["nodeTemplates"] == []

    g = c.get(f"/api/projects/{PROJECT}/graph").json()
    nodes = {n["id"]: n for n in g["nodes"]}
    anna, boris = nodes[ANNA], nodes[BORIS]
    # Картинка вынесена из узла в отдельную таблицу.
    assert anna["image"].startswith("bg-image:")
    assert c.get(f"/api/images/{anna['image'].split(':', 1)[1]}").status_code == 200
    assert anna["fields"] == [{"key": "Возраст", "value": "19"}]
    assert anna["tags"] == ["npc"]
    assert anna["updatedAt"]  # у старых строк — время создания
    # Дата строкой превратилась в структурную.
    assert boris["dates"][0]["start"] == {"kind": "exact", "y": 1149, "m": None, "d": None}
    assert g["edges"][0]["label"] == "брат"

    # В файл проекта картинка по-прежнему уходит строкой data:.
    snap = c.get(f"/api/projects/{PROJECT}/export").json()
    assert {n["id"]: n["image"] for n in snap["nodes"]}[ANNA].startswith("data:image/png;base64,")

    # И со старым проектом можно работать как с новым.
    r = c.put(f"/api/nodes/{BORIS}", json={"title": "Борис II"})
    assert r.status_code == 200
    assert c.get(f"/api/projects/{PROJECT}/backups").json()[0]["nodeCount"] == 2
