@echo off
echo Installing Intercultural PromptBot dependencies...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please download and install Node.js from: https://nodejs.org/
    echo Then run this script again.
    pause
    exit /b 1
)

echo Node.js found, installing dependencies...
npm install

echo.
echo Dependencies installed successfully!
echo.
echo Next steps:
echo 1. Copy .env.example to .env
echo 2. Fill in your Slack app tokens in .env
echo 3. Run: npm run dev
echo.
pause