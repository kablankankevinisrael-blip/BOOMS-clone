@echo off
chcp 65001 >nul
title 🚀 BOOMS - Lanceur Intelligent

set BACKEND_DIR=backend
set FRONTEND_DIR=frontend
set BACKEND_PORT=8000
set FRONTEND_PORT=8081
set LOGS_DIR=logs

:menu
cls
echo.
echo ========================================
echo    🚀 BOOMS - LANCEUR INTELLIGENT
echo ========================================
echo.
echo 1. 🎯 Démarrer Backend + Frontend
echo 2. ⚡ Démarrer Backend seulement  
echo 3. 📱 Démarrer Frontend seulement
echo 4. 🛑 Arrêter tous les services
echo 5. 📊 Voir le statut
echo 6. 🧹 Nettoyer et redémarrer
echo 7. 📝 Mode avec Logs détaillés
echo 8. 🚪 Quitter
echo.
set /p choix=Choisissez une option [1-8]: 

if "%choix%"=="1" goto start_all
if "%choix%"=="2" goto start_backend
if "%choix%"=="3" goto start_frontend
if "%choix%"=="4" goto stop_all
if "%choix%"=="5" goto status
if "%choix%"=="6" goto clean_restart
if "%choix%"=="7" goto start_with_logs
if "%choix%"=="8" exit

goto menu

:start_all
echo.
echo 🎯 Démarrage de tous les services...
call :cleanup
echo.

echo [1/3] Vérification backend...
cd %BACKEND_DIR%
if not exist "env\Scripts\activate.bat" (
    echo ❌ Environnement backend non trouvé
    echo 💡 Exécutez l'option 6 (Nettoyer et redémarrer)
    cd ..
    pause
    goto menu
)
cd ..

echo [2/3] Démarrage backend...
cd %BACKEND_DIR%
start "BOOMS Backend" cmd /k "title BOOMS Backend && echo 🐍 Démarrage FastAPI... && env\Scripts\activate.bat && echo ✅ Backend actif: http://localhost:%BACKEND_PORT% && echo 📚 Docs: http://localhost:%BACKEND_PORT%/docs && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port %BACKEND_PORT%"
cd ..

timeout /t 3 >nul

echo [3/3] Démarrage frontend...
cd %FRONTEND_DIR%
start "BOOMS Frontend" cmd /k "title BOOMS Frontend && echo ⚛️  Démarrage Expo... && echo 📱 Dev Server: http://localhost:%FRONTEND_PORT% && echo 📱 Mobile: Scannez le QR code avec Expo Go && npx expo start --port %FRONTEND_PORT%"
cd ..

call :wait_and_status
goto menu

:start_backend
echo.
echo 🐍 Démarrage du backend seulement...
call :cleanup
cd %BACKEND_DIR%
start "BOOMS Backend" cmd /k "title BOOMS Backend && env\Scripts\activate.bat && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port %BACKEND_PORT%"
cd ..
echo ✅ Backend démarré: http://localhost:%BACKEND_PORT%
pause
goto menu

:start_frontend
echo.
echo ⚛️  Démarrage du frontend seulement...
taskkill /f /im node.exe >nul 2>&1
cd %FRONTEND_DIR%
start "BOOMS Frontend" cmd /k "title BOOMS Frontend && npx expo start --port %FRONTEND_PORT%"
cd ..
echo ✅ Frontend démarré: http://localhost:%FRONTEND_PORT%
pause
goto menu

:stop_all
echo.
echo 🛑 Arrêt de tous les services Booms...
call :cleanup
echo ✅ Tous les services arrêtés
timeout /t 2 >nul
goto menu

:status
echo.
echo 📊 Statut des services:
echo.
tasklist /fi "windowtitle eq BOOMS Backend*" | find /i "python.exe" >nul && echo ✅ Backend: EN LIGNE || echo ❌ Backend: HORS LIGNE
tasklist /fi "windowtitle eq BOOMS Frontend*" | find /i "node.exe" >nul && echo ✅ Frontend: EN LIGNE || echo ❌ Frontend: HORS LIGNE

curl -s http://localhost:%BACKEND_PORT%/health >nul 2>&1
if errorlevel 1 (
    echo ❌ API: NON RESPONSIVE
) else (
    echo ✅ API: RESPONSIVE
    echo 📍 URL: http://localhost:%BACKEND_PORT%
)

echo.
pause
goto menu

:clean_restart
echo.
echo 🧹 Nettoyage complet et redémarrage...
call :cleanup

echo [1/4] Nettoyage des caches...
cd %FRONTEND_DIR%
if exist "node_modules" rmdir /s /q node_modules >nul 2>&1
cd ..\%BACKEND_DIR%
if exist "__pycache__" rmdir /s /q __pycache__ >nul 2>&1
cd ..

echo [2/4] Réinstallation backend...
cd %BACKEND_DIR%
if exist "env" rmdir /s /q env >nul 2>&1
python -m venv env
call env\Scripts\activate.bat
pip install -r requirements.txt >nul 2>&1
cd ..

echo [3/4] Réinstallation frontend...
cd %FRONTEND_DIR%
if exist "node_modules" rmdir /s /q node_modules >nul 2>&1
npm install --silent
cd ..

echo [4/4] Redémarrage des services...
call :start_all
goto menu

:start_with_logs
echo.
echo 📝 Démarrage avec logs détaillés...
if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"
set TIMESTAMP=%date:~-4%-%date:~3,2%-%date:~0,2%_%time:~0,2%-%time:~3,2%

call :cleanup

echo 📁 Création des fichiers de log...
echo Démarrage à %TIME% > "%LOGS_DIR%\booms_%TIMESTAMP%.log"

echo 🐍 Démarrage backend avec logs...
cd %BACKEND_DIR%
start "BOOMS Backend" cmd /k "title BOOMS Backend && env\Scripts\activate.bat && echo [%TIME%] Backend démarré >> ..\%LOGS_DIR%\booms_%TIMESTAMP%.log && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port %BACKEND_PORT%"
cd ..

timeout /t 3 >nul

echo ⚛️  Démarrage frontend avec logs...
cd %FRONTEND_DIR%
start "BOOMS Frontend" cmd /k "title BOOMS Frontend && echo [%TIME%] Frontend démarré >> ..\%LOGS_DIR%\booms_%TIMESTAMP%.log && npx expo start --port %FRONTEND_PORT%"
cd ..

echo 📊 Logs enregistrés dans: %LOGS_DIR%\booms_%TIMESTAMP%.log
call :wait_and_status
goto menu

:cleanup
echo 🧹 Nettoyage des processus...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
taskkill /f /fi "windowtitle eq BOOMS*" >nul 2>&1
goto :eof

:wait_and_status
echo.
echo ⏳ Attente du démarrage des services...
timeout /t 5 >nul

echo.
echo ========================================
echo     ✅ BOOMS OPÉRATIONNEL !
echo ========================================
echo.
echo 📍 Backend:  http://localhost:%BACKEND_PORT%
echo 📚 Docs:     http://localhost:%BACKEND_PORT%/docs
echo 📱 Frontend: http://localhost:%FRONTEND_PORT%
echo.
echo 🔍 Deux fenêtres ouvertes:
echo    - BOOMS Backend  (Ne pas fermer)
echo    - BOOMS Frontend (Scanner QR Code)
echo.
echo 🛑 Pour arrêter: Revenir au menu option 4
echo.
pause
goto :eof