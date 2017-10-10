/*
 * Dash-To-Panel extension for Gnome 3
 * Copyright 2016 Jason DeRose (jderose9)
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
const Panel = Me.imports.panel;
const Overview = Me.imports.overview;

const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const WindowManager = imports.ui.windowManager;
const ExtensionUtils = imports.misc.extensionUtils;
const ExtensionSystem = imports.ui.extensionSystem;
const Mainloop = imports.mainloop;

const UBUNTU_DOCK_UUID = 'ubuntu-dock@ubuntu.com';

let panel;
let overview;
let settings;
let oldDash;
let extensionChangedHandler;

function init() {
}

function enable() {
    // Disable Ubuntu Dock
    if (ExtensionUtils.extensions[UBUNTU_DOCK_UUID] && ExtensionUtils.extensions[UBUNTU_DOCK_UUID].state == ExtensionSystem.ExtensionState.ENABLED) {
        Mainloop.timeout_add(0, () => {
            ExtensionSystem.disableExtension(UBUNTU_DOCK_UUID);
            return GLib.SOURCE_REMOVE;
        });
    }
    // The Ubuntu Dock extension might get enabled after this extension
    extensionChangedHandler = ExtensionSystem.connect('extension-state-changed', (evt, extension) => {
        if (extension.uuid == UBUNTU_DOCK_UUID) {
            Mainloop.timeout_add(0, () => {
                if(extension.state == ExtensionSystem.ExtensionState.ENABLED) 
                    ExtensionSystem.disableExtension(UBUNTU_DOCK_UUID);
                else if(extension.state == ExtensionSystem.ExtensionState.DISABLED) 
                    Main.overview._controls.dash.actor.hide(); // ubuntu dock shows this when disabled, hide it again
                
                return GLib.SOURCE_REMOVE;
            });
        }
    });
    
    settings = Convenience.getSettings('org.gnome.shell.extensions.dash-to-panel');  
    panel = new Panel.dtpPanel(settings);
    panel.enable();
    overview = new Overview.dtpOverview(settings);
    overview.enable(panel.taskbar);
    
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
                panel.taskbar.popupFocusedAppSecondaryMenu();
        })
    );

    // Pretend I'm the dash: meant to make appgrd swarm animation come from the
    // right position of the appShowButton.
    oldDash  = Main.overview._dash;
    Main.overview._dash = panel.taskbar;
}

function disable() {
    overview.disable();
    panel.disable();
    settings.run_dispose();
    Main.overview._dash = oldDash;

    oldDash=null;
    settings = null;
    overview = null;
    panel = null;
    
    Main.wm.removeKeybinding('open-application-menu');
    Main.wm.addKeybinding('open-application-menu',
                           new Gio.Settings({ schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA }),
                           Meta.KeyBindingFlags.NONE,
                           Shell.ActionMode.NORMAL |
                           Shell.ActionMode.POPUP,
                           Lang.bind(Main.wm, Main.wm._toggleAppMenu));


    // Re-enable Ubuntu Dock if it exists
    ExtensionSystem.disconnect(extensionChangedHandler);
    if (ExtensionUtils.extensions[UBUNTU_DOCK_UUID] && Main.sessionMode.allowExtensions) {
        Mainloop.timeout_add(0, () => {
            ExtensionSystem.enableExtension(UBUNTU_DOCK_UUID);
        });
    }
}
