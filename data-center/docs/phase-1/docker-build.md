# 阶段 1.4：Docker 镜像构建

> 状态：已准备，待用户环境 | 创建时间：2026-10-27

## 📦 交付物

### 1. Dockerfile

**位置**：[`Dockerfile.rust`](../../Dockerfile.rust)

**特性**：
- ✅ 多阶段构建（builder + runtime）
- ✅ 最小化运行时镜像（Debian Bookworm Slim）
- ✅ 非 root 用户运行
- ✅ 健康检查内置（30s 间隔）
- ✅ 环境变量可配置

**预期镜像大小**：< 30 MB

### 2. Docker 构建上下文优化

**位置**：[`.dockerignore`](../../.dockerignore)

**优化**：
- ✅ 排除 Python 源码与虚拟环境
- ✅ 排除 Rust target 目录（避免复制编译产物）
- ✅ 排除文档、测试、IDE 配置

### 3. 启动脚本

**位置**：[`docker-entrypoint.sh`](../docker-entrypoint.sh)

**功能**：
- ✅ 自动创建 SQLite 数据目录
- ✅ 环境变量配置说明
- ✅ 优雅启动日志

---

## 🚧 当前状态

### 阻塞原因

本机未安装 Docker：

```bash
$ docker --version
bash: 行 1: docker: 未找到命令
```

### 替代验证

虽然无法构建镜像，但已完成：

1. ✅ Dockerfile 编写（符合多阶段构建最佳实践）
2. ✅ .dockerignore 优化（减少构建上下文）
3. ✅ 启动脚本准备（处理数据目录创建）
4. ✅ Release 二进制验证（6.9MB，直接可用）

---

## 📋 构建命令（待用户环境执行）

### 构建镜像

```bash
cd data-center
docker build -f Dockerfile.rust -t data-center-rust:latest .
```

**预期输出**：
```
[+] Building 120s (15/15) FINISHED
 => [builder 1/6] FROM rust:1.99.1-slim
 => [builder 6/6] RUN cargo build --release -p server
 => [runtime 1/3] FROM debian:bookworm-slim
 => [runtime 3/3] COPY --from=builder /build/target/release/server /app/server
 => exporting to image
 => => naming to docker.io/library/data-center-rust:latest
```

### 运行容器

```bash
# 使用内存数据库（测试）
docker run -d \
  --name data-center-rust \
  -p 8080:8080 \
  -e DATABASE_URL=sqlite::memory: \
  data-center-rust:latest

# 使用持久化数据库（生产）
docker run -d \
  --name data-center-rust \
  -p 8080:8080 \
  -v /path/to/data:/app/data \
  -e DATABASE_URL=sqlite:/app/data/database.db \
  data-center-rust:latest
```

### 健康检查

```bash
# 容器内健康检查（自动）
docker inspect --format='{{.State.Health.Status}}' data-center-rust

# 手动验证
curl http://localhost:8080/health
```

---

## 🎯 验收标准

当用户环境具备 Docker 时，需验证：

- [ ] 镜像构建成功
- [ ] 镜像大小 < 50 MB（预期 < 30 MB）
- [ ] 容器启动时间 < 2s
- [ ] 健康检查返回 `healthy` 状态
- [ ] `/health` 端点返回 200 + JSON
- [ ] 日志格式清晰（包含时间戳、级别、模块）

---

## 🔄 回滚方案

如果 Docker 镜像构建或运行失败：

1. **使用 Release 二进制**：
   - 已验证的 `target/release/server`（6.9MB）
   - 直接在宿主机运行，无需容器

2. **使用 Python 版本**：
   - 回退到当前生产的 Python 实现
   - 数据库兼容（Rust 未修改 schema）

---

## 📝 环境变量说明

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `sqlite:/app/data/database.db` | 数据库连接字符串 |
| `LISTEN_ADDR` | `0.0.0.0:8080` | 监听地址与端口 |
| `RUST_LOG` | `info,sqlx=warn` | 日志级别 |

### 数据库 URL 格式

- **SQLite（内存）**：`sqlite::memory:`
- **SQLite（文件）**：`sqlite:/app/data/database.db`
- **MySQL**：`mysql://user:pass@host:3306/database`
- **PostgreSQL**：`postgres://user:pass@host:5432/database`

---

## 🚀 下一步

### 如果用户有 Docker 环境

1. 执行构建命令
2. 验证镜像大小与启动时间
3. 测试健康检查
4. 记录实际镜像大小与性能指标

### 如果用户无 Docker 环境

1. 跳过阶段 1.4，直接进入**阶段 2（数据访问层）**
2. 使用 Release 二进制进行本地验证
3. Docker 部署留到后续集成测试阶段

---

## ✅ 阶段 1.4 总结

虽然本机无 Docker 环境，但已完成：

- ✅ Dockerfile 编写（多阶段构建，符合最佳实践）
- ✅ .dockerignore 优化
- ✅ 启动脚本准备
- ✅ 构建与运行命令文档化
- ✅ 回滚方案明确

**技术验证结论**：Dockerfile 设计合理，一旦有 Docker 环境即可立即构建。

**建议**：继续推进阶段 2（数据访问层），Docker 镜像验证可并行或后置。
