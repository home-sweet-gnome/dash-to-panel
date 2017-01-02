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
 *
 * Credits:
 * This file is based on code from the Dash to Dock extension by micheleg
 * and code from the Taskbar extension by Zorin OS
 * Some code was also adapted from the upstream Gnome Shell source code.
 */


const AppDisplay = imports.ui.appDisplay;
const Lang = imports.lang;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Taskbar = Me.imports.taskbar;

/**
 * Extend AppIconMenu
 *
 * - set popup arrow side based on taskbar orientation
 * - Add close windows option based on quitfromdash extension
 *   (https://github.com/deuill/shell-extension-quitfromdash)
 */

const taskbarSecondaryMenu = new Lang.Class({
    Name: 'taskbarSecondaryMenu',
    Extends: AppDisplay.AppIconMenu,

    _init: function(source) {

        let side = Taskbar.getPosition();

        // Damm it, there has to be a proper way of doing this...
        // As I can't call the parent parent constructor (?) passing the side
        // parameter, I overwite what I need later
        this.parent(source);

        // Change the initialized side where required.
        this._arrowSide = side;
        this._boxPointer._arrowSide = side;
        this._boxPointer._userArrowSide = side;
    },

    // helper function for the quit windows abilities
    _closeWindowInstance: function(metaWindow) {
        metaWindow.delete(global.get_current_time());
    },

    _redisplay: function() {
        this.parent();

        // quit menu
        let app = this._source.app;
        let count = Taskbar.getAppInterestingWindows(app).length;
        if ( count > 0) {
            this._appendSeparator();
            let quitFromTaskbarMenuText = "";
            if (count == 1)
                quitFromTaskbarMenuText = _("Quit");
            else
                quitFromTaskbarMenuText = _("Quit") + ' ' + count + ' ' + _("Windows");

            this._quitfromTaskbarMenuItem = this._appendMenuItem(quitFromTaskbarMenuText);
            this._quitfromTaskbarMenuItem.connect('activate', Lang.bind(this, function() {
                let app = this._source.app;
                let windows = app.get_windows();
                for (let i = 0; i < windows.length; i++) {
                    this._closeWindowInstance(windows[i])
                }
            }));
        }
    }
});
