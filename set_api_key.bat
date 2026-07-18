@echo off
title Register Gemini API Key - User Environment
echo ===================================================
echo  Register Gemini API Key as Windows User Env Variable
echo ===================================================
echo.
set /p API_KEY="Enter your Gemini API Key: "
if "%API_KEY%"=="" (
    echo.
    echo ERROR: API Key cannot be empty.
    pause
    exit /b
)
setx GEMINI_API_KEY "%API_KEY%"
echo.
echo ===================================================
echo  SUCCESS: GEMINI_API_KEY has been registered!
echo  Please restart any active terminal sessions or
echo  apps (like this one) to load the new variable.
echo ===================================================
echo.
pause
