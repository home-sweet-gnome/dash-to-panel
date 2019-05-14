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

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const Signals = imports.signals;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Taskbar = Me.imports.taskbar;
const Utils = Me.imports.utils;

const MONITOR_PADDING = 10;

//timeout intervals

//timeout names
const T1 = 'openMenuTimeout';
const T2 = 'closeMenuTimeout';

var PreviewMenu = Utils.defineClass({
    Name: 'DashToPanel.PreviewMenu',
    Extends: St.Widget,

    _init: function(dtpSettings, panelWrapper) {
        this.callParent('_init', { name: 'preview-menu', layout_manager: new Clutter.BinLayout(), reactive: true, track_hover: true });

        this._dtpSettings = dtpSettings;
        this._panelWrapper = panelWrapper;

        this._currentAppIcon = null;
        this._position = Taskbar.getPosition();
        let isLeftOrRight = this._position == St.Side.LEFT || this._position == St.Side.RIGHT;
        this._translationProp = 'translation_' + (isLeftOrRight ? 'x' : 'y');
        this._translationOffset = Math.min(this._dtpSettings.get_int('panel-size'), 40);

        this._box = new St.BoxLayout({ 
            vertical: isLeftOrRight,
            clip_to_allocation: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START 
        });

        this._scrollView = new St.ScrollView({
            name: 'dashtopanelPreviewScrollview',
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.NEVER,
            enable_mouse_scrolling: true
        });

        this._scrollView.add_actor(this._box);
        this.add_child(this._scrollView);




        //testing
        //this._scrollView.set_style('padding: 10px;');
        
        //TODO
        //'open-state-changed'
        //'menu-closed'
        //'sync-tooltip'
        //this.add_style_class_name('app-well-menu');

        // this._titleWindowChangeId = this.window.connect('notify::title', 
        //                                         Lang.bind(this, this._updateWindowTitle));
    },

    enable: function() {
        this._timeoutsHandler = new Utils.TimeoutsHandler();
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        Main.uiGroup.insert_child_below(this, this._panelWrapper.panelBox);
        Main.layoutManager._trackActor(this, { affectsStruts: false, trackFullscreen: true });
        this._resetHiddenState();
        
        this._signalsHandler.add(
            [
                this,
                'notify::hover',
                () => this._onHoverChanged()
            ],
        );
    },

    disable: function() {
        this._timeoutsHandler.destroy();
        this._signalsHandler.destroy();

        this.close(true);

        Main.layoutManager._untrackActor(this);
        Main.uiGroup.remove_child(this);
    },

    requestOpen: function(appIcon) {
        this._endOpenCloseTimeouts();
        this._timeoutsHandler.add([T1, this._dtpSettings.get_int('show-window-previews-timeout'), () => this.open(appIcon)]);
    },

    requestClose: function() {
        this._endOpenCloseTimeouts();
        this._addCloseTimeout();
    },

    open: function(appIcon) {
        this._currentAppIcon = appIcon;
        this.updateWindows(appIcon);
        this._updatePosition();
        this.visible = true;
        this._animateOpenOrClose(true);
    },

    close: function(immediate) {
        this._currentAppIcon = null;

        if (immediate) {
            this._resetHiddenState();
        } else {
            this._animateOpenOrClose(false, () => this._resetHiddenState());
        }
    },

    updateWindows: function(appIcon, windows) {
        if (this._currentAppIcon == appIcon) {
            windows = windows || (appIcon.window ? [appIcon.window] : appIcon.getAppIconInterestingWindows());

            let currentPreviews = this._box.get_children();

            for (let i = 0, l = currentPreviews.length; i < l; ++i) {
                if (Taskbar.findIndex(windows, w => w == currentPreviews[i].window) < 0) {
                    this._box.remove_child(currentPreviews[i]);
                    // currentPreviews[i]._animatingOut = 1;
                    // Tweener.addTween(currentPreviews[i], {
                    //     width: 0,
                    //     opacity: 0,
                    //     time: Taskbar.DASH_ANIMATION_TIME,
                    //     transition: 'easeInOutQuad',
                    //     onComplete: () => this._box.remove_child(currentPreviews[i])
                    // })
                }
            }

            for (let i = 0, l = windows.length; i < l; ++i) {
                let currentPosition = Taskbar.findIndex(currentPreviews, cp => cp.window == windows[i]);
                let preview;

                if (currentPosition == i) {
                    continue;
                } else if (currentPosition < 0) {
                    preview = new Preview(windows[i]);
                    preview.set_style('background: ' + this._panelWrapper.dynamicTransparency.currentBackgroundColor + 'padding: 10px;');
                } else {
                    preview = currentPreviews[currentPosition];
                }

                this._box.insert_child_at_index(preview, i);
            }
        }
    },

    getCurrentAppIcon: function() {
        return this._currentAppIcon;
    },

    // vfunc_allocate: function(box, flags) {
    //     this.callParent('vfunc_allocate', box, flags);
    //     this._scrollView.set_clip(0, 0, box.x2 - box.x1, box.y2 - box.y1 - this.translation_y);
    // },

    vfunc_get_preferred_width: function(forHeight) {
        let [, width] = St.Widget.prototype.vfunc_get_preferred_width.call(this, forHeight);
        let maxWidth = this._panelWrapper.monitor.width - MONITOR_PADDING * 2;

        return [0, Math.min(width, maxWidth)];
    },

    vfunc_get_preferred_height: function(forWidth) {
        let [, height] = St.Widget.prototype.vfunc_get_preferred_height.call(this, forWidth);
        let maxHeight = this._panelWrapper.monitor.height - MONITOR_PADDING * 2;
        
        return [0, Math.min(height, maxHeight)];
    },

    _addCloseTimeout: function() {
        this._timeoutsHandler.add([T2, this._dtpSettings.get_int('leave-timeout'), () => this.close()]);
    },

    _onHoverChanged: function() {
        this._endOpenCloseTimeouts();

        if (!this.hover) {
            this._addCloseTimeout();
        }
    },

    _endOpenCloseTimeouts: function() {
        this._timeoutsHandler.remove(T1);
        this._timeoutsHandler.remove(T2);
    },

    _resetHiddenState: function() {
        this.visible = false;
        this.opacity = 0;
        this[this._translationProp] = this._translationOffset;
        //this._box.remove_all_children();
    },

    _updatePosition: function() {
        let sourceNode = this._currentAppIcon.actor.get_theme_node();
        let sourceContentBox = sourceNode.get_content_box(this._currentAppIcon.actor.get_allocation_box());
        let sourceAllocation = Shell.util_get_transformed_allocation(this._currentAppIcon.actor);
        let [minWidth, minHeight, natWidth, natHeight] = this.get_preferred_size();
        //let removedChildren = this._box.get_children().filter(c => c._animatingOut);
        //let excessWidth = 0;
        let x, y;
        
        //removedChildren.forEach(rc => excessWidth += rc.width);

        if (this._position == St.Side.TOP || this._position == St.Side.BOTTOM) {
            x = sourceAllocation.x1 + (sourceContentBox.x2 - sourceContentBox.x1) * .5 - natWidth * .5 /*+ excessWidth * .5*/;
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

        if (this[this._translationProp] != 0) {
            this.set_position(x, y);
            this[this._translationProp] = this._translationOffset;
        } else {
            Tweener.addTween(this, {
                x: x, y: y,
                time: Taskbar.DASH_ANIMATION_TIME,
                transition: 'easeInOutQuad'
            });
        }
    },

    _animateOpenOrClose: function(show, onComplete) {
        let isTranslationAnimation = this[this._translationProp] !=0;
        let tweenOpts = {
            opacity: show ? 255 : 0,
            time: Taskbar.DASH_ANIMATION_TIME,
            transition: show ? 'easeInOutQuad' : 'easeInCubic',
            onComplete: () => {
                if (isTranslationAnimation) {
                    Main.layoutManager._queueUpdateRegions();
                }
                
                (onComplete || (() => {}))();
            }
        };

        tweenOpts[this._translationProp] = show ? 0 : this._translationOffset;

        Tweener.addTween(this, tweenOpts);
    },
});

var Preview = Utils.defineClass({
    Name: 'DashToPanel.Preview',
    Extends: St.Widget,

    _init: function(window) {
        this.callParent('_init', { name: 'preview-menu', reactive: true });

        this.window = window;
        this.add_actor(this.getThumbnail());

        // this._windowTitle = new St.Label({ 
        //     y_align: Clutter.ActorAlign.CENTER, 
        //     x_align: Clutter.ActorAlign.START, 
        //     style_class: 'overview-label' 
        // });
    },

    getThumbnail: function() {
        let clone = null;
        let mutterWindow = this.window.get_compositor_private();

        if (mutterWindow) {
            clone = new Clutter.Clone ({ source: mutterWindow.get_texture(), reactive: true });
            this._resize(clone);

            // this._resizeId = mutterWindow.meta_window.connect('size-changed',
            //                                 Lang.bind(this, this._queueResize));
                                            
            // this._destroyId = mutterWindow.connect('destroy', () => this.animateOutAndDestroy());
        }

        return clone;
    },

    _resize: function(clone) {
        let [width, height] = clone.get_source().get_size();
        //let scale = Math.min(this._thumbnailWidth / width, this._thumbnailHeight / height);

        clone.set_size(200, 150);
        clone.set_position(10, 10);
    },
});