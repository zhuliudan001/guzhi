# Agent 指南 - 基金估值查询系统

## 项目概述

基金实时估值查询系统：Flask 后端统一抓取东方财富 / 天天基金数据，纯 HTML + 原生 JS 前端。生产环境可部署在独立域名或二级目录（如 `/guzhi`）。

## 快速启动

```bash
# Windows 一键启动（推荐）
启动服务.bat

# 或手动启动
python fund_api.py                    # 后端 :5000
python -m http.server 8090 --bind 127.0.0.1   # 前端 http://localhost:8090
```

`启动服务.bat` 会自动检查依赖、选择 8090-8099 中可用的页面端口，并打开浏览器。8080 被其他项目占用时无需手动处理。

## 生产部署

```bash
# 服务器路径：/www/wwwroot/guzhi/
pip install -r requirements.txt
pip install gunicorn
./start.sh        # 启动（自动创建 run/ 并写入 pid）
./stop.sh         # 停止（仅停止 pid 文件对应的进程）
./restart.sh      # 重启
```

Gunicorn 使用 `gthread`（2 workers × 8 threads），监听 `127.0.0.1:5000`。Nginx 负责静态文件与反向代理，详见 `部署指南.md`。

## 架构要点

- **后端**：`fund_api.py` — Flask 应用，所有上游请求由服务端发起，带重试、超时、TTL 缓存和错误映射。
- **前端**：`index.html` + `app.js` + `app-utils.js` + `style.css`，原生 JS SPA，无构建步骤。
- **共享逻辑**：`app-utils.js` 以 UMD 方式导出收益计算、汇总、格式化、转义和备份校验/合并函数，供浏览器和 Node 测试共用。
- **API 地址**：`app.js` 自动解析——本地 `localhost` / `file://` 使用 `http://localhost:5000/api`；路径以 `/guzhi` 开头时使用 `/guzhi/api`；其余使用同源 `/api`。不需要手动改代码。
- **路由前缀**：所有 API 同时支持 `/api/` 和 `/guzhi/api/` 两种路径。
- **数据流**：搜索先取基础数据，再异步加载详情；自选列表使用批量快速估值接口，缺失估值时降级到最新披露净值。

## API 一览

| 路径 | 说明 |
|------|------|
| `GET /api/fund/<code>` | 基金基础数据（估值或最新净值） |
| `GET /api/fund/<code>/detail` | 详情（重仓股、板块、走势、资产配置、经理） |
| `POST /api/funds/batch` | 批量基础数据，最多 20 只 |
| `POST /api/funds/fast` | 批量快速估值，最多 50 只 |
| `GET /api/trading-status` | A 股交易状态与下次开盘时间 |
| `GET /api/health` | 健康检查 |

## 数据来源

| 数据类型 | 来源 | 说明 |
|----------|------|------|
| 盘中估值（批量） | `fundcomapi.tiantianfunds.com` | 服务端 `/api/funds/fast` |
| 历史净值 | `api.fund.eastmoney.com` | 服务端 `/api/fund/<code>` |
| 基金搜索 | `fundsuggest.eastmoney.com` | 仅接受代码精确匹配且含基金基础信息的条目 |
| 详情数据 | `fund.eastmoney.com` / `fundf10` / `push2` | 重仓股、阶段收益、关联板块、净值走势 |

## 关键约定

- **颜色语义**：红涨绿跌（中国股市习惯），见 CSS 中 `.positive` / `.negative`。
- **估算语义**：`gsz` 表示“当前参考净值”（有盘中估值时用估值，否则用最新净值）；`gszzl` 仅在有估值时展示，否则前端显示 `--`；`jzzzl` 为最新净值日涨跌。
- **并发控制**：批量基础数据最多 5 线程，避免被上游限流。
- **超时设置**：后端单次请求 10 秒；前端基础/批量 15 秒，详情 30 秒。
- **错误映射**：基金不存在 → 404；上游不可用 → 502；未知异常 → 通用 500，不泄露内部细节。
- **缓存**：元信息 6 小时、净值 5 分钟、估值 60 秒（失败缓存 15 秒）、详情 5 分钟。
- **CORS**：允许生产域名 `https://guzhi.itect.me` 和任意 `localhost` / `127.0.0.1` 端口；更换生产域名时需更新 `ALLOWED_ORIGINS`。
- **交易状态**：按上海时区和内置 A 股节假日表判断；休市时自动刷新间隔为 5 分钟，交易中为 1 分钟。

## 数据备份

- 入口：自选基金卡片头部的“数据”按钮，空状态中的“从备份恢复”。备份完全在浏览器本地完成，不上传服务器。
- 备份格式：`{ app: "guzhi", version: 1, exportedAt, data: { favorites, searchHistory, autoRefreshEnabled } }`，导出文件名 `guzhi-backup-YYYY-MM-DD.json`。
- 校验：仅接受 `app === "guzhi"` 且 `version === 1`；基金代码必须为 6 位数字，名称非空且不超过 100 字符，持仓为非负数；最多 200 只自选、10 条搜索记录；文件最大 1MB。无效记录忽略并在预览中计数，不会中断整份导入。
- 去重：自选同一代码以最后一条为准，搜索历史以第一条为准。
- 合并导入：保留本机自选顺序，同代码用备份中的名称和持仓覆盖，备份独有的基金追加到末尾；保留本机自动刷新设置。
- 覆盖导入：用备份替换自选和搜索历史，并采用备份中的自动刷新设置。
- 导入后必须调用 `renderFavorites(true)` 强制重建列表，否则已有行时新导入的基金不会出现在 DOM 中。
- 备份文件包含持仓金额，属于隐私数据；导出后由用户自行保管。

## 文件结构

```
fund_api.py        # Flask 后端
index.html         # 前端页面
app.js             # 前端逻辑
app-utils.js       # 共享工具（UMD）
style.css          # 样式
tests/             # Python unittest + Node 测试
requirements.txt   # Python 依赖
gunicorn.conf.py   # Gunicorn 配置
start.sh / stop.sh / restart.sh
启动服务.bat        # Windows 一键启动
```

## 测试

```bash
python -m unittest discover -s tests          # 后端
node --test tests/app-utils.test.js           # 前端共享逻辑
```

## 注意事项

- 自选基金、持仓金额和搜索历史保存在浏览器 localStorage（`fundFavorites` / `searchHistory` / `autoRefreshEnabled`）。
- 换设备或清理浏览器前，先通过“数据 → 导出备份”保存 JSON 文件；备份包含持仓金额，请勿公开分享。
- 所有动态内容在插入 HTML 前必须经过 `escapeHtml` / `escapeAttr`。
- 盘中估值是参考值，实际净值以基金公司公布为准；没有估值的基金不展示伪造的收益。
- `guzhi` 压缩包为本地备份，已被 `.gitignore` 忽略，不要提交或删除。
