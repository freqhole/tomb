#!/bin/bash
# Pi app + optional OLED/encoder setup; run as your regular account.
set -euo pipefail
umask 077
die() { echo "$*" >&2; exit 1; }
ask() {
    local answer
    echo
    read -r -p "$1 [y/N] " answer
    [[ "$answer" = y || "$answer" = Y || "$answer" = yes ]]
}

print_banner() {
    local color=false
    if [ -t 1 ] && [ "${TERM:-dumb}" != dumb ] && [ -z "${NO_COLOR+x}" ]; then
        color=true
        printf '\033[1;35m'
    fi
    cat <<'EOF'

██████████████████████    █████ ████  █████  ███  █   █  ███  █     █████
 ████████████████████     █     █   █ █     █   █ █   █ █   █ █     █
  ██████████████████      █     █   █ █     █   █ █   █ █   █ █     █
   ████████████████       ████  ████  ████  █   █ █████ █   █ █     ████
    ██████████████        █     █ █   █     █ █ █ █   █ █   █ █     █
     ███████████          █     █  █  █     █  █  █   █ █   █ █     █
      ████████            █     █   █ █████  ██ █ █   █  ███  █████ █████
       █████
        ██                ███████████████████████████████████████████████

EOF
    if "$color"; then printf '\033[0m'; fi
    echo "raspberry pi setup"
    echo
}

print_banner

set_system_volume() {
    echo "setting system output volume to 100%."
    if command -v wpctl >/dev/null && wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0; then
        return
    fi
    if command -v pactl >/dev/null && pactl set-sink-volume @DEFAULT_SINK@ 100%; then
        return
    fi
    if amixer sset Master 100%; then
        return
    fi
    echo "warning: could not set system volume; set the output to 100% in desktop sound settings." >&2
}

[ "$(id -u)" -ne 0 ] || die "run setup.sh without sudo; it requests privileges where needed."
grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null \
    || die "this script requires Raspberry Pi OS on a Raspberry Pi."
for tool in sudo apt-get raspi-config dpkg curl; do
    command -v "$tool" >/dev/null || die "missing $tool; use a recent Raspberry Pi OS image."
done
# shellcheck disable=SC1091
. /etc/os-release
case "${VERSION_CODENAME:-}" in
    bookworm|trixie) ;;
    *) die "supported Raspberry Pi OS releases: Bookworm and Trixie." ;;
esac
case "$(dpkg --print-architecture)" in
    arm64|armhf) ;;
    *) die "supported architectures: arm64 and armhf." ;;
esac
[[ "$HOME" =~ ^/[a-zA-Z0-9_./-]+$ ]] \
    || die "service setup currently requires a home path without spaces or shell metacharacters."
user="$(id -un)"
uid="$(id -u)"
[[ "$user" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "unsupported account name for service setup."
root="$HOME/.local/share/freqhole-pi"
source_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
charnel=false
echo "install/configure: 1) charnel (desktop GUI)  2) rathole (terminal ui)"
echo
read -r -p "choose [2]: " app
app="${app:-2}"
mode=3
case "$app" in
    1)
        [ "$(dpkg --print-architecture)" = arm64 ] || die "charnel requires arm64; choose rathole on armhf."
        charnel=true
        [ -d /usr/share/xsessions ] || [ -d /usr/share/wayland-sessions ] \
            || die "charnel needs an installed desktop session; this script does not install a kiosk."
        ;;
    2)
        echo "rathole: 1) dedicated tty1 player (no x-windows)  2) SSH/tmux TUI"
        echo
        read -r -p "choose [2]: " mode
        mode="${mode:-2}"
        case "$mode" in 1|2) ;; *) die "choose 1 or 2." ;; esac
        ;;
    *) die "choose 1 or 2." ;;
esac
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
[[ "$config_home" =~ ^/[a-zA-Z0-9_./-]+$ && "$data_home" =~ ^/[a-zA-Z0-9_./-]+$ ]] \
    || die "desktop setup currently requires XDG paths without spaces or shell metacharacters."
charnel_unit="$config_home/systemd/user/charnel.service"
charnel_autostart="$config_home/autostart/freqhole-pi-charnel.desktop"

