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
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const WindowManager = imports.ui.windowManager;
const ExtensionUtils = imports.misc.extensionUtils;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const PanelManager = Me.imports.panelManager;
const Utils = Me.imports.utils;

const UBUNTU_DOCK_UUID = 'ubuntu-dock@ubuntu.com';

let panelManager;
let oldDash;
let extensionChangedHandler;
let disabledUbuntuDock;
let extensionSystem = (Main.extensionManager || imports.ui.extensionSystem);

function init() {
    Convenience.initTranslations(Utils.TRANSLATION_DOMAIN);
    
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

        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(ubuntuDock.stylesheet);
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

    Me.settings = Convenience.getSettings('org.gnome.shell.extensions.dash-to-panel');
    Me.desktopSettings = Convenience.getSettings('org.gnome.desktop.interface');

    Me.imports.update.init();
    panelManager = new PanelManager.dtpPanelManager();

    panelManager.enable();
    
    Utils.removeKeybinding('open-application-menu');
    Utils.addKeybinding(
        'open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        Lang.bind(this, function() {
            if(Me.settings.get_boolean('show-appmenu'))
                Main.wm._toggleAppMenu();
            else
                panelManager.primaryPanel.taskbar.popupFocusedAppSecondaryMenu();
        }),
        Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
    );

    // Pretend I'm the dash: meant to make appgrd swarm animation come from the
    // right position of the appShowButton.
    oldDash = Main.overview._dash;
    Main.overview._dash = panelManager.primaryPanel.taskbar;
}

function disable(reset) {
    panelManager.disable();
    Main.overview._dash = oldDash;
    Me.settings.run_dispose();
    Me.desktopSettings.run_dispose();

    delete Me.settings;
    oldDash = null;
    panelManager = null;
    
    Utils.removeKeybinding('open-application-menu');
    Utils.addKeybinding(
        'open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        Lang.bind(Main.wm, Main.wm._toggleAppMenu),
        Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
    );

    if (!reset) {
        extensionSystem.disconnect(extensionChangedHandler);
        delete global.dashToPanel;

        // Re-enable Ubuntu Dock if it was disabled by dash to panel
        if (disabledUbuntuDock && Main.sessionMode.allowExtensions) {
            (extensionSystem._callExtensionEnable || extensionSystem.enableExtension).call(extensionSystem, UBUNTU_DOCK_UUID);
        }
    }
}