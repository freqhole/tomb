# freqhole Flatpak packaging

this directory contains files for building freqhole as a Flatpak.

## building via Docker (recommended)

the Makefile targets handle everything via Docker — no local flatpak installation needed:

```bash
# from repo root

# first, build the .deb
make build-tauri-linux-intel

# then build the flatpak (first run downloads ~1GB GNOME runtime)
make build-flatpak-intel
```

outputs to `build/<version>/freqhole_<version>_x86_64.flatpak`.

for arm64:

```bash
make build-tauri-linux-arm64
make build-flatpak-arm64
```

## how it works

we skip `flatpak-builder` entirely (which has sandbox/privilege requirements that don't work in Docker). instead:

1. extract binary + assets from the .deb
2. use `flatpak build-init` / `flatpak build-finish` / `flatpak build-export` directly
3. bundle into a .flatpak file

this runs in a Fedora container with just `flatpak` installed (plus the GNOME Platform runtime).

## building locally (alternative)

if you have flatpak installed locally on Linux:

```bash
# install runtime
flatpak install flathub org.gnome.Platform//46

# build
./build-flatpak.sh ../build/0.1.12/freqhole_0.1.12_amd64.deb freqhole.flatpak x86_64
```

## installing locally

```bash
flatpak install --user freqhole_0.1.12_x86_64.flatpak
```

## testing

run the Flatpak:

```bash
flatpak run net.freqhole.freqhole
```

## files

- `net.freqhole.freqhole.yml` - Flatpak manifest
- `net.freqhole.freqhole.metainfo.xml` - AppStream metadata (for app stores / software centers)

## Flathub submission

to submit to Flathub, fork https://github.com/flathub/flathub and create a PR with:

1. the manifest at `net.freqhole.freqhole.yml`
2. the metainfo at `net.freqhole.freqhole.metainfo.xml`
3. update the manifest to download the `.deb` from GitHub releases instead of local file

example source entry for releases:

```yaml
sources:
  - type: file
    url: https://github.com/freqhole/tomb/releases/download/v0.1.12/freqhole_0.1.12_amd64.deb
    sha256: <sha256sum of the deb>
    dest-filename: freqhole.deb
```

## sandbox permissions

the manifest requests these permissions:

- **network**: required to connect to remotes
- **pulseaudio**: audio playback
- **xdg-music:ro**: read-only access to music folder
- **home:ro**: read-only home access (for custom music directories)
- **dri**: GPU acceleration for WebKit rendering
- **StatusNotifierWatcher**: system tray integration
- **secrets**: credential storage via secret service
