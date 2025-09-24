# Telegram机器人管理设置指南

## 🤖 创建TG机器人

### 1. 创建机器人
1. 在Telegram中找到 @BotFather
2. 发送 `/newbot` 命令
3. 按提示设置机器人名称和用户名
4. 获得机器人Token（格式：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）

### 2. 获取用户ID
1. 在Telegram中找到 @Get_id_bot
2. 发送/my_id消息获取你的用户ID（纯数字）

## ⚙️ 配置环境变量

在Cloudflare Dashboard中设置以下环境变量：

```bash
# 机器人Token（必需）
TG_BOT_TOKEN = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"

# 管理员用户ID（必需，支持多个用户，用逗号分隔）
TG_ADMIN_USER_ID = "123456789,987654321"
```

## 🔗 设置Webhook

部署Worker后，设置TG机器人的webhook：

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-worker-domain.workers.dev/telegram-webhook"}'
```

## 📱 机器人命令

### 基础命令
- `/start` - 开始使用机器人
- `/help` - 查看帮助信息
- `/status` - 查看系统状态

### IP黑名单管理
- `/blacklist list` - 查看当前黑名单
- `/blacklist add <IP>` - 添加IP到黑名单
- `/blacklist remove <IP>` - 从黑名单移除IP

### UA配置管理
- `/ua list` - 查看所有UA配置
- `/ua enable <name>` - 启用指定UA配置
- `/ua disable <name>` - 禁用指定UA配置

## 🔒 安全说明

1. **Token保护**：机器人Token是敏感信息，只能在Cloudflare Dashboard中设置
2. **用户验证**：只有配置的管理员用户ID才能使用管理命令
3. **配置更新**：通过机器人修改的配置需要重新部署才能生效

## 📊 功能特性

- ✅ 实时查看系统状态
- ✅ 远程管理IP黑名单
- ✅ 远程管理UA配置
- ✅ 安全的用户身份验证
- ✅ 友好的中文界面

## 🚀 使用示例

```
用户: /status
机器人: 📊 系统状态报告

🚫 IP黑名单: 5 条规则
👤 UA配置: 3 个配置
📈 内存缓存: 42 个待同步请求
🔄 AppSecret当前使用: Secret1
📅 最后同步时间: 2024-09-24 20:30:15
```

## ⚠️ 注意事项

1. 机器人配置修改后需要重新部署Worker
2. 环境变量修改需要在Cloudflare Dashboard中进行
3. 建议定期检查机器人的webhook状态
4. 保护好机器人Token，避免泄露
