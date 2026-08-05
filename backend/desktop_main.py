"""Точка входа встроенного сервера BlueGem.

В десктопной сборке этот файл замораживается PyInstaller'ом в
`bluegem-backend.exe`, который Electron запускает сам при старте окна и
гасит при выходе. Пользователь никаких команд не вводит.

Всё, что нужно знать серверу, приходит через переменные окружения (их
выставляет Electron, см. `electron/backend.js`):

    BG_HOST        адрес прослушивания, по умолчанию 127.0.0.1
    BG_PORT        порт; 0 — выбрать свободный самостоятельно
    BG_TOKEN       общий секрет, без него запросы к /api отклоняются
    BG_STATIC_DIR  каталог собранного фронтенда (build/)
    SQLITE_PATH    файл базы в профиле пользователя
    BG_LOG         куда писать лог, если stdout недоступен

Код в `server.py` не знает про Electron и по-прежнему запускается обычным
`uvicorn server:app` для разработки.
"""
from __future__ import annotations

import errno
import multiprocessing
import os
import sys
import threading
import traceback
from pathlib import Path

# Замороженная сборка запускается без консоли: stdout/stderr могут быть None,
# и тогда любой print (в том числе внутри uvicorn) уронил бы процесс.
EXIT_PORT_BUSY = 98
EXIT_FAILED = 99


def _ensure_streams() -> None:
    log_path = os.environ.get("BG_LOG")
    for name in ("stdout", "stderr"):
        if getattr(sys, name, None) is not None:
            continue
        try:
            stream = open(log_path, "a", encoding="utf-8", buffering=1) if log_path \
                else open(os.devnull, "w", encoding="utf-8")
        except OSError:
            stream = open(os.devnull, "w", encoding="utf-8")
        setattr(sys, name, stream)


def emit(line: str) -> None:
    """Строка для лога Electron. Никогда не бросает — это всего лишь лог."""
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def _watch_parent(server) -> None:
    """Сторож: Electron держит открытым наш stdin.

    Оболочку закрыли (в том числе принудительно) — канал обрывается, и сервер
    уходит следом. Иначе процесс остался бы висеть без окна.
    """
    stream = sys.stdin
    if stream is None:
        return
    try:
        while stream.readline():
            pass  # ничего не ждём, важен только момент закрытия канала
    except Exception:
        pass
    emit("BG_PARENT_GONE")
    server.should_exit = True
    # Если корректное завершение почему-то подвисло — уходим жёстко.
    threading.Timer(5, lambda: os._exit(0)).start()


def main() -> int:
    _ensure_streams()

    host = os.environ.get("BG_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("BG_PORT", "0"))
    except ValueError:
        port = 0

    # Импортируем после настройки потоков: server.py при импорте создаёт базу.
    try:
        import uvicorn
        from server import DB_PATH, app
    except Exception:
        emit("BG_FATAL Не удалось загрузить серверную часть")
        traceback.print_exc()
        return EXIT_FAILED

    emit(f"BG_BOOT host={host} port={port} db={DB_PATH}")

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level=os.environ.get("BG_LOG_LEVEL", "info"),
        access_log=False,
        # Внутри одного процесса: перезапуск и воркеры десктопу не нужны.
        workers=1,
        loop="asyncio",
    )
    server = uvicorn.Server(config)

    if os.environ.get("BG_WATCH_PARENT") == "1":
        threading.Thread(target=_watch_parent, args=(server,), daemon=True).start()

    try:
        server.run()
    except SystemExit as e:  # uvicorn так сообщает о неудачном bind
        emit(f"BG_FATAL uvicorn завершился с кодом {e.code}")
        return EXIT_PORT_BUSY if port else EXIT_FAILED
    except OSError as e:
        if e.errno in (errno.EADDRINUSE, errno.EACCES, 10048, 10013):
            emit(f"BG_FATAL Порт {port} занят")
            return EXIT_PORT_BUSY
        emit(f"BG_FATAL Ошибка сети: {e}")
        traceback.print_exc()
        return EXIT_FAILED
    except Exception:
        emit("BG_FATAL Сервер упал")
        traceback.print_exc()
        return EXIT_FAILED

    emit("BG_STOPPED")
    return 0


if __name__ == "__main__":
    # Обязательно для замороженных сборок на Windows.
    multiprocessing.freeze_support()
    # Чтобы `from server import app` работал и при запуске из другого каталога.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.exit(main())
