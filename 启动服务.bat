@echo off
chcp 65001 >nul
setlocal
set "APP_DIR=%~dp0"

echo.
echo ====================================
echo     基金估值查询系统 - 启动向导
echo ====================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.8+
    echo 下载地址：https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/4] 正在检查 Python 依赖...
python -c "import flask, requests" >nul 2>&1
if errorlevel 1 (
    echo [2/4] 正在安装 Python 依赖（首次使用可能需要几分钟）...
    python -m pip install -r "%APP_DIR%requirements.txt"
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
) else (
    echo [2/4] Python 依赖已安装
)

netstat -ano | findstr /R /C:":5000 .*LISTENING" >nul
if not errorlevel 1 (
    echo [错误] 端口 5000 已被占用，请关闭占用程序后重试
    echo        如果本系统已经在运行，直接访问 http://localhost:8090 即可
    pause
    exit /b 1
)

set "PORT=8090"
:find_port
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 goto start_servers
set /a PORT+=1
if %PORT% gtr 8099 goto no_port
goto find_port

:no_port
echo [错误] 8090-8099 端口均被占用，请释放端口后重试
pause
exit /b 1

:start_servers
echo [3/4] 正在启动 API 与静态页面服务（页面端口 %PORT%）...
start "基金估值 API 服务" /D "%APP_DIR%" cmd /k "python fund_api.py"
start "基金估值 静态服务" /D "%APP_DIR%" cmd /k "python -m http.server %PORT% --bind 127.0.0.1"
timeout /t 3 /nobreak >nul

echo [4/4] 正在打开网页...
start "" http://localhost:%PORT%

echo.
echo ====================================
echo   系统已启动
echo   API:  http://localhost:5000
echo   页面: http://localhost:%PORT%
echo   关闭两个服务窗口即可停止
echo ====================================
echo.
pause
