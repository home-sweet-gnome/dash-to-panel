import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile


root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="dtp-legacy-integration-") as directory:
    work = Path(directory)
    data = work / "data"
    uuid = "legacy-tray-test@dash-to-panel"
    mode = "dtp-legacy-test"
    extension = data / "gnome-shell" / "extensions" / uuid
    modes = data / "gnome-shell" / "modes"
    extension.mkdir(parents=True)
    modes.mkdir(parents=True)
    result = work / "result.json"
    (modes / f"{mode}.json").write_text(json.dumps({
        "parentMode": "user",

        "enabledExtensions": [uuid],
    }))
    (extension / "metadata.json").write_text(json.dumps({
        "uuid": uuid,
        "name": "Legacy tray integration test",
        "description": "Temporary isolated XEmbed integration test",
        "shell-version": ["45", "46", "47", "48", "49", "50", "51"],
        "session-modes": [mode],
    }))
    code = """
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {SystemTray} from SYSTEM_TRAY;
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {testLegacyTray} from INTEGRATION;

export default class LegacyTest extends Extension {
    enable() {
        new Gio.Settings({schema_id: 'org.gnome.shell'}).set_string('welcome-dialog-last-shown-version', '9999');
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            const source = Gio.SettingsSchemaSource.new_from_directory(SCHEMAS, Gio.SettingsSchemaSource.get_default(), false);
            const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.dash-to-panel', false)});
            const panel = {panel: Main.panel, panelBox: Main.layoutManager.panelBox, geom: {vertical: false, position: St.Side.TOP}};
            const tray = new SystemTray(settings);
            tray.setPanel(panel);
            testLegacyTray(tray)
                .then(value => this.finish({ok: true, result: value}))
                .catch(error => this.finish({ok: false, error: error.message, stack: error.stack}));
            return GLib.SOURCE_REMOVE;
        });
    }
    finish(value) {
        Gio.File.new_for_path(RESULT).replace_contents(JSON.stringify(value), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {global.context.terminate(); return GLib.SOURCE_REMOVE;});
    }
    disable() {}
}
"""
    code = code.replace("INTEGRATION", json.dumps((root / "tests/legacyTrayIntegration.js").as_uri()))
    code = code.replace("SYSTEM_TRAY", json.dumps((root / "src/systemTray.js").as_uri()))
    code = code.replace("SCHEMAS", json.dumps(str(root / "schemas")))
    code = code.replace("RESULT", json.dumps(str(result)))
    (extension / "extension.js").write_text(code)
    environment = dict(os.environ)
    environment.update({
        "XDG_DATA_HOME": str(data),
        "XDG_DATA_DIRS": f"{data}:/usr/local/share:/usr/share",
        "XDG_CONFIG_HOME": str(work / "config"),
        "XDG_CACHE_HOME": str(work / "cache"),
        "GSETTINGS_BACKEND": "memory",
        "GNOME_SHELL_SESSION_MODE": mode,
        "LIBGL_ALWAYS_SOFTWARE": "1",
    })
    command = ["dbus-run-session", "--", "gnome-shell", "--headless", "--virtual-monitor", "1280x720",
               "--wayland-display", f"dtp-legacy-{os.getpid()}", "--mode", mode]
    process = subprocess.Popen(command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=40)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        output, _ = process.communicate(timeout=10)
    if not result.exists():
        print(output[-7000:], file=sys.stderr)
        raise SystemExit("Isolated GNOME Shell did not produce an integration result")
    report = json.loads(result.read_text())
    print(json.dumps(report))
    if not report["ok"]:
        print(output[-5000:], file=sys.stderr)
        raise SystemExit(1)
