# GitHub Actions 工作流配置

## 🎯 当前激活的工作流

### 1. Rust 后端构建 (`build-rust.yml`)

**触发条件：**
- ✅ 推送到 `main` 或 `develop` 分支
- ✅ 修改以下路径：
  - `rust/**` - Rust 源码
  - `web/src/**` - 前端源码
  - `web/public/**` - 静态资源
  - `web/package.json` - 依赖配置
  - `docker/Dockerfile.rust` - 镜像配置

**构建镜像：**
- `l429609201/dd-danmaku:latest-rust` (main 分支)
- `l429609201/dd-danmaku:test-rust` (develop 分支)

---

## ⏸️ 已禁用的工作流

### Python 后端构建 (`build-python.yml.disabled`)

**禁用原因：**
- 临时停止 Python 镜像的自动构建
- 文件已重命名为 `.disabled` 后缀
- 已从 Git 跟踪中移除（远程将被删除）
- 本地保留文件以备后续启用

**如何重新启用：**
```bash
cd .github/workflows
mv build-python.yml.disabled build-python.yml
git add build-python.yml
git commit -m "chore: 重新启用 Python 自动构建"
git push
```

---

## 📋 工作流优先级

当前只构建 **Rust 后端镜像**：
- 前端变化 → 只触发 Rust 构建
- Rust 代码变化 → 触发 Rust 构建
- Python 代码变化 → 不触发任何构建

---

## 🔑 配置 Secrets

需要在 GitHub 仓库配置：
- `DOCKERHUB_USERNAME` - Docker Hub 用户名
- `DOCKERHUB_TOKEN` - Docker Hub 访问令牌

---

## 📝 手动构建

### Rust 后端
```bash
# 通过 GitHub UI
Actions → Build Rust Backend → Run workflow

# 通过 gh cli
gh workflow run build-rust.yml
gh workflow run build-rust.yml -f tag=v2.0.0-rust
```

### Python 后端（手动）
```bash
# 本地构建
docker build -f docker/Dockerfile -t l429609201/dd-danmaku:manual-python .

# 或者重新启用工作流（见上面）
```

---

*更新时间：2025-01-XX*
*状态：Python 构建已禁用，Rust 构建激活*
