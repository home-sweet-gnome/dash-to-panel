/*
 * Taskbar: A taskbar extension for the Gnome panel.
 * Copyright (C) 2016 Zorin OS
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
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
 * This file is based on code from the Dash to Dock extension by micheleg.
 * Some code was also adapted from the upstream Gnome Shell source code.
 */


const Me = imports.misc.extensionUtils.getCurrentExtension();
const Clutter = imports.gi.Clutter;
const Convenience = Me.imports.convenience;
const Taskbar = Me.imports.taskbar;
const Lang = imports.lang;
const Main = imports.ui.main;

let appMenu;
let container;
let panel;
let panelConnectId;
let signalsHandler;
let taskbar;

function init() {
}

function enable() {
    panel = Main.panel;
    container = panel._leftBox;
    appMenu = panel.statusArea['appMenu'];

    panelConnectId = panel.actor.connect('allocate', allocate);
    container.remove_child(appMenu.container);
    taskbar = new Taskbar.taskbar();
    Main.overview.dashIconSize = taskbar.iconSize;

    container.insert_child_at_index( taskbar.actor, 2 );

    // Since Gnome 3.8 dragging an app without having opened the overview before cause the attemp to
    //animate a null target since some variables are not initialized when the viewSelector is created
    if(Main.overview.viewSelector._activePage == null)
        Main.overview.viewSelector._activePage = Main.overview.viewSelector._workspacesPage;

    // sync hover after a popupmenu is closed
    taskbar.connect('menu-closed', Lang.bind(this, function(){container.sync_hover();}));

    signalsHandler = new Convenience.GlobalSignalsHandler();
    signalsHandler.add(
        // Keep dragged icon consistent in size with this dash
        [
            taskbar,
            'icon-size-changed',
            Lang.bind(this, function() {
                Main.overview.dashIconSize = taskbar.iconSize;
            })
        ],
        // This duplicate the similar signal which is in owerview.js.
        // Being connected and thus executed later this effectively
        // overwrite any attempt to use the size of the default dash
        // which given the customization is usually much smaller.
        // I can't easily disconnect the original signal
        [
            Main.overview._controls.dash,
            'icon-size-changed',
            Lang.bind(this, function() {
                Main.overview.dashIconSize = taskbar.iconSize;
            })
        ]
    );
   }

function disable() {
    signalsHandler.destroy();
    container.remove_child(taskbar.actor);
    container.add_child(appMenu.container);
    taskbar.destroy();
    panel.actor.disconnect(panelConnectId);

    // reset stored icon size  to the default dash
    Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;

    appMenu = null;
    container = null;
    panel = null;
    panelConnectId = null;
    signalsHandler = null;
    taskbar = null;
}

function allocate(actor, box, flags) {
    let allocWidth = box.x2 - box.x1;
    let allocHeight = box.y2 - box.y1;

    let [leftMinWidth, leftNaturalWidth] = panel._leftBox.get_preferred_width(-1);
    let [centerMinWidth, centerNaturalWidth] = panel._centerBox.get_preferred_width(-1);
    let [rightMinWidth, rightNaturalWidth] = panel._rightBox.get_preferred_width(-1);

    let sideWidth = allocWidth - rightNaturalWidth - centerNaturalWidth;

    let childBox = new Clutter.ActorBox();

    childBox.y1 = 0;
    childBox.y2 = allocHeight;
    if (panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
	      childBox.x1 = allocWidth - Math.min(Math.floor(sideWidth), leftNaturalWidth);
	      childBox.x2 = allocWidth;
    } else {
	      childBox.x1 = 0;
	      childBox.x2 = sideWidth;
    }
    panel._leftBox.allocate(childBox, flags);

    childBox.y1 = 0;
    childBox.y2 = allocHeight;
    if (panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
	      childBox.x1 = rightNaturalWidth;
	      childBox.x2 = childBox.x1 + centerNaturalWidth;
    } else {
	      childBox.x1 = allocWidth - centerNaturalWidth - rightNaturalWidth;
	      childBox.x2 = childBox.x1 + centerNaturalWidth;
    }
    panel._centerBox.allocate(childBox, flags);

    childBox.y1 = 0;
    childBox.y2 = allocHeight;
    if (panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
	      childBox.x1 = 0;
	      childBox.x2 = rightNaturalWidth;
    } else {
	      childBox.x1 = allocWidth - rightNaturalWidth;
	      childBox.x2 = allocWidth;
    }
    panel._rightBox.allocate(childBox, flags);

    let [cornerMinWidth, cornerWidth] = panel._leftCorner.actor.get_preferred_width(-1);
    let [cornerMinHeight, cornerHeight] = panel._leftCorner.actor.get_preferred_width(-1);
    childBox.x1 = 0;
    childBox.x2 = cornerWidth;
    childBox.y1 = allocHeight;
    childBox.y2 = allocHeight + cornerHeight;
    panel._leftCorner.actor.allocate(childBox, flags);

    let [cornerMinWidth, cornerWidth] = panel._rightCorner.actor.get_preferred_width(-1);
    let [cornerMinHeight, cornerHeight] = panel._rightCorner.actor.get_preferred_width(-1);
    childBox.x1 = allocWidth - cornerWidth;
    childBox.x2 = allocWidth;
    childBox.y1 = allocHeight;
    childBox.y2 = allocHeight + cornerHeight;
    panel._rightCorner.actor.allocate(childBox, flags);
}
