import base64
import json
from datetime import datetime, timedelta, timezone

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


def test_images_are_stored_once_and_inlined_on_export(client, project, srv):
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


def test_legacy_inline_images_migrate(client, project, srv):
    n = add_node(client, project["id"])
    with srv.db() as conn:
        conn.execute("UPDATE nodes SET image = ? WHERE id = ?", (PNG_URL, n["id"]))
        srv.migrate_inline_images(conn)
        row = conn.execute("SELECT image FROM nodes WHERE id = ?", (n["id"],)).fetchone()
    assert row["image"].startswith("bg-image:")


def test_gc_drops_unreferenced_images(client, project, srv):
    n = add_node(client, project["id"], image="data:image/png;base64," + base64.b64encode(PNG + b"x").decode())
    client.put(f"/api/nodes/{n['id']}", json={"image": ""})
    with srv.db() as conn:
        conn.execute("DELETE FROM backups")
        srv.gc_images(conn)
        left = conn.execute("SELECT COUNT(*) AS c FROM images WHERE hash = ?",
                            (n["image"].split(":", 1)[1],)).fetchone()["c"]
    assert left == 0


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


def test_backup_retention(srv):
    now = datetime(2026, 11, 11, 12, tzinfo=timezone.utc)
    rows = []
    for i in range(20):  # двадцать копий сегодня, раз в десять минут
        rows.append({"id": f"t{i}", "createdAt": (now - timedelta(minutes=10 * i)).isoformat()})
    for d in range(1, 40):  # и по две в день за прошлые дни
        for h in (9, 18):
            when = (now - timedelta(days=d)).replace(hour=h)
            rows.append({"id": f"d{d}-{h}", "createdAt": when.isoformat()})
    rows.sort(key=lambda r: r["createdAt"], reverse=True)
    drop = set(srv.backups_to_drop(rows, now))
    kept = [r for r in rows if r["id"] not in drop]
    assert all(f"t{i}" in {r['id'] for r in kept} for i in range(12))
    older = [r for r in kept if not r["id"].startswith("t")]
    days = [r["createdAt"][:10] for r in older]
    assert len(days) == len(set(days))  # по одной на день
    assert all(r["createdAt"] >= (now - timedelta(days=30)).isoformat() for r in older)


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


def test_delete_project_removes_backups(client, project, srv):
    pid = project["id"]
    add_node(client, pid)
    client.post(f"/api/projects/{pid}/backups")
    client.delete(f"/api/projects/{pid}")
    with srv.db() as conn:
        assert conn.execute("SELECT COUNT(*) AS c FROM backups WHERE projectId = ?", (pid,)).fetchone()["c"] == 0


def test_starter_template(client):
    r = client.post("/api/projects", json={"name": "Кампания", "lang": "ru", "template": "dnd", "starter": True})
    p = r.json()
    assert p["nodeCount"] > 0
    snap = json.loads(json.dumps(client.get(f"/api/projects/{p['id']}/export").json()))
    assert len(snap["edges"]) > 0
