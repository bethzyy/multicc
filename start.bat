@echo off
chcp 65001 >nul
echo MultiCC - Claude Code 多窗口管理器
echo ================================
echo.

cd /d "%~dp0"

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js v20 或更高版本
    pause
    exit /b 1
)

:: 检查 node_modules
if not exist "node_modules" (
    echo [信息] 首次运行，正在安装依赖...
    npm install --ignore-scripts
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

:: 启动开发模式（使用 VBScript 隐藏窗口）
echo [信息] 启动 MultiCC...
cscript //nologo "%~dp0launch.vbs"
