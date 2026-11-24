# Start 6S22P Battery Pack Digital Twin System
$rootDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Starting 6S22P Battery Pack Digital Twin System" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Start Backend in a dedicated window
Write-Host "`n[1/2] Launching Neon-backed API on http://127.0.0.1:8000 ..." -ForegroundColor Yellow
$backendDir = Join-Path $rootDir "backend"
$backendCommand = "`$env:DATABASE_BACKEND='postgresql'; Set-Location '$backendDir'; python run.py"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand

Start-Sleep -Seconds 2

# 2. Start Frontend in a dedicated window
Write-Host "[2/2] Launching Frontend on http://localhost:5173 ..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\frontend'; npm run dev"

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "  System launched successfully!" -ForegroundColor Green
Write-Host "  Frontend : http://localhost:5173" -ForegroundColor Green
Write-Host "  Backend  : http://127.0.0.1:8000/docs (PostgreSQL / Neon)" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
