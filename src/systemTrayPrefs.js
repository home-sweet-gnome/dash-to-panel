/* SPDX-License-Identifier: GPL-2.0-or-later */

import Adw from 'gi://Adw'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'
import {
  call,
  unpackProperties,
  WATCHER_NAME,
  WATCHER_PATH,
  ITEM_INTERFACE,
} from './statusNotifierWatcher.js'
import { appearance, parseObject } from './statusNotifierUtils.js'
import { migrateTraySettings } from './statusNotifierConfig.js'

export function addSystemTrayPreferences(window, settings, _) {
  migrateTraySettings(settings)
  const page = new Adw.PreferencesPage({
    title: _('System Tray'),
    icon_name: 'view-more-symbolic',
  })
  const behavior = new Adw.PreferencesGroup({
    title: _('Application tray icons'),
  })
  const enabled = new Adw.SwitchRow({
    title: _('Use the built-in system tray'),
    subtitle: _(
      'Show application icons and menus without another tray extension',
    ),
  })
  settings.bind(
    'native-tray-enabled',
    enabled,
    'active',
    Gio.SettingsBindFlags.DEFAULT,
  )
  behavior.add(enabled)
  const legacy = new Adw.SwitchRow({
    title: _('Wine/Proton compatibility (experimental)'),
    subtitle: _(
      'Show legacy tray icons inline and anchor Wine balloon notices beside them. Requires X11 or XWayland; game-specific notices still need testing.',
    ),
  })
  settings.bind(
    'native-tray-legacy-enabled',
    legacy,
    'active',
    Gio.SettingsBindFlags.DEFAULT,
  )
  settings.bind(
    'native-tray-enabled',
    legacy,
    'sensitive',
    Gio.SettingsBindFlags.GET,
  )
  behavior.add(legacy)
  const style = new Adw.ComboRow({
    title: _('Default icon appearance'),
    model: Gtk.StringList.new([_('Original colors'), _('Monochrome')]),
    selected:
      settings.get_string('native-tray-icon-style') === 'symbolic' ? 1 : 0,
  })
  style.connect('notify::selected', () =>
    settings.set_string(
      'native-tray-icon-style',
      style.selected ? 'symbolic' : 'original',
    ),
  )
  behavior.add(style)
  const layoutSignals = []
  function integerRow(key, title, subtitle, minimum, maximum) {
    const row = new Adw.SpinRow({
      title,
      subtitle,
      digits: 0,
      adjustment: new Gtk.Adjustment({
        lower: minimum,
        upper: maximum,
        step_increment: 1,
        page_increment: 4,
        value: settings.get_int(key),
      }),
    })
    row.connect('notify::value', () =>
      settings.set_int(key, Math.round(row.value)),
    )
    layoutSignals.push(
      settings.connect(`changed::${key}`, () => {
        row.value = settings.get_int(key)
      }),
    )
    behavior.add(row)
    return row
  }
  integerRow(
    'native-tray-icon-spacing',
    _('Icon spacing'),
    _('Gap between application icons, in pixels'),
    0,
    24,
  )
  const collapse = new Adw.SwitchRow({
    title: _('Collapse extra icons'),
    subtitle: _('Show the remaining icons in a popup'),
  })
  settings.bind(
    'native-tray-overflow-enabled',
    collapse,
    'active',
    Gio.SettingsBindFlags.DEFAULT,
  )
  behavior.add(collapse)
  const count = integerRow(
    'native-tray-visible-count',
    _('Maximum visible icons'),
    _('Zero keeps every application icon in the popup'),
    0,
    32,
  )
  settings.bind(
    'native-tray-overflow-enabled',
    count,
    'sensitive',
    Gio.SettingsBindFlags.GET,
  )
  page.add(behavior)
  const ordering = new Adw.PreferencesGroup({
    title: _('Icon order'),
    description: _(
      'Move applications up or down. The first running, visible icons stay on the panel; the rest go into the popup.',
    ),
  })
  page.add(ordering)
  const apps = new Adw.PreferencesGroup({
    title: _('Per-application settings'),
    description: _(
      'Choose which icons appear, their order, and their appearance. Another active tray extension takes priority until it is disabled.',
    ),
  })
  page.add(apps)
  window.add(page)
  const rows = []
  const orderRows = []
  let disposed = false
  const cancellable = new Gio.Cancellable()

  function update(id, key, value) {
    const customizations = parseObject(
      settings.get_string('native-tray-customizations'),
    )
    const current = Object.hasOwn(customizations, id) ? customizations[id] : {}
    customizations[id] = { ...current, [key]: value }
    settings.set_string(
      'native-tray-customizations',
      JSON.stringify(customizations),
    )
  }

  function populate() {
    if (disposed) return
    for (const row of rows) apps.remove(row)
    rows.length = 0
    for (const row of orderRows) ordering.remove(row)
    orderRows.length = 0
    const known = parseObject(settings.get_string('native-tray-known-apps'))
    const customizations = parseObject(
      settings.get_string('native-tray-customizations'),
    )
    const order = settings.get_strv('native-tray-order')
    const ids = Array.from(
      new Set([
        ...order,
        ...Object.keys(known),
        ...Object.keys(customizations),
      ]),
    )
    if (!ids.length) {
      const empty = new Adw.ActionRow({
        title: _('No application tray icons found yet'),
        subtitle: _('Open an application that uses a system tray icon'),
      })
      apps.add(empty)
      rows.push(empty)
    }
    ids.forEach((id, index) => {
      const value = Object.hasOwn(customizations, id) ? customizations[id] : {}
      const configuration = appearance(value)
      const row = new Adw.ExpanderRow({ title: known[id] || id, subtitle: id })
      const orderRow = new Adw.ActionRow({
        title: known[id] || id,
        subtitle: id,
      })
      const move = new Gtk.Box({ spacing: 4, valign: Gtk.Align.CENTER })
      for (const [offset, icon, tooltip] of [
        [-1, 'go-up-symbolic', _('Move up')],
        [1, 'go-down-symbolic', _('Move down')],
      ]) {
        const button = new Gtk.Button({
          icon_name: icon,
          tooltip_text: tooltip,
          sensitive: index + offset >= 0 && index + offset < ids.length,
        })
        button.connect('clicked', () => {
          const next = [...ids]
          const target = index + offset
          ;[next[index], next[target]] = [next[target], next[index]]
          settings.set_strv('native-tray-order', next)
        })
        move.append(button)
      }
      orderRow.add_suffix(move)
      ordering.add(orderRow)
      orderRows.push(orderRow)
      const visible = new Adw.SwitchRow({
        title: _('Show icon'),
        active: !configuration.hidden,
      })
      visible.connect('notify::active', () =>
        update(id, 'hidden', !visible.active),
      )
      row.add_row(visible)
      const icon = new Adw.EntryRow({
        title: _('Icon name or file path'),
        text: configuration.icon,
        show_apply_button: true,
      })
      icon.connect('apply', () => update(id, 'icon', icon.text.trim()))
      const choose = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        tooltip_text: _('Choose an icon file'),
        valign: Gtk.Align.CENTER,
      })
      choose.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({ title: _('Choose an icon file') })
        dialog.open(window, cancellable, (source, result) => {
          try {
            const file = source.open_finish(result)
            if (!disposed && file.get_path()) {
              icon.text = file.get_path()
              update(id, 'icon', file.get_path())
            }
          } catch {
            return
          }
        })
      })
      icon.add_suffix(choose)
      row.add_row(icon)
      const iconStyle = new Adw.ComboRow({
        title: _('Icon appearance'),
        model: Gtk.StringList.new([
          _('Use default'),
          _('Original colors'),
          _('Monochrome'),
        ]),
        selected:
          value?.style === 'original' ? 1 : value?.style === 'symbolic' ? 2 : 0,
      })
      iconStyle.connect('notify::selected', () =>
        update(
          id,
          'style',
          ['default', 'original', 'symbolic'][iconStyle.selected],
        ),
      )
      row.add_row(iconStyle)
      for (const [key, title, min, max] of [
        ['saturation', _('Saturation'), 0, 1],
        ['brightness', _('Brightness'), -1, 1],
        ['contrast', _('Contrast'), -1, 1],
      ]) {
        const spin = new Adw.SpinRow({
          title,
          digits: 2,
          adjustment: new Gtk.Adjustment({
            lower: min,
            upper: max,
            step_increment: 0.05,
            page_increment: 0.1,
            value: configuration[key],
          }),
        })
        spin.connect('notify::value', () => update(id, key, spin.value))
        row.add_row(spin)
      }
      const tint = new Adw.EntryRow({
        title: _('Tint color (#RRGGBB, optional)'),
        text: configuration.tint,
        show_apply_button: true,
      })
      tint.connect('apply', () => {
        const color = tint.text.trim()
        if (!color || /^#[\da-f]{6}$/i.test(color)) {
          tint.remove_css_class('error')
          update(id, 'tint', color)
        } else tint.add_css_class('error')
      })
      row.add_row(tint)
      const resetRow = new Adw.ActionRow({ title: _('Reset this application') })
      const reset = new Gtk.Button({
        label: _('Reset'),
        valign: Gtk.Align.CENTER,
      })
      reset.connect('clicked', () => {
        const all = parseObject(
          settings.get_string('native-tray-customizations'),
        )
        delete all[id]
        settings.set_string('native-tray-customizations', JSON.stringify(all))
        populate()
      })
      resetRow.add_suffix(reset)
      row.add_row(resetRow)
      apps.add(row)
      rows.push(row)
    })
  }

  const knownSignal = settings.connect(
    'changed::native-tray-known-apps',
    populate,
  )
  const orderSignal = settings.connect('changed::native-tray-order', populate)
  window.connect('close-request', () => {
    if (disposed) return false
    disposed = true
    cancellable.cancel()
    settings.disconnect(knownSignal)
    settings.disconnect(orderSignal)
    for (const signal of layoutSignals) settings.disconnect(signal)
    return false
  })
  populate()
  ;(async () => {
    try {
      const [value] = await call(
        Gio.DBus.session,
        WATCHER_NAME,
        WATCHER_PATH,
        'org.freedesktop.DBus.Properties',
        'Get',
        new GLib.Variant('(ss)', [
          WATCHER_NAME,
          'RegisteredStatusNotifierItems',
        ]),
        cancellable,
      )
      const known = parseObject(settings.get_string('native-tray-known-apps'))
      await Promise.all(
        value.deep_unpack().map(async (address) => {
          const slash = address.indexOf('/')
          const owner = slash < 0 ? address : address.slice(0, slash)
          const path = slash < 0 ? '/StatusNotifierItem' : address.slice(slash)
          try {
            const [properties] = await call(
              Gio.DBus.session,
              owner,
              path,
              'org.freedesktop.DBus.Properties',
              'GetAll',
              new GLib.Variant('(s)', [ITEM_INTERFACE]),
              cancellable,
            )
            const item = unpackProperties(properties)
            if (item.Id) known[item.Id] = item.Title || item.Id
          } catch {
            return
          }
        }),
      )
      if (!disposed)
        settings.set_string('native-tray-known-apps', JSON.stringify(known))
    } catch {
      return
    }
  })()
}
