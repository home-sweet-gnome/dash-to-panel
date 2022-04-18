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


const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const WindowManager = imports.ui.windowManager;
const ExtensionUtils = imports.misc.extensionUtils;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Me = ExtensionUtils.getCurrentExtension();
const { PanelManager } = Me.imports.panelManager;
const Utils = Me.imports.utils;
const AppIcons = Me.imports.appIcons;

const UBUNTU_DOCK_UUID = 'ubuntu-dock@ubuntu.com';

let panelManager;
let extensionChangedHandler;
let disabledUbuntuDock;
let extensionSystem = (Main.extensionManager || imports.ui.extensionSystem);

function init() {
    this._realHasOverview = Main.sessionMode.hasOverview;

    ExtensionUtils.initTranslations(Utils.TRANSLATION_DOMAIN);
    
    //create an object that persists until gnome-shell is restarted, even if the extension is disabled
    Me.persistentStorage = {};
}

function enable() {
    // The Ubuntu Dock extension might get enabled after this extension
    extensionChangedHandler = extensionSystem.connect('extension-state-changed', (data, extension) => {
        if (extension.uuid === UBUNTU_DOCK_UUID && extension.state === 1) {
            _enable();
        }
    });

    //create a global object that can emit signals and conveniently expose functionalities to other extensions 
    global.dashToPanel = {};
    Signals.addSignalMethods(global.dashToPanel);
    
    _enable();
}

function _enable() {
    let ubuntuDock = Main.extensionManager ?
                     Main.extensionManager.lookup(UBUNTU_DOCK_UUID) : //gnome-shell >= 3.33.4
                     ExtensionUtils.extensions[UBUNTU_DOCK_UUID];

    if (ubuntuDock && ubuntuDock.stateObj && ubuntuDock.stateObj.dockManager) {
        // Disable Ubuntu Dock
        let extensionOrder = (extensionSystem.extensionOrder || extensionSystem._extensionOrder);

        Utils.getStageTheme().get_theme().unload_stylesheet(ubuntuDock.stylesheet);
        ubuntuDock.stateObj.disable();
        disabledUbuntuDock = true;
        ubuntuDock.state = 2; //ExtensionState.DISABLED
        extensionOrder.splice(extensionOrder.indexOf(UBUNTU_DOCK_UUID), 1);

        //reset to prevent conflicts with the ubuntu-dock
        if (panelManager) {
            disable(true);
        }
    }

    if (panelManager) return; //already initialized

    Me.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.dash-to-panel');
    Me.desktopSettings = ExtensionUtils.getSettings('org.gnome.desktop.interface');

    Main.layoutManager.startInOverview = !Me.settings.get_boolean('hide-overview-on-startup');

    if (Me.settings.get_boolean('hide-overview-on-startup') && Main.layoutManager._startingUp) {
        Main.sessionMode.hasOverview = false;
        Main.layoutManager.connect('startup-complete', () => {
            Main.sessionMode.hasOverview = this._realHasOverview
        });
    }

    panelManager = new PanelManager();

    panelManager.enable();
    
    Utils.removeKeybinding('open-application-menu');
    Utils.addKeybinding(
        'open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        () => {
            if(Me.settings.get_boolean('show-appmenu'))
                Main.wm._toggleAppMenu();
            else
                panelManager.primaryPanel.taskbar.popupFocusedAppSecondaryMenu();
        },
        Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
    );
}

function disable(reset) {
    panelManager.disable();
    Me.settings.run_dispose();
    Me.desktopSettings.run_dispose();

    delete Me.settings;
    panelManager = null;
    
    Utils.removeKeybinding('open-application-menu');
    Utils.addKeybinding(
        'open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        Main.wm._toggleAppMenu.bind(Main.wm),
        Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
    );

    if (!reset) {
        extensionSystem.disconnect(extensionChangedHandler);
        delete global.dashToPanel;

        // Re-enable Ubuntu Dock if it was disabled by dash to panel
        if (disabledUbuntuDock && Main.sessionMode.allowExtensions) {
            (extensionSystem._callExtensionEnable || extensionSystem.enableExtension).call(extensionSystem, UBUNTU_DOCK_UUID);
        }

        AppIcons.resetRecentlyClickedApp();
    }

    Main.sessionMode.hasOverview = this._realHasOverview;
}
