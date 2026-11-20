/* SPDX-License-Identifier: GPL-2.0-or-later */

import { StatusNotifierWatcher } from './statusNotifierWatcher.js'
import { StatusNotifierItem } from './statusNotifierItem.js'
import { LegacyTray } from './legacyTray.js'
import {
  appearance,
  orderedItems,
  parseObject,
  splitTrayItems,
} from './statusNotifierUtils.js'
import { migrateTraySettings } from './statusNotifierConfig.js'
import {
  StatusNotifierOverflow,
  applyTraySpacing,
} from './statusNotifierOverflow.js'

export class SystemTray {
  constructor(settings) {
    this._settings = settings
    this._buttons = new Map()
    this._serial = 0
    this._legacyTray = new LegacyTray(settings)
    migrateTraySettings(settings)
    this._settingsSignal = settings.connect('changed', (source, key) => {
      if (key === 'native-tray-enabled') this._updateEnabled()
      else if (key === 'native-tray-legacy-enabled') this._updateLegacy()
      else if (
        [
          'native-tray-icon-style',
          'native-tray-customizations',
          'native-tray-order',
          'native-tray-icon-spacing',
          'native-tray-overflow-enabled',
          'native-tray-visible-count',
        ].includes(key)
      ) {
        this._syncButtons()
        this._legacyTray.refresh()
      }
    })
  }

  setPanel(panel) {
    this._legacyTray.setPanel(null)
    this._panel = null
    this._clearButtons()
    this._panel = panel
    this._legacyTray.setPanel(panel)
    if (!this._disposed) {
      this._updateEnabled()
      this._syncButtons()
    }
  }

  _updateEnabled() {
    if (this._disposed) return
    const enabled = this._settings.get_boolean('native-tray-enabled')
    if (enabled && this._panel && !this.watcher) {
      const watcher = new StatusNotifierWatcher({
        onStateChanged: () => this._updateLegacy(),
        onAdded: (item) => {
          this._remember(item)
          this._syncButtons()
        },
        onRemoved: (key) => {
          const button = this._buttons.get(key)
          this._buttons.delete(key)
          button?.destroy()
          this._layoutItems()
        },
      })
      this.watcher = watcher
      watcher.start().catch((error) => {
        if (this._disposed || this.watcher !== watcher) return
        console.error(`Native tray: ${error.message}`)
        watcher.destroy()
        this.watcher = null
      })
    } else if (!enabled && this.watcher) {
      this._clearButtons()
      this.watcher.destroy()
      this.watcher = null
    }
  }

  _updateLegacy() {
    this._legacyTray.setEnabled(
      !this._disposed &&
        this._settings.get_boolean('native-tray-enabled') &&
        this._settings.get_boolean('native-tray-legacy-enabled') &&
        Boolean(this.watcher?.active),
    )
  }

  _remember(item) {
    const known = parseObject(
      this._settings.get_string('native-tray-known-apps'),
    )
    const id = item.properties.Id
    const title = item.properties.Title || id
    if (known[id] === title) return
    known[id] = title
    this._settings.set_string('native-tray-known-apps', JSON.stringify(known))
  }

  _order() {
    return Array.from(
      new Set([
        ...this._settings.get_strv('native-tray-order'),
        ...Object.keys(
          parseObject(this._settings.get_string('native-tray-known-apps')),
        ),
      ]),
    )
  }

  _ensureOverflow() {
    if (this._overflow) return
    this._overflow = new StatusNotifierOverflow(this._panel.geom.position)
    applyTraySpacing(
      this._overflow.button,
      this._settings.get_int('native-tray-icon-spacing'),
      this._panel.geom.vertical,
    )
    this._panel.panel.addToStatusArea(
      `dtp-native-tray-overflow-${++this._serial}`,
      this._overflow.button,
      0,
      'right',
    )
    if (this._panel.isStandalone)
      this._panel.panelManager._adjustPanelMenuButton(
        this._overflow.button,
        this._panel.monitor,
        this._panel.geom.position,
      )
  }

