/* SPDX-License-Identifier: GPL-2.0-or-later */

import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'
import System from 'system'
import { addSystemTrayPreferences } from '../src/systemTrayPrefs.js'

function find(root, predicate) {
  if (predicate(root)) return root
  for (
    let child = root.get_first_child();
    child;
    child = child.get_next_sibling()
  ) {
    const result = find(child, predicate)
    if (result) return result
  }
  return null
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

let passed = false
const app = new Adw.Application({
  application_id: 'org.gnome.DashToPanel.TrayPreferencesTest',
})
app.connect('activate', () => {
  const window = new Adw.PreferencesWindow({
    application: app,
    title: 'Native tray preferences test',
  })
  try {
    const directory = GLib.build_filenamev([GLib.get_current_dir(), 'schemas'])
    const source = Gio.SettingsSchemaSource.new_from_directory(
      directory,
      Gio.SettingsSchemaSource.get_default(),
      false,
    )
    const settings = new Gio.Settings({
      settings_schema: source.lookup(
        'org.gnome.shell.extensions.dash-to-panel',
        false,
      ),
    })
    settings.set_boolean('native-tray-migrated', true)
    settings.set_string(
      'native-tray-known-apps',
      JSON.stringify({
        'sample-player': 'Sample player',
        'example-app': 'Example app',
      }),
    )
    addSystemTrayPreferences(window, settings, (text) => text)
    const legacy = find(
      window,
      (widget) =>
        widget instanceof Adw.SwitchRow &&
        widget.title === 'Wine/Proton compatibility (experimental)',
    )
    assert(
      legacy && !legacy.active && !legacy.sensitive,
      'Experimental compatibility must default off and require the built-in tray',
    )
    settings.set_boolean('native-tray-enabled', true)
    assert(
      legacy.sensitive,
      'Enabling the native tray did not enable the beta control',
    )
    legacy.active = true
    assert(
      settings.get_boolean('native-tray-legacy-enabled'),
      'The beta control did not persist its own opt-in',
    )
    settings.set_boolean('native-tray-enabled', false)
    assert(
      !legacy.sensitive && legacy.active,
      'Disabling the parent tray lost the saved opt-in or left its control active',
    )
    legacy.active = false
    console.log(
      'PASS experimental Wine compatibility defaults, binding and parent dependency',
    )
    const spacing = find(
      window,
      (widget) =>
        widget instanceof Adw.SpinRow && widget.title === 'Icon spacing',
    )
    spacing.value = 2
    assert(
      settings.get_int('native-tray-icon-spacing') === 2,
      'Spacing control did not save',
    )
    const collapse = find(
      window,
      (widget) =>
        widget instanceof Adw.SwitchRow &&
        widget.title === 'Collapse extra icons',
    )
    collapse.active = true
    const count = find(
      window,
      (widget) =>
        widget instanceof Adw.SpinRow &&
        widget.title === 'Maximum visible icons',
    )
    count.value = 1
    assert(
      settings.get_boolean('native-tray-overflow-enabled') &&
        settings.get_int('native-tray-visible-count') === 1 &&
        count.sensitive,
      'Overflow controls did not save or enable',
    )
    count.value = 0
    assert(
      settings.get_int('native-tray-visible-count') === 0,
      'Zero visible count was rejected',
    )
    console.log('PASS spacing and overflow preference controls')
    const row = find(
      window,
      (widget) =>
        widget instanceof Adw.ExpanderRow && widget.title === 'Sample player',
    )
    assert(row, 'Application expander is missing')
    row.expanded = true
    const visible = find(
      row,
      (widget) =>
        widget instanceof Adw.SwitchRow && widget.title === 'Show icon',
    )
    visible.active = false
    const values = () =>
      JSON.parse(settings.get_string('native-tray-customizations'))['sample-player']
    assert(values().hidden, 'Visibility switch did not save its value')
    const icon = find(
      row,
      (widget) =>
        widget instanceof Adw.EntryRow &&
        widget.title === 'Icon name or file path',
    )
    icon.text = 'applications-system-symbolic'
    icon.emit('apply')
    assert(values().icon === icon.text, 'Icon entry did not save its value')
    const brightness = find(
      row,
      (widget) =>
        widget instanceof Adw.SpinRow && widget.title === 'Brightness',
    )
    brightness.value = 0.25
    assert(
      values().brightness === 0.25,
      'Brightness control did not save its value',
    )
    const tint = find(
      row,
      (widget) =>
        widget instanceof Adw.EntryRow && widget.title.startsWith('Tint color'),
    )
    tint.text = '#00aaff'
    tint.emit('apply')
    assert(values().tint === '#00aaff', 'Tint entry did not save its value')
    tint.text = 'invalid'
    tint.emit('apply')
    assert(values().tint === '#00aaff', 'Invalid tint replaced a valid color')
    const reset = find(
      row,
      (widget) => widget instanceof Gtk.Button && widget.label === 'Reset',
    )
    reset.emit('clicked')
    assert(!values(), 'Reset did not remove per-application overrides')
    console.log(
      'PASS preferences expand, visibility, icon, brightness, tint validation and reset',
    )
    const down = find(
      window,
      (widget) =>
        widget instanceof Gtk.Button &&
        widget.tooltip_text === 'Move down' &&
        widget.sensitive,
    )
    assert(down, 'Dedicated order control is missing')
    down.emit('clicked')
    assert(
      settings.get_strv('native-tray-order').join(',') ===
        'example-app,sample-player',
      'Dedicated order control did not persist',
    )
    console.log('PASS dedicated application order preference')
    passed = true
  } catch (error) {
    console.error(error.stack)
  }
  window.close()
  app.quit()
})
app.run([])
if (!passed) System.exit(1)
