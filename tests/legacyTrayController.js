/* SPDX-License-Identifier: GPL-2.0-or-later */

import { LegacyTrayController } from '../src/legacyTrayController.js'

function assert(value, message) {
  if (!value) throw new Error(message)
}

function fixture({ unsupported = false, fail = false } = {}) {
  const managers = []
  const buttons = []
  const errors = []
  const controller = new LegacyTrayController({
    createManager: () => {
      if (unsupported) return null
      const manager = {
        signals: new Map(),
        serial: 0,
        stopped: 0,
        connect(name, callback) {
          const id = ++this.serial
          this.signals.set(id, { name, callback })
          return id
        },
        disconnect(id) {
          this.signals.delete(id)
        },
        emit(name, icon) {
          for (const signal of this.signals.values())
            if (signal.name === name) signal.callback(this, icon)
        },
        manage_screen(panel) {
          this.panel = panel
          if (fail) throw new Error('Cannot manage this display')
        },
        unmanage_screen() {
          this.stopped++
        },
      }
      managers.push(manager)
      return manager
    },
    createButton: (icon) => {
      const button = {
        icon,
        destroyed: 0,
        updates: 0,
        destroy() {
          this.destroyed++
        },
      }
      buttons.push(button)
      return button
    },
    updateButton: (button, panel) => {
      button.updates++
      button.panel = panel
    },
    addButton: (panel, button, serial) => {
      panel.added.push({ button, serial })
    },
    onError: (error) => errors.push(error),
  })
  const panel = { panel: {}, added: [] }
  controller.setPanel(panel)
  return { controller, panel, managers, buttons, errors }
}

{
  const { controller, managers } = fixture()
  controller.setEnabled(false)
  assert(managers.length === 0, 'Disabled beta acquired a legacy tray')
  controller.destroy()
  console.log('PASS experimental compatibility remains off without activation')
}

{
  const { controller, managers, buttons, panel } = fixture()
  controller.setEnabled(true)
  controller.setEnabled(true)
  assert(
    managers.length === 1,
    'Repeated activation created duplicate managers',
  )
  const icon = { title: 'Test game' }
  managers[0].emit('tray-icon-added', icon)
  managers[0].emit('tray-icon-added', icon)
  assert(
    buttons.length === 1 && panel.added.length === 1,
    'Legacy icon duplicated',
  )
  controller.refresh()
  assert(
    buttons[0].updates === 2,
    'Live spacing/style changes did not update the icon',
  )
  managers[0].emit('tray-icon-removed', icon)
  managers[0].emit('tray-icon-removed', icon)
  assert(buttons[0].destroyed === 1, 'Icon removal was not idempotent')
  controller.destroy()
  console.log(
    'PASS legacy icon discovery, deduplication, appearance and removal',
  )
}

{
  const { controller, managers, buttons } = fixture()
  controller.setEnabled(true)
  managers[0].emit('tray-icon-added', {})
  controller.setEnabled(false)
  assert(
    managers[0].stopped === 1 && managers[0].signals.size === 0,
    'Disable retained native ownership or signals',
  )
  assert(buttons[0].destroyed === 1, 'Disable retained an icon actor')
  controller.setEnabled(true)
  assert(managers.length === 2, 'Compatibility could not be re-enabled')
  controller.destroy()
  controller.destroy()
  controller.setEnabled(true)
  assert(
    managers[1].stopped === 1 && managers.length === 2,
    'Shutdown restarted the manager or unregistered twice',
  )
  console.log(
    'PASS disabling, re-enabling and shutdown release legacy ownership',
  )
}

{
  const { controller, managers, buttons } = fixture()
  controller.setEnabled(true)
  managers[0].emit('tray-icon-added', {})
  controller.setPanel(null)
  assert(
    buttons[0].destroyed === 1 && managers[0].stopped === 1,
    'Panel removal retained old actors',
  )
  controller.setPanel({ panel: {}, added: [] })
  assert(
    managers.length === 2,
    'Panel recreation did not restart the enabled tray',
  )
  controller.destroy()
  console.log(
    'PASS panel recreation preserves the opt-in state without stale icons',
  )
}

{
  const { controller, managers, errors } = fixture({ unsupported: true })
  controller.setEnabled(true)
  controller.destroy()
  assert(
    managers.length === 0 && errors.length === 0,
    'Unsupported Shell APIs failed instead of leaving the beta inactive',
  )
  console.log(
    'PASS unsupported Shell versions leave the compatibility backend inactive',
  )
}

{
  const { controller, managers, errors } = fixture({ fail: true })
  controller.setEnabled(true)
  assert(
    errors.length === 1 &&
      managers[0].stopped === 1 &&
      managers[0].signals.size === 0,
    'Failed startup leaked ownership or handlers',
  )
  controller.destroy()
  console.log(
    'PASS failed native initialization cleans up before reporting an error',
  )
}
