@echo off
chcp 65001 >nul
echo MultiCC - Claude Code 多窗口管理器
echo ================================
echo.

cd /d "%~dp0"

:: 自动查找 dist 目录中最新的便携版 exe（排除 Setup 安装包和 blockmap）
set "LATEST="
for /f "delims=" %%f in ('dir /b /a-d /o-d "dist\MultiCC*.exe" 2^>nul ^| findstr /v /i "Setup blockmap"') do (
    if not defined LATEST set "LATEST=%%f"
)

if not defined LATEST (
    echo [错误] 未在 dist 目录找到打包好的 MultiCC 便携版 exe
    echo [提示] 请先执行 npm run build:win 进行打包
    pause
    exit /b 1
)

echo [信息] 启动最新版: %LATEST%
start "" "dist\%LATEST%"
