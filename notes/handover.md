# 交接文档：媒体元数据清洗 / 别名匹配

> 面向接手本任务的 AI 助手。读完本文可直接继续工作，无需回溯对话。
> 最后更新：2026-08-04

---

## 0. 最紧急的事（先做这个）

**生产环境正在持续丢数据，有 4 个已修但未部署的补丁。**

| # | 问题 | 影响 | 涉及文件 |
|---|---|---|---|
| 1 | MySQL collation 冲突导致实体索引整事务回滚 | **每分钟丢 anime/episode 实体 + media_library** | `services_v2/media_meta_service.py` |
| 2 | 回填任务 `No module named 'scripts'` | 存量 4846 条 bangumi 从未提取过 | `services_v2/alias_supplement_service.py`、`src/main.py` |
| 3 | 别名校验页容器类用错 | 布局贴边，无页面留白 | `web/src/views/AliasReview.vue` |
| 4 | geoip `DetachedInstanceError` | 仪表盘 IP 地图接口 500 | `services_v2/geoip_service.py` |

代码都已改完并通过语法/导入校验，**只差用户重新部署**。第 1 项优先级最高。

部署后应观察：
- 启动日志出现 `🚀 首次启动：回填存量媒体外部ID与别名...`
- `❌ 实体索引失败` 应彻底消失
- `app_settings` 出现 `media_meta_backfill_done=true`

---

## 1. 环境与工具约束（踩过的坑）

**工作区**：`d:\桌面\dd-danmaku\dd-danmaku`，Windows + PowerShell。

**本地无数据库凭据**（实例为远程），所以：
- 所有 DB 写入路径只能做语法 + 导入链校验，无法实跑
- 表由 `init_db()` 的 `create_all` 在服务启动时自动创建
- 查生产数据只能通过 MCP `dd-danmaku-control`（**只读** SQL，密钥字段自动脱敏）

**工具可用性**：
- `zhi`（方案确认工具）**连续两次 10 分钟超时**，不可靠。用文字确认代替，并向用户说明。
- `str-replace-editor` 偶发拒绝自身参数（`Empty required parameter` / `Invalid parameter`）→ 回退用 `applyPatch`
- PowerShell 没有 `rg`、`head`；多行 `python -c "..."` 会失败（需写临时脚本再删）
- 控制台 GBK 编码，日志里的 emoji 会报 `UnicodeEncodeError`，**不是代码错误**
- 前端 `npm run build` 的正常输出会被 PowerShell 当 stderr 显示，看到 `NativeCommandError` 先确认是否真有 error

**MCP 可用能力**：`logs_app`（本地端日志）、`db_query`（只读 SQL）、`db_tables`、`diag_*`、`cache_search`、`logs_worker` 等。

---

## 2. 项目架构速览

```
worker/cf_worker.js          Cloudflare Worker（3600+ 行），边缘代理 + 内存/R2 缓存
data-center/src/             FastAPI 本地端
  ├─ models_v2/              ORM（全部新表都在这里注册）
  ├─ services_v2/            业务服务
  ├─ api/v2/endpoints/       路由
  └─ main.py                 lifespan 里启停各后台任务
data-center/web/             Vue 3 + Element Plus 后台
docs/媒体元数据清洗方案.md    本任务的完整方案 + 实施记录（~1000 行，必读）
```

**Worker ↔ 本地端**：通过 ControlHub Durable Object 的 WebSocket 做 RPC，消息类型有
`cache.get` / `cache.upsert` / `stats.report` / `metrics.report` 等。

**缓存存储**：响应体默认在 Redis（`storage_mode=redis`），SQL 的 `response_body` 为 NULL，
只存 `redis_key` / `body_size` / `hit_count` 等元数据。**读不到响应体时别去查 SQL，
要么读 Redis，要么走 `api_response_entities.cache_key` 关联。**

---

## 3. 本任务已完成的工作

