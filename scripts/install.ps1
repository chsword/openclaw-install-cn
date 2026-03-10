#Requires -Version 5.1
<#
.SYNOPSIS
  OpenClaw Bootstrap Installer for Windows
.DESCRIPTION
  Downloads the oclaw CLI from CDN and installs OpenClaw.
  Does NOT require internet access to npm or GitHub.
.PARAMETER CdnBase
  CDN base URL. Default: https://openclaw-cdn.example.com
.PARAMETER CliVersion
  CLI version to download. Default: latest
.PARAMETER InstallDir
  OpenClaw installation directory. Default: %LOCALAPPDATA%\OpenClaw
.EXAMPLE
  irm https://your-cdn.example.com/install.ps1 | iex
  # or with custom CDN:
  & ([scriptblock]::Create((irm https://your-cdn.example.com/install.ps1))) -CdnBase "https://your-cdn.example.com"
#>
[CmdletBinding()]
param(
  [string]$CdnBase     = $(if ($env:OCLAW_CDN) { $env:OCLAW_CDN } else { 'https://openclaw-cdn.example.com' }),
  [string]$CliVersion  = 'latest',
  [string]$InstallDir  = ''
)

# ── Defaults ─────────────────────────────────────────────────────────────────
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'OpenClaw' }
$OclawBinDir = Join-Path $env:LOCALAPPDATA 'oclaw\bin'

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Info    { param($Msg) Write-Host "  [i] $Msg" -ForegroundColor Cyan }
function Write-Success { param($Msg) Write-Host "  [✔] $Msg" -ForegroundColor Green }
function Write-Warn    { param($Msg) Write-Host "  [!] $Msg" -ForegroundColor Yellow }
function Write-Fail    { param($Msg) Write-Host "  [✖] $Msg" -ForegroundColor Red; throw $Msg }

function Get-RemoteString {
  param([string]$Url)
  $wc = New-Object System.Net.WebClient
  $wc.Encoding = [System.Text.Encoding]::UTF8
  return $wc.DownloadString($Url)
}

function Get-RemoteFile {
  param([string]$Url, [string]$Dest)
  $wc = New-Object System.Net.WebClient
  Write-Info "Downloading from: $Url"
  $wc.DownloadFile($Url, $Dest)
}

# ── Check Node.js ─────────────────────────────────────────────────────────────
function Test-NodeJs {
  $nodePath = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodePath) {
    Write-Fail "Node.js is not installed. Please install Node.js >= 18 from https://nodejs.org/ and re-run."
  }
  $nodeVer = & node -e "process.stdout.write(process.versions.node)"
  $major   = [int]($nodeVer -split '\.')[0]
  if ($major -lt 18) {
    Write-Fail "Node.js >= 18 required (found $nodeVer). Please upgrade."
  }
  Write-Success "Node.js $nodeVer detected."
}

# ── Main ──────────────────────────────────────────────────────────────────────
function Main {
  Write-Host ""
  Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Blue
  Write-Host "  ║    OpenClaw Installer Bootstrap      ║" -ForegroundColor Blue
  Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Blue
  Write-Host ""

  Test-NodeJs

  # Ensure bin dir
  if (-not (Test-Path $OclawBinDir)) {
    New-Item -ItemType Directory -Path $OclawBinDir -Force | Out-Null
  }

  # Resolve CLI version
  $cliVer = $CliVersion
  if ($cliVer -eq 'latest') {
    Write-Info "Fetching latest CLI version..."
    try {
      $manifest = Get-RemoteString "$CdnBase/cli-manifest.json" | ConvertFrom-Json
      $cliVer   = $manifest.latest
      Write-Info "Latest CLI version: $cliVer"
    } catch {
      Write-Fail "Could not fetch CLI manifest: $_"
    }
  }

  # Determine architecture
  $arch = if ([System.Environment]::Is64BitOperatingSystem) { 'x64' } else { 'ia32' }
  # ARM detection
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }

  $pkgName = "oclaw-${cliVer}-win32-${arch}.zip"
  $pkgUrl  = "$CdnBase/cli/$cliVer/$pkgName"
  $tmpDir  = Join-Path $env:TEMP "oclaw-bootstrap"
  $pkgPath = Join-Path $tmpDir $pkgName

  if (-not (Test-Path $tmpDir)) {
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
  }

  Write-Info "Downloading oclaw CLI $cliVer..."
  try {
    Get-RemoteFile $pkgUrl $pkgPath
  } catch {
    Write-Fail "Download failed: $_"
  }

  Write-Info "Extracting..."
  Expand-Archive -Force -Path $pkgPath -DestinationPath $tmpDir

  # Find oclaw.exe
  $exePath = Get-ChildItem -Path $tmpDir -Filter 'oclaw.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $exePath) {
    Write-Fail "Could not find oclaw.exe in downloaded package."
  }

  Copy-Item -Path $exePath.FullName -Destination (Join-Path $OclawBinDir 'oclaw.exe') -Force
  Write-Success "oclaw CLI installed to $OclawBinDir\oclaw.exe"

  # Add to PATH for this session
  $env:Path = "$OclawBinDir;$env:Path"

  # Set CDN config
  & "$OclawBinDir\oclaw.exe" config --cdn-url $CdnBase 2>$null

  # Install OpenClaw
  Write-Info "Installing OpenClaw from CDN ($CdnBase)..."
  & "$OclawBinDir\oclaw.exe" install --dir $InstallDir

  Write-Host ""
  Write-Success "OpenClaw installed successfully!"
  Write-Host ""

  # Add to system PATH permanently
  $currentPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if ($currentPath -notlike "*$OclawBinDir*") {
    [System.Environment]::SetEnvironmentVariable(
      'Path',
      "$currentPath;$OclawBinDir",
      'User'
    )
    Write-Info "Added $OclawBinDir to user PATH."
    Write-Warn "Restart your terminal for PATH changes to take effect."
  }

  # Cleanup temp
  Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

try {
  Main
} catch {
  Write-Host ""
  Write-Host "  Installation failed: $_" -ForegroundColor Red
  exit 1
}
