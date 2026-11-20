/* SPDX-License-Identifier: GPL-2.0-or-later */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async')

async function until(condition, message) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (condition()) return
    await new Promise((resolve) =>
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        resolve()
        return GLib.SOURCE_REMOVE
      }),
    )
  }
  throw new Error(message)
}

async function run(...argv) {
  const process = Gio.Subprocess.new(
    argv,
    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
  )
  const [stdout, stderr] = await process.communicate_utf8_async(null, null)
  if (!process.get_successful()) throw new Error(stderr)
  return stdout
}

function displayedOn(actor, monitor) {
  if (!actor?.mapped || !actor.has_allocation()) return false
  const [x, y] = actor.get_transformed_position()
  const [width, height] = actor.get_transformed_size()
  return (
    width > 0 &&
    height > 0 &&
    x >= monitor.x &&
    y >= monitor.y &&
    x + width <= monitor.x + monitor.width &&
    y + height <= monitor.y + monitor.height
  )
}

async function test() {
  await until(
    () =>
      !Main.layoutManager._startingUp &&
      global.dashToPanel?.panels?.[0]?.panelManager._systemTray.watcher?.active,
    'The native tray did not start',
  )
  Main.overview.hide()
  const tray = global.dashToPanel.panels[0].panelManager._systemTray
  const path = '/StatusNotifierItem'
  const item = Gio.DBusExportedObject.wrapJSObject(
    '<node><interface name="org.kde.StatusNotifierItem"><property name="Id" type="s" access="read"/><property name="IconName" type="s" access="read"/></interface></node>',
    { Id: 'hotplug-test', IconName: 'dialog-information-symbolic' },
  )
  const bus = Gio.DBus.session
  const key = bus.get_unique_name() + path
  item.export(bus, path)
  try {
    await run(
      'gdbus',
      'call',
      '--session',
      '--dest',
      'org.kde.StatusNotifierWatcher',
      '--object-path',
      '/StatusNotifierWatcher',
      '--method',
      'org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem',
      bus.get_unique_name(),
    )
    const verify = async (count, previous) => {
      await until(() => {
        const panels = global.dashToPanel.panels
        const button = tray._buttons.get(key)
        return (
          panels !== previous &&
          panels.length === count &&
          panels.length === Main.layoutManager.monitors.length &&
          panels.every(
            (p) =>
              p.monitor === Main.layoutManager.monitors[p.monitor.index] &&
              displayedOn(p.panelBox, p.monitor) &&
              p.taskbar
                ._getAppIcons()
                .some((icon) => displayedOn(icon, p.monitor)),
          ) &&
          panels[0].monitor === Main.layoutManager.primaryMonitor &&
          displayedOn(button?._icon, panels[0].monitor) &&
          panels[0].panel.contains(button.container)
        )
      }, `Expected visible taskbar and tray icons after switching to ${count} display(s)`)
    }
    const connectors = Array.from(
      (await run('gdctl', 'show')).matchAll(/Monitor (\S+) \(/g),
      (match) => match[1],
    )
    if (connectors.length !== 2)
      throw new Error('Expected two virtual monitors')
    const [first, second] = connectors
    await verify(2)
    const switchTo = async (count, ...args) => {
      const previous = global.dashToPanel.panels
      await run('gdctl', 'set', ...args)
      await verify(count, previous)
    }
    const left = ['-L', '-M', first]
    const right = ['-L', '-M', second, '--right-of', first]
    await switchTo(1, '-L', '-M', second, '--primary')
    await switchTo(2, ...left, '--primary', ...right)
    await switchTo(2, ...left, ...right, '--primary')
    await switchTo(1, ...left, '--primary')
  } finally {
    item.unexport()
  }
}

export default class MonitorTest extends Extension {
  enable() {
    if (!global.backend.is_headless())
      throw new Error('Requires a headless desktop')
    test()
      .then(() =>
        GLib.file_set_contents(
          GLib.build_filenamev([GLib.get_user_runtime_dir(), 'passed']),
          'Taskbar and tray icons survived all four monitor changes.\n',
        ),
      )
      .catch((error) => console.error(error))
      .finally(() => global.context.terminate())
  }

  disable() {}
}
