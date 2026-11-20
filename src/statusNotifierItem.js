/* SPDX-License-Identifier: GPL-2.0-or-later */

import Clutter from 'gi://Clutter'
import GdkPixbuf from 'gi://GdkPixbuf'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import GObject from 'gi://GObject'
import St from 'gi://St'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import {
  call,
  ITEM_INTERFACE,
  unpackProperties,
} from './statusNotifierWatcher.js'
import { pixmapToRgba } from './statusNotifierUtils.js'
import { applyIconEffects } from './statusNotifierEffects.js'

const MENU_INTERFACE = 'com.canonical.dbusmenu'

function themedIcon(name) {
  return new Gio.ThemedIcon({
    names: [
      name || 'application-x-executable-symbolic',
      'application-x-executable-symbolic',
    ],
  })
}

function imageIcon(properties, prefix, size, override = '') {
  const name = override || properties[`${prefix}Name`] || ''
  if (name.startsWith('/'))
    return new Gio.FileIcon({ file: Gio.File.new_for_path(name) })
  if (name && properties.IconThemePath && !override) {
    for (const extension of ['', '.png', '.svg', '.xpm']) {
      const path = GLib.build_filenamev([
        properties.IconThemePath,
        name + extension,
      ])
      if (GLib.file_test(path, GLib.FileTest.IS_REGULAR))
        return new Gio.FileIcon({ file: Gio.File.new_for_path(path) })
    }
  }
  if (!override) {
    const pixmap = pixmapToRgba(properties[`${prefix}Pixmap`] || [], size)
    if (pixmap) {
      const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
        new GLib.Bytes(pixmap.bytes),
        GdkPixbuf.Colorspace.RGB,
        true,
        8,
        pixmap.width,
        pixmap.height,
        pixmap.width * 4,
      )
      const [, data] = pixbuf.save_to_bufferv('png', [], [])
      return new Gio.BytesIcon({ bytes: new GLib.Bytes(data) })
    }
  }
  return themedIcon(name)
}

