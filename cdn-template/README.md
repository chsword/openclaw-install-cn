# CDN 目录结构模板 / CDN Directory Structure Template

将以下文件上传到您的 CDN（如腾讯云 COS）：

```
(CDN Root)/
├── manifest.json          # OpenClaw 包版本清单
├── cli-manifest.json      # oclaw CLI 版本清单
│
├── install.sh             # macOS/Linux 一键安装脚本
├── install.ps1            # Windows 一键安装脚本
│
├── pkg/                   # OpenClaw 应用包目录（由 sync-openclaw.yml 管理）
│   └── 1.0.0/             # OpenClaw v1.0.0 包目录
│       ├── openclaw-1.0.0-win32-x64.zip
│       ├── openclaw-1.0.0-darwin-x64.tar.gz
│       ├── openclaw-1.0.0-darwin-arm64.tar.gz
│       └── openclaw-1.0.0-linux-x64.tar.gz
│
├── cli/                   # oclaw CLI 包目录
│   └── 1.0.0/
│       ├── oclaw-1.0.0-win32-x64.zip
│       ├── oclaw-1.0.0-darwin-x64.tar.gz
│       ├── oclaw-1.0.0-darwin-arm64.tar.gz
│       └── oclaw-1.0.0-linux-x64.tar.gz
│
└── gui/                   # GUI 离线安装包目录
    └── 1.0.0/
        ├── openclaw-gui-setup-1.0.0-x64.exe
        ├── openclaw-gui-1.0.0-win32-x64.exe
        ├── openclaw-gui-1.0.0-darwin-x64.dmg
        ├── openclaw-gui-1.0.0-darwin-arm64.dmg
        └── openclaw-gui-1.0.0-linux-x86_64.AppImage
```

## manifest.json 格式说明

```json
{
  "latest": "1.0.0",       // 最新版本号
  "versions": [
    {
      "version": "1.0.0",
      "releaseDate": "2025-01-01",
      "description": "版本说明",
      "files": {
        "win32-x64":    "openclaw-1.0.0-win32-x64.zip",
        "darwin-x64":   "openclaw-1.0.0-darwin-x64.tar.gz",
        "darwin-arm64": "openclaw-1.0.0-darwin-arm64.tar.gz",
        "linux-x64":    "openclaw-1.0.0-linux-x64.tar.gz"
      },
      "checksums": {
        "win32-x64":    "sha256:abc123...",
        ...
      }
    }
  ]
}
```

## 发布新版本步骤

OpenClaw 应用包（`pkg/` 目录）由 `sync-openclaw.yml` 工作流每日自动同步，无需手动操作。如需手动触发，可在 Actions 页面运行 `Sync OpenClaw Upstream Release` 工作流。

oclaw CLI 和 GUI 安装包（`cli/` 和 `gui/` 目录）由 `release.yml` 工作流在发布新版本时自动构建和上传。

详细发布流程请参考 [deployment.md](../docs/deployment.md)。

## 腾讯云 COS 配置建议

- Bucket 设置为公有读（或配置 CDN 访问控制）
- 开启 CDN 加速，设置合理的缓存时间（manifest.json 短缓存，包文件长缓存）
- 建议为 `manifest.json` 和 `cli-manifest.json` 设置 `Cache-Control: max-age=60`
- 建议为包文件设置 `Cache-Control: max-age=86400`
