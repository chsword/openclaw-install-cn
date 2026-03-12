# CDN 目录结构模板 / CDN Directory Structure Template

当前 CDN 只需要分发安装器相关文件和版本清单，不再存放 OpenClaw 离线安装包。

建议目录结构：

```text
(CDN Root)/
├── manifest.json
├── cli-manifest.json
├── install.sh
├── install.ps1
├── cli/
│   └── 1.0.0/
│       ├── oclaw-1.0.0-win32-x64.zip
│       ├── oclaw-1.0.0-darwin-x64.tar.gz
│       ├── oclaw-1.0.0-darwin-arm64.tar.gz
│       └── oclaw-1.0.0-linux-x64.tar.gz
└── gui/
    └── 1.0.0/
        ├── openclaw-gui-setup-1.0.0-x64.exe
        ├── openclaw-gui-1.0.0-win32-x64.exe
        ├── openclaw-gui-1.0.0-darwin-x64.dmg
        ├── openclaw-gui-1.0.0-darwin-arm64.dmg
        └── openclaw-gui-1.0.0-linux-x86_64.AppImage
```

## manifest.json 格式

`manifest.json` 现在只用于标记最新的 OpenClaw 版本，例如：

```json
{
  "latest": "2026.3.8",
  "versions": [
    {
      "version": "2026.3.8",
      "releaseDate": "2026-03-12",
      "description": "OpenClaw 2026.3.8"
    }
  ]
}
```

不再包含平台文件列表、校验和或 `pkg/` 目录映射。

## 文件职责

- `manifest.json`: OpenClaw 最新版本标记，由 `sync-openclaw.yml` 维护
- `cli-manifest.json`: `oclaw` CLI 发布版本清单，由 `release.yml` 维护
- `install.sh` / `install.ps1`: 引导脚本，负责检查 Node.js、pnpm 并调用 pnpm 安装 OpenClaw

## 发布说明

- `release.yml` 发布 CLI、GUI、引导脚本和 `cli-manifest.json`
- `sync-openclaw.yml` 更新并上传 `manifest.json`

详细流程见 [deployment.md](../docs/deployment.md)。

## 腾讯云 COS 配置建议

- 为 `manifest.json` 和 `cli-manifest.json` 设置较短缓存时间
- 为 `cli/` 与 `gui/` 下的版本化产物设置较长缓存时间
- 引导脚本建议与 `cli-manifest.json` 一起刷新缓存
