#!/usr/bin/env pwsh
<#
.SYNOPSIS
  installs ffmpeg + yt-dlp on windows and puts both on PATH.

.DESCRIPTION
  optional runtime dependencies for freqhole (not needed to build/run the
  app itself, only for audio processing / album art / waveforms / url
  fetch). idempotent - safe to re-run.

  installs via winget:
    - Gyan.FFmpeg (ffmpeg + ffprobe, a winget "portable" package - winget
      adds it to PATH itself via its portable-package symlink mechanism,
      no manual PATH edit or freqhole-config.toml changes needed)
    - yt-dlp.yt-dlp (also a winget portable package, same PATH handling)

  freqhole's config defaults to the bare names "ffmpeg"/"ffprobe", and
  looks up yt-dlp on PATH too (see grimoire/src/setup/checks.rs) - once
  these are resolvable via `Get-Command`, no config file edits are needed.

.NOTES
  does not require an elevated/administrator prompt (unlike
  install-toolchain.ps1) - winget installs portable packages per-user.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$failures = @()

function Update-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Install-WingetPackage {
    param(
        [Parameter(Mandatory)][string]$Id
    )

    Write-Host ""
    Write-Host "== installing $Id ==" -ForegroundColor Cyan

    & winget install --id $Id -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    $exitCode = $LASTEXITCODE

    # 0 = installed. -1978335189 (0x8A15002B) = already installed / no
    # update available - not a failure, just a no-op.
    if ($exitCode -eq 0 -or $exitCode -eq -1978335189) {
        Write-Host "  ok ($Id)" -ForegroundColor Green
    }
    else {
        Write-Warning "winget install failed for $Id (exit code $exitCode)"
        $script:failures += $Id
    }

    Update-SessionPath
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Error "winget not found. run scripts\windows\install-toolchain.ps1 first (it auto-repairs a missing/broken winget)."
    exit 1
}

Install-WingetPackage -Id "Gyan.FFmpeg"
Install-WingetPackage -Id "yt-dlp.yt-dlp"

Write-Host ""
Write-Host "== verifying ==" -ForegroundColor Cyan
$tools = @("ffmpeg", "ffprobe", "yt-dlp")
$missing = @()
foreach ($tool in $tools) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if ($cmd) {
        Write-Host "  $tool -> $($cmd.Source)" -ForegroundColor Green
    }
    else {
        Write-Warning "$tool not found on PATH"
        $missing += $tool
    }
}

if ($failures -or $missing) {
    Write-Host ""
    Write-Warning "some steps did not complete: winget failures=[$($failures -join ', ')] missing on PATH=[$($missing -join ', ')]"
    Write-Host "if a tool is missing right after a fresh install, open a new terminal (PATH changes from an msi/portable installer don't always reach an already-open session) and re-run this script to verify." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "== done - ffmpeg, ffprobe, and yt-dlp are all on PATH ==" -ForegroundColor Green
