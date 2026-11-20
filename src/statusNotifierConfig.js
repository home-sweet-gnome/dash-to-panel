/* SPDX-License-Identifier: GPL-2.0-or-later */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import { parseObject } from './statusNotifierUtils.js'

export function migrateTraySettings(settings) {
  if (settings.get_boolean('native-tray-migrated')) return
  for (const root of [
    GLib.get_user_data_dir(),
    ...GLib.get_system_data_dirs(),
  ]) {
    const directory = GLib.build_filenamev([
      root,
      'gnome-shell/extensions/status-tray@keithvassallo.com/schemas',
    ])
    if (
      !GLib.file_test(
        GLib.build_filenamev([directory, 'gschemas.compiled']),
        GLib.FileTest.IS_REGULAR,
      )
    )
      continue
    try {
      const source = Gio.SettingsSchemaSource.new_from_directory(
        directory,
        Gio.SettingsSchemaSource.get_default(),
        false,
      )
      const schema = source.lookup(
        'org.gnome.shell.extensions.status-tray',
        false,
      )
      if (!schema) continue
      const legacy = new Gio.Settings({ settings_schema: schema })
      const overrides = legacy.get_value('icon-overrides').deep_unpack()
      const effects = legacy.get_value('icon-effect-overrides').deep_unpack()
      const disabled = legacy.get_strv('disabled-apps')
      const existing = parseObject(
        settings.get_string('native-tray-customizations'),
      )
      const ids = new Set([
        ...Object.keys(overrides),
        ...Object.keys(effects),
        ...disabled,
      ])
      for (const id of ids) {
        if (Object.hasOwn(existing, id)) continue
        const effect = parseObject(effects[id] || '{}')
        const value = {
          hidden: disabled.includes(id),
          icon: overrides[id] || '',
        }
        if (typeof effect.desaturation === 'number')
          value.saturation = 1 - effect.desaturation
        if (typeof effect.brightness === 'number')
          value.brightness = effect.brightness
        if (typeof effect.contrast === 'number')
          value.contrast = effect.contrast - 1
        if (effect.useTint && Array.isArray(effect.tintColor)) {
          value.tint =
            '#' +
            effect.tintColor
              .slice(0, 3)
              .map((component) =>
                Math.round(Math.max(0, Math.min(1, component)) * 255)
                  .toString(16)
                  .padStart(2, '0'),
              )
              .join('')
        }
        existing[id] = value
      }
      settings.set_string(
        'native-tray-customizations',
        JSON.stringify(existing),
      )
      if (!settings.get_strv('native-tray-order').length)
        settings.set_strv('native-tray-order', legacy.get_strv('app-order'))
      if (settings.get_user_value('native-tray-icon-style') === null)
        settings.set_string(
          'native-tray-icon-style',
          legacy.get_string('icon-mode'),
        )
      break
    } catch (error) {
      console.error(`Native tray settings migration: ${error.message}`)
    }
  }
  settings.set_boolean('native-tray-migrated', true)
}
