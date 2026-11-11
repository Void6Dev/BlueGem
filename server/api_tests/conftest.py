"""Сервер (server/, Rust) запускается настоящим процессом на временной базе,
тесты ходят к нему по HTTP — так же, как интерфейс.

Какой бинарник проверять: BG_SERVER_BIN, иначе server/target/release.
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
EXE = "bluegem-backend.exe" if sys.platform == "win32" else "bluegem-backend"
BIN = Path(os.environ.get("BG_SERVER_BIN") or ROOT / "target" / "release" / EXE)
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    """Один запущенный сервер на своей базе."""

    def __init__(self, db_path: Path, token: str = ""):
        if not BIN.exists():
            pytest.exit(f"Нет собранного сервера: {BIN} (cargo build --release в server/)", 2)
        self.db_path = db_path
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        env = {**os.environ, "SQLITE_PATH": str(db_path), "BG_PORT": str(self.port),
               "BG_TOKEN": token, "BG_STATIC_DIR": ""}
        self.proc = subprocess.Popen([str(BIN)], env=env, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        headers = {"x-bg-token": token} if token else {}
        self.client = httpx.Client(base_url=self.url, timeout=30, headers=headers)
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                if self.client.get("/api/health").status_code == 200:
                    return
            except httpx.TransportError:
                pass
            if self.proc.poll() is not None:
                break
            time.sleep(0.05)
        out = self.proc.stdout.read().decode(errors="replace") if self.proc.poll() is not None else ""
        self.stop()
        raise RuntimeError(f"Сервер не поднялся: {out}")

    def stop(self):
        self.client.close()
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()


@pytest.fixture(scope="session")
def tmp_root():
    d = Path(tempfile.mkdtemp(prefix="bluegem-api-"))
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture(scope="session")
def server(tmp_root):
    s = Server(tmp_root / "test.db")
    yield s
    s.stop()


@pytest.fixture(scope="session")
def client(server):
    return server.client


@pytest.fixture
def start(tmp_root):
    """Поднять отдельный сервер на заданной базе (перезапуск, старая база)."""
    started = []

    def _start(db_path: Path, token: str = "") -> Server:
        s = Server(db_path, token)
        started.append(s)
        return s

    yield _start
    for s in started:
        s.stop()


@pytest.fixture
def project(client):
    r = client.post("/api/projects", json={"name": "Мир", "lang": "ru"})
    assert r.status_code == 200, r.text
    return r.json()
