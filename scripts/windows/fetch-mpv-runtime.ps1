#!/usr/bin/env pwsh
<#
.SYNOPSIS
  fetches a portable libmpv-2.dll for windows x86_64 and generates the
  mpv.lib import library MSVC's linker needs (libmpv2-sys emits a bare
  `-lmpv`/`mpv.lib`, but mpv-libre-runtime's windows archive ships only the
  dll - no import lib to link against, unlike a full mpv dev package).

.DESCRIPTION
  see scripts/fetch-mpv-runtime.sh for the macOS/linux story - same source
  (mpv-libre-runtime), same reasoning (portable, no system package manager
  required on the end user's machine).

  requires dumpbin.exe and lib.exe on PATH (part of the MSVC build tools -
  in CI, run this after the `ilammy/msvc-dev-cmd` action; locally, run from
  a "Developer PowerShell for VS" prompt).

  outputs:
    - client\charnel\src-tauri\mpv-runtime\libmpv-2.dll (bundled into the
      app via tauri.windows.conf.json's `bundle.resources`)
    - target\mpv-import-lib\mpv.lib (linked against via
      CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS, set by build.ps1)
#>

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$releaseTag = "runtime-mpv-2a4eb8067c-librempeg-9c00336e26-fb08030026"
$asset = "mpv-libre-runtime-win32-x64.7z"
$expectedSha256 = "2dc646c36013f11823127a56682c4d1382036d668c89586b8af1a5e2432a48e3"
$url = "https://github.com/Zencok/mpv-libre-runtime/releases/download/$releaseTag/$asset"

$bundleDest = Join-Path $repoRoot "client\charnel\src-tauri\mpv-runtime"
$libDest = Join-Path $repoRoot "target\mpv-import-lib"
# "-defv2" suffix: bump this whenever the generated .def/mpv.lib logic
# changes, so a stale cached mpv.lib (e.g. from Swatinem/rust-cache
# persisting target\mpv-import-lib across CI runs) gets regenerated
# instead of silently reused - defv2 adds the LIBRARY directive fixing
# the wrong-dll-name-embedded-in-the-import-table bug.
$stamp = Join-Path $bundleDest ".fetched-$releaseTag-defv2"

if ((Test-Path $stamp) -and (Test-Path (Join-Path $libDest "mpv.lib"))) {
    Write-Host "fetch-mpv-runtime: mpv already staged at this release, skipping download"
}
else {
    if (-not (Get-Command dumpbin -ErrorAction SilentlyContinue)) {
        throw "dumpbin.exe not found on PATH. run this from a Developer PowerShell for VS, or (in CI) after the ilammy/msvc-dev-cmd action."
    }
    if (-not (Get-Command lib -ErrorAction SilentlyContinue)) {
        throw "lib.exe not found on PATH. run this from a Developer PowerShell for VS, or (in CI) after the ilammy/msvc-dev-cmd action."
    }

    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        $archivePath = Join-Path $tmp $asset
        Write-Host "fetch-mpv-runtime: downloading $asset..."
        Invoke-WebRequest -Uri $url -OutFile $archivePath

        $actualSha256 = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLower()
        if ($actualSha256 -ne $expectedSha256) {
            throw "checksum mismatch for $asset - expected $expectedSha256, got $actualSha256"
        }

        # 7z.exe ships preinstalled on github's windows runners; locally, install
        # via `winget install 7zip.7zip` if this fails.
        & 7z x $archivePath "-o$tmp" -y | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "7z extraction failed with exit code $LASTEXITCODE"
        }

        $dll = Join-Path $tmp "libmpv-2.dll"
        if (-not (Test-Path $dll)) {
            throw "libmpv-2.dll not found in extracted archive"
        }

        New-Item -ItemType Directory -Path $bundleDest -Force | Out-Null
        Copy-Item $dll (Join-Path $bundleDest "libmpv-2.dll") -Force
        Write-Host "fetch-mpv-runtime: staged for bundling at $bundleDest"

        # generate mpv.lib: parse dumpbin's export table into a .def file, then
        # let lib.exe build the true MSVC import library from it.
        Write-Host "fetch-mpv-runtime: generating mpv.lib import library..."
        $exports = & dumpbin /exports $dll
        # without an explicit LIBRARY statement, lib.exe assumes the runtime dll
        # is named after /out:'s own base name ("mpv.dll") instead of the real
        # file ("libmpv-2.dll") - bakes the wrong expected filename into the
        # import table, so windows looks for "mpv.dll" at runtime and fails
        # with "the code execution cannot proceed because mpv.dll was not
        # found" (confirmed for real: renaming the dll to mpv.dll "fixed" it,
        # which is exactly the symptom of this missing directive).
        $defLines = @("LIBRARY libmpv-2.dll", "EXPORTS")
        foreach ($line in $exports) {
            # matches lines like: "   123   7A 00012340 mpv_create"
            if ($line -match '^\s*\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)\s*$') {
                $defLines += "  $($matches[1])"
            }
        }
        if ($defLines.Count -le 2) {
            throw "no exported symbols parsed from dumpbin output - dumpbin's export table format may have changed"
        }

        New-Item -ItemType Directory -Path $libDest -Force | Out-Null
        $defPath = Join-Path $tmp "mpv.def"
        $defLines | Set-Content -Path $defPath -Encoding ASCII

        & lib /def:$defPath /out:"$(Join-Path $libDest 'mpv.lib')" /machine:x64 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "lib.exe failed generating mpv.lib with exit code $LASTEXITCODE"
        }
        Write-Host "fetch-mpv-runtime: staged for linking at $libDest"

        New-Item -ItemType File -Path $stamp -Force | Out-Null
    }
    finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# ffmpeg.exe / ffprobe.exe - used by grimoire's own transcode/thumbnail/
