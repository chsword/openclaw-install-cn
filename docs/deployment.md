# 部署指南 / Deployment Guide

本文档说明如何发布新版本，以及如何将 OpenClaw 安装包分发给用户。

---

## 目录

1. [架构概览](#架构概览)
2. [GitHub Actions 环境配置（COS 凭证）](#github-actions-环境配置cos-凭证)
3. [发布安装工具新版本（release.yml）](#发布安装工具新版本releaseyml)
4. [同步上游 OpenClaw 应用版本（sync-openclaw.yml）](#同步上游-openclaw-应用版本sync-openclawml)
5. [用户安装与更新指南](#用户安装与更新指南)
6. [CDN 目录结构参考](#cdn-目录结构参考)
7. [故障排查](#故障排查)

---

## 架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│                           GitHub Actions                              │
│                                                                      │
│  Push to main ──► ci.yml                                             │
│       │  (auto-tag from cli/package.json version)                    │
│       │                                                              │
│       ▼                                                              │
│  Tag Push (v*.*.*)  ──────────────────────────────────► release.yml  │
│                                │                                     │
│        ┌───────────────────────┤                                     │
│        ├── Build CLI binaries (Linux/Windows/macOS/arm64)            │
│        ├── Build GUI installer (Windows NSIS/Portable, macOS DMG,    │
│        │              Linux AppImage)                                 │
│        ├── Publish GitHub Release                                    │
│        └── Upload cli/{installer-ver}/oclaw-* + cli-manifest ──┐    │
│            Upload gui/{installer-ver}/openclaw-gui-*  ──────┤    │
│                                                                  │   │
│  Daily schedule / workflow_dispatch                              │   │
│       │                                                          │   │
│       ▼                                                          │   │
│  sync-openclaw.yml                                               │   │
│       │                                                          │   │
│       ├── Detect latest openclaw/openclaw release                │   │
│       ├── Download & repackage upstream packages                 │   │
│       └── Upload {openclaw-ver}/openclaw-* + manifest ───────┐  │   │
└──────────────────────────────────────────────────────────────│──│───┘
                                                               │  │
                                                               ▼  ▼
                                         ┌─────────────────────────────┐
                                         │   腾讯云 COS + CDN           │
                                         │   https://oclaw.chatu.plus  │
                                         │                             │
                                         │  manifest.json  ◄── sync    │
                                         │  cli-manifest.json ◄─ rel.  │
                                         │  install.sh / install.ps1   │
                                         │                             │
                                         │  {openclaw-ver}/            │
                                         │    openclaw-*  ◄─── sync    │
                                         │  cli/{installer-ver}/       │
                                         │    oclaw-*  ◄──── release   │
                                         │  gui/{installer-ver}/       │
                                         │    openclaw-gui-* ◄─ rel.   │
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

两条独立的版本轨道：

| CDN 路径 | 版本含义 | 由谁管理 |
|----------|----------|----------|
| `cli/{ver}/oclaw-*` | 本安装工具的 Tag 版本（如 `0.2.3`） | `release.yml` |
| `gui/{ver}/openclaw-gui-*` | 本安装工具的 GUI 离线安装包（如 `0.2.3`） | `release.yml` |
| `{ver}/openclaw-*` | 上游 OpenClaw 应用版本（如 `2026.3.8`） | `sync-openclaw.yml` |

开发者只需将更新合并到 `main` 分支，GitHub Actions 会自动从 `cli/package.json` 读取版本号、创建 Tag、构建所有平台安装包并上传到腾讯云 COS，无需手动操作。

---

## GitHub Actions 环境配置（COS 凭证）

Release 工作流的 `deploy-to-cos` 任务使用 GitHub Environments 中的 `TencentSecretId` 环境。

### 创建 GitHub Environment

1. 进入仓库 **Settings → Environments → New environment**
2. 创建名为 `TencentSecretId` 的环境
3. 在该环境中添加以下 **Secrets**：

   | Secret 名称 | 说明 |
   |-------------|------|
   | `SECRETID`  | 腾讯云 API 密钥 SecretId |
   | `SECRETKEY` | 腾讯云 API 密钥 SecretKey |
   | `BUCKET`    | COS Bucket 名称（含 AppId，如 `openclaw-1234567890`） |
   | `REGION`    | COS 地域（如 `ap-guangzhou`） |

4. 可选：设置环境保护规则（如需要审批才能部署）

### 获取腾讯云 API 凭证

1. 登录 [腾讯云 API 密钥管理](https://console.cloud.tencent.com/cam/capi)
2. 新建 API 密钥，记录 SecretId 和 SecretKey
3. **建议使用子账号，并只授予以下最小权限：**
   - `QcloudCOSDataWrite`（COS 数据写入）
   - `QcloudCOSDataRead`（COS 数据读取）

---

## 发布安装工具新版本（release.yml）

### 自动发布流程

发布新版本只需更新版本号并推送到 `main` 分支，CI 会自动完成全部后续工作：

1. 修改 `cli/package.json` 中的 `version` 字段：

   ```bash
   cd cli
   npm version patch   # 或 minor / major / 任意版本号
   # 这会自动更新 package.json，无需手动推送 Tag
   ```

2. 将变更合并（或直接推送）到 `main` 分支：

   ```bash
   git add cli/package.json
   git commit -m "chore: bump version to x.y.z"
   git push origin main
   ```

3. `ci.yml` 工作流会自动：
   - 运行所有测试和 lint
   - 读取 `cli/package.json` 中的版本号，创建对应的版本 Tag（如 `vX.Y.Z`）
   - 通过 `workflow_dispatch` 触发 `release.yml` 工作流

4. `release.yml` 工作流会自动：
   - 为 Windows / macOS (x64 + arm64) / Linux 构建 CLI 二进制文件
   - 构建 GUI 安装包（Windows NSIS + 便携版，macOS DMG，Linux AppImage）
   - 更新 `cli-manifest.json` 中的版本清单及校验和（**不修改** `manifest.json`，后者由 `sync-openclaw.yml` 管理）
   - 创建 GitHub Release，上传所有构建产物
   - 将 CLI 安装包上传到 `cli/{installer-ver}/` 目录（腾讯云 COS，`TencentSecretId` 环境）
   - 将 GUI 离线安装包（`.exe` / `.dmg` / `.AppImage`）上传到 `gui/{installer-ver}/` 目录（腾讯云 COS）
   - 自动刷新 CDN 缓存（`cli-manifest.json`、安装脚本、本次发布的 CLI 包及 GUI 离线包）

5. 在 [GitHub Releases 页面](https://github.com/chsword/openclaw-install-cn/releases) 确认发布成功。

> **注意**：如果 Tag 已存在，`ci.yml` 的自动打标步骤会跳过，`release.yml` 不会被重复触发。

### 手动触发发布

如需手动创建 Tag 并触发 Release（不经过 `ci.yml` 自动打标），可直接推送符合格式的 Tag：

```bash
git checkout main
git pull origin main

# Tag 格式必须为 v{数字}.{数字}.{数字}，否则不会触发 release.yml
git tag v1.2.3
git push origin v1.2.3
```

### 发布预发布版（Pre-release）

> **注意**：`release.yml` 的 Tag 触发器仅匹配 `v[0-9]+.[0-9]+.[0-9]+` 格式（不含连字符）。
> 含连字符的 Tag（如 `v1.2.3-beta.1`）**不会**通过 Tag push 触发工作流。

如需发布 Pre-release，请在 GitHub Actions 页面手动触发 `release.yml`（`workflow_dispatch`），
或在 `cli/package.json` 中将 `version` 设为带连字符的预发布版本号（如 `1.2.3-beta.1`）后推送到 `main`，
CI 将读取该版本号、创建 `v1.2.3-beta.1` Tag，并通过 `workflow_dispatch` 触发 Release 工作流（此时 `contains(github.ref_name, '-')` 为 `true`，GitHub Release 会自动标记为 Pre-release）。

---

## 同步上游 OpenClaw 应用版本（sync-openclaw.yml）

`manifest.json`（`oclaw install` / `oclaw upgrade` 用于定位安装包的清单）和 CDN 上的 `{openclaw-ver}/openclaw-*` 包**不由 `release.yml` 管理**，而是由独立的 `sync-openclaw.yml` 工作流负责。

### 触发方式

| 方式 | 说明 |
|------|------|
| **每日自动检测**（04:00 UTC） | 自动调用 `openclaw/openclaw` 的 GitHub Releases API；若检测到新版本则同步，否则静默退出 |
| **手动触发**（`workflow_dispatch`） | 在 Actions 页面手动运行，可指定具体版本号（如 `2026.3.8`）或留空自动检测最新版 |

### 工作流程

1. 从 `openclaw/openclaw` GitHub Releases API 获取最新版本（或使用手动指定版本）
2. 对比 `cdn-template/manifest.json`；若版本已存在则跳过
3. 下载该 Release 中所有平台的安装包（支持多种文件名模式，缺失平台静默跳过）
4. 将下载的包重新打包为 CDN 规范格式（`openclaw-{ver}-{platform}.{ext}`）
5. 计算 SHA-256 校验和，更新 `cdn-template/manifest.json`
6. 上传至腾讯云 COS 的 `{openclaw-ver}/` 目录
7. 刷新 CDN 缓存（`manifest.json` + 本次上传的包 URL）
8. 将更新后的 `cdn-template/manifest.json` 提交回 `main` 分支

### 手动触发指定版本

在 [Actions → Sync OpenClaw Upstream Release → Run workflow](https://github.com/chsword/openclaw-install-cn/actions/workflows/sync-openclaw.yml) 中：

- **version** 留空 → 自动拉取 `openclaw/openclaw` 最新 Release
- **version** 填写 `2026.3.8`（或 `v2026.3.8`）→ 同步指定版本

---

## 用户安装与更新指南

### 首次安装

**macOS / Linux（一键安装）：**
```bash
curl -fsSL https://oclaw.chatu.plus/install.sh | bash
```

**Windows（PowerShell 一键安装）：**
```powershell
irm https://oclaw.chatu.plus/install.ps1 | iex
```

**Windows（GUI 安装程序）：**
从 GitHub Release 页面下载 `openclaw-gui-setup-*.exe`，双击运行即可。

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
├── cli/                        # oclaw CLI 二进制包目录
│   ├── 1.0.0/
│   │   ├── oclaw-1.0.0-win32-x64.zip
│   │   ├── oclaw-1.0.0-darwin-x64.tar.gz
│   │   ├── oclaw-1.0.0-darwin-arm64.tar.gz
│   │   └── oclaw-1.0.0-linux-x64.tar.gz
│   └── ...
│
└── gui/                        # GUI 离线安装包目录
    ├── 1.0.0/
    │   ├── openclaw-gui-setup-1.0.0-x64.exe      # Windows NSIS 安装向导
    │   ├── openclaw-gui-1.0.0-win-x64.exe         # Windows 便携版
    │   ├── openclaw-gui-1.0.0-mac-x64.dmg         # macOS Intel 磁盘映像
    │   ├── openclaw-gui-1.0.0-mac-arm64.dmg       # macOS Apple Silicon 磁盘映像
    │   └── openclaw-gui-1.0.0-linux-x64.AppImage  # Linux AppImage
    └── ...
```

---

## 故障排查

### 用户报告 "无法连接 CDN"

确认 CDN 域名能在目标网络环境中访问：
```bash
curl -I https://oclaw.chatu.plus/manifest.json
```

如仍无法访问，请检查腾讯云 CDN 控制台中的域名状态及访问日志。

### `oclaw install` 提示 "版本未找到"

1. 确认 CDN 上的 `manifest.json` 已更新（`sync-openclaw.yml` 每日自动同步；也可手动触发）：
   ```bash
   curl https://oclaw.chatu.plus/manifest.json
   ```
2. 确认 `versions` 数组中包含对应版本
3. CDN 缓存由 `sync-openclaw.yml` 通过 `tccli cdn PurgeUrlsCache` 自动刷新；若仍有缓存问题，可在腾讯云 CDN 控制台 → 刷新预热 → 手动刷新 `manifest.json` 的缓存

### deploy-to-cos 任务失败

1. 确认 `TencentSecretId` 环境中的 SECRETID、SECRETKEY、BUCKET、REGION 值正确
2. 确认子账号有 COS 写入权限
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
