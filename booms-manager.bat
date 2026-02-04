@echo off
chcp 65001 >nul
title 🎮 BOOMS MANAGER - Gestion des Services

:menu
cls
echo.
echo =======================================================
echo   🎮 BOOMS MANAGER - PANEL DE CONTRÔLE
echo =======================================================
echo.
echo 1. 🚀 Démarrer tous les services
echo 2. ⏹️  Arrêter tous les services  
echo 3. 🔄 Redémarrer tous les services
echo 4. 📊 Statut des services
echo 5. 🧹 Nettoyer et redémarrer
echo 6. 📋 Voir les logs
echo 7. 🛠️  Réparer l'installation
echo 8. 🚪 Quitter
echo.
set /p choice="Choisissez une option [1-8]: "

if "%choice%"=="1" goto start_all
if "%choice%"=="2" goto stop_all  
if "%choice%"=="3" goto restart_all
if "%choice%"=="4" goto status
if "%choice%"=="5" goto clean_restart
if "%choice%"=="6" goto show_logs
if "%choice%"=="7" goto repair
if "%choice%"=="8" exit

goto menu

:start_all
call launch-booms.bat
goto menu

:stop_all
echo.
echo ⏹️  Arrêt de tous les services Booms...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im cmd.exe /t /fi "windowtitle eq BOOMS*" >nul 2>&1
echo ✅ Tous les services ont été arrêtés
timeout /t 2 >nul
goto menu

:restart_all
call :stop_all
timeout /t 3 >nul
call :start_all
goto menu

:status
echo.
echo 📊 STATUT DES SERVICES BOOMS:
echo.
tasklist /fi "windowtitle eq BOOMS Backend*" | find /i "python.exe" >nul && echo ✅ Backend: EN LIGNE || echo ❌ Backend: HORS LIGNE
tasklist /fi "windowtitle eq BOOMS Frontend*" | find /i "node.exe" >nul && echo ✅ Frontend: EN LIGNE || echo ❌ Frontend: HORS LIGNE
curl -s http://localhost:8000/health >nul 2>&1 && echo 🌐 API: RESPONSIVE || echo 🌐 API: NON RESPONSIVE
echo.
pause
goto menu

:clean_restart
echo.
echo 🧹 NETTOYAGE COMPLET ET REDÉMARAGE...
:: Nettoyage des caches
cd frontend && if exist "node_modules" rmdir /s /q node_modules >nul 2>&1
cd ..\backend && if exist "__pycache__" rmdir /s /q __pycache__ >nul 2>&1
cd .. && if exist "logs" rmdir /s /q logs >nul 2>&1
echo ✅ Nettoyage terminé
call :restart_all
goto menu

:show_logs
echo.
echo 📋 LOGS RÉCENTS:
if exist "logs" (
    dir logs /b
    echo.
    set /p logfile="Entrez le nom du fichier log: "
    if exist "logs\%logfile%" type "logs\%logfile%"
) else (
    echo Aucun log disponible
)
pause
goto menu

:repair
echo.
echo 🛠️  RÉPARATION DE L'INSTALLATION BOOMS...
:: Réinstallation des dépendances
cd backend && if exist "env" rmdir /s /q env >nul 2>&1
python -m venv env
call env\Scripts\activate.bat
pip install -r requirements.txt
cd ..\frontend
rmdir /s /q node_modules >nul 2>&1
npm install
echo ✅ Réparation terminée
pause
goto menu