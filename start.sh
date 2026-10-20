#!/bin/bash
set -e
cd "$(dirname "$0")"

PIDFILE="run/gunicorn.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "服务已在运行（PID $(cat "$PIDFILE")）"
    exit 0
fi

mkdir -p run
gunicorn -c gunicorn.conf.py fund_api:app -D
sleep 1
echo "服务已启动（PID $(cat "$PIDFILE")）"