hardware=false
if ask "set up the 128x32 OLED + rotary encoder knob?"; then hardware=true; fi
splash=false
if ask "replace the Raspberry Pi plymouth boot splash image?"; then splash=true; fi
wifi=false
interface=""
if ask "install manual Wi-Fi setup (captive wifi portal)?"; then
    wifi=true
    if ! command -v nmcli >/dev/null || ! systemctl is-active --quiet NetworkManager.service; then
        die "Wi-Fi provisioning requires existing, active NetworkManager; network configuration was not changed."
    fi
    nmcli --fields DEVICE,TYPE,STATE device
    echo
    read -r -p "Wi-Fi interface [wlan0]: " interface
    interface="${interface:-wlan0}"
    [[ "$interface" =~ ^[a-zA-Z0-9_-]{1,15}$ ]] || die "invalid interface name."
    [ "$(nmcli -g GENERAL.TYPE device show "$interface")" = wifi ] || die "selected interface is not Wi-Fi."
    [ "$(nmcli -g WIFI-PROPERTIES.AP device show "$interface")" = yes ] || die "selected interface does not support AP mode."
    echo "the portal is started manually; it can interrupt Wi-Fi/SSH and playback."
fi
autostart=false
if [ "$mode" != 3 ] && ask "start rathole automatically at boot?"; then autostart=true; fi
charnel_boot=false
player=false
window=fullscreen
if "$charnel"; then
    if ask "start charnel at desktop login (requires desktop/autologin)?"; then charnel_boot=true; fi
    if ask "make player the initial charnel view?"; then player=true; fi
    echo
    read -r -p "charnel window: fullscreen / maximized / keep [fullscreen]: " window
    window="${window:-fullscreen}"
    case "$window" in fullscreen|maximized|keep) ;; *) die "invalid charnel window mode." ;; esac
fi
menu_player=rathole
if "$charnel"; then menu_player=charnel; fi
if "$hardware"; then
    echo "hardware setup enables i2c at 400 kHz and the menu sets the mixer to 100%."
    echo "select enable control socket in the app's first-run wizard for OLED playback controls."
fi
echo "install location: $root; config/data are preserved on reruns."
echo "updates are explicitly requested; desktop autologin and taskbar settings are not changed."
ask "apply these changes?" || exit 0

for unit in rathole rathole-ctrl; do
    if [ -f "/etc/systemd/system/$unit.service" ] &&
        ! grep -q '^# managed by freqhole-pi setup$' "/etc/systemd/system/$unit.service"; then
        die "existing $unit.service is not managed by this installer; review/move it before setup."
    fi
    if [ -f "/etc/systemd/system/$unit.service" ] &&
        ! grep -qx "User=$user" "/etc/systemd/system/$unit.service"; then
        die "existing $unit.service belongs to another account; setup cancelled."
    fi
done
if "$charnel" && pgrep -u "$(id -u)" -x charnel >/dev/null; then
    die "quit charnel before changing its startup/configuration."
fi
if [ -f "$root/charnel-transaction.json" ]; then
    jq -e '.phase == "complete" or .phase == "recovered" or .phase == "failed-before-install"' \
        "$root/charnel-transaction.json" >/dev/null \
        || die "recover the unfinished charnel update before rerunning setup: freqhole-pi recover charnel."
fi
if "$wifi" && [ -f /etc/systemd/system/freqhole-wifi.service ] &&
    ! grep -q '^# managed by freqhole-pi setup$' /etc/systemd/system/freqhole-wifi.service; then
    die "existing freqhole-wifi.service is unmanaged; setup cancelled."
fi
if "$wifi" && systemctl is-active --quiet freqhole-wifi.service; then
    die "stop Wi-Fi provisioning before rerunning its setup."
fi
for path in "$charnel_unit" "$charnel_autostart"; do
    if [ -f "$path" ] && ! grep -q '^# managed by freqhole-pi setup$' "$path"; then
        die "existing $path is unmanaged; setup cancelled."
    fi
done

