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


const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const PanelManager = Me.imports.panelManager;

const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const WindowManager = imports.ui.windowManager;
const ExtensionUtils = imports.misc.extensionUtils;
const ExtensionSystem = imports.ui.extensionSystem;
const Mainloop = imports.mainloop;

const UBUNTU_DOCK_UUID = 'ubuntu-dock@ubuntu.com';

let panelManager;
let settings;
let oldDash;
let extensionChangedHandler;
let disabledUbuntuDock;

function init() {
}

function enable() {
    // The Ubuntu Dock extension might get enabled after this extension
    extensionChangedHandler = ExtensionSystem.connect('extension-state-changed', (data, extension) => {
        if (extension.uuid === UBUNTU_DOCK_UUID && extension.state === 1) {
            _enable();
        }
    });

    _enable();
}

function _enable() {
    let ubuntuDock = ExtensionUtils.extensions[UBUNTU_DOCK_UUID];

    if (ubuntuDock && ubuntuDock.stateObj && ubuntuDock.stateObj.dockManager) {
        // Disable Ubuntu Dock
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(ubuntuDock.stylesheet);
        ubuntuDock.stateObj.disable();
        disabledUbuntuDock = true;
        ubuntuDock.state = ExtensionSystem.ExtensionState.DISABLED;
        ExtensionSystem.extensionOrder.splice(ExtensionSystem.extensionOrder.indexOf(UBUNTU_DOCK_UUID), 1);

        //reset to prevent conflicts with the ubuntu-dock
        if (panelManager) {
            disable(true);
        }
    }

    if (panelManager) return; //already initialized

    settings = Convenience.getSettings('org.gnome.shell.extensions.dash-to-panel');
    panelManager = new PanelManager.dtpPanelManager(settings);
    panelManager.enable();
    
    Main.wm.removeKeybinding('open-application-menu');
    Main.wm.addKeybinding('open-application-menu',
        new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL |
        Shell.ActionMode.POPUP,
        Lang.bind(this, function() {
            if(settings.get_boolean('show-appmenu'))
                Main.wm._toggleAppMenu();
            else
                panelManager.primaryPanel.taskbar.popupFocusedAppSecondaryMenu();
        })
    );

    // Pretend I'm the dash: meant to make appgrd swarm animation come from the
    // right position of the appShowButton.
    oldDash = Main.overview._dash;
    Main.overview._dash = panelManager.primaryPanel.taskbar;
}

function disable(reset) {
    panelManager.disable();
    Main.overview._dash = oldDash;
    settings.run_dispose();

    settings = null;
    oldDash = null;
    panelManager = null;
    
    Main.wm.removeKeybinding('open-application-menu');
    Main.wm.addKeybinding('open-application-menu',
                           new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
                           Meta.KeyBindingFlags.NONE,
                           Shell.ActionMode.NORMAL |
                           Shell.ActionMode.POPUP,
                           Lang.bind(Main.wm, Main.wm._toggleAppMenu));

    if (!reset) {
        ExtensionSystem.disconnect(extensionChangedHandler);

        // Re-enable Ubuntu Dock if it exists and if it was disabled by dash to panel
        if (disabledUbuntuDock && ExtensionUtils.extensions[UBUNTU_DOCK_UUID] && Main.sessionMode.allowExtensions) {
            ExtensionSystem.enableExtension(UBUNTU_DOCK_UUID);
        }
    }
}