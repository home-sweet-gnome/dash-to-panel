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
const MONITOR_PADDING = 10;

//timeout intervals

//timeout names
const T1 = 'openMenuTimeout';
const T2 = 'closeMenuTimeout';

var PreviewMenu = Utils.defineClass({
    Name: 'DashToPanel.PreviewMenu',
    Extends: St.Widget,

    _init: function(dtpSettings, panelWrapper) {
        this.callParent('_init', { name: 'preview-menu', reactive: true });

        this._dtpSettings = dtpSettings;
        this._panelWrapper = panelWrapper;

        this._currentAppIcon = null;
        this._position = Taskbar.getPosition();
        this._translationProp = 'translation_' + (this._position == St.Side.LEFT || this._position == St.Side.RIGHT ? 'x' : 'y');
        this[this._translationProp] = TRANSLATION_OFFSET;



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

        Main.uiGroup.insert_child_below(this, this._panelWrapper.panelBox);

        // this._signalsHandler.add(
        //     [
                
        //     ],
        // );
    },

    disable: function() {
        this._signalsHandler.destroy();
        this._timeoutsHandler.destroy();

        this.close(true);
        Main.uiGroup.remove_child(this);
    },

    requestOpen: function(appIcon) {
        this._endOpenCloseTimeouts();

        if (this._currentAppIcon) {
            return this.open(appIcon);
        }
        
        this._timeoutsHandler.add([T1, this._dtpSettings.get_int('show-window-previews-timeout'), () => this.open(appIcon)]);
    },

    requestClose: function() {
        this._endOpenCloseTimeouts();
        this._timeoutsHandler.add([T2, this._dtpSettings.get_int('leave-timeout'), () => this.close()]);
    },

    open: function(appIcon) {
        this._currentAppIcon = appIcon;
        this._updatePosition();
        this.show();
        this._animateOpenOrClose(true);
    },

    close: function(immediate) {
        this._currentAppIcon = null;

        if (this.visible) {
            this._animateOpenOrClose(false, immediate, () => {
                this.hide();
            });
        }
    },

    updateWindows: function(appIcon, windows) {
        if (this._currentAppIcon == appIcon) {

        }
    },

    getCurrentAppIcon: function() {
        return this._currentAppIcon;
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

    _endOpenCloseTimeouts: function() {
        this._timeoutsHandler.remove(T1);
        this._timeoutsHandler.remove(T2);
    },

    _updatePosition: function() {
        let sourceNode = this._currentAppIcon.actor.get_theme_node();
        let sourceContentBox = sourceNode.get_content_box(this._currentAppIcon.actor.get_allocation_box());
        let sourceAllocation = Shell.util_get_transformed_allocation(this._currentAppIcon.actor);
        let [minWidth, minHeight, natWidth, natHeight] = this.get_preferred_size();
        let x, y;

        if (this._position == St.Side.TOP || this._position == St.Side.BOTTOM) {
            x = sourceAllocation.x1 + (sourceContentBox.x2 - sourceContentBox.x1) * .5 - natWidth * .5;
        } else if (this._position == St.Side.LEFT) {
            x = sourceAllocation.x2;
        } else { //St.Side.RIGHT
            x = sourceAllocation.x1 - natWidth;
        }

        if (this._position == St.Side.LEFT || this._position == St.Side.RIGHT) {
            y = sourceAllocation.y1 + (sourceContentBox.y2 - sourceContentBox.y1) * .5 - natHeight * .5;
        } else if (this._position == St.Side.TOP) {
            y = sourceAllocation.y2;
        } else { //St.Side.BOTTOM
            y = sourceAllocation.y1 - natHeight;
        }

        x = Math.max(x, this._panelWrapper.monitor.x + MONITOR_PADDING);
        y = Math.max(y, this._panelWrapper.monitor.y + MONITOR_PADDING);

        if (this[this._translationProp] > 0) {
            this.set_position(x, y);
            this[this._translationProp] = TRANSLATION_OFFSET;
        } else {
            Tweener.addTween(this, {
                x: x, y: y,
                time: Taskbar.DASH_ANIMATION_TIME,
                transition: 'easeInOutQuad'
            });
        }
    },

    _animateOpenOrClose: function(show, immediate, onComplete) {
        let tweenOpts = {
            opacity: show ? 255 : 0,
            time: immediate ? 0 : Taskbar.DASH_ANIMATION_TIME,
            transition: show ? 'easeInOutQuad' : 'easeInCubic'
        };

        tweenOpts[this._translationProp] = show ? 0 : TRANSLATION_OFFSET;

        if (onComplete) {
            tweenOpts.onComplete = onComplete;
        }

        Tweener.addTween(this, tweenOpts);
    },
});