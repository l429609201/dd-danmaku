# GitHub Actions 自动构建配置

本项目使用 GitHub Actions 自动构建和推送 Docker 镜像。

---

## 🎯 工作流概览

### 1. Python 后端构建 (`build-python.yml`)

**触发条件：**
- ✅ 推送到 `main` 分支 → 构建 `latest-python`
- ✅ 推送到 `develop` 分支 → 构建 `test-python`
- ✅ 修改以下路径时自动构建：
  - `python/**` - Python 源码
  - `web/src/**` - 前端源码
  - `web/public/**` - 静态资源
  - `web/package.json` - 依赖配置
  - `docker/Dockerfile` - 镜像配置
- ✅ PR 到 `main` 或 `develop`（仅构建不推送）
- ✅ 手动触发（可指定自定义标签）

**不会触发：**
- ❌ 文档更新（`*.md`）
- ❌ 配置文件（`.gitignore`）
- ❌ 依赖锁（`package-lock.json`）

**构建镜像：**
```
l429609201/dd-danmaku:latest-python   # main 分支
l429609201/dd-danmaku:test-python     # develop 分支
l429609201/dd-danmaku:v1.0.0-python   # 手动指定
```

### 2. Rust 后端构建 (`build-rust.yml`)

**触发条件：**
- ✅ 推送到 `main` 分支 → 构建 `latest-rust`
- ✅ 推送到 `develop` 分支 → 构建 `test-rust`
- ✅ 修改以下路径时自动构建：
  - `rust/**` - Rust 源码
  - `web/src/**` - 前端源码
  - `web/public/**` - 静态资源
  - `web/package.json` - 依赖配置
  - `docker/Dockerfile.rust` - 镜像配置
- ✅ PR 到 `main` 或 `develop`（仅构建不推送）
- ✅ 手动触发（可指定自定义标签）

**不会触发：**
- ❌ 文档更新（`*.md`）
- ❌ 配置文件（`.gitignore`）
- ❌ 编译产物（`rust/target/`）

**构建镜像：**
```
l429609201/dd-danmaku:latest-rust     # main 分支
l429609201/dd-danmaku:test-rust       # develop 分支
l429609201/dd-danmaku:v2.0.0-rust     # 手动指定
```

> 💡 **详细触发策略**：查看 [TRIGGER_STRATEGY.md](./TRIGGER_STRATEGY.md) 了解完整的路径过滤规则。

---

## 🔑 配置 Secrets

在 GitHub 仓库设置中配置以下 Secrets：

