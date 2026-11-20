/* SPDX-License-Identifier: GPL-2.0-or-later */

import Clutter from 'gi://Clutter'
import Shell from 'gi://Shell'
import St from 'gi://St'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { LegacyTrayController } from './legacyTrayController.js'
import { applyTraySpacing } from './statusNotifierOverflow.js'
import { applyIconEffects } from './statusNotifierEffects.js'
import { appearance } from './statusNotifierUtils.js'

function createLegacyButton(icon) {
  const button = new PanelMenu.Button(
    0.5,
    icon.title || icon.wm_class || 'Wine/Proton',
    true,
  )
  button._clickGesture?.set_enabled(false)
  button._iconBox = new St.Widget({
    layout_manager: new Clutter.BinLayout(),
    x_align: Clutter.ActorAlign.CENTER,
    y_align: Clutter.ActorAlign.CENTER,
  })
  button._legacyIcon = icon
  button._icon = icon
  icon.x_align = Clutter.ActorAlign.CENTER
  icon.y_align = Clutter.ActorAlign.CENTER
  button._iconBox.add_child(icon)
  button.add_child(button._iconBox)
  button.connect('button-press-event', () => {
    button.add_style_pseudo_class('active')
    return Clutter.EVENT_STOP
  })
  button.connect('button-release-event', (actor, event) => {
    icon.click(event)
    button.remove_style_pseudo_class('active')
    return Clutter.EVENT_STOP
  })
  for (const signal of ['key-press-event', 'key-release-event'])
    button.connect(signal, (actor, event) => {
      if (
        [Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space].includes(
          event.get_key_symbol(),
        )
      ) {
        icon.click(event)
        return Clutter.EVENT_STOP
      }
      return Clutter.EVENT_PROPAGATE
    })
  return button
}

export class LegacyTray extends LegacyTrayController {
  constructor(settings) {
    super({
      createManager: () =>
        typeof Shell.TrayManager === 'function'
          ? new Shell.TrayManager()
          : null,
      createButton: createLegacyButton,
      addButton: (panel, button, serial) =>
        panel.panel.addToStatusArea(
          `dtp-legacy-tray-${serial}`,
          button,
          0,
          'right',
        ),
      updateButton: (button, panel) => {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor
        button._legacyIcon.set_size(16 * scale, 16 * scale)
        applyTraySpacing(
          button,
          settings.get_int('native-tray-icon-spacing'),
          panel.geom.vertical,
        )
        applyIconEffects(
          button._legacyIcon,
          appearance(
            {},
            settings.get_string('native-tray-icon-style') === 'symbolic',
          ),
        )
      },
      onError: (error) =>
        console.error(`Experimental Wine tray: ${error.message}`),
    })
  }
}
