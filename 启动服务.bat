@echo off
chcp 65001 >nul
echo.
echo ====================================
echo     基金估值查询系统 - 启动向导
echo ====================================
echo.

REM 检查 Python 是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.8+
    echo 下载地址：https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/4] 正在检查 Python 依赖...
pip show flask >nul 2>&1
if errorlevel 1 (
    echo [2/4] 正在安装 Python 依赖（首次使用可能需要几分钟）...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
) else (
    echo [2/4] Python 依赖已安装
)

echo [3/4] 正在启动 Python API 服务...
start "基金估值 API 服务" cmd /k "python fund_api.py"
timeout /t 3 /nobreak >nul

echo [4/4] 正在打开网页...
start http://localhost:8080

echo.
echo ====================================
echo   ✨ 系统已启动
echo   🐍 Python API: http://localhost:5000
echo   🌐 访问页面：http://localhost:8080
echo   ❌ 关闭窗口可停止服务
echo ====================================
echo.
pause
