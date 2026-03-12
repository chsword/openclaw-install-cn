#Requires -Version 5.1
<#
.SYNOPSIS
  OpenClaw Bootstrap Installer for Windows
.DESCRIPTION
  Verifies Node.js and pnpm, then installs or upgrades OpenClaw with pnpm.
  Actual install command:
    pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com
.PARAMETER NodeMirror
  Mirror for Node.js downloads. Used when auto-installing via MSI.
  Example mirrors:
    https://npmmirror.com/mirrors/node
    https://mirrors.huaweicloud.com/nodejs
.PARAMETER AutoInstall
  Automatically install Node.js without prompting when it is not detected.
  Equivalent to the -y flag in the shell script.
.PARAMETER LogFile
  Path to the installation log file.
#>
[CmdletBinding()]
param(
  [string]$NodeMirror = $(if ($env:NODE_MIRROR) { $env:NODE_MIRROR } else { 'https://nodejs.org/dist' }),
  [switch]$AutoInstall,
  [string]$LogFile = $(if ($env:OCLAW_LOG_FILE) { $env:OCLAW_LOG_FILE } else { Join-Path $env:TEMP "openclaw-install-$(Get-Date -Format 'yyyyMMdd-HHmmss').log" })
)

$script:InstallCommand = 'pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com'
# LTS version to install when Node.js is absent (used by MSI fallback); full semver required
$script:NodeLtsVersion = '22.14.0'

