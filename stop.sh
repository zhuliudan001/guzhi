#!/bin/bash
cd "$(dirname "$0")"

PIDFILE="run/gunicorn.pid"
if [ ! -f "$PIDFILE" ]; then
    echo "未找到 pid 文件，服务可能未启动"
    exit 0
fi

PID=$(cat "$PIDFILE")
if ! kill -0 "$PID" 2>/dev/null; then
    echo "进程 $PID 不存在，清理 pid 文件"
    rm -f "$PIDFILE"
    exit 0
fi

kill "$PID"
for _ in $(seq 1 20); do
    if ! kill -0 "$PID" 2>/dev/null; then
        break
    fi
    sleep 0.5
done

if kill -0 "$PID" 2>/dev/null; then
    echo "进程未在 10 秒内退出，请手动检查 PID $PID"
    exit 1
fi

rm -f "$PIDFILE"
echo "服务已停止"
