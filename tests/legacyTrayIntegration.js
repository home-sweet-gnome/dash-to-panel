/* SPDX-License-Identifier: GPL-2.0-or-later */

import Clutter from 'gi://Clutter'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'

const wait = (milliseconds) =>
  new Promise((resolve) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
      resolve()
      return GLib.SOURCE_REMOVE
    }),
  )

function assert(value, message) {
  if (!value) throw new Error(message)
}

export async function testLegacyTray(tray) {
  assert(
    global.backend.is_headless(),
    'Run this test with tests/runLegacyTrayIntegration.py in a headless desktop',
  )
  const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
  })
  launcher.setenv('GDK_BACKEND', 'x11', true)
  launcher.setenv('PYTHONWARNINGS', 'ignore::DeprecationWarning', true)
  const fixture = Gio.File.new_for_uri(import.meta.url)
    .get_parent()
    .get_child('legacyTrayXembed.py')
    .get_path()
  const child = launcher.spawnv(['/usr/bin/python3', fixture])
  const output = new Gio.DataInputStream({
    base_stream: child.get_stdout_pipe(),
  })
  const events = []
  let latest
  const readOutput = (async () => {
    while (true) {
      const line = await new Promise((resolve, reject) =>
        output.read_line_async(
          GLib.PRIORITY_DEFAULT,
          null,
          (stream, result) => {
            try {
              resolve(stream.read_line_finish_utf8(result)[0])
            } catch (error) {
              reject(error)
            }
          },
        ),
      )
      if (line === null) return
      const message = JSON.parse(line)
      events.push(message)
      if (message.event === 'geometry') latest = message
    }
  })()
  const until = async (predicate, message) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (predicate()) return
      await wait(100)
    }
    throw new Error(message)
  }
  const legacy = tray._legacyTray
  const settings = tray._settings
  const originalPointer = global.get_pointer()
  const panel = tray._panel
  const panelVisible = panel.panelBox.visible
  const backend =
    global.stage.context?.get_backend() ?? Clutter.get_default_backend()
  const seat = backend.get_default_seat()
  const pointer = seat.create_virtual_device(
    Clutter.InputDeviceType.POINTER_DEVICE,
  )
  const click = async (button, mouseButton) => {
    const [x, y] = button.get_transformed_position()
    const [width, height] = button.get_transformed_size()
    seat.warp_pointer(100, 100)
    await wait(100)
    seat.warp_pointer(x + width / 2, y + height / 2)
    await wait(100)
    pointer.notify_button(
      GLib.get_monotonic_time(),
      mouseButton,
      Clutter.ButtonState.PRESSED,
    )
    await wait(100)
    pointer.notify_button(
      GLib.get_monotonic_time(),
      mouseButton,
      Clutter.ButtonState.RELEASED,
    )
    await wait(200)
  }
  try {
    await until(
      () => !Main.layoutManager._startingUp,
      'The isolated desktop did not finish starting',
    )
    Main.welcomeDialog?.close()
    Main.overview.hide()
    await until(
      () => Main.modalCount === 0,
      `The isolated desktop retained a modal grab: ${JSON.stringify(Main.modalActorFocusStack.map((record) => ({ name: record.actor?.name, type: record.actor?.constructor.name })))}`,
    )
    await until(
      () => events.some((event) => event.event === 'ready'),
      'XEmbed fixture did not start',
    )
    assert(
      events.find((event) => event.event === 'ready').owner === 0,
      'Another legacy tray is active; the native integration test will not replace it',
    )
    panel.panelBox.show()
    assert(
      !settings.get_boolean('native-tray-legacy-enabled') && !legacy._manager,
      'The legacy backend was not disabled by default',
    )
    settings.set_boolean('native-tray-legacy-enabled', true)
    assert(
      !legacy._manager,
      'The beta acquired a legacy tray while the main tray was disabled',
    )
    settings.set_boolean('native-tray-enabled', true)
    await until(
      () =>
        [...legacy._buttons.keys()].some(
          (icon) => icon.title === 'DTP legacy tray test',
        ),
      'The native XEmbed icon was not discovered',
    )
    const [icon, button] = [...legacy._buttons.entries()].find(
      ([candidate]) => candidate.title === 'DTP legacy tray test',
    )
    await until(
      () => latest?.embedded && button.mapped && icon.get_source(),
      'The legacy icon was not embedded and allocated',
    )
    const [x, y] = icon.get_transformed_position()
    assert(
      Math.abs(latest.x - x) <= 2 && Math.abs(latest.y - y) <= 2,
      'The X11 icon geometry does not match the panel balloon anchor',
    )
    await click(button, 1)
    await until(
      () => events.some((event) => event.event === 'activate'),
      'The legacy application did not receive a left click',
    )
    await click(button, 3)
    await until(
      () => events.some((event) => event.event === 'menu'),
      'The legacy application did not receive a right click',
    )
    child.get_stdin_pipe().close(null)
    await until(
      () => !legacy._buttons.has(icon),
      'The native tray retained a disconnected application icon',
    )
    settings.set_boolean('native-tray-legacy-enabled', false)
    assert(
      !legacy._manager && tray.watcher?.active,
      'Disabling the beta also stopped the modern tray',
    )
    settings.set_boolean('native-tray-enabled', false)
    assert(
      !legacy._manager && !tray.watcher,
      'Disabling the tray retained a legacy manager or modern watcher',
    )
    return {
      optIn: true,
      independent: true,
      embedded: true,
      geometry: true,
      left: true,
      right: true,
      removal: true,
    }
  } finally {
    if (child.get_identifier() !== null) child.force_exit()
    tray.destroy()
    if (!panelVisible) panel.panelBox.hide()
    seat.warp_pointer(originalPointer[0], originalPointer[1])
    await readOutput
  }
}
