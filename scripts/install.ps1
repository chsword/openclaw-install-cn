#Requires -Version 5.1
<#
.SYNOPSIS
  OpenClaw Bootstrap Installer for Windows
.DESCRIPTION
  Downloads the oclaw CLI from CDN and installs OpenClaw.
  Does NOT require internet access to npm or GitHub.
  Auto-installs Node.js LTS if it is not already present.
.PARAMETER CdnBase
  CDN base URL. Default: https://openclaw-cdn.example.com
.PARAMETER CliVersion
  CLI version to download. Default: latest
.PARAMETER InstallDir
  OpenClaw installation directory. Default: %LOCALAPPDATA%\OpenClaw
.PARAMETER LocalBundle
  Path to a local bundle directory to skip ALL network downloads
  (offline / air-gap mode).  The directory must mirror the CDN structure:
    {LocalBundle}\cli-manifest.json
    {LocalBundle}\cli\{version}\oclaw-{version}-win32-{arch}.zip
    {LocalBundle}\manifest.json
    {LocalBundle}\{version}\openclaw-{version}-win32-{arch}.zip
  Can also be set via the OCLAW_LOCAL_BUNDLE environment variable.
.PARAMETER NodeMirror
  Mirror URL for Node.js binary downloads (default: https://nodejs.org/dist).
  Override with a China mirror when nodejs.org is inaccessible, e.g.:
    https://npmmirror.com/mirrors/node    (Alibaba/Taobao)
    https://mirrors.huaweicloud.com/nodejs
    https://mirrors.aliyun.com/nodejs-release
.PARAMETER NodeLtsVersion
  Specific Node.js version to install (e.g. "v20.19.1"). Leave empty to
  auto-detect the latest LTS from NodeMirror.
.EXAMPLE
  irm https://your-cdn.example.com/install.ps1 | iex
  # Custom CDN + China Node mirror:
  & ([scriptblock]::Create((irm https://your-cdn.example.com/install.ps1))) `
      -CdnBase "https://your-cdn.example.com" `
      -NodeMirror "https://npmmirror.com/mirrors/node"
  # Offline local bundle:
  & ([scriptblock]::Create((Get-Content install.ps1 -Raw))) `
      -LocalBundle "C:\offline\openclaw-bundle"
#>
[CmdletBinding()]
param(
  [string]$CdnBase        = $(if ($env:OCLAW_CDN)              { $env:OCLAW_CDN }              else { 'https://openclaw-cdn.example.com' }),
  [string]$CliVersion     = 'latest',
  [string]$InstallDir     = '',
  [string]$LocalBundle    = $(if ($env:OCLAW_LOCAL_BUNDLE)     { $env:OCLAW_LOCAL_BUNDLE }     else { '' }),
  [string]$NodeMirror     = $(if ($env:NODE_MIRROR)            { $env:NODE_MIRROR }            else { 'https://nodejs.org/dist' }),
  [string]$NodeLtsVersion = $(if ($env:NODE_LTS_VERSION)       { $env:NODE_LTS_VERSION }       else { '' })
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

# ── Resolve latest Node.js LTS version from mirror index ──────────────────────
function Resolve-NodeLtsVersion {
  $indexUrl = ($NodeMirror.TrimEnd('/') + '/index.json')
  try {
    $raw  = Get-RemoteString $indexUrl
    $data = $raw | ConvertFrom-Json
    # index.json is sorted newest-first by release date.
    # The first entry where .lts is a non-empty string is the latest LTS release.
    $lts  = $data | Where-Object { $_.lts -is [string] -and $_.lts -ne '' } | Select-Object -First 1
    if ($lts) { return $lts.version }
  } catch {
    Write-Warn "Could not detect latest Node.js LTS from ${NodeMirror}: $_"
  }
  Write-Warn 'Falling back to Node.js v20.'
  return 'v20'
}

# Given a major-only string like "v20", resolve to "v20.x.y" via SHASUMS256.txt
function Resolve-NodeMajorToFull {
  param([string]$Major)
  $m = $Major -replace '^v', ''
  try {
    $sumsUrl = ($NodeMirror.TrimEnd('/') + "/latest-v${m}.x/SHASUMS256.txt")
    $sums    = Get-RemoteString $sumsUrl
    $first   = ($sums -split "`n")[0]
    if ($first -match '(v[0-9]+\.[0-9]+\.[0-9]+)') { return $Matches[1] }
  } catch { <# ignore – return original #> }
  return $Major
}

# ── Auto-install Node.js LTS ─────────────────────────────────────────────────
function Install-NodeLts {
  Write-Info "Node.js not found. Auto-installing Node.js LTS..."
  Write-Info "Mirror: $NodeMirror"

  # ── Option 1: winget (Windows Package Manager) ───────────────────────────
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Info "Found winget – using it to install Node.js LTS."
    try {
      & winget install --id OpenJS.NodeJS.LTS -e --silent `
          --accept-source-agreements --accept-package-agreements
      # Refresh PATH in current session
      $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                  [System.Environment]::GetEnvironmentVariable('Path', 'User')
      $nodeVer = & node -e "process.stdout.write(process.versions.node)" 2>$null
      if ($nodeVer) {
        Write-Success "Node.js $nodeVer installed via winget."
        return
      }
    } catch {
      Write-Warn "winget install failed ($_), falling back to direct download."
    }
  }

  # ── Option 2: download MSI from NodeMirror ────────────────────────────────
  $target = if ($NodeLtsVersion) { $NodeLtsVersion } else { Resolve-NodeLtsVersion }
  Write-Info "Resolved LTS version: $target"

  # Expand "v20" to full "v20.x.y"
  if ($target -match '^v\d+$') {
    $full = Resolve-NodeMajorToFull $target
    if ($full -ne $target) {
      $target = $full
      Write-Info "Expanded to: $target"
    }
  }

  # Determine architecture
  $arch = if ([System.Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }

  # ARM64 MSI may not exist for all versions; fall back to x64
  $msiName = "node-${target}-${arch}.msi"
  $msiUrl  = ($NodeMirror.TrimEnd('/') + "/${target}/${msiName}")

  $tmpDir  = Join-Path $env:TEMP 'oclaw-node-bootstrap'
  if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null }
  $msiPath = Join-Path $tmpDir $msiName

  try {
    Get-RemoteFile $msiUrl $msiPath
  } catch {
    # ARM64 MSI download failed – retry with x64 MSI
    if ($arch -eq 'arm64') {
      Write-Warn "ARM64 MSI download failed, retrying with x64..."
      $arch    = 'x64'
      $msiName = "node-${target}-x64.msi"
      $msiUrl  = ($NodeMirror.TrimEnd('/') + "/${target}/${msiName}")
      $msiPath = Join-Path $tmpDir $msiName
      Get-RemoteFile $msiUrl $msiPath
    } else {
      throw
    }
  }

  Write-Info "Installing Node.js $target (silent MSI)..."
  $proc = Start-Process msiexec -ArgumentList "/i `"$msiPath`" /qn /norestart ADDLOCAL=ALL" `
            -Wait -PassThru -NoNewWindow
  if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
    Write-Fail "msiexec exited with code $($proc.ExitCode). Node.js installation failed."
  }

  # Refresh PATH in current session
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path', 'User')

  # Cleanup
  Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

  $nodeVer = & node -e "process.stdout.write(process.versions.node)" 2>$null
  if ($nodeVer) {
    Write-Success "Node.js $nodeVer installed from $NodeMirror."
  } else {
    Write-Fail "Node.js installation appeared to succeed but 'node' is still not found. Please restart your terminal and re-run."
  }
}

# ── Check / install Node.js ───────────────────────────────────────────────────
function Test-NodeJs {
  $nodePath = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodePath) {
    Install-NodeLts
    # Re-check after install
    $nodePath = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodePath) {
      Write-Fail "Node.js installation failed. Please install Node.js >= 18 from https://nodejs.org/ and re-run."
    }
  }

  $nodeVer = & node -e "process.stdout.write(process.versions.node)"
  $major   = [int]($nodeVer -split '\.')[0]
  if ($major -lt 18) {
    Write-Warn "Node.js $nodeVer is too old (need >= 18). Attempting upgrade..."
    Install-NodeLts
    $nodeVer = & node -e "process.stdout.write(process.versions.node)" 2>$null
    $major   = [int]($nodeVer -split '\.')[0]
    if ($major -lt 18) {
      Write-Fail "Node.js >= 18 is required but installation produced $nodeVer. Please upgrade manually."
    }
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

  if ($LocalBundle) {
    Install-FromLocalBundle
  } else {
    Install-FromCdn
  }
}

# ── Online CDN install ────────────────────────────────────────────────────────
function Install-FromCdn {
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

# ── Offline local bundle install ──────────────────────────────────────────────
function Install-FromLocalBundle {
  $bundle = (Resolve-Path $LocalBundle -ErrorAction SilentlyContinue)
  if (-not $bundle) {
    Write-Fail "Local bundle directory not found: $LocalBundle"
  }
  $bundle = $bundle.Path
  Write-Info "Offline mode: using local bundle at $bundle"

  # Node.js is still required to run the oclaw CLI.
  # In local bundle mode we do NOT auto-install Node.js from the internet.
  $nodePath = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodePath) {
    Write-Fail "Node.js is required but not found.
  In offline mode, please install Node.js >= 18 manually before running this script."
  }

  $nodeVer = & node -e "process.stdout.write(process.versions.node)"
  $major   = [int]($nodeVer -split '\.')[0]
  if ($major -lt 18) {
    Write-Fail "Node.js $nodeVer is too old (need >= 18). Please upgrade manually and retry."
  }
  Write-Success "Node.js $nodeVer detected."

  # Ensure bin dir
  if (-not (Test-Path $OclawBinDir)) {
    New-Item -ItemType Directory -Path $OclawBinDir -Force | Out-Null
  }

  # Determine architecture
  $arch = if ([System.Environment]::Is64BitOperatingSystem) { 'x64' } else { 'ia32' }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }

  # Read CLI version from local cli-manifest.json
  $cliManifestPath = Join-Path $bundle 'cli-manifest.json'
  if (-not (Test-Path $cliManifestPath)) {
    Write-Fail "cli-manifest.json not found in bundle: $bundle"
  }
  $cliManifest = Get-Content $cliManifestPath -Raw | ConvertFrom-Json
  $cliVer = $cliManifest.latest
  Write-Info "CLI version from local bundle: $cliVer"

  # Locate CLI archive in bundle
  $cliPkgName = "oclaw-${cliVer}-win32-${arch}.zip"
  $cliPkgPath = Join-Path $bundle "cli\$cliVer\$cliPkgName"
  if (-not (Test-Path $cliPkgPath)) {
    Write-Fail "CLI package not found in bundle: $cliPkgPath"
  }

  $tmpDir = Join-Path $env:TEMP "oclaw-local-bootstrap"
  if (-not (Test-Path $tmpDir)) {
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
  }

  Write-Info "Extracting oclaw CLI from local bundle..."
  Expand-Archive -Force -Path $cliPkgPath -DestinationPath $tmpDir

  $exePath = Get-ChildItem -Path $tmpDir -Filter 'oclaw.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $exePath) {
    Write-Fail "Could not find oclaw.exe in CLI package."
  }

  Copy-Item -Path $exePath.FullName -Destination (Join-Path $OclawBinDir 'oclaw.exe') -Force
  Write-Success "oclaw CLI installed to $OclawBinDir\oclaw.exe"

  # Add to PATH for this session
  $env:Path = "$OclawBinDir;$env:Path"

  # Install OpenClaw from local bundle
  Write-Info "Installing OpenClaw from local bundle..."
  & "$OclawBinDir\oclaw.exe" install --dir $InstallDir --local-package $bundle

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
