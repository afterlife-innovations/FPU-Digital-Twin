@echo off
echo ========================================================
echo   Starting 6S22P Battery Pack Digital Twin System
echo ========================================================
echo.

:: Start FastAPI Backend in a separate window
echo [1/2] Launching Neon-backed API on http://127.0.0.1:8000 ...
start "Digital Twin - Backend (FastAPI / Neon)" /D "%~dp0backend" cmd /k "set DATABASE_BACKEND=postgresql && python run.py"

:: Brief delay to allow backend to bind port
timeout /t 2 /nobreak >nul

:: Start Vite Frontend in a separate window
echo [2/2] Launching Frontend on http://localhost:5173 ...
start "Digital Twin - Frontend (Vite)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ========================================================
echo   System launched successfully!
echo   Frontend : http://localhost:5173
echo   Backend  : http://127.0.0.1:8000/docs (PostgreSQL / Neon)
echo ========================================================
