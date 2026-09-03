#!/usr/bin/env pwsh
<#
.SYNOPSIS
  builds the charnel (freqhole) tauri app for windows x86_64. shared by both
  local dev and CI (release.yml should just call `pwsh scripts/windows/build.ps1`)
  so the build steps only ever live in one place.

.DESCRIPTION
  assumes the toolchain from install-toolchain.ps1 is already installed
  (rust/msvc build tools/node/webview2/sqlite3/sqlx-cli). steps:
    1. set up the local sqlite db (migrations + views + blob_data) using
       sqlx-cli + the sqlite3 cli - the windows equivalent of `make db-migrate`,
       without needing `make`/`sed`/bash.
    2. build the haruspex/reliquary/cenotaph ts libs + the spume web client
       (skippable with -SkipSpume for a fast rust-only rebuild).
    3. `npm run tauri build` from client/charnel.
    4. print the path to the produced installer.

.PARAMETER SkipSpume
  skip steps 1-2 (db setup + libs/spume build). useful for a fast rebuild
  when only rust code changed and client/spume/dist + the db are already
  up to date from a previous run.
#>

[CmdletBinding()]
param(
    [switch]$SkipSpume
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# runs an external command and throws if it exits non-zero. powershell does
# NOT stop on a failing external command by default (unlike a failing
# cmdlet), so without this a failed npm/cargo/sqlx step would silently let
# the script continue.
function Invoke-Checked {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList,
        [string]$WorkingDirectory = $repoRoot
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "'$FilePath $ArgumentList' failed with exit code $LASTEXITCODE (in $WorkingDirectory)"
        }
    }
    finally {
        Pop-Location
    }
}

function Install-NpmDepsIfMissing {
    param([Parameter(Mandatory)][string]$ProjectDir)

    if (-not (Test-Path (Join-Path $ProjectDir "node_modules"))) {
        Write-Host "  installing npm deps in $ProjectDir..."
        Invoke-Checked -FilePath "npm" -ArgumentList @("ci") -WorkingDirectory $ProjectDir
    }
}

$gitSha = "unknown"
try {
    $gitSha = (& git -C $repoRoot rev-parse --short HEAD 2>$null).Trim()
    if (-not $gitSha) { $gitSha = "unknown" }
}
catch {
    $gitSha = "unknown"
}
$env:FREQHOLE_GIT_SHA = $gitSha
Write-Host "FREQHOLE_GIT_SHA=$gitSha"

if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = "sqlite:data/grimoire.db"
}
Write-Host "DATABASE_URL=$($env:DATABASE_URL)"

if (-not $SkipSpume) {
    Write-Host ""
    Write-Host "== setting up local sqlite db (migrations + views + blob_data) ==" -ForegroundColor Cyan

    if (-not (Get-Command sqlx -ErrorAction SilentlyContinue)) {
        throw "sqlx-cli not found on PATH. run scripts\windows\install-toolchain.ps1 first."
    }
    if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) {
        throw "sqlite3 cli not found on PATH. run scripts\windows\install-toolchain.ps1 first."
    }

    $dbRelativePath = ($env:DATABASE_URL -replace "^sqlite:", "") -replace "/", "\"
    $dbPath = Join-Path $repoRoot $dbRelativePath
    $dataDir = Split-Path $dbPath -Parent

    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    if (-not (Test-Path $dbPath)) {
        New-Item -ItemType File -Path $dbPath | Out-Null
    }

    Invoke-Checked -FilePath "sqlx" -ArgumentList @("migrate", "run", "--source", "migrations")

    Write-Host "  creating views..."
    Get-ChildItem (Join-Path $repoRoot "migrations\views") -Filter "*.sql" | ForEach-Object {
        Write-Host "    applying $($_.Name)..."
        Get-Content -Raw $_.FullName | & sqlite3 $dbPath
        if ($LASTEXITCODE -ne 0) {
            throw "sqlite3 failed applying $($_.Name) (exit code $LASTEXITCODE)"
        }
    }

    Write-Host "  creating blob_data database..."
    $blobDbPath = $dbPath -replace "\.db$", "-blobdata.db"
    if (-not (Test-Path $blobDbPath)) {
        New-Item -ItemType File -Path $blobDbPath | Out-Null
    }
    "CREATE TABLE IF NOT EXISTS blob_data (id TEXT PRIMARY KEY, data BLOB NOT NULL);" | & sqlite3 $blobDbPath
    if ($LASTEXITCODE -ne 0) {
        throw "sqlite3 failed creating blob_data table (exit code $LASTEXITCODE)"
    }

    Write-Host ""
    Write-Host "== building haruspex/reliquary/cenotaph ts libs ==" -ForegroundColor Cyan
    foreach ($lib in @("haruspex", "reliquary", "cenotaph")) {
        $libDir = Join-Path $repoRoot "lib\$lib\ts"
        Install-NpmDepsIfMissing -ProjectDir $libDir
        Invoke-Checked -FilePath "npm" -ArgumentList @("run", "build") -WorkingDirectory $libDir
    }

    Write-Host ""
    Write-Host "== building spume client ==" -ForegroundColor Cyan
    $apiClientDir = Join-Path $repoRoot "client-codegen\freqhole-api-client"
    Install-NpmDepsIfMissing -ProjectDir $apiClientDir

    $spumeDir = Join-Path $repoRoot "client\spume"
    Install-NpmDepsIfMissing -ProjectDir $spumeDir
    Invoke-Checked -FilePath "npm" -ArgumentList @("run", "build") -WorkingDirectory $spumeDir
}
else {
    Write-Host "skipping db setup + spume build (-SkipSpume set)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "== building charnel tauri app for windows x86_64 ==" -ForegroundColor Cyan
$charnelDir = Join-Path $repoRoot "client\charnel"
Install-NpmDepsIfMissing -ProjectDir $charnelDir
Invoke-Checked -FilePath "npm" -ArgumentList @("run", "tauri", "build", "--", "--target", "x86_64-pc-windows-msvc") -WorkingDirectory $charnelDir

Write-Host ""
Write-Host "== build complete ==" -ForegroundColor Green
# charnel's src-tauri crate is part of the root cargo workspace, so cargo's
# target dir resolves to the repo root, not client\charnel\src-tauri\target.
$bundleDir = Join-Path $repoRoot "target\x86_64-pc-windows-msvc\release\bundle"
$installers = Get-ChildItem $bundleDir -Recurse -Include "*.exe", "*.msi" -ErrorAction SilentlyContinue
if ($installers) {
    Write-Host "installer(s):"
    $installers | ForEach-Object { Write-Host "  $($_.FullName)" }
}
else {
    Write-Warning "build finished but no .exe/.msi found under $bundleDir"
}