sudo -v
stopped_units=()
setup_complete=false
report_exit() {
    if [ "$1" -ne 0 ] && ! "$setup_complete" && [ "${#stopped_units[@]}" -gt 0 ]; then
        echo "setup did not complete; services stopped for setup were not automatically restarted." >&2
        echo "after resolving the error, rerun setup or start them manually:" >&2
        printf '  sudo systemctl start %s\n' "${stopped_units[@]}" >&2
    fi
}
trap 'report_exit $?' EXIT
running_units=()
for unit in rathole-ctrl rathole; do
    if systemctl is-active --quiet "$unit.service"; then
        [ -f "/etc/systemd/system/$unit.service" ] \
            || die "running $unit.service is not managed by this installer; setup cancelled."
        running_units+=("$unit.service")
    fi
done
if [ "${#running_units[@]}" -gt 0 ]; then
    ask "rathole/OLED services are running. stop them to continue setup? playback will stop." || exit 0
    for unit in "${running_units[@]}"; do
        stopped_units+=("$unit")
        sudo systemctl stop "$unit" || die "could not stop $unit; setup cancelled."
    done
    for unit in "${running_units[@]}"; do
        if systemctl is-active --quiet "$unit"; then
            die "$unit is still running; setup cancelled."
        fi
    done
fi
sudo apt-get update
if ask "upgrade installed system packages before setup?"; then
    sudo apt-get upgrade -y
fi
packages=(curl ca-certificates jq python3 util-linux lsof alsa-utils)
if [ "$mode" != 3 ]; then packages+=(mpv ffmpeg); fi
if [ "$mode" = 1 ]; then packages+=(console-setup console-data kbd); fi
if [ "$mode" = 2 ]; then packages+=(tmux); fi
if "$wifi"; then packages+=(dnsmasq-base); fi
if "$hardware"; then
    packages+=(python3-venv python3-pip python3-dev build-essential swig
        python3-lgpio liblgpio-dev python3-libgpiod libgpiod-dev i2c-tools iproute2 iw)
fi
sudo apt-get install -y "${packages[@]}"
if [ "$mode" != 3 ]; then
    sudo usermod -aG audio "$user"
fi
if [ "$mode" = 1 ]; then
    for group in video render; do
        if getent group "$group" >/dev/null; then
            sudo usermod -aG "$group" "$user"
        else
            echo "warning: $group group is absent; check mpv display access on this image."
        fi
    done
fi

mkdir -p "$root" "$HOME/.local/bin"
chmod 700 "$root"
work="$(mktemp -d "$root/setup.XXXXXX")"
files=(menu.py storage_menu.py requirements.txt configure.py packages.py charnel.py splash.py freqhole-pi freqhole-pi-control
    rathole.service rathole-tmux.service rathole-ctrl.service tmux.conf
    freqhole-wifi freqhole-wifi.service freqhole-pi-wifi-recover charnel.service charnel-session)
