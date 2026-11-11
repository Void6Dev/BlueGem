import base64
import json
import shutil

from conftest import FIXTURES

# 1×1 PNG.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


def add_node(client, pid, **data):
    r = client.post(f"/api/projects/{pid}/nodes", json={"title": "Узел", **data})
    assert r.status_code == 200, r.text
    return r.json()


def link(client, pid, a, b):
    r = client.post(f"/api/projects/{pid}/edges", json={"source": a, "target": b})
    assert r.status_code == 200, r.text
    return r.json()


def export(client, pid, inline=True):
    r = client.get(f"/api/projects/{pid}/export", params={"inline": inline})
    assert r.status_code == 200, r.text
    return r.json()


def test_version_comes_from_package_json(client):
    version = client.get("/api/").json()["version"]
    assert version not in ("", "1.1.0")


def test_graph_roundtrip(client, project):
    pid = project["id"]
    a = add_node(client, pid, title="Анна")
    b = add_node(client, pid, title="Борис")
    e = link(client, pid, a["id"], b["id"])
    graph = client.get(f"/api/projects/{pid}/graph").json()
    assert {n["title"] for n in graph["nodes"]} == {"Анна", "Борис"}
    assert graph["edges"][0]["id"] == e["id"]
    assert all(n["updatedAt"] for n in graph["nodes"])


def test_self_link_rejected(client, project):
    n = add_node(client, project["id"])
    r = client.post(f"/api/projects/{project['id']}/edges", json={"source": n["id"], "target": n["id"]})
    assert r.status_code == 400


def test_images_are_stored_once_and_inlined_on_export(client, project):
    pid = project["id"]
    a = add_node(client, pid, image=PNG_URL)
    assert a["image"].startswith("bg-image:")
    b = add_node(client, pid, title="Второй")
    b2 = client.put(f"/api/nodes/{b['id']}", json={"image": PNG_URL}).json()
    assert b2["image"] == a["image"]  # одно содержимое — одна строка

    digest = a["image"].split(":", 1)[1]
    r = client.get(f"/api/images/{digest}")
    assert r.status_code == 200 and r.content == PNG
    assert r.headers["content-type"] == "image/png"

    snap = export(client, pid)
    assert {n["image"] for n in snap["nodes"] if n["image"]} == {PNG_URL}
    raw = export(client, pid, inline=False)
    assert {n["image"] for n in raw["nodes"] if n["image"]} == {a["image"]}


def test_image_route_rejects_garbage(client):
    assert client.get("/api/images/../../etc").status_code == 404
    assert client.get("/api/images/" + "0" * 64).status_code == 404




def test_deletions_leave_marks(client, project):
    pid = project["id"]
    a = add_node(client, pid)
    b = add_node(client, pid)
    e = link(client, pid, a["id"], b["id"])
    client.delete(f"/api/nodes/{a['id']}")
    dead = export(client, pid)["project"]["deleted"]
    assert a["id"] in dead["nodes"]
    assert e["id"] in dead["edges"]


def test_backup_is_taken_before_first_change_and_restores(client, project):
    pid = project["id"]
    a = add_node(client, pid, title="Сохранить меня")
    # Копия снята перед созданием узла (пустой проект); ручная — с узлом.
    manual = client.post(f"/api/projects/{pid}/backups").json()
    assert manual["nodeCount"] == 1
    client.delete(f"/api/nodes/{a['id']}")
    assert export(client, pid)["nodes"] == []

    backups = client.get(f"/api/projects/{pid}/backups").json()
    assert backups[0]["id"] == manual["id"]
    restored = client.post(f"/api/backups/{manual['id']}/restore")
    assert restored.status_code == 200, restored.text
    snap = export(client, pid)
    assert [n["id"] for n in snap["nodes"]] == [a["id"]]
    # Возвращённый узел больше не числится удалённым.
    assert a["id"] not in snap["project"]["deleted"]["nodes"]
    # И само восстановление можно отменить: перед ним снята копия.
    reasons = [b["reason"] for b in client.get(f"/api/projects/{pid}/backups").json()]
    assert "restore" in reasons


def test_identical_backup_is_not_duplicated(client, project):
    pid = project["id"]
    add_node(client, pid)
    first = client.post(f"/api/projects/{pid}/backups").json()
    second = client.post(f"/api/projects/{pid}/backups").json()
    assert first["id"] == second["id"]



def test_import_keeps_ids_once(client, project):
    pid = project["id"]
    a = add_node(client, pid, title="A")
    b = add_node(client, pid, title="B")
    link(client, pid, a["id"], b["id"])
    snap = export(client, pid)
    client.delete(f"/api/projects/{pid}")

    payload = {"project": snap["project"], "nodes": snap["nodes"], "edges": snap["edges"], "keepIds": True}
    first = client.post("/api/projects/import", json=payload).json()
    assert first["id"] == pid
    assert {n["id"] for n in export(client, pid)["nodes"]} == {a["id"], b["id"]}

    # Второй раз те же id уже заняты — получается копия с новыми.
    second = client.post("/api/projects/import", json=payload).json()
    assert second["id"] != pid
    copy = export(client, second["id"])
    assert not ({n["id"] for n in copy["nodes"]} & {a["id"], b["id"]})
    assert len(copy["edges"]) == 1


