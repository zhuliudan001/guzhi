# Gunicorn 配置文件
# 绑定地址
bind = "127.0.0.1:5000"

# worker 进程数（建议 CPU 核心数 * 2 + 1）
workers = 2

# worker 模式
worker_class = "sync"

# 超时时间
timeout = 30

# 日志
accesslog = "-"
errorlog = "-"
loglevel = "info"

# 进程名
proc_name = "fund_api"

# 预加载应用
preload_app = True
