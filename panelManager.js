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
const Panel = Me.imports.panel;
const Main = imports.ui.main;
const Lang = imports.lang;
const St = imports.gi.St;

var dtpPanelManager = new Lang.Class({
    Name: 'DashToDock.DockManager',

    _init: function(settings) {
        this._dtpSettings = settings;
    },

    enable: function() {
        this.primaryPanel = new Panel.dtpPanelWrapper(this._dtpSettings, Main.layoutManager.primaryMonitor, Main.panel, Main.layoutManager.panelBox);
        this.primaryPanel.enable();
        this.allPanels = [ this.primaryPanel ];

        Main.layoutManager.monitors.forEach(monitor => {
            if(monitor == Main.layoutManager.primaryMonitor)
                return;

            let panelBox = new St.BoxLayout({ name: 'dashtopanelSecondaryPanelBox', vertical: true });
            Main.layoutManager.addChrome(panelBox, { affectsStruts: true, trackFullscreen: true });
            Main.uiGroup.set_child_below_sibling(panelBox, Main.layoutManager.panelBox);

            let panel = new Panel.dtpSecondaryPanel();
            panelBox.add(panel.actor);

            panelBox.set_position(monitor.x, monitor.y);
            panelBox.set_size(monitor.width, -1);
            
            let panelWrapper = new Panel.dtpPanelWrapper(this._dtpSettings, monitor, panel, panelBox);
            panelWrapper.enable(panelWrapper);

            this.allPanels.push(panelWrapper);
        })
    },

    disable: function() {
        this.allPanels.forEach(p => {
            p.disable();
        })
    }
    
});
