#!/usr/bin/env pwsh
<#
.SYNOPSIS
  bootstraps a fresh windows install (just vscode/git/github desktop) into
  everything build.ps1 needs to produce a charnel (freqhole) tauri installer.

.DESCRIPTION
  idempotent - safe to re-run after a partial failure. installs, in order:
    - rust (via rustup), pinned to the msvc host toolchain
    - the MSVC "desktop development with C++" build tools (needed to link
      rust/tauri on windows)
    - node.js LTS
    - the webview2 runtime (tauri's windows webview)
    - the sqlite3 CLI (used to apply freqhole's view/blob-db setup, same as
      `make db-migrate` does on macOS/linux via the sqlite3 cli there)
    - perl (openssl-sys builds OpenSSL from source ("vendored") on windows,
      and its ./Configure script requires perl - there's no prebuilt openssl
      it can link against instead here, unlike macOS/linux)
    - git (belt-and-suspenders - you're assumed to already have this)
    - sqlx-cli (for running freqhole's sql migrations without needing `make`)
  finishes by invoking build.ps1, so a fresh machine really can go all the
  way to a built installer with just this one script.

.PARAMETER SkipBuild
  bootstrap the toolchain only; don't invoke build.ps1 at the end.

.NOTES
  run from an elevated (administrator) powershell prompt - the MSVC build
  tools installer requires it. everything else in this script would work
  unelevated, but splitting that out isn't worth the complexity.

  one manual prerequisite on a genuinely fresh windows install: powershell's
  default execution policy (Restricted) blocks running *any* .ps1 file,
  including this one, so it can't fix itself. run this once per terminal
  session before invoking this script (process-scoped, doesn't change any
  system-wide setting):

    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

  a missing/broken winget (seen on some fresh/minimal installs - the
  Microsoft.DesktopAppInstaller appx package is present but is an old stub
  with no winget.exe in it) IS handled automatically below via the official
  Microsoft.WinGet.Client module's Repair-WinGetPackageManager cmdlet - no
  manual step needed for that one.
#>

[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$failures = @()

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    Write-Error "this script must be run from an elevated (administrator) powershell prompt (the MSVC build tools installer requires it)."
    exit 1
}

# winget writes to HKCU/HKLM PATH entries that this process doesn't see yet -
# re-read them so a tool installed earlier in this same run (e.g. rustup,
# node) is immediately usable by a later step (e.g. `cargo install sqlx-cli`)
# without needing to open a new terminal.
function Update-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

# runs a winget install and treats "already installed / no newer version"
# as success rather than aborting the whole bootstrap. real failures
# (package not found, download error, etc.) are recorded in $failures and
# reported at the end instead of stopping the script immediately - one
# missing package shouldn't block the rest of the toolchain from installing.
function Install-WingetPackage {
    param(
        [Parameter(Mandatory)][string]$Id,
        [string]$Override
    )

    Write-Host ""
    Write-Host "== installing $Id ==" -ForegroundColor Cyan

    $wingetArgs = @(
        "install", "--id", $Id, "-e",
        "--accept-package-agreements", "--accept-source-agreements",
        "--disable-interactivity"
    )
    if ($Override) {
        $wingetArgs += @("--override", $Override)
    }

    & winget @wingetArgs
    $exitCode = $LASTEXITCODE

    # 0 = installed. -1978335189 (0x8A15002B) = already installed / no
    # update available - not a failure, just a no-op.
    if ($exitCode -eq 0 -or $exitCode -eq -1978335189) {
        Write-Host "  ok ($Id)" -ForegroundColor Green
    }
    else {
        Write-Warning "  winget install failed for $Id (exit code $exitCode) - continuing with the rest of the toolchain."
        $script:failures += $Id
    }

    Update-SessionPath
}

# winget ships with modern windows 10/11, but some fresh/minimal installs
# only have the old Microsoft.DesktopAppInstaller stub package (no winget.exe
# inside it). repair via the official Microsoft.WinGet.Client module instead
# of failing outright - this is what fixed it during testing.
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "== winget not found - attempting repair via Microsoft.WinGet.Client ==" -ForegroundColor Yellow

    if (-not (Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) {
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
    }
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
    Install-Module -Name Microsoft.WinGet.Client -Force -Scope AllUsers
    Import-Module Microsoft.WinGet.Client
    Repair-WinGetPackageManager -Force
    Update-SessionPath

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Error "winget still not found after automatic repair. see https://learn.microsoft.com/windows/package-manager/winget/ to install it manually, then re-run this script."
        exit 1
    }
    Write-Host "  winget repaired." -ForegroundColor Green
}

Install-WingetPackage -Id "Git.Git"
Install-WingetPackage -Id "Rustlang.Rustup"
Install-WingetPackage -Id "OpenJS.NodeJS.LTS"
Install-WingetPackage -Id "Microsoft.EdgeWebView2Runtime"
Install-WingetPackage -Id "SQLite.SQLite"
Install-WingetPackage -Id "StrawberryPerl.StrawberryPerl"

# the single heaviest/slowest step here - the visual studio bootstrapper
# downloads and installs the C++ build tools workload, easily 5-15+ minutes
# depending on connection speed.
Write-Host ""
Write-Host "installing MSVC build tools (this is the slow one - can take 5-15+ minutes)..." -ForegroundColor Yellow
Install-WingetPackage -Id "Microsoft.VisualStudio.2022.BuildTools" `
    -Override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Update-SessionPath

if (Get-Command rustup -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "== configuring rust toolchain ==" -ForegroundColor Cyan
    & rustup default stable-x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "rustup default failed (exit code $LASTEXITCODE)."
        $failures += "rustup default stable-x86_64-pc-windows-msvc"
    }
}
else {
    Write-Warning "rustup not found on PATH after install - open a new terminal and run: rustup default stable-x86_64-pc-windows-msvc"
    $failures += "rustup default stable-x86_64-pc-windows-msvc"
}

if (Get-Command cargo -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "== installing sqlx-cli (for running freqhole's sql migrations) ==" -ForegroundColor Cyan
    & cargo install sqlx-cli --no-default-features --features sqlite,rustls --locked
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "cargo install sqlx-cli failed (exit code $LASTEXITCODE)."
        $failures += "cargo install sqlx-cli"
    }
    Update-SessionPath
}
else {
    Write-Warning "cargo not found on PATH - open a new terminal and re-run this script so sqlx-cli can be installed."
    $failures += "cargo install sqlx-cli"
}

Write-Host ""
if ($failures.Count -eq 0) {
    Write-Host "toolchain bootstrap complete." -ForegroundColor Green
}
else {
    Write-Warning "toolchain bootstrap finished with issues in: $($failures -join ', ')"
    Write-Warning "re-run this script (it's idempotent) after resolving those, or install them manually."
}

if ($SkipBuild) {
    Write-Host ""
    Write-Host "skipping build (-SkipBuild set). run scripts\windows\build.ps1 when you're ready." -ForegroundColor Yellow
    exit 0
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "not auto-continuing to build.ps1 because of the issues above - open a new terminal (so PATH updates take effect), fix them, and re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "== toolchain ready - handing off to build.ps1 ==" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "build.ps1")
exit $LASTEXITCODE
