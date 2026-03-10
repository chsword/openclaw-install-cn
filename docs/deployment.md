# 部署指南 / Deployment Guide

本文档说明如何搭建 CDN、发布新版本，以及如何将 OpenClaw 安装包分发给用户。

---

## 目录

1. [架构概览](#架构概览)
2. [CDN 搭建（腾讯云 COS）](#cdn-搭建腾讯云-cos)
3. [发布新版本到 GitHub Release](#发布新版本到-github-release)
4. [更新 CDN 内容](#更新-cdn-内容)
5. [用户安装与更新指南](#用户安装与更新指南)
6. [CDN 目录结构参考](#cdn-目录结构参考)
7. [故障排查](#故障排查)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub Actions                        │
│   Tag Push (v*.*.*)                                         │
│        │                                                     │
│        ├── Build CLI binaries (Linux/Windows/macOS/arm64)   │
│        ├── Build Windows GUI (NSIS + Portable)              │
│        └── Publish GitHub Release  ────────────────────┐   │
└──────────────────────────────────────────────────────── │ ──┘
                                                          │
                                                          ▼
                                              GitHub Release Assets
                                              (oclaw-*.exe, install.sh, …)
                                                          │
                                              手动下载并上传到 CDN
                                                          │
                                                          ▼
                                        ┌─────────────────────────────┐
                                        │   腾讯云 COS (私有 CDN)      │
                                        │                             │
                                        │  manifest.json              │
                                        │  cli-manifest.json          │
                                        │  install.sh                 │
                                        │  install.ps1                │
                                        │  1.0.0/openclaw-*.zip/.tgz  │
                                        │  cli/1.0.0/oclaw-*          │
                                        └────────────┬────────────────┘
                                                     │
                                                     ▼ CDN 加速
                                        ┌─────────────────────────────┐
                                        │         用户设备             │
                                        │                             │
                                        │  oclaw install              │
                                        │  oclaw upgrade              │
                                        │  GUI 安装程序               │
                                        └─────────────────────────────┘
```

---

## CDN 搭建（腾讯云 COS）

### 1. 创建 COS Bucket

1. 登录 [腾讯云 COS 控制台](https://console.cloud.tencent.com/cos)
2. 创建 Bucket：
   - Bucket 名称：`openclaw-installer`（或自定义）
   - 地域：选择靠近用户的地区（如华南广州 `ap-guangzhou`）
   - 访问权限：**公有读私有写**（或按需配置 CDN 鉴权）
3. 记录 Bucket 的 **访问域名**，格式为：
   `openclaw-installer-xxxxxxxxxx.cos.ap-guangzhou.myqcloud.com`

### 2. 开启 CDN 加速（推荐）

1. 在 COS Bucket 管理页面，进入 **「域名与传输管理」→「自定义 CDN 加速域名」**
2. 绑定自定义域名（如 `openclaw-cdn.example.com`），申请 SSL 证书
3. 配置缓存规则：

   | 路径模式 | 缓存时间 | 说明 |
   |---------|---------|------|
   | `manifest.json` | 60 秒 | 版本清单，需快速更新 |
   | `cli-manifest.json` | 60 秒 | CLI 版本清单 |
   | `*.zip` | 30 天 | 安装包（不变更） |
   | `*.tar.gz` | 30 天 | 安装包（不变更） |
   | `install.sh` | 1 小时 | 引导脚本 |
   | `install.ps1` | 1 小时 | 引导脚本 |

4. 将 CDN 域名记录（如 `https://openclaw-cdn.example.com`）配置到 CLI 默认值中。

### 3. 配置 CORS（如需浏览器直接访问）

在 Bucket 的「安全管理」→「跨域访问 CORS」中添加：
- 来源 Origin：`*`
- 操作：`GET`
- 允许的头部：`*`

---

## 发布新版本到 GitHub Release

### 自动发布流程

1. 确保代码已合并到 `main` 分支
2. 在本地创建并推送版本 Tag：

   ```bash
   git checkout main
   git pull origin main

   # 打 Tag（遵循 semver 格式）
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. GitHub Actions 将自动：
   - 运行所有测试
   - 为 Windows / macOS (x64 + arm64) / Linux 构建 CLI 二进制文件
   - 构建 Windows GUI（NSIS 安装包 + 便携版）
   - 创建 GitHub Release，上传所有构建产物

4. 在 [GitHub Releases 页面](https://github.com/chsword/openclaw-install-cn/releases) 确认发布成功。

### 发布预发布版（Pre-release）

Tag 名称中包含连字符时会自动标记为 Pre-release：

```bash
git tag v1.2.3-beta.1
git push origin v1.2.3-beta.1
```

### 手动触发（可选）

如需在不推送 Tag 的情况下测试构建，可在 GitHub Actions 页面手动触发 CI 工作流（仅测试，不发布 Release）。

---

## 更新 CDN 内容

GitHub Release 发布后，需手动（或通过脚本）将资产上传到 CDN。

### 方式一：腾讯云 CLI（coscli）

```bash
# 安装 coscli
# https://cloud.tencent.com/document/product/436/63144

# 配置 coscli 凭证
coscli config add -a <SecretId> -s <SecretKey> -r ap-guangzhou -b openclaw-installer-xxxxxxxxxx

BUCKET="cos://openclaw-installer-xxxxxxxxxx"
VERSION="1.2.3"

# 1. 上传 OpenClaw 安装包（从 openclaw.ai 官方下载后上传）
#    文件命名规范：openclaw-{version}-{platform}-{arch}.{ext}
coscli cp openclaw-${VERSION}-win32-x64.zip    "${BUCKET}/${VERSION}/openclaw-${VERSION}-win32-x64.zip"
coscli cp openclaw-${VERSION}-darwin-x64.tar.gz  "${BUCKET}/${VERSION}/openclaw-${VERSION}-darwin-x64.tar.gz"
coscli cp openclaw-${VERSION}-darwin-arm64.tar.gz "${BUCKET}/${VERSION}/openclaw-${VERSION}-darwin-arm64.tar.gz"
coscli cp openclaw-${VERSION}-linux-x64.tar.gz  "${BUCKET}/${VERSION}/openclaw-${VERSION}-linux-x64.tar.gz"

# 2. 上传 oclaw CLI 二进制（从 GitHub Release 下载）
coscli cp oclaw-win-x64.exe     "${BUCKET}/cli/${VERSION}/oclaw-${VERSION}-win32-x64.zip"
coscli cp oclaw-darwin-x64      "${BUCKET}/cli/${VERSION}/oclaw-${VERSION}-darwin-x64.tar.gz"
coscli cp oclaw-darwin-arm64    "${BUCKET}/cli/${VERSION}/oclaw-${VERSION}-darwin-arm64.tar.gz"
coscli cp oclaw-linux-x64       "${BUCKET}/cli/${VERSION}/oclaw-${VERSION}-linux-x64.tar.gz"

# 3. 上传引导脚本
coscli cp install.sh  "${BUCKET}/install.sh"
coscli cp install.ps1 "${BUCKET}/install.ps1"

# 4. 更新 manifest.json（将 latest 改为新版本）
# 编辑 cdn-template/manifest.json，确保 latest 字段和 versions 数组已更新
coscli cp cdn-template/manifest.json     "${BUCKET}/manifest.json"
coscli cp cdn-template/cli-manifest.json "${BUCKET}/cli-manifest.json"

# 5. 刷新 CDN 缓存（确保 manifest.json 立即生效）
# 在腾讯云 CDN 控制台 → 刷新预热 → URL 刷新
# 或者使用 CDN API：
# https://cloud.tencent.com/document/api/228/37870
```

### 方式二：腾讯云 COS Web 控制台

1. 登录 COS 控制台，进入 Bucket
2. 按照 [CDN 目录结构参考](#cdn-目录结构参考) 上传文件
3. 上传完成后，在 CDN 控制台刷新 `manifest.json` 和 `cli-manifest.json` 的缓存

### manifest.json 更新说明

每次发布新版本后，需更新 `manifest.json` 中的以下字段：

```json
{
  "latest": "1.2.3",          // ← 改为新版本号
  "versions": [
    {
      "version": "1.2.3",     // ← 新增此对象
      "releaseDate": "2025-06-01",
      "description": "版本说明",
      "files": {
        "win32-x64":    "openclaw-1.2.3-win32-x64.zip",
        "darwin-x64":   "openclaw-1.2.3-darwin-x64.tar.gz",
        "darwin-arm64": "openclaw-1.2.3-darwin-arm64.tar.gz",
        "linux-x64":    "openclaw-1.2.3-linux-x64.tar.gz"
      },
      "checksums": {
        "win32-x64":    "sha256:<从checksums.sha256文件中获取>",
        "darwin-x64":   "sha256:<从checksums.sha256文件中获取>",
        "darwin-arm64": "sha256:<从checksums.sha256文件中获取>",
        "linux-x64":    "sha256:<从checksums.sha256文件中获取>"
      }
    },
    // ... 旧版本保留
  ]
}
```

---

## 用户安装与更新指南

### 首次安装

**macOS / Linux（一键安装）：**
```bash
OCLAW_CDN=https://openclaw-cdn.example.com \
  curl -fsSL https://openclaw-cdn.example.com/install.sh | bash
```

**Windows（PowerShell 一键安装）：**
```powershell
$env:OCLAW_CDN = "https://openclaw-cdn.example.com"
irm https://openclaw-cdn.example.com/install.ps1 | iex
```

**Windows（GUI 安装程序）：**
从 GitHub Release 页面下载 `openclaw-gui-setup-*.exe`，双击运行即可。

### CLI 手动安装（无 Node.js 环境）

1. 从 GitHub Release 下载对应平台的 `oclaw-*` 二进制文件
2. 将其放到 PATH 中的目录（如 `/usr/local/bin/` 或 `%LOCALAPPDATA%\Programs\oclaw\`）
3. 配置 CDN 地址：
   ```bash
   oclaw config --cdn-url https://openclaw-cdn.example.com
   ```
4. 安装 OpenClaw：
   ```bash
   oclaw install
   ```

### 升级

```bash
# 检查更新（不执行）
oclaw upgrade --check

# 升级到最新版
oclaw upgrade
```

### 查看状态

```bash
oclaw status --check-updates
```

---

## CDN 目录结构参考

```
(CDN Root)/
│
├── manifest.json               # OpenClaw 包版本清单（需频繁刷新缓存）
├── cli-manifest.json           # oclaw CLI 版本清单（需频繁刷新缓存）
│
├── install.sh                  # macOS / Linux 引导脚本
├── install.ps1                 # Windows PowerShell 引导脚本
│
│── 1.0.0/                      # OpenClaw v1.0.0 安装包目录
│   ├── openclaw-1.0.0-win32-x64.zip
│   ├── openclaw-1.0.0-darwin-x64.tar.gz
│   ├── openclaw-1.0.0-darwin-arm64.tar.gz
│   └── openclaw-1.0.0-linux-x64.tar.gz
│
├── 1.1.0/                      # OpenClaw v1.1.0 ...
│   └── ...
│
└── cli/                        # oclaw CLI 二进制包目录
    ├── 1.0.0/
    │   ├── oclaw-1.0.0-win32-x64.zip      # 打包为 zip（方便解压）
    │   ├── oclaw-1.0.0-darwin-x64.tar.gz
    │   ├── oclaw-1.0.0-darwin-arm64.tar.gz
    │   └── oclaw-1.0.0-linux-x64.tar.gz
    └── ...
```

> **注意：** `cli/` 目录中的包名需与 `cli-manifest.json` 中的 `files` 字段一致。
> 引导脚本（`install.sh` / `install.ps1`）会从 `cli/{version}/` 中下载 CLI 二进制，
> 因此每次发布新 CLI 版本时都需更新 `cli-manifest.json`。

---

## 故障排查

### 用户报告 "无法连接 CDN"

1. 确认 CDN 域名能在目标网络环境中访问：
   ```bash
   curl -I https://openclaw-cdn.example.com/manifest.json
   ```
2. 如果 HTTPS 不可用，可临时改为 HTTP：
   ```bash
   oclaw config --cdn-url http://openclaw-cdn.example.com
   ```
3. 检查 COS Bucket 是否开放公有读权限

### `oclaw install` 提示 "版本未找到"

1. 确认 CDN 上的 `manifest.json` 已更新：
   ```bash
   curl https://openclaw-cdn.example.com/manifest.json
   ```
2. 确认 `versions` 数组中包含对应版本
3. 刷新 CDN 缓存（腾讯云 CDN 控制台 → 刷新预热）

### GitHub Actions 构建失败

1. 检查是否有 Node.js 版本兼容性问题（CLI 构建需要 Node.js 18）
2. Windows GUI 构建需要 `gui/assets/icon.ico`，确认已提交到仓库
3. 查看 Actions 日志中的详细错误信息

### CLI 二进制在 macOS 上提示"无法打开，因为来自身份不明的开发者"

```bash
# 移除隔离标记
xattr -dr com.apple.quarantine /usr/local/bin/oclaw
# 或者
chmod +x oclaw-darwin-x64
./oclaw-darwin-x64 status
```

### Windows 杀毒软件误报

`oclaw-win-x64.exe` 是由 `pkg` 打包的 Node.js 可执行文件，部分杀毒软件可能误报。
用户可通过 SHA-256 校验和（`checksums.sha256`）验证文件完整性：

```powershell
Get-FileHash oclaw-win-x64.exe -Algorithm SHA256
# 对比 checksums.sha256 中的值
```
