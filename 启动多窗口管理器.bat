@echo off
chcp 65001 >nul
title Claude Code 多窗口管理器

REM 检查Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到Python
    pause
    exit /b 1
)

REM 检查主程序
if not exist "%~dp0multi_cc_manager.py" (
    echo [错误] 未找到 multi_cc_manager.py
    pause
    exit /b 1
)

REM 检查依赖
python -c "import PyQt5" >nul 2>&1
if errorlevel 1 (
    echo [信息] 正在安装 PyQt5...
    pip install PyQt5
)

python -c "import winpty" >nul 2>&1
if errorlevel 1 (
    echo [信息] 正在安装 pywinpty...
    pip install pywinpty
)

cd /d "%~dp0"

REM 启动管理器
start "" pythonw multi_cc_manager.py
