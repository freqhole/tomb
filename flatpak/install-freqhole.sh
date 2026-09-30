#!/bin/bash
# extracts freqhole's own binary/desktop-file/icons from the pre-built
# .deb and installs them into $FLATPAK_DEST - run as the `freqhole`
# module's build-commands by flatpak-builder
# (net.freqhole.freqhole.yml). separate from the `libmpv` module (built
# from source, see that module's comment in the manifest for why).
set -e

ar x freqhole.deb
tar xf data.tar.* 2>/dev/null || tar xf data.tar

# tauri app is named charnel internally, rename to freqhole
if [ -f usr/bin/charnel ]; then
    install -Dm755 usr/bin/charnel "$FLATPAK_DEST/bin/freqhole"
elif [ -f usr/bin/freqhole ]; then
    install -Dm755 usr/bin/freqhole "$FLATPAK_DEST/bin/freqhole"
else
    echo "error: could not find binary (tried charnel, freqhole)" >&2
    ls -la usr/bin/ 2>/dev/null || echo "usr/bin not found" >&2
    exit 1
fi

# desktop file may be named charnel.desktop or freqhole.desktop
for desktop_name in freqhole charnel; do
    if [ -f "usr/share/applications/${desktop_name}.desktop" ]; then
        install -Dm644 "usr/share/applications/${desktop_name}.desktop" \
            "$FLATPAK_DEST/share/applications/net.freqhole.freqhole.desktop"
        sed -i "s|^Icon=.*|Icon=net.freqhole.freqhole|" \
            "$FLATPAK_DEST/share/applications/net.freqhole.freqhole.desktop"
        sed -i "s|^Exec=.*|Exec=freqhole %U|" \
            "$FLATPAK_DEST/share/applications/net.freqhole.freqhole.desktop"
        break
    fi
done

# icons may be named freqhole or charnel
for icon_name in freqhole charnel; do
    for size in 32x32 128x128 256x256; do
        icon="usr/share/icons/hicolor/$size/apps/${icon_name}.png"
        if [ -f "$icon" ]; then
            install -Dm644 "$icon" "$FLATPAK_DEST/share/icons/hicolor/$size/apps/net.freqhole.freqhole.png"
        fi
    done
    for size in 128x128@2x 256x256@2; do
        icon="usr/share/icons/hicolor/$size/apps/${icon_name}.png"
        if [ -f "$icon" ]; then
            base_size=$(echo "$size" | sed 's/@2x$//; s/@2$//')
            install -Dm644 "$icon" "$FLATPAK_DEST/share/icons/hicolor/$base_size/apps/net.freqhole.freqhole.png"
        fi
    done
done

install -Dm644 net.freqhole.freqhole.metainfo.xml \
    "$FLATPAK_DEST/share/metainfo/net.freqhole.freqhole.metainfo.xml"
