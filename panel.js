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
 * and code from the Taskbar extension by Zorin OS
 * 
 * Code to re-anchor the panel was taken from Thoma5 BottomPanel:
 * https://github.com/Thoma5/gnome-shell-extension-bottompanel
 * 
 * Pattern for moving clock based on Frippery Move Clock by R M Yorston
 * http://frippery.org/extensions/
 * 
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Clutter = imports.gi.Clutter;
const Convenience = Me.imports.convenience;
const TaskBar = Me.imports.taskbar;
const Lang = imports.lang;
const Main = imports.ui.main;
const St = imports.gi.St;

const taskbarPanel = new Lang.Class({
    Name: 'TaskBar.Panel',

    _init: function(settings) {
        this._dtpSettings = settings;
    },

    enable : function() {
        this.panel = Main.panel;
        this.container = this.panel._leftBox;
        this.appMenu = this.panel.statusArea['appMenu'];
        this.panelBox = Main.layoutManager.panelBox;

        this._panelConnectId = this.panel.actor.connect('allocate', Lang.bind(this, function(actor,box,flags){this._allocate(actor,box,flags);}));
        this.container.remove_child(this.appMenu.container);
        this.taskbar = new TaskBar.taskbar(this._dtpSettings);
        Main.overview.dashIconSize = this.taskbar.iconSize;

        this.container.insert_child_at_index( this.taskbar.actor, 2 );
        
        this._oldPanelHeight = this.panel.actor.get_height();

        // The overview uses the this.panel height as a margin by way of a "ghost" transparent Clone
        // This pushes everything down, which isn't desired when the this.panel is moved to the bottom
        // I'm adding a 2nd ghost this.panel and will resize the top or bottom ghost depending on the this.panel position
        this._myPanelGhost = new St.Bin({ 
            child: new Clutter.Clone({ source: Main.overview._panelGhost.get_child(0) }), 
            reactive: false,
            opacity: 0 
        });
        Main.overview._overview.add_actor(this._myPanelGhost);
        
        // this.panel styling
        this._MonitorsChangedListener = global.screen.connect("monitors-changed", Lang.bind(this, function(){this._setPanelStyle();}));
        this._HeightNotifyListener = this.panelBox.connect("notify::height", Lang.bind(this, function(){this._setPanelStyle();}));
        this._setPanelStyle();

        this._oldLeftBoxStyle = this.panel._leftBox.get_style();
        this._oldCenterBoxStyle = this.panel._centerBox.get_style();
        this._oldRightBoxStyle = this.panel._rightBox.get_style();
        this._setTraySize(this._dtpSettings.get_int('tray-size'));
        this._setLeftBoxSize(this._dtpSettings.get_int('tray-size'));
        this._setClockLocation(this._dtpSettings.get_string('location-clock'));
        
        this.panel.actor.add_style_class_name("popup-menu");

        // Since Gnome 3.8 dragging an app without having opened the overview before cause the attemp to
        //animate a null target since some variables are not initialized when the viewSelector is created
        if(Main.overview.viewSelector._activePage == null)
            Main.overview.viewSelector._activePage = Main.overview.viewSelector._workspacesPage;

        // sync hover after a popupmenu is closed
        this.taskbar.connect('menu-closed', Lang.bind(this, function(){this.container.sync_hover();}));

        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.add(
            // Keep dragged icon consistent in size with this dash
            [
                this.taskbar,
                'icon-size-changed',
                Lang.bind(this, function() {
                    Main.overview.dashIconSize = this.taskbar.iconSize;
                })
            ],
            // This duplicate the similar signal which is in overview.js.
            // Being connected and thus executed later this effectively
            // overwrite any attempt to use the size of the default dash
            // which given the customization is usually much smaller.
            // I can't easily disconnect the original signal
            [
                Main.overview._controls.dash,
                'icon-size-changed',
                Lang.bind(this, function() {
                    Main.overview.dashIconSize = this.taskbar.iconSize;
                })
            ],
            [
                this.panel._rightBox,
                'actor-added',
                Lang.bind(this, function() {
                    this._setClockLocation(this._dtpSettings.get_string('location-clock'));
                })
            ]
        );

        this._bindSettingsChanges();
    },

    disable: function () {
        this._signalsHandler.destroy();
        this.container.remove_child(this.taskbar.actor);
        this.container.add_child(this.appMenu.container);
        this.taskbar.destroy();
        this.panel.actor.disconnect(this._panelConnectId);

        // reset stored icon size  to the default dash
        Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;

        // remove this.panel styling
        if(this._HeightNotifyListener !== null) {
            this.panelBox.disconnect(this._HeightNotifyListener);
        }
        if(this._MonitorsChangedListener !== null) {
            global.screen.disconnect(this._MonitorsChangedListener);
        }
        this.panel.actor.set_height(this._oldPanelHeight);
        this.panelBox.set_anchor_point(0, 0);
        Main.overview._overview.remove_child(this._myPanelGhost);
        Main.overview._panelGhost.set_height(this._oldPanelHeight);
        this._setTraySize(0);
        this._setLeftBoxSize(0);
        this._setClockLocation("NATURAL");
        this.panel.actor.remove_style_class_name("popup-menu");

        this.appMenu = null;
        this.container = null;
        this.panel = null;
        this.taskbar = null;
        this._panelConnectId = null;
        this._signalsHandler = null;
        this._MonitorsChangedListener = null;
        this._HeightNotifyListener = null;
    },

    _bindSettingsChanges: function() {
        this._dtpSettings.connect('changed::panel-position', Lang.bind(this, function() {
            this._setPanelStyle();
        }));

        this._dtpSettings.connect('changed::panel-size', Lang.bind(this, function() {
            this._setPanelStyle();
        }));

        this._dtpSettings.connect('changed::tray-size', Lang.bind(this, function() {
            this._setTraySize(this._dtpSettings.get_int('tray-size'));
        }));

        this._dtpSettings.connect('changed::leftbox-size', Lang.bind(this, function() {
            this._setLeftBoxSize(this._dtpSettings.get_int('leftbox-size'));
        }));

        this._dtpSettings.connect('changed::location-clock', Lang.bind(this, function() {
            this._setClockLocation(this._dtpSettings.get_string('location-clock'));
        }));
    },

    _allocate: function(actor, box, flags) {
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;

        let [leftMinWidth, leftNaturalWidth] = this.panel._leftBox.get_preferred_width(-1);
        let [centerMinWidth, centerNaturalWidth] = this.panel._centerBox.get_preferred_width(-1);
        let [rightMinWidth, rightNaturalWidth] = this.panel._rightBox.get_preferred_width(-1);

        let sideWidth = allocWidth - rightNaturalWidth - centerNaturalWidth;

        let childBox = new Clutter.ActorBox();

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
            childBox.x1 = allocWidth - Math.min(Math.floor(sideWidth), leftNaturalWidth);
            childBox.x2 = allocWidth;
        } else {
            childBox.x1 = 0;
            childBox.x2 = sideWidth;
        }
        this.panel._leftBox.allocate(childBox, flags);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
            childBox.x1 = rightNaturalWidth;
            childBox.x2 = childBox.x1 + centerNaturalWidth;
        } else {
            childBox.x1 = allocWidth - centerNaturalWidth - rightNaturalWidth;
            childBox.x2 = childBox.x1 + centerNaturalWidth;
        }
        this.panel._centerBox.allocate(childBox, flags);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = rightNaturalWidth;
        } else {
            childBox.x1 = allocWidth - rightNaturalWidth;
            childBox.x2 = allocWidth;
        }
        this.panel._rightBox.allocate(childBox, flags);

        let [cornerMinWidth, cornerWidth] = this.panel._leftCorner.actor.get_preferred_width(-1);
        let [cornerMinHeight, cornerHeight] = this.panel._leftCorner.actor.get_preferred_width(-1);
        childBox.x1 = 0;
        childBox.x2 = cornerWidth;
        childBox.y1 = allocHeight;
        childBox.y2 = allocHeight + cornerHeight;
        this.panel._leftCorner.actor.allocate(childBox, flags);

        [cornerMinWidth, cornerWidth] = this.panel._rightCorner.actor.get_preferred_width(-1);
        [cornerMinHeight, cornerHeight] = this.panel._rightCorner.actor.get_preferred_width(-1);
        childBox.x1 = allocWidth - cornerWidth;
        childBox.x2 = allocWidth;
        childBox.y1 = allocHeight;
        childBox.y2 = allocHeight + cornerHeight;
        this.panel._rightCorner.actor.allocate(childBox, flags);
    },

    _setPanelStyle: function() {
        let size = this._dtpSettings.get_int('panel-size');
        let position = this._dtpSettings.get_string('panel-position');
        let isTop = position == "TOP";

        this.panel.actor.set_height(size);

        Main.overview._panelGhost.set_height(isTop ? size : 0);
        this._myPanelGhost.set_height(isTop ? 0 : size);
        isTop ? this.panelBox.set_anchor_point(0, 0) :
            this.panelBox.set_anchor_point(0,(-1)*(Main.layoutManager.primaryMonitor.height-this.panelBox.height));
    },

    _setTraySize: function(size) {
        size ? this.panel._centerBox.set_style("font-size: " + size + "px;" + (this._oldCenterBoxStyle || "")) : this.panel._centerBox.set_style(this._oldCenterBoxStyle);
        size ? this.panel._rightBox.set_style("font-size: " + size + "px;" + (this._oldRightBoxStyle || "")) : this.panel._rightBox.set_style(this._oldRightBoxStyle);    
    },

    _setLeftBoxSize: function(size) {
        size ? this.panel._leftBox.set_style("font-size: " + size + "px;" + (this._oldLeftBoxStyle || "")) : this.panel._leftBox.set_style(this._oldLeftBoxStyle);
    },

    _setClockLocation: function(loc) {
        let centerBox = this.panel._centerBox;
        let rightBox = this.panel._rightBox;
        let dateMenu = this.panel.statusArea['dateMenu'];
        let statusMenu = this.panel.statusArea['aggregateMenu'];

        if(loc == "NATURAL") {
            // only move the clock back if it's in the right box
            if ( rightBox.get_children().indexOf(dateMenu.container) != -1 ) {
                rightBox.remove_actor(dateMenu.container);
                centerBox.add_actor(dateMenu.container);
            }
        } else {
            // if clock is in left box, remove it and add to right
            if ( centerBox.get_children().indexOf(dateMenu.container) != -1 ) {
                centerBox.remove_actor(dateMenu.container);
                rightBox.insert_child_at_index(dateMenu.container, 0);
            }

            // then, move to its new location
            switch(loc) {
                case "STATUSLEFT":
                    if(statusMenu)
                        rightBox.set_child_below_sibling(dateMenu.container, statusMenu.container);
                    break;
                case "STATUSRIGHT":
                    if(statusMenu)
                        rightBox.set_child_above_sibling(dateMenu.container, statusMenu.container);
                    break;
                default:
                    break;
            }

        }
    }
});