export const StatusNotifierItem = GObject.registerClass(
  {
    GTypeName: 'DashToPanelStatusNotifierItem',
    Signals: { 'item-updated': {} },
  },
  class StatusNotifierItem extends PanelMenu.Button {
    _init(bus, item, configuration, onIdentityChanged = () => {}) {
      super._init(0.5, item.properties.Title || item.properties.Id)
      this._clickGesture?.set_enabled(false)
      this._bus = bus
      this.item = item
      this._configuration = configuration
      this._onIdentityChanged = onIdentityChanged
      this._cancellable = new Gio.Cancellable()
      this._signals = []
      this._menuRequest = 0
      this._iconBox = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      })
      this._icon = new St.Icon({
        style_class: 'system-status-icon',
        icon_size: 16,
      })
      this._overlay = new St.Icon({
        icon_size: 8,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.END,
      })
      this._iconBox.add_child(this._icon)
      this._iconBox.add_child(this._overlay)
      this.add_child(this._iconBox)
      this._signals.push(
        bus.signal_subscribe(
          item.owner,
          null,
          null,
          item.path,
          null,
          Gio.DBusSignalFlags.NONE,
          () => this._refresh(),
        ),
      )
      this.menu.connect('open-state-changed', (menu, open) => {
        if (open) this._refreshMenu()
      })
      this.connect('destroy', () => {
        this._disposed = true
        this._cancellable.cancel()
        for (const id of this._signals) this._bus.signal_unsubscribe(id)
        this._signals = []
      })
      this.applyAppearance(configuration)
    }

    async _refresh() {
      if (this._disposed) return
      if (this._refreshing) {
        this._refreshAgain = true
        return
      }
      this._refreshing = true
      try {
        const [properties] = await call(
          this._bus,
          this.item.owner,
          this.item.path,
          'org.freedesktop.DBus.Properties',
          'GetAll',
          new GLib.Variant('(s)', [ITEM_INTERFACE]),
          this._cancellable,
        )
        if (this._disposed) return
        const oldId = this.item.properties.Id
        this.item.properties = unpackProperties(properties)
        this.applyAppearance(this._configuration)
        if (oldId !== this.item.properties.Id)
          this._onIdentityChanged(this.item)
        this.emit('item-updated')
      } catch {
        return
      } finally {
        this._refreshing = false
        if (this._refreshAgain && !this._disposed) {
          this._refreshAgain = false
          this._refresh()
        }
      }
    }

    applyAppearance(configuration) {
      if (this._disposed) return
      this._configuration = configuration
      const properties = this.item.properties
      this.visible = !configuration.hidden && properties.Status !== 'Passive'
      this.accessible_name = properties.Title || properties.Id
      const attention = properties.Status === 'NeedsAttention'
      const prefix =
        attention &&
        (properties.AttentionIconName || properties.AttentionIconPixmap?.length)
          ? 'AttentionIcon'
          : 'Icon'
      const size = 16 * St.ThemeContext.get_for_stage(global.stage).scale_factor
      this._icon.gicon = imageIcon(properties, prefix, size, configuration.icon)
      this._overlay.visible = Boolean(
        properties.OverlayIconName || properties.OverlayIconPixmap?.length,
      )
      if (this._overlay.visible)
        this._overlay.gicon = imageIcon(properties, 'OverlayIcon', size / 2)
      applyIconEffects(this._iconBox, configuration)
      this._syncMenuSignal()
    }

    _syncMenuSignal() {
      const path = this.item.properties.Menu
      if (path === this._menuPath) return
      if (this._menuSignal) {
        this._bus.signal_unsubscribe(this._menuSignal)
        this._signals = this._signals.filter((id) => id !== this._menuSignal)
        this._menuSignal = 0
      }
      this._menuPath = path
      if (!path || path === '/') return
      this._menuSignal = this._bus.signal_subscribe(
        this.item.owner,
        MENU_INTERFACE,
        null,
        path,
        null,
        Gio.DBusSignalFlags.NONE,
        () => {
          const menu = this._presentationMenu || this.menu
          if (menu.isOpen) this._refreshMenu(menu)
        },
      )
      this._signals.push(this._menuSignal)
    }

    _toggleMenu() {
      if (!this.menu.numMenuItems)
        this.menu.addMenuItem(
          new PopupMenu.PopupMenuItem('…', { reactive: false }),
        )
      this.menu.toggle()
    }

    vfunc_event(event) {
      if (!this.item) return Clutter.EVENT_PROPAGATE
      const type = event.type()
      if (
        type === Clutter.EventType.BUTTON_PRESS ||
        type === Clutter.EventType.TOUCH_END
      ) {
        const button =
          type === Clutter.EventType.TOUCH_END ? 1 : event.get_button()
        if (button === 2) this._invoke('SecondaryActivate', event)
        else if (button === 1 || button === 3) {
          if (this._menuPath && this._menuPath !== '/') this._toggleMenu()
          else this._invoke(button === 3 ? 'ContextMenu' : 'Activate', event)
        }
        return Clutter.EVENT_STOP
      }
      if (type === Clutter.EventType.SCROLL) {
        const direction = event.get_scroll_direction()
        let delta =
          direction === Clutter.ScrollDirection.UP ||
          direction === Clutter.ScrollDirection.LEFT
            ? 120
            : -120
        let orientation =
          direction === Clutter.ScrollDirection.LEFT ||
          direction === Clutter.ScrollDirection.RIGHT
            ? 'horizontal'
            : 'vertical'
        if (direction === Clutter.ScrollDirection.SMOOTH) {
          const [dx, dy] = event.get_scroll_delta()
          orientation = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
          delta = Math.round(-120 * (orientation === 'horizontal' ? dx : dy))
        }
        call(
          this._bus,
          this.item.owner,
          this.item.path,
          ITEM_INTERFACE,
          'Scroll',
          new GLib.Variant('(is)', [delta, orientation]),
          this._cancellable,
        ).catch(() => {})
        return Clutter.EVENT_STOP
      }
      if (
        type === Clutter.EventType.KEY_PRESS &&
        [
          Clutter.KEY_Return,
          Clutter.KEY_KP_Enter,
          Clutter.KEY_space,
          Clutter.KEY_Menu,
        ].includes(event.get_key_symbol())
      ) {
        if (this._menuPath && this._menuPath !== '/') this._toggleMenu()
        else this._invoke('Activate')
        return Clutter.EVENT_STOP
      }
      return Clutter.EVENT_PROPAGATE
    }

    _invoke(method, event = null) {
      const [x, y] = event
        ? event.get_coords()
        : (
            this._presentationMenu?.sourceActor || this
          ).get_transformed_position()
      call(
        this._bus,
        this.item.owner,
        this.item.path,
        ITEM_INTERFACE,
        method,
        new GLib.Variant('(ii)', [Math.round(x), Math.round(y)]),
        this._cancellable,
      ).catch(() => {})
    }

    async _refreshMenu(menu = this._presentationMenu || this.menu) {
      const path = this._menuPath
      if (this._disposed || menu._dtpDestroyed || !path || path === '/') return
      if (this._menuRefreshTarget === menu) return
      this._menuRefreshTarget = menu
      const request = ++this._menuRequest
      if (!menu.numMenuItems)
        menu.addMenuItem(new PopupMenu.PopupMenuItem('…', { reactive: false }))
      try {
        await call(
          this._bus,
          this.item.owner,
          path,
          MENU_INTERFACE,
          'AboutToShow',
          new GLib.Variant('(i)', [0]),
          this._cancellable,
        ).catch(() => {})
        const [, layout] = await call(
          this._bus,
          this.item.owner,
          path,
          MENU_INTERFACE,
          'GetLayout',
          new GLib.Variant('(iias)', [0, -1, []]),
          this._cancellable,
        )
        if (
          this._disposed ||
          menu._dtpDestroyed ||
          request !== this._menuRequest ||
          path !== this._menuPath
        )
          return
        menu.removeAll()
        const budget = { remaining: 1000 }
        for (const child of layout[2])
          this._addMenuNode(menu, child, path, budget, 0)
      } catch {
        if (
          !this._disposed &&
          !menu._dtpDestroyed &&
          request === this._menuRequest
        ) {
          menu.close()
          this._invoke('ContextMenu')
        }
      } finally {
        if (this._menuRefreshTarget === menu) this._menuRefreshTarget = null
      }
    }

    _addMenuNode(menu, node, path, budget, depth) {
      if (budget.remaining-- <= 0 || depth > 12) return
      const [id, rawProperties, children] =
        node instanceof GLib.Variant ? node.deep_unpack() : node
      const properties = unpackProperties(rawProperties)
      if (properties.visible === false) return
      if (properties.type === 'separator') {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
        return
      }
      const label = (properties.label || '')
        .replace(/__/g, '\0')
        .replace(/_/g, '')
        .replace(/\0/g, '_')
      const submenu =
        properties['children-display'] === 'submenu' || children.length > 0
      const row = submenu
        ? new PopupMenu.PopupSubMenuMenuItem(label)
        : properties['icon-name']
          ? new PopupMenu.PopupImageMenuItem(label, properties['icon-name'])
          : new PopupMenu.PopupMenuItem(label)
      row.setSensitive(properties.enabled !== false)
      if (properties['toggle-state'] === 1)
        row.setOrnament(
          properties['toggle-type'] === 'radio'
            ? PopupMenu.Ornament.DOT
            : PopupMenu.Ornament.CHECK,
        )
      if (submenu) {
        for (const child of children)
          this._addMenuNode(row.menu, child, path, budget, depth + 1)
        row.menu.connect('open-state-changed', (childMenu, open) => {
          if (!open) return
          call(
            this._bus,
            this.item.owner,
            path,
            MENU_INTERFACE,
            'AboutToShow',
            new GLib.Variant('(i)', [id]),
            this._cancellable,
          ).catch(() => {})
        })
      } else {
        row.connect('activate', () => {
          call(
            this._bus,
            this.item.owner,
            path,
            MENU_INTERFACE,
            'Event',
            new GLib.Variant('(isvu)', [
              id,
              'clicked',
              new GLib.Variant('i', 0),
              global.get_current_time(),
            ]),
            this._cancellable,
          ).catch(() => {})
        })
      }
      menu.addMenuItem(row)
    }
  },
)
