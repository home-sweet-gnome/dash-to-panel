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


import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as  PanelManager from './panelManager.js';
import * as Utils from './utils.js';
import * as AppIcons from './appIcons.js';


const UBUNTU_DOCK_UUID = 'ubuntu-dock@ubuntu.com';

let panelManager;
let extensionChangedHandler;
let startupCompleteHandler;
let disabledUbuntuDock;
let extensionSystem = Main.extensionManager;

export let DTP_EXTENSION = null;
export let SETTINGS = null;
export let DESKTOPSETTINGS = null;
export let TERMINALSETTINGS = null;
export let PERSISTENTSTORAGE = null;
export let EXTENSION_UUID = null;
export let EXTENSION_PATH = null;

export default class DashToPanelExtension extends Extension {
    constructor(metadata) {
        super(metadata);

        this._realHasOverview = Main.sessionMode.hasOverview;
        
        //create an object that persists until gnome-shell is restarted, even if the extension is disabled
        PERSISTENTSTORAGE = {};
    }

    enable() {
        DTP_EXTENSION = this;

        // The Ubuntu Dock extension might get enabled after this extension
        extensionChangedHandler = extensionSystem.connect('extension-state-changed', (data, extension) => {
            if (extension.uuid === UBUNTU_DOCK_UUID && extension.state === 1) {
                _enable(this);
            }
        });

        //create a global object that can emit signals and conveniently expose functionalities to other extensions 
        global.dashToPanel = new EventEmitter();
        
        _enable(this);
    }

    disable(reset = false) {
        panelManager.disable();

        DTP_EXTENSION = null;
        SETTINGS = null;
        DESKTOPSETTINGS = null;
        TERMINALSETTINGS = null;
        panelManager = null;

        if (!reset) {
            extensionSystem.disconnect(extensionChangedHandler);
            delete global.dashToPanel;

            // Re-enable Ubuntu Dock if it was disabled by dash to panel
            if (disabledUbuntuDock && Main.sessionMode.allowExtensions) {
                (extensionSystem._callExtensionEnable || extensionSystem.enableExtension).call(extensionSystem, UBUNTU_DOCK_UUID);
            }

            AppIcons.resetRecentlyClickedApp();
        }

        if (startupCompleteHandler) {
            Main.layoutManager.disconnect(startupCompleteHandler);
            startupCompleteHandler = null;
        }

        Main.sessionMode.hasOverview = this._realHasOverview;
    }
}

function _enable(extension) {
    let ubuntuDock = extensionSystem.lookup(UBUNTU_DOCK_UUID);

    if (ubuntuDock && ubuntuDock.stateObj) {
        // Disable Ubuntu Dock
        let extensionOrder = (extensionSystem.extensionOrder || extensionSystem._extensionOrder);

        Utils.getStageTheme().get_theme().unload_stylesheet(ubuntuDock.stylesheet);
        ubuntuDock.stateObj.disable();
        disabledUbuntuDock = true;
        ubuntuDock.state = 2; //ExtensionState.DISABLED
        extensionOrder.splice(extensionOrder.indexOf(UBUNTU_DOCK_UUID), 1);

        //reset to prevent conflicts with the ubuntu-dock
        if (panelManager) {
            extension.disable(true);
        }
    }

    if (panelManager) return; //already initialized

    SETTINGS = extension.getSettings('org.gnome.shell.extensions.dash-to-panel');
    DESKTOPSETTINGS = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    TERMINALSETTINGS = new Gio.Settings({schema_id: 'org.gnome.desktop.default-applications.terminal'})
    EXTENSION_UUID = extension.uuid
    EXTENSION_PATH = extension.path

    Main.layoutManager.startInOverview = !SETTINGS.get_boolean('hide-overview-on-startup');

    if (SETTINGS.get_boolean('hide-overview-on-startup') && Main.layoutManager._startingUp) {
        Main.sessionMode.hasOverview = false;
        startupCompleteHandler = Main.layoutManager.connect('startup-complete', () => {
            Main.sessionMode.hasOverview = extension._realHasOverview
        });
    }

    panelManager = new PanelManager.PanelManager();

    panelManager.enable();
}
