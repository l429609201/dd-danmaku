# DanDanPlay API 数据交互中心

基于 FastAPI + Vue3 + Telegram Bot 的弹幕API代理系统数据管理和监控中心。

## 🌟 主要特性

- **🤖 Telegram机器人管理** - 轮询模式，无需公网地址
- **📊 实时数据监控** - 系统状态、请求统计、性能指标
- **⚙️ 配置管理** - UA限制、IP黑名单、Worker配置
- **🔄 自动同步** - 定时同步配置到Worker节点
- **📝 日志管理** - 系统日志、同步日志、机器人日志
- **🌐 现代化Web界面** - Vue3 + Element Plus

## 🏗️ 技术架构

### 后端技术栈
- **FastAPI** - 现代异步Web框架
- **SQLAlchemy** - ORM数据库操作
- **python-telegram-bot** - Telegram机器人SDK（轮询模式）
- **APScheduler** - 定时任务调度
- **httpx** - 异步HTTP客户端

### 前端技术栈
- **Vue 3** - 渐进式JavaScript框架
- **Element Plus** - Vue3组件库
- **Vite** - 现代化构建工具
- **Pinia** - Vue状态管理
- **ECharts** - 数据可视化

### 数据库
- **SQLite** - 默认数据库（生产可切换PostgreSQL）

## 🚀 快速开始

### 环境要求
- Python 3.11+
- Node.js 18+
- Docker & Docker Compose（推荐）

### Docker部署（推荐）

1. **克隆项目**
```bash
git clone <repository-url>
cd data-center
```

2. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入实际配置
```

3. **启动服务**
```bash
docker-compose -f docker/docker-compose.yml up -d
```

4. **访问服务**
- Web界面: http://localhost:7759
- API文档: http://localhost:7759/docs

### 本地开发

1. **后端开发**
```bash
# 安装Python依赖
pip install -r requirements/base.txt

# 启动后端服务
cd src && python -m uvicorn main:app --reload --host 0.0.0.0 --port 7759
```

2. **前端开发**
```bash
# 安装前端依赖
cd web && npm install

# 启动前端开发服务器
npm run dev
```

## ⚙️ 配置说明

### 环境变量配置

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `TG_BOT_TOKEN` | Telegram机器人Token | `123456:ABC-DEF...` |
| `TG_ADMIN_USER_ID` | 管理员用户ID | `123456789` |
| `WORKER_ENDPOINTS` | Worker端点列表 | `https://worker1.com,https://worker2.com` |
| `DATABASE_URL` | 数据库连接URL | `sqlite:///./data/database.db` |
| `SYNC_INTERVAL_HOURS` | 同步间隔（小时） | `1` |

### Telegram机器人配置

1. **创建机器人**
   - 联系 @BotFather 创建新机器人
   - 获取机器人Token

2. **获取用户ID**
   - 联系 @userinfobot 获取你的用户ID

3. **配置轮询模式**
   - 无需设置Webhook
   - 机器人自动轮询获取消息
   - 支持Docker容器内运行

## 🔧 功能模块

### 1. 系统监控
- 实时系统状态
- 请求统计分析
- 性能指标监控
- Worker健康检查

### 2. 配置管理
- UA配置增删改查
- IP黑名单管理
- 路径特定限制
- 配置导出导入

### 3. 同步管理
- 自动配置同步
- 手动推送配置
- 统计数据拉取
- 同步状态监控

### 4. 日志管理
- 系统日志查询
- Telegram操作日志
- 同步日志记录
- 日志导出功能

### 5. Telegram机器人
- 系统状态查询
- 配置管理操作
- 实时通知推送
- 内联键盘交互

## 📊 API接口

### 配置管理
- `GET /api/v1/config/ua` - 获取UA配置
- `POST /api/v1/config/ua` - 创建UA配置
- `PUT /api/v1/config/ua/{name}` - 更新UA配置
- `DELETE /api/v1/config/ua/{name}` - 删除UA配置

### 统计数据
- `GET /api/v1/stats/overview` - 系统概览
- `GET /api/v1/stats/performance` - 性能指标
- `GET /api/v1/stats/requests` - 请求统计
- `POST /api/v1/stats/worker` - 记录Worker统计

### 同步管理
- `POST /api/v1/sync/push-config` - 推送配置
- `POST /api/v1/sync/pull-stats` - 拉取统计
- `GET /api/v1/sync/worker-health` - Worker健康状态

## 🔄 与Worker通信

### 配置推送
```json
POST /api/config/update
{
  "ua_configs": {...},
  "ip_blacklist": {...},
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### 统计拉取
```json
GET /api/stats/export
{
  "request_stats": {...},
  "violation_stats": {...},
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## 🛠️ 开发指南

### 项目结构
```
data-center/
├── src/                    # 后端代码
│   ├── main.py            # 应用入口
│   ├── config.py          # 配置管理
│   ├── models/            # 数据模型
│   ├── services/          # 业务逻辑
│   ├── api/               # API路由
│   ├── telegram/          # TG机器人
│   └── tasks/             # 定时任务
├── web/                   # 前端代码
│   ├── src/
│   │   ├── views/         # 页面组件
│   │   ├── components/    # 通用组件
│   │   ├── api/           # API调用
│   │   └── stores/        # 状态管理
│   └── package.json
├── docker/                # Docker配置
├── requirements/          # Python依赖
└── data/                  # 数据存储
```

### 添加新功能
1. 在 `src/models/` 添加数据模型
2. 在 `src/services/` 添加业务逻辑
3. 在 `src/api/v1/endpoints/` 添加API端点
4. 在 `web/src/` 添加前端界面
5. 更新路由和导航

## 📝 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

如有问题，请通过以下方式联系：
- 提交 GitHub Issue
- 通过Telegram机器人反馈
