# 部署指南 / Deployment Guide

本文档说明如何发布新版本，以及如何将 OpenClaw 安装包分发给用户。

---

## 目录

1. [架构概览](#架构概览)
2. [GitHub Actions 环境配置（COS 凭证）](#github-actions-环境配置cos-凭证)
3. [发布新版本](#发布新版本)
4. [用户安装与更新指南](#用户安装与更新指南)
5. [CDN 目录结构参考](#cdn-目录结构参考)
6. [故障排查](#故障排查)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub Actions                        │
│   Tag Push (v*.*.*)                                         │
│        │                                                     │
│        ├── Build CLI binaries (Linux/Windows/macOS/arm64)   │
│        ├── Build Windows GUI (NSIS + Portable)              │
│        ├── Publish GitHub Release                           │
│        └── Upload to Tencent COS ──────────────────────┐   │
└────────────────────────────────────────────────────────│───┘
                                                          │
                                                          ▼
                                        ┌─────────────────────────────┐
                                        │   腾讯云 COS + CDN           │
                                        │   https://oclaw.chatu.plus  │
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

每次推送版本 Tag，GitHub Actions 会自动构建所有平台的安装包并上传到腾讯云 COS，用户无需手动操作。

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

## 发布新版本

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
   - 构建 GUI 安装包（Windows NSIS + 便携版，macOS DMG，Linux AppImage）
   - 创建 GitHub Release，上传所有构建产物
   - 将安装包、manifest、安装脚本上传到腾讯云 COS（`TencentSecretId` 环境）

4. 在 [GitHub Releases 页面](https://github.com/chsword/openclaw-install-cn/releases) 确认发布成功。

### 发布预发布版（Pre-release）

Tag 名称中包含连字符时会自动标记为 Pre-release：

```bash
git tag v1.2.3-beta.1
git push origin v1.2.3-beta.1
```

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
└── cli/                        # oclaw CLI 二进制包目录
    ├── 1.0.0/
    │   ├── oclaw-1.0.0-win32-x64.zip
    │   ├── oclaw-1.0.0-darwin-x64.tar.gz
    │   ├── oclaw-1.0.0-darwin-arm64.tar.gz
    │   └── oclaw-1.0.0-linux-x64.tar.gz
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

1. 确认 CDN 上的 `manifest.json` 已更新：
   ```bash
   curl https://oclaw.chatu.plus/manifest.json
   ```
2. 确认 `versions` 数组中包含对应版本
3. 在腾讯云 CDN 控制台 → 刷新预热 → 刷新 `manifest.json` 和 `cli-manifest.json` 的缓存

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
