/*
 * Dash-To-Panel extension for Gnome 3
 * Copyright 2016 jderose9
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

let panel;
let overview;
let settings;

function init() {
}

function enable() {
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
}

function disable() {
    overview.disable();
    panel.disable();
    settings.run_dispose();
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
}
