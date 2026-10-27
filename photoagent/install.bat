@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo === Установка PhotoAgent ===
set PY=
for %%V in (3.13 3.12 3.11) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>&1 && set PY=py -%%V
  )
)
if not defined PY (
  python -c "import sys; assert sys.version_info >= (3, 11)" >nul 2>&1 && set PY=python
)
if not defined PY (
  echo Не найден Python 3.11-3.13. Установите его с https://www.python.org/downloads/ ^(отметьте "Add python.exe to PATH"^) и запустите install.bat снова.
  pause
  exit /b 1
)
echo Использую: %PY%
if not exist .venv (
  %PY% -m venv .venv || goto :fail
)
call .venv\Scripts\activate.bat || goto :fail
python -m pip install --upgrade pip || goto :fail
python -m pip install -r requirements-dev.txt || goto :fail
echo.
echo === Проверка окружения ===
python -m photoagent check
echo.
echo Установка завершена. Модели скачиваются кнопкой в разделе "Модели и система"
echo или командой:  .venv\Scripts\python -m photoagent models download required
echo Запуск: run.bat
pause
exit /b 0
:fail
echo Установка прервалась с ошибкой. Скопируйте текст выше и пришлите его.
pause
exit /b 1
