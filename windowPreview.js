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
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

const Main = imports.ui.main;
const Signals = imports.signals;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Taskbar = Me.imports.taskbar;
const Utils = Me.imports.utils;

const TRANSLATION_OFFSET = 50;

//timeout intervals

//timeout names
const T1 = 'openMenuTimeout';
const T2 = 'closeMenuTimeout';

var PreviewMenu = Utils.defineClass({
    Name: 'DashToPanel.PreviewMenu',
    Extends: St.Widget,

    _init: function(appIcon) {
        this.callParent('_init', { name: 'preview-menu', reactive: true });

        this.isOpen = false;

        this._appIcon = appIcon;
        this._app = appIcon.app;
        this._dtpSettings = appIcon._dtpSettings;



        //testing
        this.set_style('background: #ff0000;')
        
        //TODO
        //'open-state-changed'
        //'menu-closed'
        //'sync-tooltip'
        //this.add_style_class_name('app-well-menu');
    },

    enable: function() {
        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._timeoutsHandler = new Utils.TimeoutsHandler();

        this.visible = false;
        this.opacity = 0;

        Main.uiGroup.insert_child_below(this, this._appIcon.panelWrapper.panelBox);

        this._signalsHandler.add(
            [
                this._appIcon.actor,
                'notify::hover',
                () => this._onAppIconHoverChanged()
            ],
        );
    },

    disable: function() {
        this._signalsHandler.destroy();
        this._timeoutsHandler.destroy();

        this.close();
        Main.uiGroup.remove_child(this);
    },

    open: function() {
        if (!this.isOpen) {
            this.isOpen = true;

            this._updatePosition();
            this.show();
            this._animateOpenOrClose(true);
        }
    },

    close: function() {
        if (this.isOpen) {
            this.isOpen = false;

            this._animateOpenOrClose(false, () => {
                this.hide();
            });
        }
    },

    updateWindows: function(windows) {

    },

    vfunc_allocate: function(box, flags) {
        this.set_allocation(box, flags);
    },

    vfunc_get_preferred_width: function(forHeight) {
        return [0, 300];
    },

    vfunc_get_preferred_height: function(forWidth) {
        return [0, 200];
    },

    _onAppIconHoverChanged: function() {
        if (this._appIcon.actor.hover) {
            this._timeoutsHandler.remove(T2);
            this._timeoutsHandler.add([T1, this._dtpSettings.get_int('show-window-previews-timeout'), () => this.open()]);
        } else {
            this._timeoutsHandler.remove(T1);
            this._timeoutsHandler.add([T2, this._dtpSettings.get_int('leave-timeout'), () => this.close()]);
        }
    },

    _updatePosition: function() {
        let sourceNode = this._appIcon.actor.get_theme_node();
        let sourceContentBox = sourceNode.get_content_box(this._appIcon.actor.get_allocation_box());
        let sourceAllocation = Shell.util_get_transformed_allocation(this._appIcon.actor);
        let [minWidth, minHeight, natWidth, natHeight] = this.get_preferred_size();
        let position = Taskbar.getPosition();
        let isLeftOrRight = position == St.Side.LEFT || position == St.Side.RIGHT;
        let x, y;

        if (position == St.Side.TOP || position == St.Side.BOTTOM) {
            x = sourceAllocation.x1 + (sourceContentBox.x2 - sourceContentBox.x1) * .5 - natWidth * .5;
        } else if (position == St.Side.LEFT) {
            x = sourceAllocation.x2;
        } else { //St.Side.RIGHT
            x = sourceAllocation.x1 - natWidth;
        }

        if (isLeftOrRight) {
            y = sourceAllocation.y1 + (sourceContentBox.y2 - sourceContentBox.y1) * .5 - natHeight * .5;
        } else if (position == St.Side.TOP) {
            y = sourceAllocation.y2;
        } else { //St.Side.BOTTOM
            y = sourceAllocation.y1 - natHeight;
        }

        x = Math.max(x, this._appIcon.panelWrapper.monitor.x);
        y = Math.max(y, this._appIcon.panelWrapper.monitor.y);

        this.set_position(x, y);
        this._translationProp = 'translation_' + (isLeftOrRight ? 'x' : 'y');
        this[this._translationProp] = TRANSLATION_OFFSET;
    },

    _animateOpenOrClose: function(show, onComplete) {
        Tweener.removeTweens(this);

        let tweenOpts = {
            opacity: show ? 255 : 0,
            time: Taskbar.DASH_ANIMATION_TIME,
            transition: 'easeOutQuad',
            onComplete: () => {
                (onComplete || (() => {}))();
            }
        };

        tweenOpts[this._translationProp] = show ? 0 : TRANSLATION_OFFSET;

        Tweener.addTween(this, tweenOpts);
    },
});