| Secret 名称 | 说明 | 获取方式 |
|------------|------|---------|
| `DOCKERHUB_USERNAME` | Docker Hub 用户名 | 你的 Docker Hub 账号 |
| `DOCKERHUB_TOKEN` | Docker Hub 访问令牌 | [创建 Access Token](https://hub.docker.com/settings/security) |

### 创建 Docker Hub Access Token

1. 登录 [Docker Hub](https://hub.docker.com/)
2. 进入 **Account Settings** → **Security**
3. 点击 **New Access Token**
4. 输入描述（如 `github-actions-dd-danmaku`）
5. 权限选择 **Read, Write, Delete**
6. 复制生成的 Token（只显示一次）
7. 在 GitHub 仓库中添加为 Secret

### 添加 GitHub Secrets

1. 进入 GitHub 仓库
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**
4. 添加 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`

---

## 🚀 手动触发构建

### 通过 GitHub UI

1. 进入仓库的 **Actions** 标签页
2. 选择 **Build Python Backend** 或 **Build Rust Backend**
3. 点击 **Run workflow**
4. 选择分支
5. 可选：输入自定义标签（如 `v1.0.0-python`）
6. 点击 **Run workflow** 确认

### 通过 GitHub CLI

```bash
# Python 后端 - latest-python
gh workflow run build-python.yml

# Python 后端 - 自定义标签
gh workflow run build-python.yml -f tag=v1.0.0-python

# Rust 后端 - latest-rust
gh workflow run build-rust.yml

# Rust 后端 - 自定义标签
gh workflow run build-rust.yml -f tag=v2.0.0-rust
```

---

## 📋 分支策略

### main 分支（生产环境）

- 推送后自动构建 `latest-python` 和 `latest-rust`
- 用于生产部署
- 必须经过充分测试

### develop 分支（测试环境）

- 推送后自动构建 `test-python` 和 `test-rust`
- 用于测试和预发布
- 开发新功能时使用

### 其他分支

- 推送后构建 `<分支名>-python` 或 `<分支名>-rust`
- 用于功能开发和实验

---

## 🏷️ 标签规范

### 自动标签

| 分支 | Python 标签 | Rust 标签 |
|------|------------|-----------|
| `main` | `latest-python` | `latest-rust` |
| `develop` | `test-python` | `test-rust` |
| `feature/xxx` | `feature-xxx-python` | `feature-xxx-rust` |

### 手动标签

版本发布时使用语义化版本号：

```bash
# Python 后端
v1.0.0-python
v1.1.0-python
v1.1.1-python

# Rust 后端
v2.0.0-rust
v2.1.0-rust
v2.1.1-rust
```

---

## 🔍 构建日志

### 查看构建状态

1. 进入 GitHub 仓库
2. 点击 **Actions** 标签页
3. 查看最近的工作流运行
4. 点击具体的运行查看详细日志

### 构建失败处理

1. 检查错误日志
2. 常见问题：
   - Docker Hub 认证失败 → 检查 Secrets 配置
   - 构建超时 → 优化 Dockerfile 缓存
   - 依赖下载失败 → 网络问题，重试即可

---

## 🎨 Badge（可选）

在 README.md 中添加构建状态徽章：

```markdown
[![Build Python](https://github.com/你的用户名/dd-danmaku/actions/workflows/build-python.yml/badge.svg)](https://github.com/你的用户名/dd-danmaku/actions/workflows/build-python.yml)
[![Build Rust](https://github.com/你的用户名/dd-danmaku/actions/workflows/build-rust.yml/badge.svg)](https://github.com/你的用户名/dd-danmaku/actions/workflows/build-rust.yml)
```

---

## 📊 构建优化

### 缓存策略

- ✅ 使用 GitHub Actions 缓存（`cache-from: type=gha`）
- ✅ Docker 多阶段构建
- ✅ 依赖层分离（先复制依赖文件，再复制源码）

### 构建时间优化

- Python 后端：~5-8 分钟
- Rust 后端：~15-20 分钟（首次构建），~8-12 分钟（缓存命中）

### 并行构建

- Python 和 Rust 工作流独立运行
- 不会相互阻塞
- 可以同时触发

---

## 🔒 安全性

- ✅ 使用 Docker Hub Access Token（不是密码）
- ✅ Token 权限最小化
- ✅ Secrets 加密存储
- ✅ 不在日志中暴露敏感信息

---

## 📝 常见问题

### Q: 如何只构建一个后端？

A: 修改对应工作流的 `paths` 过滤，或者手动触发特定工作流。

### Q: 如何构建多架构镜像（如 arm64）？

A: 修改 `platforms` 配置：
```yaml
platforms: linux/amd64,linux/arm64
```

### Q: 如何添加自动测试？

A: 在工作流中添加测试步骤：
```yaml
- name: Run tests
  run: |
    cd python && pytest tests/
```

### Q: 如何推送到多个镜像仓库？

A: 在 `tags` 中添加多个仓库：
```yaml
tags: |
  l429609201/dd-danmaku:latest-python
  ghcr.io/你的用户名/dd-danmaku:latest-python
```

---

## 🎯 下一步

1. ✅ 配置 GitHub Secrets
2. ✅ 推送代码到 `develop` 分支测试
3. ✅ 确认镜像成功推送到 Docker Hub
4. ✅ 合并到 `main` 分支发布生产版本

---

*更新时间：2025-01-XX*
