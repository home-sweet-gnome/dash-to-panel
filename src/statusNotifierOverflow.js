/* SPDX-License-Identifier: GPL-2.0-or-later */

import Clutter from 'gi://Clutter'
import St from 'gi://St'
import Gettext from 'gettext'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { applyIconEffects } from './statusNotifierEffects.js'
import { createBoxLayout } from './utils.js'

const _ = Gettext.domain('dash-to-panel').gettext

function ownedStyle(actor, style) {
  actor.set_style(style)
  if (actor._dtp_original_inline_style !== undefined)
    actor._dtp_original_inline_style = style
}

export function applyTraySpacing(button, spacing, vertical) {
  const padding = Math.max(0, spacing) / 2
  const horizontal = vertical ? 0 : padding
  ownedStyle(
    button,
    `-natural-hpadding: ${horizontal}px; -minimum-hpadding: ${horizontal}px; padding: 0; margin: 0;`,
  )
  ownedStyle(
    button._iconBox,
    `padding: ${vertical ? padding : 0}px 0; margin: 0;`,
  )
  if (button._icon?.set_style)
    ownedStyle(button._icon, 'padding: 0; margin: 0;')
  if (button._overlay) ownedStyle(button._overlay, 'padding: 0; margin: 0;')
  button.queue_relayout()
}

export class StatusNotifierOverflow {
  constructor(side) {
    this._side = side
    this.tiles = new Map()
    this._keys = []
    this.button = new PanelMenu.Button(0.5, _('Show hidden tray icons'))
    this.button._iconBox = new St.Widget({
      layout_manager: new Clutter.BinLayout(),
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    })
    const iconName =
      side === St.Side.TOP
        ? 'pan-down-symbolic'
        : side === St.Side.LEFT
          ? 'pan-end-symbolic'
          : side === St.Side.RIGHT
            ? 'pan-start-symbolic'
            : 'pan-up-symbolic'
    this.button._icon = new St.Icon({
      icon_name: iconName,
      style_class: 'system-status-icon',
      icon_size: 16,
    })
    this.button._iconBox.add_child(this.button._icon)
    this.button.add_child(this.button._iconBox)
    this._manager = new PopupMenu.PopupMenuManager(this.button)
    const header = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    })
    this._label = new St.Label({ text: _('Hidden application icons') })
    header.add_child(this._label)
    this.button.menu.addMenuItem(header)
    const row = new PopupMenu.PopupBaseMenuItem({
      reactive: false,
      can_focus: false,
    })
    const scroll = new St.ScrollView({
      overlay_scrollbars: true,
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      style: 'max-height: 320px;',
      x_expand: true,
    })
    this._layout = new Clutter.GridLayout({ column_spacing: 4, row_spacing: 4 })
    this._grid = new St.Widget({
      layout_manager: this._layout,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.START,
    })
    const scrollContent = createBoxLayout({ vertical: true, x_expand: true })
    scrollContent.add_child(this._grid)
    scroll.set_child(scrollContent)
    row.add_child(scroll)
    this.button.menu.addMenuItem(row)
    this.button.menu.connect('open-state-changed', (menu, open) => {
      if (!open) this._manager.activeMenu?.close()
      else this._label.text = _('Hidden application icons')
    })
  }

  updateItems(models) {
    if (this._disposed) return
    const keys = models.map((model) => model.item.key)
    const same =
      keys.length === this._keys.length &&
      keys.every(
        (key, index) =>
          key === this._keys[index] &&
          this.tiles.get(key)?.model === models[index],
      )
    if (!same) {
      this._clearTiles()
      this._keys = keys
      models.forEach((model, index) => this._addTile(model, index))
    }
    for (const model of models) this.updateItem(model.item.key)
    this.button.accessible_name = `${_('Show hidden tray icons')} (${models.length})`
    if (!models.length) this.button.menu.close()
    this.button.container.visible = models.length > 0
  }

  _addTile(model, index) {
    const tile = new St.Button({
      style_class: 'popup-menu-item',
      can_focus: true,
      track_hover: true,
      style: 'padding: 10px; border-radius: 6px;',
    })
    const box = new St.Widget({ layout_manager: new Clutter.BinLayout() })
    const icon = new St.Icon({ icon_size: 16, style: 'padding: 0; margin: 0;' })
    const overlay = new St.Icon({
      icon_size: 8,
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.END,
      style: 'padding: 0; margin: 0;',
    })
    box.add_child(icon)
    box.add_child(overlay)
    tile.set_child(box)
    const menu = new PopupMenu.PopupMenu(tile, 0.5, this._side)
    menu.actor.hide()
    Main.uiGroup.add_child(menu.actor)
    menu.connect('destroy', () => {
      menu._dtpDestroyed = true
    })
    menu.connect('open-state-changed', (popup, open) => {
      if (open) model._refreshMenu(popup)
    })
    this._manager.addMenu(menu)
    model._presentationMenu = menu
    const entry = { button: tile, box, icon, overlay, menu, model }
    this.tiles.set(model.item.key, entry)
    tile.connect('clicked', () => this.openItem(model.item.key))
    tile.connect('button-press-event', (actor, event) => {
      if (event.get_button() === 2) {
        model._invoke('SecondaryActivate', event)
        return Clutter.EVENT_STOP
      }
      if (event.get_button() === 3) {
        this.openItem(model.item.key)
        return Clutter.EVENT_STOP
      }
      return Clutter.EVENT_PROPAGATE
    })
    tile.connect('scroll-event', (actor, event) => model.vfunc_event(event))
    const label = () => {
      this._label.text = model.item.properties.Title || model.item.properties.Id
    }
    tile.connect('notify::hover', () => {
      if (tile.hover) label()
    })
    tile.connect('key-focus-in', label)
    this._layout.attach(tile, index % 4, Math.floor(index / 4), 1, 1)
  }

  updateItem(key) {
    if (this._disposed) return
    const entry = this.tiles.get(key)
    if (!entry || entry.model._disposed) return
    entry.button.accessible_name =
      entry.model.item.properties.Title || entry.model.item.properties.Id
    entry.icon.gicon = entry.model._icon.gicon
    entry.overlay.visible = entry.model._overlay.visible
    if (entry.overlay.visible) entry.overlay.gicon = entry.model._overlay.gicon
    applyIconEffects(entry.box, entry.model._configuration)
  }

  async openItem(key) {
    const entry = this.tiles.get(key)
    if (!entry || entry.model._disposed) return
    if (!entry.model._menuPath || entry.model._menuPath === '/') {
      entry.model._invoke('Activate')
      this.button.menu.close()
      return
    }
    await entry.model._refreshMenu(entry.menu)
    if (
      !this._disposed &&
      this.tiles.get(key) === entry &&
      !entry.menu._dtpDestroyed
    )
      entry.menu.open()
  }

  _clearTiles() {
    for (const entry of this.tiles.values()) {
      if (entry.model._presentationMenu === entry.menu) {
        entry.model._presentationMenu = null
        ++entry.model._menuRequest
      }
      entry.menu._dtpDestroyed = true
      entry.menu.destroy()
      entry.button.destroy()
    }
    this.tiles.clear()
    this._keys = []
  }

  destroy() {
    if (this._disposed) return
    this._disposed = true
    this._clearTiles()
    this.button.destroy()
  }
}
