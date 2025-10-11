# Docker 部署指南

## 快速开始

### 1. 启动服务

```bash
cd data-center/docker
docker-compose up -d
```

### 2. 查看日志

```bash
docker-compose logs -f
```

### 3. 停止服务

```bash
docker-compose down
```

---

## 密码管理

### 忘记密码？重置密码

如果忘记了管理员密码，可以使用以下方法重置：

#### 方法1：使用重置脚本（推荐）

```bash
cd data-center/docker

# 添加执行权限
chmod +x reset-password.sh

# 重置密码（自动生成随机密码）
./reset-password.sh admin

# 重置密码（指定新密码）
./reset-password.sh admin MyNewPass123
```

**输出示例：**
```
🔄 正在重置密码...

🔑 生成随机密码: Xy9#mK2@pL4!
✅ 密码重置成功！

用户名: admin
新密码: Xy9#mK2@pL4!

请妥善保存密码，建议登录后立即修改。

✅ 密码重置完成！
```

#### 方法2：进入容器手动重置

```bash
# 进入容器
docker exec -it danmu-data-center sh

# 重置密码（自动生成随机密码）
python -m src.utils.reset_password admin

# 重置密码（指定新密码）
python -m src.utils.reset_password admin MyNewPass123

# 退出容器
exit
```

---

## 配置说明

### 环境变量

在 `docker-compose.yml` 中可以配置以下环境变量：

#### 基础配置
- `DATABASE_TYPE`: 数据库类型（sqlite/mysql/postgresql）
- `SQLITE_PATH`: SQLite数据库文件路径
- `CONFIG_PATH`: 配置文件目录
- `LOG_LEVEL`: 日志级别（DEBUG/INFO/WARNING/ERROR）
- `LOG_FILE`: 日志文件路径

#### 服务配置
- `HOST`: 监听地址（默认：0.0.0.0）
- `PORT`: 监听端口（默认：7759）

#### 管理员配置
- `ADMIN_USERNAME`: 管理员用户名（默认：admin）

### 数据持久化

配置和数据存储在 `./config` 目录：
- `database.db`: SQLite数据库文件
- `logs/`: 日志文件目录
- `backups/`: 备份文件目录

---

## 常见问题

### Q: 如何查看容器状态？

```bash
docker ps | grep danmu-data-center
```

### Q: 如何重启服务？

```bash
docker-compose restart
```

### Q: 如何更新镜像？

```bash
docker-compose pull
docker-compose up -d
```

### Q: 如何备份数据？

```bash
# 备份config目录
cp -r ./config ./config.backup.$(date +%Y%m%d)
```

### Q: 如何恢复数据？

```bash
# 停止服务
docker-compose down

# 恢复config目录
cp -r ./config.backup.YYYYMMDD ./config

# 启动服务
docker-compose up -d
```

---

## 安全建议

1. **修改默认密码**
   - 首次登录后立即修改管理员密码
   - 使用强密码（至少8位，包含大小写字母、数字和特殊字符）

2. **定期备份**
   - 定期备份 `./config` 目录
   - 建议每天自动备份

3. **限制访问**
   - 使用防火墙限制访问端口
   - 仅允许信任的IP访问

4. **更新维护**
   - 定期更新Docker镜像
   - 关注安全公告

---

## 技术支持

如有问题，请查看：
- 项目文档：`../README.md`
- 日志文件：`./config/logs/app.log`
- GitHub Issues

---

## 许可证

本项目采用 MIT 许可证

