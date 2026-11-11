"""Сервер поднимается на временной базе: тесты не трогают настоящие проекты."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

_TMP = tempfile.mkdtemp(prefix="bluegem-test-")
os.environ["SQLITE_PATH"] = str(Path(_TMP) / "test.db")
os.environ.pop("BG_TOKEN", None)
os.environ.pop("BG_STATIC_DIR", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402  (база должна быть задана до импорта)
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def srv():
    return server


@pytest.fixture(scope="session")
def client():
    return TestClient(server.app)


@pytest.fixture
def project(client):
    r = client.post("/api/projects", json={"name": "Мир", "lang": "ru"})
    assert r.status_code == 200, r.text
    return r.json()
