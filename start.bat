@echo off
setlocal
cd /d "%~dp0"

REM Скрипт для разработки. Готовое приложение запускается двойным кликом по
REM ярлыку BlueGem - ни консоли, ни команд там не нужно.
REM
REM     npm run dev    окно приложения + горячая перезагрузка интерфейса
REM     npm run dist   установщик и портативный exe в папке release
REM
REM Файл сохранён в кодировке CP866 (OEM) и намеренно НЕ вызывает chcp.
REM Смена кодовой страницы посреди .bat сбивает разбор файла: cmd читает его
REM по байтам, смещение уезжает, и обрывки строк выполняются как команды.
REM Если правите этот файл, сохраняйте его в CP866, а не в UTF-8.

if not exist "node_modules" (
    echo [BlueGem] Ставлю зависимости оболочки, это небыстро...
    call npm install
    if errorlevel 1 goto fail
)

if not exist "backend\.venv\Scripts\python.exe" (
    echo [BlueGem] Не найдено окружение backend\.venv
    echo.
    echo Создайте его командами:
    echo     python -m venv backend\.venv
    echo     backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
    goto fail
)

echo [BlueGem] Запускаю режим разработки. Закройте окно приложения, чтобы выйти.
call npm run dev
if errorlevel 1 goto fail

endlocal
exit /b 0

:fail
echo.
echo [BlueGem] Запуск прерван. Текст ошибки выше.
pause
exit /b 1
