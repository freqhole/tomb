#!/usr/bin/env python3
"""patches a homebrew formula's extracted .rb file in place.

invoked as: python3 mpv.py <path-to-mpv.rb>

vapoursynth is only ever dlopen'd at runtime by mpv's optional vs filter
bridge - libmpv.2.dylib never links against it directly - so charnel
loses nothing by disabling it outright. worth doing regardless: vapoursynth's
own formula builds a python extension via pip/pyproject.toml, which hard-fails
with "Preparing metadata (pyproject.toml) did not run successfully / No
available output" on a from-scratch x86_64 build (confirmed real failure
2026-10-07 and again 2026-10-09) - a flaky, Tier-3-support-tier
homebrew/core formula with its own unrelated packaging problems, not
worth fighting just to support a filter path this app never uses.
dropping the `depends_on` line too means homebrew never attempts to
build it at all, instead of building it and then mpv ignoring it.

yt-dlp is a convenience companion CLI mpv's formula installs alongside
itself - invoked at runtime via a PATH lookup from mpv's own
ytdl_hook.lua, never linked into libmpv.2.dylib - not something mpv's
own build needs. dropping it avoids pulling in its own dependency chain
(deno, which on macOS 12 fails outright with "A full installation of
Xcode.app 15.0 is required... Xcode 15.0 cannot be installed on macOS
12" - confirmed real failure 2026-10-09 - and which has no x86_64
bottle regardless, so it'd otherwise drag in a from-source rust+llvm
build just to produce a CLI tool this app never bundles or invokes).

molten-vk is also dropped: it's purely a runtime dependency (the vulkan
loader finds libMoltenVK.dylib via its own ICD-manifest discovery, never
a build-time link - same as the vapoursynth/yt-dlp reasoning above), and
homebrew's current molten-vk formula (1.4.2) requires Xcode 15.0.1+ to
compile (confirmed real 2026-10-09: multiple unguarded newer-SDK Metal
enum references - MTLLanguageVersion3_0/3_1, MTLTextureUsageShaderAtomic,
MTLVertexFormatFloatRG11B10/RGB9E5 - fail to compile on Xcode 13.4.1's
MacOSX12.3.sdk). build-x86.sh instead builds MoltenVK v1.2.11 directly
from its own source (last release confirmed to still properly guard all
of those same symbols behind Xcode-13-and-earlier-compatible checks),
bypassing homebrew's molten-vk formula entirely - see build-x86.sh's own
MoltenVK section for that build.

exits non-zero (without modifying the file) if any expected fragment
isn't found - e.g. if a future mpv formula update changes this - so a
stale patch fails loudly instead of silently no-op'ing or corrupting
the file.

also forces the SDK mpv's Swift glue code compiles against: confirmed
real 2026-10-09, mpv's own osdep/mac/meson.build does NOT resolve the
macOS SDK via `xcrun --show-sdk-path` (which already correctly reports
Xcode 13.4.1's own MacOSX12.3.sdk on this machine) - it shells out to
mpv's own TOOLS/macos-sdk-version.py, which checks a `MACOS_SDK` env
var override FIRST, before ever calling xcrun. unset, this machine's
Swift compile picked up a newer, separately-updatable SDK from
/Library/Developer/CommandLineTools/SDKs/ instead (a module built with
Swift 5.7.1, incompatible with Xcode 13.4.1's own Swift 5.6.1 compiler).
same fix already proven in x86-formula-patches.sh for the arm64-cross-
build case - just without that script's separate-Xcode-pinning/native-
file machinery, since build-x86.sh only ever has one (already-selected)
Xcode to point at. plain shell-exported env vars don't survive
Homebrew's superenv build sandbox - only `ENV[...] =` lines inside the
formula's own `install` method do.
"""

import sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()

vapoursynth_depends_line = '  depends_on "vapoursynth"\n'
vulkan_marker = '      -Dvulkan=enabled\n'
vapoursynth_disable_arg = '      -Dvapoursynth=disabled\n'
yt_dlp_depends_line = '  depends_on "yt-dlp"\n'
molten_vk_depends_line = '    depends_on "molten-vk"\n'

if vapoursynth_depends_line not in content:
    print(f"mpv.py: expected vapoursynth depends_on line not found in {path} - formula may have changed upstream", file=sys.stderr)
    sys.exit(1)
if vulkan_marker not in content:
    print(f"mpv.py: expected vulkan marker line not found in {path} - formula may have changed upstream", file=sys.stderr)
    sys.exit(1)
if yt_dlp_depends_line not in content:
    print(f"mpv.py: expected yt-dlp depends_on line not found in {path} - formula may have changed upstream", file=sys.stderr)
    sys.exit(1)
if molten_vk_depends_line not in content:
    print(f"mpv.py: expected molten-vk depends_on line not found in {path} - formula may have changed upstream", file=sys.stderr)
    sys.exit(1)

content = content.replace(vapoursynth_depends_line, "", 1)
if vapoursynth_disable_arg not in content:
    content = content.replace(vulkan_marker, vulkan_marker + vapoursynth_disable_arg, 1)
content = content.replace(yt_dlp_depends_line, "", 1)
content = content.replace(molten_vk_depends_line, "", 1)

install_marker = "  def install\n"
if install_marker not in content:
    print(f"mpv.py: expected 'def install' marker not found in {path} - formula may have changed upstream", file=sys.stderr)
    sys.exit(1)
sdk_env_inject = (
    '    ENV["DEVELOPER_DIR"] = "/Applications/Xcode.app/Contents/Developer"\n'
    '    ENV["SDKROOT"] = Utils.safe_popen_read("/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path").strip\n'
    '    ENV["MACOS_SDK"] = ENV["SDKROOT"]\n'
    '    ENV["MACOS_SDK_VERSION"] = "12.3"\n'
)
idx = content.index(install_marker) + len(install_marker)
if sdk_env_inject not in content:
    content = content[:idx] + sdk_env_inject + content[idx:]

with open(path, "w") as f:
    f.write(content)
