# Gunicorn 配置文件
bind = "127.0.0.1:5000"

# gthread 适合以网络 I/O 为主的抓取型服务
workers = 2
threads = 8
worker_class = "gthread"

# 上游抓取较慢时留出余量
timeout = 60
graceful_timeout = 30
keepalive = 5

pidfile = "run/gunicorn.pid"

accesslog = "-"
errorlog = "-"
loglevel = "info"

proc_name = "fund_api"
preload_app = True