function Write-LogLine {
  param([string]$Level, [string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [$Level] $Message"
  Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

function Write-Info { param([string]$Message) Write-Host "  [i] $Message" -ForegroundColor Cyan; Write-LogLine 'INFO' $Message }
function Write-Success { param([string]$Message) Write-Host "  [✔] $Message" -ForegroundColor Green; Write-LogLine 'SUCCESS' $Message }
function Write-Warn { param([string]$Message) Write-Host "  [!] $Message" -ForegroundColor Yellow; Write-LogLine 'WARN' $Message }
function Write-Fail { param([string]$Message) Write-Host "  [✖] $Message" -ForegroundColor Red; Write-LogLine 'ERROR' $Message; throw $Message }

function Get-Version {
  param([string]$Command, [string[]]$Args)
  try {
    $output = & $Command @Args 2>$null
    if (-not $output) { return $null }
    $match = [regex]::Match(($output | Out-String), 'v?(\d+(?:\.\d+)+)')
    if ($match.Success) { return $match.Groups[1].Value }
    return ($output | Select-Object -First 1).ToString().Trim()
  } catch {
    return $null
  }
}

function Install-NodeViaWinget {
  <#
  .SYNOPSIS
    Attempts to install Node.js LTS via winget.
  .OUTPUTS
    Returns $true on success, $false if winget is unavailable.
  #>
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    return $false
  }
  Write-Info "通过 winget 安装 Node.js LTS..."
  winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements -e
  if ($LASTEXITCODE -eq 0) {
    Write-Success 'Node.js 已通过 winget 安装成功。'
    return $true
  }
  Write-Warn 'winget 安装 Node.js 失败，将尝试其他方式。'
  return $false
}

function Install-NodeViaMsi {
  <#
  .SYNOPSIS
    Downloads and silently installs the Node.js LTS MSI using NodeMirror.
  #>
  $arch = if ([System.Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  $lts  = $script:NodeLtsVersion

  # Resolve the latest patch release for the chosen LTS major from the mirror index
  $indexUrl = "$NodeMirror/index.json"
  Write-Info "正在获取 Node.js 版本列表：$indexUrl"
  try {
    $releases = Invoke-RestMethod -Uri $indexUrl -TimeoutSec 30 -ErrorAction Stop
    $majorPattern = [regex]::Escape($lts.Split('.')[0])
    $entry = $releases | Where-Object {
      ($_.version -replace '^v', '') -match "^${majorPattern}\." -and $_.lts -and $_.lts -ne $false
    } | Select-Object -First 1
    if ($entry) { $lts = ($entry.version -replace '^v', '') }
  } catch {
    Write-Warn "无法获取版本列表，将使用内置版本 Node.js $lts。"
  }

  $msiUrl  = "$NodeMirror/v${lts}/node-v${lts}-${arch}.msi"
  $msiPath = Join-Path $env:TEMP "node-v${lts}-${arch}.msi"
  Write-Info "正在下载 Node.js MSI：$msiUrl"
  try {
    Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing -TimeoutSec 300 -ErrorAction Stop
  } catch {
    Write-Fail "下载 Node.js MSI 失败：$_。请手动安装 Node.js：$NodeMirror"
  }

  Write-Info '正在静默安装 Node.js...'
  $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru
  Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
  if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
    Write-Fail "Node.js MSI 安装失败（退出码：$($proc.ExitCode)）。"
  }
  Write-Success 'Node.js 已通过 MSI 安装成功。请重新打开终端以使 PATH 生效，然后重新运行本脚本。'

  # Refresh PATH in the current session so subsequent commands can find node
  $machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path    = (@($machinePath, $userPath) | Where-Object { $_ }) -join ';'
}

function Test-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Warn '未检测到 Node.js。'

    $doInstall = $false
    if ($AutoInstall) {
      $doInstall = $true
    } elseif ([System.Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
      $answer = Read-Host '  是否自动安装 Node.js？[Y/n]'
      $doInstall = ($answer -eq '' -or $answer -match '^[Yy]')
    }

    if (-not $doInstall) {
      Write-Fail "请先手动安装 Node.js 18 或更高版本后再重试。推荐镜像：$NodeMirror"
    }

    # Try winget first, fall back to MSI download
    if (-not (Install-NodeViaWinget)) {
      Install-NodeViaMsi
    }

    # Re-check after installation
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
      Write-Fail 'Node.js 安装完成，但当前终端仍无法识别 node 命令。请重新打开终端后重试。'
    }
  }

  $version = Get-Version 'node' @('--version')
  if (-not $version) {
    Write-Fail '无法获取 Node.js 版本。'
  }

  $major = [int](($version -split '\.')[0])
  if ($major -lt 18) {
    Write-Fail "当前 Node.js 版本为 $version，需要 18 或更高版本。"
  }

  Write-Success "Node.js $version 已就绪。"
}

function Ensure-Pnpm {
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($pnpm) {
    $version = Get-Version 'pnpm' @('--version')
    Write-Success "pnpm $version 已就绪。"
    return
  }

  Write-Info '未检测到 pnpm，正在通过 npm 安装...'
  & npm install -g pnpm
  if ($LASTEXITCODE -ne 0) {
    Write-Fail 'pnpm 安装失败，请先执行 npm install -g pnpm。'
  }

  $version = Get-Version 'pnpm' @('--version')
  if (-not $version) {
    Write-Fail 'pnpm 安装完成，但当前终端无法识别 pnpm。请重新打开终端后重试。'
  }

  Write-Success "pnpm $version 已安装。"
}

function Get-OpenClawVersion {
  return Get-Version 'openclaw' @('--version')
}

function Install-OpenClaw {
  $current = Get-OpenClawVersion
  if ($current) {
    Write-Info "检测到当前 OpenClaw 版本：$current"
  } else {
    Write-Info '当前未检测到 OpenClaw，将执行全新安装。'
  }

  Write-Info "执行命令：$script:InstallCommand"
  & pnpm add -g openclaw@latest --registry=https://registry.npmmirror.com
  if ($LASTEXITCODE -ne 0) {
    Write-Fail 'OpenClaw 安装失败。'
  }

  $installed = Get-OpenClawVersion
  if (-not $installed) {
    Write-Fail '安装完成，但当前终端仍无法识别 openclaw 命令。请确认 pnpm 全局目录已加入 PATH。'
  }

  Write-Success "OpenClaw $installed 安装成功。"
}

try {
  New-Item -ItemType File -Path $LogFile -Force | Out-Null
  Write-Info '开始检查安装环境...'
  Test-Node
  Ensure-Pnpm
  Install-OpenClaw
  Write-Host ''
  Write-Success '全部完成。'
  Write-Host "  日志文件: $LogFile" -ForegroundColor DarkGray
} catch {
  Write-Host ''
  Write-Host "  安装失败: $_" -ForegroundColor Red
  Write-Host "  日志文件: $LogFile" -ForegroundColor Yellow
  exit 1
}
