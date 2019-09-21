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
 * This file is based on code from the Workspace Bar extension by mbokil
 * and the taskbar component (which is based on the Dash to Dock extension
 * by micheleg, code from the Taskbar extension by Zorin OS and
 * the upstream Gnome Shell source code).
 */

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Signals = imports.signals;
const Lang = imports.lang;
const St = imports.gi.St;

const Main = imports.ui.main;
const Workspace = imports.ui.workspace;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Panel = Me.imports.panel;


var WSActor = Utils.defineClass({
    Name: 'DashToPanel-WorkspaceSwitcherActor',
    Extends: St.Widget,

    _init: function(delegate) {
        this._delegate = delegate;
        this._currentBackgroundColor = 0;
        this.callParent('_init', { name: 'dashtopanelWorkspaceSwitcher',
                                   layout_manager: new Clutter.BoxLayout({ orientation: Clutter.Orientation[Panel.getOrientation().toUpperCase()] }),
                                   clip_to_allocation: true });
    }
});


var WorkspaceSwitcher = Utils.defineClass({
    Name: 'DashToPanel.WorkspaceSwitcher',

    _init : function(panel) {
        this.panel = panel;
        
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._box = new St.BoxLayout({ vertical: false,
                                       clip_to_allocation: false,
                                       x_align: Clutter.ActorAlign.START,
                                       y_align: Clutter.ActorAlign.START });

        this._container = new WSActor(this);
        this._container.add_actor(this._box);

        let rtl = Clutter.get_default_text_direction() == Clutter.TextDirection.RTL;
        this.actor = new St.Bin({ child: this._container,
            y_align: St.Align.MIDDLE, x_align:rtl ? St.Align.END : St.Align.START
        });

        this._workId = Main.initializeDeferredWork(this._box, Lang.bind(this, this._redisplay));

        this._signalsHandler.add(
            [
                this.panel,
		[
                    'notify::height',
                    'notify::width',
		],
                () => this._queueRedisplay()
            ],
            [
                Utils.DisplayWrapper.getWorkspaceManager(),
                [
                    'workspace-removed',
                    'workspace-added',
                    'workspace-switched'
                ],
                Lang.bind(this, this._redisplay)
            ]
        );
    },

    destroy: function() {
        this._signalsHandler.destroy();
        this._signalsHandler = 0;

        this._container.destroy();
    },

    _queueRedisplay: function () {
        Main.queueDeferredWork(this._workId);
    },

    _redisplay: function () {
        if (!this._signalsHandler) {
            return;
        }
        this._buildWorkspaceBtns();
        this._box.queue_relayout();
    },



    _buildWorkspaceBtns: function() {
        this._removeAllChildren(this._box); //clear box container
        const workspaces = Utils.getWorkspaceCount() - 1;
        const currentWorkspace = Utils.getCurrentWorkspace().index();
        let str = '';

        for (let x=0; x <= workspaces; x++) {
            let str = (x+1).toString();
            let label;		
            if (x == currentWorkspace) {
                label = new St.Label({ text: _(str), style_class: "activeBtn" });
            } else {
                label = new St.Label({ text: _(str), style_class: "inactiveBtn" });
            }
            
            const button = new St.Button();
            button.set_child(label);

            button.connect('button-press-event', Lang.bind(this, function(actor, event) {
                Utils.activateWorkspaceByIndex(actor.get_child().text - 1);
            }));

            button.connect('scroll-event', Lang.bind(this, this._onScrollEvent));
            this._box.add_actor(button);
        }
    },

    _removeAllChildren: function(box) {
        let children = box.get_children();

        if (children) {
            let len = children.length;
            for(let x=len-1; x >= 0; x--) {
                box.remove_actor(children[x]);
            }
        }
    },

    _onScrollEvent : function(actor, event) {
        let offset = Utils.getMouseScrollDirection(event) == 'up' ? -1 : 1;
        let targetWorkspace = Utils.getCurrentWorkspace().index() + offset;
        const workspaces = Utils.getWorkspaceCount() - 1;
        if (targetWorkspace < 0) targetWorkspace = 0;
        if (targetWorkspace > workspaces) targetWorkspace = workspaces;
        Utils.activateWorkspaceByIndex(targetWorkspace);
}
});

Signals.addSignalMethods(WorkspaceSwitcher.prototype);