cleanup() {
    local file
    for file in "${files[@]}" revision.json splash.png font5x8.bin font-LICENSE sudoers \
        freqhole-config.toml rathole-rendered.service rathole-ctrl-rendered.service tmux-rendered.conf wifi.json menu.json installation.json; do
        rm -f -- "$work/$file"
    done
    rmdir -- "$work"
}
finish_setup() {
    local status=$?
    cleanup || echo "warning: could not remove setup staging files." >&2
    report_exit "$status"
    exit "$status"
}
trap finish_setup EXIT
if [ ! -f "$source_dir/configure.py" ]; then
    ref="${FREQHOLE_PI_REF:-main}"
    [[ "$ref" =~ ^[a-zA-Z0-9._-]+$ ]] || die "invalid FREQHOLE_PI_REF."
    curl -fsSL --retry 2 --connect-timeout 15 --max-time 60 \
        "https://api.github.com/repos/freqhole/tomb/commits/$ref" -o "$work/revision.json"
    revision="$(jq -er '.sha' "$work/revision.json")"
    [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || die "invalid GitHub revision."
    for file in "${files[@]}"; do
        curl -fsSL --retry 2 --connect-timeout 15 --max-time 60 \
            "https://raw.githubusercontent.com/freqhole/tomb/$revision/scripts/raspberry-pi/$file" \
            -o "$work/$file"
    done
    if "$splash"; then
        curl -fsSL --retry 2 --connect-timeout 15 --max-time 60 \
            "https://raw.githubusercontent.com/freqhole/tomb/$revision/assets/splash.png" -o "$work/splash.png"
    fi
    source_dir="$work"
fi
for file in "${files[@]}"; do
    [ -f "$source_dir/$file" ] || die "missing installer asset: $source_dir/$file"
done
if "$splash"; then
    image="$source_dir/../../assets/splash.png"
    if [ "$source_dir" = "$work" ]; then image="$work/splash.png"; fi
    [ -f "$image" ] || die "missing splash image: $image"
    sudo python3 "$source_dir/splash.py" "$image"
fi
for file in menu.py storage_menu.py requirements.txt configure.py packages.py charnel.py; do
    install -m 644 "$source_dir/$file" "$root/$file"
done
python3 "$root/configure.py" menu "$root/menu.json" \
    --player "$menu_player" --socket-path "$root/$menu_player-control.sock"
configured_data="$data_home/net.freqhole.charnel"
configured_config="$config_home/net.freqhole.charnel"
if ! "$charnel" && [ -f "$root/installation.json" ]; then
    configured_data="$(jq -er '.charnel_data' "$root/installation.json")"
    configured_config="$(jq -er '.charnel_config' "$root/installation.json")"
fi
jq -n --arg data "$configured_data" --arg config "$configured_config" \
    --arg player "$menu_player" --argjson hardware "$hardware" \
    '{charnel_data: $data, charnel_config: $config, menu_player: $player, hardware: $hardware}' > "$work/installation.json"
install -m 600 "$work/installation.json" "$root/installation.json"
install -m 755 "$source_dir/freqhole-pi" "$HOME/.local/bin/freqhole-pi"
login_profile="$HOME/.profile"
for profile in "$HOME/.bash_profile" "$HOME/.bash_login"; do
    if [ -f "$profile" ]; then login_profile="$profile"; break; fi
done
for profile in "$login_profile" "$HOME/.bashrc"; do
    python3 "$root/configure.py" path "$profile"
done
export PATH="$HOME/.local/bin:$PATH"
sudo install -d -m 755 /usr/local/libexec
sudo install -o root -g root -m 755 "$source_dir/freqhole-pi-control" /usr/local/libexec/freqhole-pi-control
sudo install -o root -g root -m 755 "$source_dir/packages.py" /usr/local/libexec/freqhole-pi-packages
for action in enable-rathole disable-rathole enable-menu disable-menu disable-wifi; do
    printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/freqhole-pi-control %s\n' "$user" "$action"
done > "$work/sudoers"
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/freqhole-pi-control start, /usr/local/libexec/freqhole-pi-control stop, /usr/local/libexec/freqhole-pi-control restart, /usr/local/libexec/freqhole-pi-control poweroff, /usr/local/libexec/freqhole-pi-control wifi-start, /usr/local/libexec/freqhole-pi-control wifi-stop\n' \
    "$user" >> "$work/sudoers"
if "$charnel" || grep -q '^# managed by freqhole-pi setup$' "${configured_config%/*}/systemd/user/charnel.service" 2>/dev/null; then
    printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/freqhole-pi-packages charnel-prepare, /usr/local/libexec/freqhole-pi-packages charnel-install *, /usr/local/libexec/freqhole-pi-packages charnel-rollback *\n' "$user" >> "$work/sudoers"
fi
sudo visudo -cf "$work/sudoers"
sudo install -o root -g root -m 440 "$work/sudoers" "/etc/sudoers.d/freqhole-pi-$user"

if [ "$mode" != 3 ]; then
    "$HOME/.local/bin/freqhole-pi" install
fi

render() {
    sed -e "s|@USER@|$user|g" -e "s|@UID@|$uid|g" -e "s|@HOME@|$HOME|g" -e "s|@ROOT@|$root|g" "$1"
}
if [ "$mode" = 1 ]; then
    [ -f /usr/share/consolefonts/Uni2-VGA14.psf.gz ] \
        || die "required tty font Uni2-VGA14.psf.gz is missing; service was not installed."
    sudo python3 "$root/configure.py" console /etc/default/console-setup
fi
if [ "$mode" != 3 ]; then
    template=rathole.service
    if [ "$mode" = 2 ]; then
        template=rathole-tmux.service
        render "$source_dir/tmux.conf" > "$work/tmux-rendered.conf"
        install -m 600 "$work/tmux-rendered.conf" "$root/tmux.conf"
    fi
    render "$source_dir/$template" > "$work/rathole-rendered.service"
    sudo install -o root -g root -m 644 "$work/rathole-rendered.service" /etc/systemd/system/rathole.service
fi

if "$hardware"; then
    font_ref=6f6c89891de7d96c43028c4fdff5765763dffe16
    font_base="https://raw.githubusercontent.com/adafruit/Adafruit_CircuitPython_framebuf/$font_ref"
    curl -fsSL --retry 2 --connect-timeout 15 --max-time 60 "$font_base/examples/font5x8.bin" -o "$work/font5x8.bin"
    curl -fsSL --retry 2 --connect-timeout 15 --max-time 60 "$font_base/LICENSE" -o "$work/font-LICENSE"
    printf '%s  %s\n' 256f8db12c0d562a03490865479dddc4d6931b5774be1eaee416a1064ef6bdcf "$work/font5x8.bin" | sha256sum -c -
    install -m 644 "$work/font5x8.bin" "$root/font5x8.bin"
    install -m 644 "$work/font-LICENSE" "$root/font-LICENSE"
    sudo raspi-config nonint do_i2c 0
    boot_config=/boot/firmware/config.txt
    if [ ! -f "$boot_config" ]; then boot_config=/boot/config.txt; fi
    sudo python3 "$root/configure.py" i2c "$boot_config"
    for group in i2c gpio audio; do
        getent group "$group" >/dev/null || die "required device group is missing: $group"
        sudo usermod -aG "$group" "$user"
    done
    /usr/bin/python3 -m venv --system-site-packages "$root/.venv"
    "$root/.venv/bin/python3" -m pip install -r "$root/requirements.txt"
    (
        cd "$root"
        .venv/bin/python3 -c 'import adafruit_framebuf, adafruit_ssd1306; from adafruit_seesaw import digitalio, neopixel, rotaryio, seesaw; adafruit_framebuf.FrameBuffer(bytearray(512), 128, 32, adafruit_framebuf.MVLSB).text("ready", 0, 0, 1)'
    )
    python3 "$root/charnel.py" socket
    render "$source_dir/rathole-ctrl.service" > "$work/rathole-ctrl-rendered.service"
    sudo install -o root -g root -m 644 "$work/rathole-ctrl-rendered.service" /etc/systemd/system/rathole-ctrl.service
fi
if "$charnel"; then
    set_system_volume
    if [ "$(dpkg-query -W -f='${Status}' freqhole 2>/dev/null || true)" != "install ok installed" ]; then
        sudo python3 "$source_dir/packages.py" charnel
    else
        echo "charnel is already installed; preserving its package version."
    fi
    [ -x /usr/bin/charnel ] || die "installed package is missing /usr/bin/charnel."
    data="$data_home/net.freqhole.charnel"
    config="$config_home/net.freqhole.charnel"
    if "$player"; then python3 "$root/configure.py" player "$data/charnel-config.toml"; fi
    if [ "$window" != keep ]; then python3 "$root/configure.py" "$window" "$config/.window-state.json"; fi
    mkdir -p "$config_home/systemd/user" "$config_home/autostart"
    {
        cat "$source_dir/charnel.service"
        printf '\n[Service]\nEnvironment=XDG_DATA_HOME=%s\nEnvironment=XDG_CONFIG_HOME=%s\n' "$data_home" "$config_home"
    } > "$charnel_unit"
    chmod 644 "$charnel_unit"
    install -m 755 "$source_dir/charnel-session" "$HOME/.local/bin/charnel-session"
    if "$charnel_boot"; then
        printf '[Desktop Entry]\n# managed by freqhole-pi setup\nType=Application\nName=charnel\nExec=%s/.local/bin/charnel-session\nTerminal=false\n' \
            "$HOME" > "$charnel_autostart"
    fi
    systemctl --user daemon-reload
    echo "charnel: complete first-run setup in the desktop app; systemctl --user status charnel."
fi
if "$charnel" && ! "$charnel_boot" && [ -f "$charnel_autostart" ]; then
    rm -- "$charnel_autostart"
fi
if "$wifi"; then
    if sudo test -f /etc/freqhole-pi/wifi.env; then
        [ -f "$root/wifi.json" ] || die "Wi-Fi provisioning belongs to a different installation; existing configuration was kept."
        [ "$(jq -er '.interface' "$root/wifi.json")" = "$interface" ] || die "existing Wi-Fi interface differs; configuration was kept."
        echo "preserving existing Wi-Fi portal credentials."
    else
        # save generated portal credentials in the invoking account's private staging directory.
        # shellcheck disable=SC2024
        sudo python3 "$root/configure.py" wifi /etc/freqhole-pi --interface "$interface" > "$work/wifi.json"
        install -m 600 "$work/wifi.json" "$root/wifi.json"
    fi
    sudo python3 "$source_dir/packages.py" wifi
    sudo install -o root -g root -m 755 "$source_dir/freqhole-pi-wifi-recover" /usr/local/libexec/freqhole-pi-wifi-recover
    sudo install -o root -g root -m 644 "$source_dir/freqhole-wifi.service" /etc/systemd/system/freqhole-wifi.service
    install -m 755 "$source_dir/freqhole-wifi" "$HOME/.local/bin/freqhole-wifi"
    echo "Wi-Fi setup: $HOME/.local/bin/freqhole-wifi info (or start/stop/status)."
fi
sudo systemctl daemon-reload
if [ "$mode" != 3 ] && [ -f /etc/systemd/system/rathole.service ]; then
    if "$autostart"; then sudo systemctl enable rathole.service; else sudo systemctl disable rathole.service; fi
fi
if "$hardware" && ask "start the OLED menu automatically at boot?"; then
    sudo systemctl enable rathole-ctrl.service
elif [ -f /etc/systemd/system/rathole-ctrl.service ]; then
    sudo systemctl disable rathole-ctrl.service
fi
setup_complete=true
echo "setup complete;"
printf '\n\n'
cat <<'EOF'
+----------------------------------------------------------+
| freqhole pi                                              |
|                                                          |
| freqhole-pi          command help                         |
| freqhole-pi enable   choose automatic startup entries      |
| freqhole-pi disable  stop + disable startup entries        |
EOF
if [ "$mode" = 2 ]; then
    echo '| freqhole-pi attach   open rathole; Ctrl+B, D to detach     |'
elif "$charnel"; then
    echo '| charnel-session      launch from the Pi desktop           |'
fi
cat <<'EOF'
|                                                          |
| reboot recommended to apply system/hardware changes.      |
+----------------------------------------------------------+
EOF
echo "commands work in new Bash sessions; for this terminal:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
selected_app=rathole
if "$charnel"; then selected_app=charnel; fi
echo
if ! read -r -n 1 -p "setup done! press enter to start $selected_app, r to reboot, or any other key to exit. " launch; then
    echo
    exit 0
fi
echo
if [[ "$launch" = r || "$launch" = R ]]; then
    sudo systemctl reboot
    exit 0
fi
[ -z "$launch" ] || exit 0
if "$charnel"; then
    if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
        "$HOME/.local/bin/charnel-session"
        sleep 2
        systemctl --user is-active --quiet charnel.service \
            || die "charnel exited after launch; inspect journalctl --user -u charnel."
        echo "charnel started; complete its wizard if this is the first launch."
    else
        echo "no graphical session in this terminal; run ~/.local/bin/charnel-session from the Pi desktop to launch charnel."
    fi
else
    sudo -n /usr/local/libexec/freqhole-pi-control start
    sleep 2
    systemctl is-active --quiet rathole.service \
        || die "rathole exited after launch; inspect journalctl -u rathole."
    if [ "$mode" = 2 ]; then
        "$HOME/.local/bin/freqhole-pi" attach
    fi
fi