完整设计与逐阶段实施记录见 `docs/媒体元数据清洗方案.md`（§1-§12）。这里只列结果。

### 起因

客户端搜索词与 dandanplay 官方标题写法不一致，导致大量搜索返回空：

| 客户端发的词 | 命中次数 | dandanplay 实际标题 |
|---|---|---|
| `无职转生 第三季 ～到了异世界就拿出真本事～` | 7638 | `无职转生Ⅲ ～到了异世界就拿出真本事～` |
| `无职转生 第二季 ～…～` | 623 | `无职转生Ⅱ ～…～` |
| `航海王 埃鲁巴夫篇` | 511 | `航海王` |

**关键发现：外部 ID 和别名数据本来就在库里**。`api_response_entities` 里
`entity_type='bangumi'` 的 `raw_json` 含：
- `onlineDatabases[]` — 9 个平台的完整 URL（覆盖率 99.6%），正则即可提取 ID
- `titles[]` — 多语言标题/别名（覆盖率 100%，共 25566 条）

所以第一阶段完全不需要调外部 API。

### 新增的两张表

```
media_external_ids   anime_id + provider（唯一）→ external_id / external_url / source / confidence
media_alias          alias_norm + anime_id（唯一）→ alias / lang / title_type
                     / source / status / confidence / hit_snapshot / verified_by
                     / ai_suggestion / ai_called_at
```

`provider` 与 `source` 都是自由文本不做 Enum，新增平台/来源只写数据不改代码。

`media_alias.source` 取值与默认状态：

| source | 含义 | status | confidence |
|---|---|---|---|
| `dandanplay_titles` | 上游 `titles[]` 官方别名 | approved | 95 |
| `cache_extract_1` | 搜索词精确命中 1 部番 | approved | 85 |
| `cache_extract_n` | 搜索词命中 2-5 部番 | pending | 60 |
| `auto_match` | 算法季号对齐推断 | pending | 算法算 |
| `tmdb` / `bgm` | 外部源补充 | pending | 70 |
| `manual` | 人工填写 | approved | 100 |

**只有 `approved` 参与线上解析。**

### 新增/改动的文件

| 文件 | 作用 |
|---|---|
| `services_v2/media_meta_service.py` | 核心：提取、归一化、季号对齐、候选生成、线上解析、后台读写 |
| `services_v2/alias_supplement_service.py` | 周期任务 + 存量一次性回填 |
| `services_v2/alias_ai_service.py` | AI 打分（OpenAI 兼容接口） |
| `services_v2/alias_external_service.py` | TMDB / Bangumi.tv 补充 |
| `services_v2/entity_service.py` | 挂钩：bangumi 提取外部ID+别名、search 提取搜索词别名 |
| `services_v2/control_client.py` | `_handle_cache_get` 未命中时顺带别名解析 |
| `api/v2/endpoints/media.py` | 全部路由 |
| `web/src/views/AliasReview.vue` | 别名校验页 |
| `worker/cf_worker.js` | 别名命中时改写搜索词回源 |

### 路由清单（顺序有强制要求）

```
GET    /media/library
POST   /media/rebuild
GET    /media/alias/pending          # 待校验列表
POST   /media/alias/generate         # 扫空结果词生成候选
POST   /media/alias/ai-score         # AI 打分
POST   /media/alias/external         # 外部源补充
GET    /media/meta/{anime_id}        # 某番剧的外部ID + 别名
PUT    /media/meta/{anime_id}/external-id
DELETE /media/meta/external-id/{row_id}
PUT    /media/meta/{anime_id}/alias
PUT    /media/meta/alias/{row_id}/review
DELETE /media/meta/alias/{row_id}
GET    /media/{anime_id}             # 必须放最后！
```

**`/{anime_id}` 是通配路由，必须声明在所有 `/alias/*`、`/meta/*` 之后**，
否则 FastAPI 按注册顺序会把 `/media/alias/pending` 当成 `anime_id="alias"`。