# probe code via Command::new (a completely separate code path from
# libmpv above). same version (9.0.2) as macOS's bundled copy for
# consistency, though these are independent static builds, not shared
# dylibs - gyan.dev's "essentials" build ships statically-linked exes
# (confirmed via a real download+inspection 2026-10-02 - only ffmpeg.exe/
# ffplay.exe/ffprobe.exe in bin/, no sibling dlls needed), so this is a
# flat drop-in with no dependency-closure bundling step the way macOS's
# dylibbundler pass needs. client/charnel's own ffmpeg-path resolution
# prefers this bundled copy, falling back to the user's own configured/
# PATH ffmpeg if bundling failed or on non-windows - see
# grimoire/src/config.rs's `set_bundled_ffmpeg_resolver` and
# client/charnel/src-tauri/src/commands.rs's `resolve_bundled_media_binary`.
$ffmpegReleaseTag = "9.0.2"
$ffmpegAsset = "ffmpeg-9.0.2-essentials_build.zip"
$ffmpegExpectedSha256 = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba"
$ffmpegUrl = "https://github.com/GyanD/codexffmpeg/releases/download/$ffmpegReleaseTag/$ffmpegAsset"
$ffmpegStamp = Join-Path $bundleDest ".fetched-ffmpeg-$ffmpegReleaseTag"

if ((Test-Path $ffmpegStamp) -and (Test-Path (Join-Path $bundleDest "ffmpeg.exe")) -and (Test-Path (Join-Path $bundleDest "ffprobe.exe"))) {
    Write-Host "fetch-mpv-runtime: ffmpeg/ffprobe already staged at this release, skipping download"
}
else {
    $ffmpegTmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $ffmpegTmp | Out-Null
    try {
        $ffmpegArchivePath = Join-Path $ffmpegTmp $ffmpegAsset
        Write-Host "fetch-mpv-runtime: downloading $ffmpegAsset..."
        Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegArchivePath

        $ffmpegActualSha256 = (Get-FileHash -Path $ffmpegArchivePath -Algorithm SHA256).Hash.ToLower()
        if ($ffmpegActualSha256 -ne $ffmpegExpectedSha256) {
            throw "checksum mismatch for $ffmpegAsset - expected $ffmpegExpectedSha256, got $ffmpegActualSha256"
        }

        Expand-Archive -Path $ffmpegArchivePath -DestinationPath $ffmpegTmp -Force

        $extractedDir = Get-ChildItem -Path $ffmpegTmp -Directory | Where-Object { $_.Name -like "ffmpeg-*" } | Select-Object -First 1
        if (-not $extractedDir) {
            throw "couldn't find extracted ffmpeg-* directory in $ffmpegAsset"
        }
        $ffmpegExe = Join-Path $extractedDir.FullName "bin\ffmpeg.exe"
        $ffprobeExe = Join-Path $extractedDir.FullName "bin\ffprobe.exe"
        if (-not (Test-Path $ffmpegExe) -or -not (Test-Path $ffprobeExe)) {
            throw "ffmpeg.exe/ffprobe.exe not found in extracted archive"
        }

        New-Item -ItemType Directory -Path $bundleDest -Force | Out-Null
        Copy-Item $ffmpegExe (Join-Path $bundleDest "ffmpeg.exe") -Force
        Copy-Item $ffprobeExe (Join-Path $bundleDest "ffprobe.exe") -Force
        Write-Host "fetch-mpv-runtime: staged ffmpeg.exe/ffprobe.exe for bundling at $bundleDest"

        New-Item -ItemType File -Path $ffmpegStamp -Force | Out-Null
    }
    finally {
        Remove-Item -Recurse -Force $ffmpegTmp -ErrorAction SilentlyContinue
    }
}
