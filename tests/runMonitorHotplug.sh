#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
cleanup() {
    for _ in {1..30}; do
        if ! mountpoint -q "$work/runtime/doc" && rm -rf --one-file-system -- "$work"; then
            return
        fi
        sleep 0.1
    done
    return 1
}
trap cleanup EXIT
export XDG_DATA_HOME="$work/data" XDG_CONFIG_HOME="$work/config"
export XDG_CACHE_HOME="$work/cache" XDG_RUNTIME_DIR="$work/runtime"
export GSETTINGS_BACKEND=keyfile LIBGL_ALWAYS_SOFTWARE=1 LC_ALL=C
unset DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS GNOME_SHELL_SESSION_MODE

uuid=dash-to-panel@jderose9.github.com
probe=monitor-hotplug-test@dash-to-panel
extensions="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$extensions/$uuid" "$extensions/$probe" "$XDG_DATA_HOME/applications"
mkdir -m 700 "$XDG_RUNTIME_DIR"
ln -s "$root"/src/*.js "$root"/src/stylesheet.css "$root"/{metadata.json,schemas,ui,img} "$extensions/$uuid/"
ln -s "$root/tests/monitorHotplug.js" "$extensions/$probe/extension.js"
sed "s/$uuid/$probe/g" "$root/metadata.json" > "$extensions/$probe/metadata.json"
cat > "$XDG_DATA_HOME/applications/hotplug-test.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Monitor test
Exec=true
Icon=application-x-executable
DESKTOP

gsettings set org.gnome.shell enabled-extensions "['$uuid', '$probe']"
gsettings set org.gnome.shell favorite-apps "['hotplug-test.desktop']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '9999'
gsettings --schemadir "$root/schemas" set org.gnome.shell.extensions.dash-to-panel native-tray-enabled true
if ! timeout --kill-after=3s 35s dbus-run-session -- gnome-shell --headless \
    --wayland-display dtp-test --virtual-monitor 1280x720 --virtual-monitor 1024x768 \
    >"$work/shell.log" 2>&1 || ! test -f "$XDG_RUNTIME_DIR/passed"; then
    tail -100 "$work/shell.log" >&2
    exit 1
fi
cat "$XDG_RUNTIME_DIR/passed"
