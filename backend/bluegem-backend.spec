# -*- mode: python ; coding: utf-8 -*-
"""Сборка встроенного сервера в отдельный exe.

Вызывается из scripts/build-backend.mjs:
    .venv/Scripts/pyinstaller.exe backend/bluegem-backend.spec --noconfirm

Формат onedir (папка с exe и зависимостями), а не onefile: onefile при каждом
запуске распаковывает себя во временный каталог — это лишние секунды на старте
приложения и лишний повод для антивируса.
"""
import os

from PyInstaller.utils.hooks import collect_submodules

BACKEND_DIR = SPECPATH  # noqa: F821 — PyInstaller подставляет каталог spec-файла

hidden = [
    # uvicorn подбирает реализации цикла и протоколов через importlib,
    # статический анализ их не видит.
    *collect_submodules("uvicorn"),
    "server",
    "anyio",
    "h11",
]

excluded = [
    # Осталось от старой mongo-версии сервера, активному коду не нужно.
    "motor", "pymongo", "bson",
    # Тянутся транзитивно и весят больше самого приложения.
    "tkinter", "numpy", "PIL", "matplotlib", "pytest", "setuptools._distutils",
]

a = Analysis(
    [os.path.join(BACKEND_DIR, "desktop_main.py")],
    pathex=[BACKEND_DIR],
    binaries=[],
    datas=[],
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=excluded,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(
    pyz,  # noqa: F821
    a.scripts,
    [],
    exclude_binaries=True,
    name="bluegem-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Без консоли: сервер живёт фоном, чёрное окно рядом с приложением не нужно.
    console=False,
    disable_windowed_traceback=False,
    icon=os.path.join(BACKEND_DIR, "..", "build", "icon.ico"),
)

coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="bluegem-backend",
)
