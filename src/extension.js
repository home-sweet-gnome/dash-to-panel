/*
 * Dash-To-Panel extension for Gnome 3
 * Copyright 2016 Jason DeRose (jderose9) and Charles Gagnon (charlesg99)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import Gio from 'gi://Gio'

import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { EventEmitter } from 'resource:///org/gnome/shell/misc/signals.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as PanelSettings from './panelSettings.js'

import * as PanelManager from './panelManager.js'
import * as AppIcons from './appIcons.js'

const UBUNTU_DOCK_UUID = 'ubuntu-dock@ubuntu.com'

let panelManager
let startupCompleteHandler
let ubuntuDockDelayId = 0

export let DTP_EXTENSION = null
export let SETTINGS = null
export let DESKTOPSETTINGS = null
export let TERMINALSETTINGS = null
export let PERSISTENTSTORAGE = null
export let EXTENSION_PATH = null

export default class DashToPanelExtension extends Extension {
  constructor(metadata) {
    super(metadata)

    this._realHasOverview = Main.sessionMode.hasOverview

    //create an object that persists until gnome-shell is restarted, even if the extension is disabled
    PERSISTENTSTORAGE = {}
  }

  async enable() {
    DTP_EXTENSION = this
    SETTINGS = this.getSettings('org.gnome.shell.extensions.dash-to-panel')
    DESKTOPSETTINGS = new Gio.Settings({
      schema_id: 'org.gnome.desktop.interface',
    })
    TERMINALSETTINGS = new Gio.Settings({
      schema_id: 'org.gnome.desktop.default-applications.terminal',
    })
    EXTENSION_PATH = this.path

    //create a global object that can emit signals and conveniently expose functionalities to other extensions
    global.dashToPanel = new EventEmitter()

    // reset to be safe
    SETTINGS.set_boolean('prefs-opened', false)

    await PanelSettings.init(SETTINGS)

    // To remove later, try to map settings using monitor indexes to monitor ids
    PanelSettings.adjustMonitorSettings(SETTINGS)

    let completeEnable = () => {
      panelManager = new PanelManager.PanelManager()
      panelManager.enable()
      ubuntuDockDelayId = 0
    }
    let donateIconUnixtime = SETTINGS.get_string('hide-donate-icon-unixtime')

    // show the donate icon every 120 days (10368000000 milliseconds)
    if (donateIconUnixtime && donateIconUnixtime < Date.now() - 10368000000)
      SETTINGS.set_string('hide-donate-icon-unixtime', '')

    Main.layoutManager.startInOverview = !SETTINGS.get_boolean(
      'hide-overview-on-startup',
    )

    if (
      SETTINGS.get_boolean('hide-overview-on-startup') &&
      Main.layoutManager._startingUp
    ) {
      Main.sessionMode.hasOverview = false
      startupCompleteHandler = Main.layoutManager.connect(
        'startup-complete',
        () => (Main.sessionMode.hasOverview = this._realHasOverview),
      )
    }

    // disable ubuntu dock if present
    if (Main.extensionManager._extensionOrder.indexOf(UBUNTU_DOCK_UUID) >= 0) {
      let disabled = global.settings.get_strv('disabled-extensions')

      if (disabled.indexOf(UBUNTU_DOCK_UUID) < 0) {
        disabled.push(UBUNTU_DOCK_UUID)
        global.settings.set_strv('disabled-extensions', disabled)

        // wait a bit so ubuntu dock can disable itself and restore the showappsbutton
        ubuntuDockDelayId = setTimeout(completeEnable, 200)
      }
    } else completeEnable()
  }

  disable() {
    if (ubuntuDockDelayId) clearTimeout(ubuntuDockDelayId)

    PanelSettings.disable(SETTINGS)
    panelManager.disable()

    DTP_EXTENSION = null
    SETTINGS = null
    DESKTOPSETTINGS = null
    TERMINALSETTINGS = null
    panelManager = null

    delete global.dashToPanel

    AppIcons.resetRecentlyClickedApp()

    if (startupCompleteHandler) {
      Main.layoutManager.disconnect(startupCompleteHandler)
      startupCompleteHandler = null
    }

    Main.sessionMode.hasOverview = this._realHasOverview
  }

  openPreferences() {
    if (SETTINGS.get_boolean('prefs-opened')) {
      let prefsWindow = global
        .get_window_actors()
        .map((wa) => wa.meta_window)
        .find(
          (w) =>
            w.title == 'Dash to Panel' &&
            w.wm_class == 'org.gnome.Shell.Extensions',
        )

      if (prefsWindow) Main.activateWindow(prefsWindow)

      return
    }

    super.openPreferences()
  }
}