  _syncButtons() {
    if (
      this._disposed ||
      this._syncing ||
      this._clearing ||
      !this._panel ||
      !this.watcher?.active
    )
      return
    this._syncing = true
    try {
      this._ensureOverflow()
      const customizations = parseObject(
        this._settings.get_string('native-tray-customizations'),
      )
      const symbolic =
        this._settings.get_string('native-tray-icon-style') === 'symbolic'
      const items = orderedItems(this.watcher.items.values(), this._order())
      for (const item of items) {
        const configuration = appearance(
          Object.hasOwn(customizations, item.properties.Id)
            ? customizations[item.properties.Id]
            : {},
          symbolic,
        )
        let button = this._buttons.get(item.key)
        if (!button) {
          button = new StatusNotifierItem(
            this.watcher.bus,
            item,
            configuration,
            (changed) => {
              this._remember(changed)
              this._syncButtons()
            },
          )
          this._buttons.set(item.key, button)
          applyTraySpacing(
            button,
            this._settings.get_int('native-tray-icon-spacing'),
            this._panel.geom.vertical,
          )
          button.connect('notify::visible', () => this._layoutItems())
          button.connect('item-updated', () =>
            this._overflow?.updateItem(item.key),
          )
          this._panel.panel.addToStatusArea(
            `dtp-native-tray-${++this._serial}`,
            button,
            0,
            'right',
          )
          if (this._panel.isStandalone)
            this._panel.panelManager._adjustPanelMenuButton(
              button,
              this._panel.monitor,
              this._panel.geom.position,
            )
        } else button.applyAppearance(configuration)
      }
    } finally {
      this._syncing = false
    }
    this._layoutItems()
  }

  _layoutItems() {
    if (
      this._disposed ||
      this._syncing ||
      this._clearing ||
      !this._panel ||
      !this.watcher?.active ||
      !this._overflow
    )
      return
    const customizations = parseObject(
      this._settings.get_string('native-tray-customizations'),
    )
    const layout = splitTrayItems(
      this.watcher.items.values(),
      this._order(),
      customizations,
      this._settings.get_int('native-tray-visible-count'),
      this._settings.get_boolean('native-tray-overflow-enabled'),
    )
    const inline = new Set(layout.inline.map((item) => item.key))
    const spacing = this._settings.get_int('native-tray-icon-spacing')
    for (const [key, button] of this._buttons) {
      if (!inline.has(key)) button.menu.close()
      button.container.visible = inline.has(key)
      applyTraySpacing(button, spacing, this._panel.geom.vertical)
    }
    this._overflow.updateItems(
      layout.overflow
        .map((item) => this._buttons.get(item.key))
        .filter(Boolean),
    )
    applyTraySpacing(this._overflow.button, spacing, this._panel.geom.vertical)
    const parent = this._panel.panel._rightBox
    layout.inline.forEach((item, index) => {
      const container = this._buttons.get(item.key)?.container
      if (container?.get_parent() === parent)
        parent.set_child_at_index(container, index)
    })
    if (this._overflow.button.container.get_parent() === parent)
      parent.set_child_at_index(
        this._overflow.button.container,
        layout.inline.length,
      )
    this._inlineKeys = layout.inline.map((item) => item.key)
  }

  _clearButtons() {
    this._clearing = true
    try {
      this._overflow?.destroy()
      this._overflow = null
      for (const button of this._buttons.values()) button.destroy()
      this._buttons.clear()
    } finally {
      this._clearing = false
    }
  }

  destroy() {
    if (this._disposed) return
    this._disposed = true
    this._settings.disconnect(this._settingsSignal)
    this._legacyTray.destroy()
    this._clearButtons()
    this.watcher?.destroy()
    this.watcher = null
    this._panel = null
  }
}
