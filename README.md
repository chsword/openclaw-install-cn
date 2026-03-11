# openclaw-install-cn

<p align="center">
  <a href="https://github.com/chsword/openclaw-install-cn/actions/workflows/ci.yml">
    <img src="https://github.com/chsword/openclaw-install-cn/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://github.com/chsword/openclaw-install-cn/actions/workflows/release.yml">
    <img src="https://github.com/chsword/openclaw-install-cn/actions/workflows/release.yml/badge.svg" alt="Release">
  </a>
  <a href="https://github.com/chsword/openclaw-install-cn/releases/latest">
    <img src="https://img.shields.io/github/v/release/chsword/openclaw-install-cn?label=latest" alt="Latest Release">
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js >= 18">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg" alt="Platform: Windows | macOS | Linux">
</p>

<p align="center">
  OpenClaw 中国大陆 / 受限内网离线安装工具<br>
  Install and update <a href="https://openclaw.ai/">OpenClaw</a> from a private CDN — no npm / GitHub access required.
</p>

---

## 📖 项目背景

OpenClaw 是一个开源、本地运行的 AI Agent 平台，支持 Windows / macOS / Linux。  
在中国大陆或受限内网环境中，其依赖包（npm、GitHub Release）无法正常下载。

本项目提供：

| 组件 | 说明 |
|------|------|
| **`cli/`** | 跨平台命令行工具 `oclaw`，用于安装、升级、查看状态和配置 CDN |
| **`gui/`** | Windows（兼容 macOS/Linux）Electron GUI，提供图形化安装/升级/版本检查界面 |
| **`scripts/`** | 一键引导脚本（`install.sh` / `install.ps1`），首次从 CDN 拉取 CLI 并完成安装 |
| **`cdn-template/`** | CDN 目录结构模板和 manifest 格式说明，供运营者搭建私有 CDN 时参考 |

所有 OpenClaw 安装包均从**官方 CDN**（腾讯云 COS + CDN，https://oclaw.chatu.plus）下载，不访问 npm 或 GitHub。

---

## 🚀 快速开始

### 方法一：一键引导脚本（推荐）

**macOS / Linux：**

```bash
curl -fsSL https://oclaw.chatu.plus/install.sh | bash
```

**Windows（PowerShell）：**

```powershell
irm https://oclaw.chatu.plus/install.ps1 | iex
```

### 方法二：直接使用 CLI

若 Node.js >= 18 已安装，可以直接克隆本仓库使用 CLI：

```bash
git clone https://github.com/chsword/openclaw-install-cn.git
cd openclaw-install-cn/cli
npm install

# 安装 OpenClaw
node bin/oclaw.js install

# 升级 OpenClaw
node bin/oclaw.js upgrade

# 查看安装状态
node bin/oclaw.js status --check-updates
```

---

## 🛠️ CLI 用法

```
oclaw <command> [options]

Commands:
  install [options]   从 CDN 下载并安装 OpenClaw
  upgrade [options]   检查并升级到最新版本
  status  [options]   显示当前安装状态和版本信息
  config  [options]   查看或修改 oclaw 配置

install options:
  --version <ver>     安装指定版本（默认：最新版）
  --dir <path>        覆盖安装目录
  --force             强制重新安装（即使版本相同）

upgrade options:
  --check             仅检查更新，不执行升级

status options:
  --check-updates     同时查询 CDN 上的最新版本

config options:
  --dir <path>        设置安装目录
  --reset             重置为默认配置
```

### 配置文件位置

| 平台 | 路径 |
|------|------|
| Linux | `~/.oclaw/config.json` |
| macOS | `~/.oclaw/config.json` |
| Windows | `%USERPROFILE%\.oclaw\config.json` |

---

## 🖥️ GUI（Windows / macOS / Linux）

GUI 基于 Electron 构建，提供图形化界面，适合非技术用户。

📖 **[查看完整 GUI 使用说明 →](docs/gui-guide.md)**

### 开发运行

```bash
cd gui
npm install
npm start
```

### 功能

- 显示当前安装版本和最新版本
- 一键安装 / 升级（含下载进度条）
- 配置安装目录
- 点击安装目录可直接在文件管理器中打开
- 查看详细安装日志（支持按级别过滤、导出）

### 界面预览

![GUI 主界面](docs/screenshots/screenshot_01_main.png)

### 构建发布包

```bash
cd gui
npm run build        # Windows NSIS 安装包 + 便携版
npm run build:mac    # macOS DMG（x64 + arm64）
npm run build:linux  # Linux AppImage（x64）
npm run build:all    # Windows / macOS / Linux 全平台
```

---

## ☁️ CDN 搭建

请参考 [`cdn-template/`](./cdn-template/) 目录，其中包含：

- `manifest.json`：OpenClaw 包版本清单（格式说明）
- `cli-manifest.json`：oclaw CLI 版本清单
- `README.md`：完整的 CDN 目录结构和腾讯云 COS 配置建议

### 发布新版本

每次将 `main` 分支的 `cli/package.json` 版本号更新后推送，GitHub Actions 会自动：

1. 创建对应的版本 Tag
2. 构建所有平台的 CLI 安装包并上传到 CDN 的 `cli/{version}/` 目录
3. 更新 `cli-manifest.json` 的 `latest` 字段和版本列表
4. 自动刷新 CDN 缓存（CLI 包 + `cli-manifest.json`）

`manifest.json`（OpenClaw 应用包版本）由 `sync-openclaw.yml` 每日自动维护，与安装工具发布独立。

详细发布流程请参考 [docs/deployment.md](./docs/deployment.md)。

---

## ⚙️ 空环境 vs 已安装环境

| 情况 | 行为 |
|------|------|
| **空环境**（首次安装）| `oclaw install` 直接下载并解压到安装目录，写入 `.oclaw-version` 标记文件 |
| **已安装 OpenClaw**（升级）| `oclaw upgrade` 检测版本差异，备份现有目录后覆盖安装，失败时自动回滚 |

CLI 通过 `{installDir}/.oclaw-version` 文件识别当前安装版本，兼容空环境和已安装两种情况。

---

## 🔧 开发

### 目录结构

```
openclaw-install-cn/
├── cli/                  # CLI 工具（Node.js）
│   ├── bin/oclaw.js      # 入口脚本
│   ├── src/
│   │   ├── commands/     # 子命令：install, upgrade, status, config
│   │   └── lib/          # 工具库：config, downloader, installer, platform, registry
│   └── package.json
├── gui/                  # Electron GUI
│   ├── src/
│   │   ├── main.js       # 主进程
│   │   ├── preload.js    # 预加载脚本
│   │   ├── lib/          # 共享库（引用 cli/src/lib/）
│   │   └── renderer/     # 前端（HTML/CSS/JS）
│   └── package.json
├── scripts/
│   ├── install.sh        # macOS/Linux 引导脚本
│   └── install.ps1       # Windows 引导脚本
└── cdn-template/         # CDN 目录结构模板
```

### 运行测试

```bash
cd cli
npm install
npm test
```

### 依赖要求

| 工具 | 版本 |
|------|------|
| Node.js | >= 18 |
| npm | >= 8 |
| unzip / tar | 系统内置（Linux/macOS 解压用） |
| PowerShell | >= 5.1（Windows 解压用） |

---

## 📄 License

MIT
