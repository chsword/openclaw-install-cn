#Requires -Version 5.1
<#
.SYNOPSIS
  OpenClaw Bootstrap Installer for Windows
.DESCRIPTION
  Downloads the oclaw CLI from CDN and installs OpenClaw.
  Does NOT require internet access to npm or GitHub.
  Auto-installs Node.js LTS if it is not already present.
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
.PARAMETER LogFile
  Path to the installation log file. All messages are written here in addition
  to the console. Defaults to a timestamped file in %TEMP%.
  Can also be set via the OCLAW_LOG_FILE environment variable.
.EXAMPLE
  irm https://oclaw.chatu.plus/install.ps1 | iex
  # China Node mirror:
  & ([scriptblock]::Create((irm https://oclaw.chatu.plus/install.ps1))) `
      -NodeMirror "https://npmmirror.com/mirrors/node"
  # Offline local bundle:
  & ([scriptblock]::Create((Get-Content install.ps1 -Raw))) `
      -LocalBundle "C:\offline\openclaw-bundle"
  # Custom log file + verbose output:
  $env:OCLAW_LOG_FILE = "C:\logs\openclaw.log"
  $env:OCLAW_VERBOSE  = "1"
  irm https://oclaw.chatu.plus/install.ps1 | iex
#>
[CmdletBinding()]
param(
  [string]$CdnBase        = 'https://oclaw.chatu.plus',
  [string]$CliVersion     = 'latest',
  [string]$InstallDir     = '',
  [string]$LocalBundle    = $(if ($env:OCLAW_LOCAL_BUNDLE)     { $env:OCLAW_LOCAL_BUNDLE }     else { '' }),
  [string]$NodeMirror     = $(if ($env:NODE_MIRROR)            { $env:NODE_MIRROR }            else { 'https://nodejs.org/dist' }),
  [string]$NodeLtsVersion = $(if ($env:NODE_LTS_VERSION)       { $env:NODE_LTS_VERSION }       else { '' }),
  [string]$LogFile        = $(if ($env:OCLAW_LOG_FILE)         { $env:OCLAW_LOG_FILE }         else { Join-Path $env:TEMP "openclaw-install-$(Get-Date -Format 'yyyyMMdd-HHmmss').log" })
)

# ── Defaults ─────────────────────────────────────────────────────────────────
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'OpenClaw' }
$OclawBinDir = Join-Path $env:LOCALAPPDATA 'oclaw\bin'
$script:_logWarned = $false

# ── Log file helpers ──────────────────────────────────────────────────────────
function Write-Log {
  param([string]$Level, [string]$Msg)
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $line = "[$ts] [$Level] $Msg"
  try {
    Add-Content -Path $LogFile -Value $line -ErrorAction Stop
  } catch {
    # Log write failed – warn once, then suppress further logging to avoid noise.
    if (-not $script:_logWarned) {
      $script:_logWarned = $true
      Write-Host "  [!] Warning: cannot write to log file: $LogFile (proceeding without logging)" -ForegroundColor Yellow
    }
  }
}

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Info    { param($Msg) Write-Host "  [i] $Msg" -ForegroundColor Cyan;   Write-Log 'INFO   ' $Msg }
function Write-Success { param($Msg) Write-Host "  [✔] $Msg" -ForegroundColor Green;  Write-Log 'SUCCESS' $Msg }
function Write-Warn    { param($Msg) Write-Host "  [!] $Msg" -ForegroundColor Yellow; Write-Log 'WARN   ' $Msg }
function Write-Verbose-Log {
  param($Msg)
  Write-Log 'VERBOSE' $Msg
  if ($env:OCLAW_VERBOSE) { Write-Host "    »  $Msg" -ForegroundColor DarkCyan }
}
function Write-Fail {
  param($Msg)
  Write-Host "  [✖] $Msg" -ForegroundColor Red
  Write-Log 'ERROR  ' $Msg
  Write-Host ""
  if (-not $script:_logWarned) {
    Write-Host "  Log file: $LogFile" -ForegroundColor Yellow
  }
  throw $Msg
}

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

# ── SHA-256 checksum verification ────────────────────────────────────────────
function Confirm-Sha256 {
  param([string]$FilePath, [string]$Expected)
  # Strip optional "sha256:" prefix
  $expectedHex = $Expected -replace '^sha256:', ''
  $actualHex   = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash.ToLower()
  if ($actualHex -ne $expectedHex.ToLower()) {
    Write-Fail ("Checksum mismatch for $(Split-Path $FilePath -Leaf):`n" +
      "  Expected: $expectedHex`n" +
      "  Got:      $actualHex`n" +
      'The downloaded file may be corrupted or tampered with. Please re-run the installer.')
  }
  Write-Verbose-Log "Checksum verified: $actualHex"
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
  # Initialise log file
  $null = New-Item -ItemType File -Path $LogFile -Force -ErrorAction SilentlyContinue
  Write-Log 'INFO   ' '============================================================'
  Write-Log 'INFO   ' 'OpenClaw Installer Bootstrap'
  Write-Log 'INFO   ' "Date:        $(Get-Date)"
  Write-Log 'INFO   ' "OS:          $([System.Environment]::OSVersion.VersionString)"
  Write-Log 'INFO   ' "CDN:         $CdnBase"
  Write-Log 'INFO   ' "Install dir: $InstallDir"
  Write-Log 'INFO   ' "Bin dir:     $OclawBinDir"
  Write-Log 'INFO   ' "Log file:    $LogFile"
  if ($LocalBundle) { Write-Log 'INFO   ' "Local bundle: $LocalBundle" }
  if ($env:OCLAW_VERBOSE) { Write-Log 'INFO   ' 'Verbose:     enabled' }
  Write-Log 'INFO   ' '============================================================'

  Write-Host ""
  Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Blue
  Write-Host "  ║    OpenClaw Installer Bootstrap      ║" -ForegroundColor Blue
  Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Blue
  Write-Host ""
  Write-Verbose-Log "Log file: $LogFile"

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

  # Resolve CLI version and fetch checksum from the manifest in one request.
  $cliVer = $CliVersion
  $cliManifest = $null
  if ($cliVer -eq 'latest') {
    Write-Info "Fetching latest CLI version..."
    try {
      $cliManifest = Get-RemoteString "$CdnBase/cli-manifest.json" | ConvertFrom-Json
      $cliVer      = $cliManifest.latest
      Write-Info "Latest CLI version: $cliVer"
    } catch {
      Write-Fail "Could not fetch CLI manifest: $_"
    }
  } else {
    # Still fetch the manifest so we can verify the checksum.
    try {
      $cliManifest = Get-RemoteString "$CdnBase/cli-manifest.json" | ConvertFrom-Json
    } catch {
      Write-Warn "Could not fetch CLI manifest for checksum verification: $_"
    }
  }

  # Determine architecture
  # Windows ARM64 can run x64 executables via emulation; fall back to x64 if
  # an arm64-specific CLI package is unavailable.
  $arch = if ([System.Environment]::Is64BitOperatingSystem) { 'x64' } else { 'ia32' }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  Write-Verbose-Log "Platform: win32-${arch}"

  $pkgName = "oclaw-${cliVer}-win32-${arch}.zip"
  $pkgUrl  = "$CdnBase/cli/$cliVer/$pkgName"
  Write-Verbose-Log "CLI package URL: $pkgUrl"

  # ARM64: fall back to x64 if the arm64 package is unavailable
  if ($arch -eq 'arm64') {
    try {
      Invoke-WebRequest -Uri $pkgUrl -Method Head -UseBasicParsing -TimeoutSec 10 | Out-Null
    } catch {
      Write-Warn "arm64 CLI package not found on CDN, falling back to x64..."
      $arch    = 'x64'
      $pkgName = "oclaw-${cliVer}-win32-x64.zip"
      $pkgUrl  = "$CdnBase/cli/$cliVer/$pkgName"
      Write-Verbose-Log "Fallback CLI package URL: $pkgUrl"
    }
  }

  # Extract expected checksum for the resolved platform key.
  $platformKey      = "win32-${arch}"
  $expectedChecksum = $null
  if ($cliManifest) {
    $verEntry = $cliManifest.versions | Where-Object { $_.version -eq $cliVer } | Select-Object -First 1
    if ($verEntry -and $verEntry.checksums) {
      $expectedChecksum = $verEntry.checksums.$platformKey
    }
  }

  $tmpDir  = Join-Path $env:TEMP "oclaw-bootstrap"
  $pkgPath = Join-Path $tmpDir $pkgName
  Write-Verbose-Log "Temporary directory: $tmpDir"

  if (-not (Test-Path $tmpDir)) {
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
  }

  Write-Info "Downloading oclaw CLI $cliVer..."
  try {
    Get-RemoteFile $pkgUrl $pkgPath
  } catch {
    Write-Fail "Download failed: $_"
  }

  # Verify SHA-256 checksum of the downloaded package.
  if ($expectedChecksum) {
    Write-Info "Verifying checksum..."
    Confirm-Sha256 -FilePath $pkgPath -Expected $expectedChecksum
    Write-Success "Checksum verified."
  } else {
    Write-Warn "No checksum available for ${platformKey} in CLI manifest; skipping verification."
  }

  Write-Info "Extracting..."
  Expand-Archive -Force -LiteralPath "$pkgPath" -DestinationPath "$tmpDir"

  # Find oclaw.exe
  $exePath = Get-ChildItem -Path $tmpDir -Filter 'oclaw.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $exePath) {
    Write-Fail "Could not find oclaw.exe in downloaded package."
  }

  Copy-Item -Path $exePath.FullName -Destination (Join-Path $OclawBinDir 'oclaw.exe') -Force
  Write-Success "oclaw CLI installed to $OclawBinDir\oclaw.exe"

  # Add to PATH for this session
  $env:Path = "$OclawBinDir;$env:Path"

  # Install OpenClaw
  Write-Info "Installing OpenClaw from CDN ($CdnBase)..."
  & "$OclawBinDir\oclaw.exe" install --dir "$InstallDir"

  Write-Host ""
  Write-Success "OpenClaw installed successfully!"
  Write-Host ""
  Write-Verbose-Log "Installation log: $LogFile"

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
  # Windows ARM64 can run x64 executables via emulation; fall back to x64 if
  # an arm64-specific CLI package is not present in the bundle.
  $arch = if ([System.Environment]::Is64BitOperatingSystem) { 'x64' } else { 'ia32' }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  Write-Verbose-Log "Platform: win32-${arch}"

  # Read CLI version from local cli-manifest.json
  $cliManifestPath = Join-Path $bundle 'cli-manifest.json'
  if (-not (Test-Path $cliManifestPath)) {
    Write-Fail "cli-manifest.json not found in bundle: $bundle"
  }
  $cliManifest = Get-Content $cliManifestPath -Raw | ConvertFrom-Json
  $cliVer = $cliManifest.latest
  Write-Info "CLI version from local bundle: $cliVer"

  # Locate CLI archive in bundle; fall back from arm64 to x64 if needed
  $cliPkgName = "oclaw-${cliVer}-win32-${arch}.zip"
  $cliPkgPath = Join-Path $bundle "cli\$cliVer\$cliPkgName"
  Write-Verbose-Log "CLI package path: $cliPkgPath"
  if ($arch -eq 'arm64' -and -not (Test-Path $cliPkgPath)) {
    Write-Warn "arm64 CLI package not found in bundle, falling back to x64..."
    $arch       = 'x64'
    $cliPkgName = "oclaw-${cliVer}-win32-x64.zip"
    $cliPkgPath = Join-Path $bundle "cli\$cliVer\$cliPkgName"
    Write-Verbose-Log "Fallback CLI package path: $cliPkgPath"
  }
  if (-not (Test-Path $cliPkgPath)) {
    Write-Fail "CLI package not found in bundle: $cliPkgPath"
  }

  $tmpDir = Join-Path $env:TEMP "oclaw-local-bootstrap"
  Write-Verbose-Log "Temporary directory: $tmpDir"
  if (-not (Test-Path $tmpDir)) {
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
  }

  Write-Info "Extracting oclaw CLI from local bundle..."
  Expand-Archive -Force -LiteralPath "$cliPkgPath" -DestinationPath "$tmpDir"

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
  & "$OclawBinDir\oclaw.exe" install --dir "$InstallDir" --local-package "$bundle"

  Write-Host ""
  Write-Success "OpenClaw installed successfully!"
  Write-Host ""
  Write-Verbose-Log "Installation log: $LogFile"

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
  if (-not $script:_logWarned) {
    Write-Host "  Log file: $LogFile" -ForegroundColor Yellow
  }
  exit 1
}
