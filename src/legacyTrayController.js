/* SPDX-License-Identifier: GPL-2.0-or-later */

export class LegacyTrayController {
  constructor({
    createManager,
    createButton,
    addButton,
    updateButton,
    onError,
  }) {
    this._createManager = createManager
    this._createButton = createButton
    this._addButton = addButton
    this._updateButton = updateButton
    this._onError = onError
    this._buttons = new Map()
    this._serial = 0
    this._enabled = false
  }

  setPanel(panel) {
    if (this._disposed || panel === this._panel) return
    this._stop()
    this._panel = panel
    this.setEnabled(this._enabled)
  }

  setEnabled(enabled) {
    if (this._disposed) return
    this._enabled = Boolean(enabled)
    if (!this._enabled || !this._panel) {
      this._stop()
      return
    }
    if (this._manager) return
    try {
      const manager = this._createManager()
      if (!manager) return
      this._manager = manager
      this._signals = [
        manager.connect('tray-icon-added', (source, icon) => {
          if (this._manager === manager) this._addIcon(icon)
        }),
        manager.connect('tray-icon-removed', (source, icon) => {
          if (this._manager === manager) this._removeIcon(icon)
        }),
      ]
      manager.manage_screen(this._panel.panel)
    } catch (error) {
      this._stop()
      this._onError(error)
    }
  }

  _addIcon(icon) {
    if (this._disposed || !this._manager || this._buttons.has(icon)) return
    let button
    try {
      button = this._createButton(icon)
      this._buttons.set(icon, button)
      this._updateButton(button, this._panel)
      this._addButton(this._panel, button, ++this._serial)
    } catch (error) {
      this._buttons.delete(icon)
      button?.destroy()
      this._onError(error)
    }
  }

  _removeIcon(icon) {
    const button = this._buttons.get(icon)
    this._buttons.delete(icon)
    button?.destroy()
  }

  refresh() {
    if (this._disposed || !this._panel) return
    for (const button of this._buttons.values())
      this._updateButton(button, this._panel)
  }

  _stop() {
    const manager = this._manager
    this._manager = null
    if (manager) for (const id of this._signals || []) manager.disconnect(id)
    this._signals = []
    for (const button of this._buttons.values()) button.destroy()
    this._buttons.clear()
    manager?.unmanage_screen()
  }

  destroy() {
    if (this._disposed) return
    this._disposed = true
    this._stop()
    this._panel = null
  }
}
