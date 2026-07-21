@echo off
cd /d "%~dp0"
echo Gerando o executavel (release\)...
call npm run dist
echo.
echo Pronto! O .exe novo esta na pasta release\
pause
