/*
 * This file is part of the Dash-To-Panel extension for Gnome 3
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
 * Credits:
 * This file is based on code from the Dash to Dock extension by micheleg
 * 
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Lang = imports.lang;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;

const taskbarOverview = new Lang.Class({
    Name: 'TaskBar.Overview',

    _init: function(settings) {
        this._dtpSettings = settings;
    },

    enable : function(taskbar) {
        this.taskbar = taskbar;

        this._injectionsHandler = new Convenience.InjectionsHandler();
        this._signalsHandler = new Convenience.GlobalSignalsHandler();

        // Hide usual Dash
        Main.overview._controls.dash.actor.hide();

        // Also set dash width to 1, so it's almost not taken into account by code
        // calculaing the reserved space in the overview. The reason to keep it at 1 is
        // to allow its visibility change to trigger an allocaion of the appGrid which
        // in turn is triggergin the appsIcon spring animation, required when no other
        // actors has this effect, i.e in horizontal mode and without the workspaceThumnails
        // 1 static workspace only)
        Main.overview._controls.dash.actor.set_width(1);

        this._optionalWorkspaceIsolation();
        this._bindSettingsChanges();
    },

    disable: function () {
        Main.overview._controls.dash.actor.show();
        Main.overview._controls.dash.actor.set_width(-1); //reset default dash size
        // This force the recalculation of the icon size
        Main.overview._controls.dash._maxHeight = -1;

        // reset stored icon size  to the default dash
        Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;
    },

    _bindSettingsChanges: function() {
    },

    /**
     * Isolate overview to open new windows for inactive apps
     */
    _optionalWorkspaceIsolation: function() {

        let label = 'optionalWorkspaceIsolation';

        this._dtpSettings.connect('changed::isolate-workspaces', Lang.bind(this, function() {
            this.taskbar.resetAppIcons();
            if (this._dtpSettings.get_boolean('isolate-workspaces'))
                Lang.bind(this, enable)();
            else
                Lang.bind(this, disable)();
        }));

        if (this._dtpSettings.get_boolean('isolate-workspaces'))
            Lang.bind(this, enable)();

        function enable() {
            this._injectionsHandler.removeWithLabel(label);

            this._injectionsHandler.addWithLabel(label, [
                Shell.App.prototype,
                'activate',
                IsolatedOverview
            ]);

            this._signalsHandler.removeWithLabel(label);

            this._signalsHandler.addWithLabel(label, [
                global.screen,
                'restacked',
                Lang.bind(this.taskbar, this.taskbar._queueRedisplay)
            ]);
            this._signalsHandler.addWithLabel(label, [
                global.window_manager,
                'switch-workspace',
                Lang.bind(this.taskbar, this.taskbar._queueRedisplay)
            ]);
        }

        function disable() {
            this._signalsHandler.removeWithLabel(label);
            this._injectionsHandler.removeWithLabel(label);

            this._signalsHandler.destroy();
            this._injectionsHandler.destroy();
        }

        function IsolatedOverview() {
            // These lines take care of Nautilus for icons on Desktop
            let windows = this.get_windows().filter(function(w) {
                return w.get_workspace().index() == global.screen.get_active_workspace_index();
            });
            if (windows.length == 1)
                if (windows[0].skip_taskbar)
                    return this.open_new_window(-1);

            if (this.is_on_workspace(global.screen.get_active_workspace()))
                return Main.activateWindow(windows[0]);
            return this.open_new_window(-1);
        }
    }
});