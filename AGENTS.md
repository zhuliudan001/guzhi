# Agent 指南 - 基金估值查询系统

## 项目概述

基金实时估值查询系统，Python Flask 后端 + 纯 HTML 前端，部署在宝塔面板二级目录 `/guzhi`。

## 快速启动

```bash
# Windows 一键启动（推荐）
启动服务.bat

# 或手动启动
python fund_api.py          # 后端 :5000
python -m http.server 8080  # 前端（仅本地调试）
```

## 生产部署

```bash
# 服务器路径：/www/wwwroot/guzhi/
pip install -r requirements.txt
pip install gunicorn
gunicorn -c gunicorn.conf.py fund_api:app -D  # 启动
./stop.sh   # 停止
./restart.sh # 重启
```

## 架构要点

- **后端**：`fund_api.py` — Flask 应用，调用东方财富基金 API（净值接口 + 搜索接口）
- **前端**：`index.html` — 单文件 SPA，Tailwind + Axios + Font Awesome
- **实时估值**：前端直接通过 JSONP 请求 `fundgz.1234567.com.cn` 获取实时估值
- **API 地址**：生产环境固定为 `https://guzhi.itect.me/api`，本地调试需改为 `http://localhost:5000/api`
- **路由前缀**：所有 API 同时支持 `/api/` 和 `/guzhi/api/` 两种路径

## 数据来源

| 数据类型 | 来源 | 说明 |
|----------|------|------|
| 实时估值 | `fundgz.1234567.com.cn` | 前端 JSONP 直接请求 |
| 历史净值 | `api.fund.eastmoney.com` | 后端 API 请求 |
| 基金搜索 | `fundsuggest.eastmoney.com` | 后端 API 请求 |

## 关键约定

- **颜色语义**：红涨绿跌（中国股市习惯），见 CSS 中 `.positive` / `.negative`
- **并发控制**：批量请求限制最多 5 线程，避免被天天基金封禁
- **敏感信息过滤**：错误信息中包含 URL 等关键词时自动脱敏
- **超时设置**：单次请求 10 秒，前端 Axios 30 秒

## 文件结构

```
fund_api.py        # Flask 后端
index.html         # 前端页面
requirements.txt   # Python 依赖
gunicorn.conf.py   # Gunicorn 配置
start.sh           # 启动脚本
stop.sh            # 停止脚本
restart.sh         # 重启脚本
启动服务.bat        # Windows 一键启动
```

## 注意事项

- 前端通过 localStorage 存储自选基金和搜索历史
- 实时估值依赖浏览器直接请求天天基金接口，服务器 IP 可能被限制
- 如果实时估值获取失败，会自动降级使用历史净值