def test_replace_content_keeps_ids_and_backs_up(client, project):
    pid = project["id"]
    a = add_node(client, pid, title="Было")
    snap = export(client, pid)
    snap["nodes"][0]["title"] = "Стало"
    snap["project"]["name"] = "Новое имя"
    r = client.put(f"/api/projects/{pid}/content", json=snap)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Новое имя"
    now = export(client, pid)
    assert [(n["id"], n["title"]) for n in now["nodes"]] == [(a["id"], "Стало")]
    assert "sync" in [b["reason"] for b in client.get(f"/api/projects/{pid}/backups").json()]


def test_duplicate_shares_images(client, project):
    pid = project["id"]
    a = add_node(client, pid, image=PNG_URL)
    dup = client.post(f"/api/projects/{pid}/duplicate").json()
    nodes = export(client, dup["id"], inline=False)["nodes"]
    assert nodes[0]["image"] == a["image"]
    assert nodes[0]["id"] != a["id"]


def test_settings_change_moves_meta_stamp(client, project):
    pid = project["id"]
    before = client.get(f"/api/projects/{pid}").json()["metaUpdatedAt"]
    after = client.put(f"/api/projects/{pid}", json={"name": "Другое"}).json()["metaUpdatedAt"]
    assert after > before
    add_node(client, pid)
    assert client.get(f"/api/projects/{pid}").json()["metaUpdatedAt"] == after



def test_starter_template(client):
    r = client.post("/api/projects", json={"name": "Кампания", "lang": "ru", "template": "dnd", "starter": True})
    p = r.json()
    assert p["nodeCount"] > 0
    snap = json.loads(json.dumps(client.get(f"/api/projects/{p['id']}/export").json()))
    assert len(snap["edges"]) > 0


def test_delete_project_removes_backups(client, project):
    pid = project["id"]
    add_node(client, pid)
    client.post(f"/api/projects/{pid}/backups")
    client.delete(f"/api/projects/{pid}")
    assert client.get(f"/api/projects/{pid}/backups").json() == []
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_errors_keep_their_shape(client, project):
    r = client.get("/api/projects/nope")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "projectNotFound"
    r = client.put("/api/nodes/nope", json={"title": "x"})
    assert r.json()["detail"]["code"] == "nodeNotFound"
    r = client.post("/api/projects", json={})
    assert r.status_code == 422
    r = client.post("/api/projects/import", json={"name": "   "})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "projectNameRequired"
    assert client.get("/api/no-such-route").status_code == 404


def test_templates(client):
    t = {x["id"]: x for x in client.get("/api/templates", params={"lang": "ru"}).json()}
    assert list(t) == ["blank", "dnd", "custom"]
    assert t["dnd"]["starter"] is True
    assert t["blank"]["types"][0] == {"id": "character", "label": "Персонаж", "color": "#E8465E", "icon": "User"}
    assert t["dnd"]["pages"][0] == "Кампания"
    p = client.post("/api/projects", json={"name": "Кампания", "lang": "ru", "template": "dnd"}).json()
    assert p["settings"]["template"] == "dnd"
    assert p["settings"]["fieldTemplates"]["quest"][0] == "Зацепка"
    assert [r["id"] for r in p["settings"]["relTypes"]][:3] == ["ally", "enemy", "member"]


def test_positions_and_edges(client, project):
    pid = project["id"]
    a = add_node(client, pid, title="A")
    b = add_node(client, pid, title="B")
    r = client.put(f"/api/projects/{pid}/nodes/positions",
                   json={"positions": [{"id": a["id"], "position": {"x": 5, "y": 7}}]})
    assert r.json() == {"ok": True, "updated": 1}
    e = link(client, pid, a["id"], b["id"])
    assert link(client, pid, a["id"], b["id"])["id"] == e["id"]  # повторная связь — та же
    e2 = client.put(f"/api/edges/{e['id']}", json={"label": "брат", "points": [{"x": 1, "y": 2}]}).json()
    assert e2["label"] == "брат" and e2["points"] == [{"x": 1.0, "y": 2.0}]
    e3 = client.put(f"/api/edges/{e['id']}", json={"points": []}).json()
    assert e3["points"] == []  # пустой список — сброс излома, а не «не трогать»
    g = client.get(f"/api/projects/{pid}/graph").json()
    pos = {n["id"]: n["position"] for n in g["nodes"]}
    assert pos[a["id"]] == {"x": 5.0, "y": 7.0}


def test_token_is_required(start, tmp_root):
    s = start(tmp_root / "token.db", token="secret")
    import httpx
    assert httpx.get(f"{s.url}/api/projects").status_code == 403
    assert httpx.get(f"{s.url}/api/projects", headers={"x-bg-token": "secret"}).status_code == 200
    assert httpx.get(f"{s.url}/api/projects", params={"token": "secret"}).status_code == 200


def test_gc_drops_unreferenced_images_on_restart(start, tmp_root):
    db = tmp_root / "gc.db"
    s = start(db)
    c = s.client
    p = c.post("/api/projects", json={"name": "gc"}).json()
    n = add_node(c, p["id"], image="data:image/png;base64," + base64.b64encode(PNG + b"gc").decode())
    digest = n["image"].split(":", 1)[1]
    c.put(f"/api/nodes/{n['id']}", json={"image": ""})
    for b in c.get(f"/api/projects/{p['id']}/backups").json():
        c.delete(f"/api/backups/{b['id']}")
    assert c.get(f"/api/images/{digest}").status_code == 200
    s.stop()
    again = start(db)
    assert again.client.get(f"/api/images/{digest}").status_code == 404
