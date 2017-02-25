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
const RemoteMenu = imports.ui.remoteMenu;
const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;
const AppFavorites = imports.ui.appFavorites;

/**
 * Extend AppIconMenu
 *
 * - set popup arrow side based on taskbar orientation
 * - Add close windows option based on quitfromdash extension
 *   (https://github.com/deuill/shell-extension-quitfromdash)
 */

const taskbarSecondaryMenu = new Lang.Class({
    Name: 'DashToPanel.SecondaryMenu',
    Extends: AppDisplay.AppIconMenu,

    _init: function(source, settings) {

        this._dtpSettings = settings;

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
        this.removeAll();

        let windows = this._source.app.get_windows().filter(function(w) {
            return !w.skip_taskbar;
        });

        // Display the app windows menu items and the separator between windows
        // of the current desktop and other windows.
        let activeWorkspace = global.screen.get_active_workspace();
        let separatorShown = windows.length > 0 && windows[0].get_workspace() != activeWorkspace;

        for (let i = 0; i < windows.length; i++) {
            let window = windows[i];
            if (!separatorShown && window.get_workspace() != activeWorkspace) {
                this._appendSeparator();
                separatorShown = true;
            }
            let item = this._appendMenuItem(window.title);
            item.connect('activate', Lang.bind(this, function() {
                this.emit('activate-window', window);
            }));
        }

        if (!this._source.app.is_window_backed()) {
            this._appendSeparator();

            let appInfo = this._source.app.get_app_info();
            let actions = appInfo.list_actions();
            if (this._source.app.can_open_new_window() &&
                actions.indexOf('new-window') == -1) {
                this._newWindowMenuItem = this._appendMenuItem(_("New Window"));
                this._newWindowMenuItem.connect('activate', Lang.bind(this, function() {
                    if (this._source.app.state == Shell.AppState.STOPPED)
                        this._source.animateLaunch();

                    this._source.app.open_new_window(-1);
                    this.emit('activate-window', null);
                }));
                this._appendSeparator();
            }

            if (PopupMenu.discreteGpuAvailable &&
                this._source.app.state == Shell.AppState.STOPPED &&
                actions.indexOf('activate-discrete-gpu') == -1) {
                this._onDiscreteGpuMenuItem = this._appendMenuItem(_("Launch using Dedicated Graphics Card"));
                this._onDiscreteGpuMenuItem.connect('activate', Lang.bind(this, function() {
                    if (this._source.app.state == Shell.AppState.STOPPED)
                        this._source.animateLaunch();

                    this._source.app.launch(0, -1, true);
                    this.emit('activate-window', null);
                }));
            }

            for (let i = 0; i < actions.length; i++) {
                let action = actions[i];
                let item = this._appendMenuItem(appInfo.get_action_name(action));
                item.connect('activate', Lang.bind(this, function(emitter, event) {
                    this._source.app.launch_action(action, event.get_time(), -1);
                    this.emit('activate-window', null);
                }));
            }

            let appMenu = this._source.app.menu;
            if(appMenu) {
                this._appendSeparator();
                let remoteMenu = new RemoteMenu.RemoteMenu(this._source.actor, this._source.app.menu, this._source.app.action_group);
                let appMenuItems = remoteMenu._getMenuItems();
                for(let appMenuIdx in appMenuItems){
                    let menuItem = appMenuItems[appMenuIdx];
                    let labelText = menuItem.actor.label_actor.text;
                    if(labelText == _("New Window") || labelText == _("Help") || labelText == _("About") || labelText == _("Quit"))
                        continue;
                    
                    if(menuItem instanceof PopupMenu.PopupSeparatorMenuItem)
                        continue;

                    // this ends up getting called multiple times, and bombing due to the signal id's being invalid
                    // on a 2nd pass. disconnect the base handler and attach our own that wraps the id's in if statements
                    menuItem.disconnect(menuItem._popupMenuDestroyId)
                    menuItem._popupMenuDestroyId = menuItem.connect('destroy', Lang.bind(this, function(menuItem) {
                        if(menuItem._popupMenuDestroyId) {
                            menuItem.disconnect(menuItem._popupMenuDestroyId);
                            menuItem._popupMenuDestroyId = 0;
                        }
                        if(menuItem._activateId) {
                            menuItem.disconnect(menuItem._activateId);
                            menuItem._activateId = 0;
                        }
                        if(menuItem._activeChangeId) {
                            menuItem.disconnect(menuItem._activeChangeId);
                            menuItem._activeChangeId = 0;
                        }
                        if(menuItem._sensitiveChangeId) {
                            menuItem.disconnect(menuItem._sensitiveChangeId);
                            menuItem._sensitiveChangeId = 0;
                        }
                        this.disconnect(menuItem._parentSensitiveChangeId);
                        if (menuItem == this._activeMenuItem)
                            this._activeMenuItem = null;
                    }));

                    menuItem.actor.get_parent().remove_child(menuItem.actor);
                    if(menuItem instanceof PopupMenu.PopupSubMenuMenuItem) {
                        let newSubMenuMenuItem = new PopupMenu.PopupSubMenuMenuItem(labelText);
                        let appSubMenuItems = menuItem.menu._getMenuItems();
                        for(let appSubMenuIdx in appSubMenuItems){
                            let subMenuItem = appSubMenuItems[appSubMenuIdx];
                            subMenuItem.actor.get_parent().remove_child(subMenuItem.actor);
                            newSubMenuMenuItem.menu.addMenuItem(subMenuItem);
                        }
                        this.addMenuItem(newSubMenuMenuItem);
                    } else 
                        this.addMenuItem(menuItem);

                }
            }

            let canFavorite = global.settings.is_writable('favorite-apps');

            if (canFavorite) {
                this._appendSeparator();

                let isFavorite = AppFavorites.getAppFavorites().isFavorite(this._source.app.get_id());

                if (isFavorite) {
                    let item = this._appendMenuItem(_("Remove from Favorites"));
                    item.connect('activate', Lang.bind(this, function() {
                        let favs = AppFavorites.getAppFavorites();
                        favs.removeFavorite(this._source.app.get_id());
                    }));
                } else {
                    let item = this._appendMenuItem(_("Add to Favorites"));
                    item.connect('activate', Lang.bind(this, function() {
                        let favs = AppFavorites.getAppFavorites();
                        favs.addFavorite(this._source.app.get_id());
                    }));
                }
            }

            // if (Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop')) {
            //     this._appendSeparator();
            //     let item = this._appendMenuItem(_("Show Details"));
            //     item.connect('activate', Lang.bind(this, function() {
            //         let id = this._source.app.get_id();
            //         let args = GLib.Variant.new('(ss)', [id, '']);
            //         Gio.DBus.get(Gio.BusType.SESSION, null,
            //             function(o, res) {
            //                 let bus = Gio.DBus.get_finish(res);
            //                 bus.call('org.gnome.Software',
            //                          '/org/gnome/Software',
            //                          'org.gtk.Actions', 'Activate',
            //                          GLib.Variant.new('(sava{sv})',
            //                                           ['details', [args], null]),
            //                          null, 0, -1, null, null);
            //                 Main.overview.hide();
            //             });
            //     }));
            // }
        }

        // quit menu
        let app = this._source.app;
        let count = Taskbar.getInterestingWindows(app, this._dtpSettings).length;
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
