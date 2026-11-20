# System tray tests

Run these commands from the root of the repository.

```sh
make extension
dbus-run-session -- gjs -m tests/statusNotifierWatcher.js
gjs -m tests/legacyTrayController.js
GSETTINGS_BACKEND=memory gjs -m tests/systemTrayPrefs.js
```

The preferences test needs a display. The next two tests start their own GNOME Shell session with virtual monitors and temporary settings.

```sh
bash tests/runMonitorHotplug.sh
/usr/bin/python3 tests/runLegacyTrayIntegration.py
```

The monitor test uses `gdctl` to switch displays and checks the icons on each panel. The legacy tray test uses XWayland and Python with GTK 3 and PyGObject to check an XEmbed icon, its position and its mouse buttons.
