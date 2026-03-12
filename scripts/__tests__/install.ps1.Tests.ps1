#Requires -Version 5.1
<#
.SYNOPSIS
  Pester 5 unit tests for scripts/install.ps1
.DESCRIPTION
  Dot-sources install.ps1 with -IsTestRun so the main execution block is
  skipped, then tests individual functions in isolation using Pester mocks.
#>

BeforeAll {
  $script:ScriptPath = Join-Path $PSScriptRoot '..' 'install.ps1'
  $script:TestLog    = Join-Path $TestDrive 'test.log'

  # Dot-source the script to import all functions without running the installer.
  . $script:ScriptPath -IsTestRun -LogFile $script:TestLog
}

# ── Get-Version ───────────────────────────────────────────────────────────────

Describe 'Get-Version' {

  It 'extracts semver from v-prefixed output' {
    function global:Invoke-FakeNodeV18 { 'v18.0.0' }
    $result = Get-Version 'Invoke-FakeNodeV18' @()
    $result | Should -Be '18.0.0'
  }

  It 'strips leading v' {
    function global:Invoke-FakeNodeV22 { 'v22.14.0' }
    $result = Get-Version 'Invoke-FakeNodeV22' @()
    $result | Should -Be '22.14.0'
  }

  It 'returns null for a non-existent command' {
    $result = Get-Version 'NonExistentCommand_xyz_abc' @()
    $result | Should -BeNullOrEmpty
  }

  It 'returns null when command produces no output' {
    function global:Invoke-EmptyCmd { }
    $result = Get-Version 'Invoke-EmptyCmd' @()
    $result | Should -BeNullOrEmpty
  }

  It 'extracts version embedded in a longer string' {
    function global:Invoke-FakeNpm { 'npm version 10.2.0 (some extra text)' }
    $result = Get-Version 'Invoke-FakeNpm' @()
    $result | Should -Be '10.2.0'
  }
}

# ── Test-Node ─────────────────────────────────────────────────────────────────

Describe 'Test-Node' {

  Context 'node is present with version >= 18' {
    BeforeAll {
      Mock Get-Command {
        [PSCustomObject]@{ Name = 'node'; Source = 'C:\mock\node.exe' }
      } -ParameterFilter { $Name -eq 'node' }
      Mock Get-Version { '18.0.0' } -ParameterFilter { $Command -eq 'node' }
    }

    It 'does not throw' {
      { Test-Node } | Should -Not -Throw
    }
  }

  Context 'node is present but version < 18' {
    BeforeAll {
      Mock Get-Command {
        [PSCustomObject]@{ Name = 'node'; Source = 'C:\mock\node.exe' }
      } -ParameterFilter { $Name -eq 'node' }
      Mock Get-Version { '16.20.0' } -ParameterFilter { $Command -eq 'node' }
    }

    It 'throws because version is too old' {
      { Test-Node } | Should -Throw
    }
  }

  Context 'node is absent and AutoInstall is false (non-interactive)' {
    BeforeAll {
      Mock Get-Command { $null } -ParameterFilter { $Name -eq 'node' }
      # Simulate user answering 'n' so the interactive prompt doesn't hang
      Mock Read-Host { 'n' }
    }

    It 'throws because node is missing' {
      { Test-Node } | Should -Throw
    }
  }
}

# ── Ensure-Pnpm ───────────────────────────────────────────────────────────────

Describe 'Ensure-Pnpm' {

  Context 'pnpm is already installed' {
    BeforeAll {
      Mock Get-Command {
        [PSCustomObject]@{ Name = 'pnpm'; Source = 'C:\mock\pnpm.cmd' }
      } -ParameterFilter { $Name -eq 'pnpm' }
      Mock Get-Version { '9.0.0' } -ParameterFilter { $Command -eq 'pnpm' }
    }

    It 'does not throw' {
      { Ensure-Pnpm } | Should -Not -Throw
    }
  }

  Context 'pnpm is absent but npm install succeeds' {
    BeforeAll {
      Mock Get-Command { $null } -ParameterFilter { $Name -eq 'pnpm' }
      # Invoke-Npm wraps & npm; mocking it avoids calling the real npm on CI
      Mock Invoke-Npm { $global:LASTEXITCODE = 0 }
      # After npm install, Get-Version finds pnpm
      Mock Get-Version { '9.0.0' } -ParameterFilter { $Command -eq 'pnpm' }
    }

    It 'does not throw' {
      { Ensure-Pnpm } | Should -Not -Throw
    }
  }

  Context 'pnpm is absent and npm install fails' {
    BeforeAll {
      Mock Get-Command { $null } -ParameterFilter { $Name -eq 'pnpm' }
      Mock Invoke-Npm { $global:LASTEXITCODE = 1 }
    }

    It 'throws because npm install failed' {
      { Ensure-Pnpm } | Should -Throw
    }
  }
}

# ── Install-OpenClaw ──────────────────────────────────────────────────────────

Describe 'Install-OpenClaw' {

  Context 'pnpm install succeeds and openclaw is available' {
    BeforeAll {
      # Invoke-Pnpm wraps & pnpm; mocking it avoids calling the real pnpm on CI
      Mock Invoke-Pnpm { $global:LASTEXITCODE = 0 }
      Mock Get-Version {
        if ($Command -eq 'openclaw') { '1.0.25' } else { $null }
      }
    }

    It 'does not throw' {
      { Install-OpenClaw } | Should -Not -Throw
    }
  }

  Context 'pnpm install exits non-zero' {
    BeforeAll {
      Mock Invoke-Pnpm { $global:LASTEXITCODE = 1 }
    }

    It 'throws because pnpm failed' {
      { Install-OpenClaw } | Should -Throw
    }
  }

  Context 'pnpm install succeeds but openclaw not found afterwards' {
    BeforeAll {
      Mock Invoke-Pnpm { $global:LASTEXITCODE = 0 }
      Mock Get-Version { $null }
    }

    It 'throws because openclaw is not in PATH' {
      { Install-OpenClaw } | Should -Throw
    }
  }
}

# ── Write-Fail ────────────────────────────────────────────────────────────────

Describe 'Write-Fail' {
  It 'throws with the provided message' {
    { Write-Fail 'test error message' } | Should -Throw 'test error message'
  }
}
