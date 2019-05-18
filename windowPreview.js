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

//timeout intervals

//timeout names
const T1 = 'openMenuTimeout';
const T2 = 'closeMenuTimeout';

const MAX_TRANSLATION = 40;
const HEADER_HEIGHT = 0;
const DEFAULT_RATIO = { w: 160, h: 90 };

var PreviewMenu = Utils.defineClass({
    Name: 'DashToPanel.PreviewMenu',
    Extends: St.Widget,

    _init: function(dtpSettings, panelWrapper) {
        this.callParent('_init', { layout_manager: new Clutter.BinLayout() });

        this._dtpSettings = dtpSettings;
        this._panelWrapper = panelWrapper;
        this._currentAppIcon = null;
        this.opened = false;
        this._position = Taskbar.getPosition();
        let isLeftOrRight = this._checkIfLeftOrRight();
        this._translationProp = 'translation_' + (isLeftOrRight ? 'x' : 'y');
        this._translationOffset = Math.min(this._dtpSettings.get_int('panel-size'), MAX_TRANSLATION) * 
                                  (this._position == St.Side.TOP || this._position == St.Side.LEFT ? -1 : 1);

        this.menu = new St.Widget({ name: 'preview-menu', layout_manager: new Clutter.BinLayout(), reactive: true, track_hover: true });
        this._box = new St.BoxLayout({ vertical: isLeftOrRight });
        this._scrollView = new St.ScrollView({
            name: 'dashtopanelPreviewScrollview',
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.NEVER,
            enable_mouse_scrolling: true
        });

        this._scrollView.add_actor(this._box);
        this.menu.add_child(this._scrollView);
        this.add_child(this.menu);




        
        //TODO
        //'open-state-changed'
        //'menu-closed'
        //'sync-tooltip'
        //this.add_style_class_name('app-well-menu');

        // add middle click

        // move closing delay setting from "advanced"

        // this._titleWindowChangeId = this.window.connect('notify::title', 
        //                                         Lang.bind(this, this._updateWindowTitle));

        // hook settings
    },

    enable: function() {
        this._timeoutsHandler = new Utils.TimeoutsHandler();
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        Main.uiGroup.insert_child_below(this, this._panelWrapper.panelBox);
        Main.layoutManager._trackActor(this, { trackFullscreen: true, affectsInputRegion: false });
        Main.layoutManager.trackChrome(this.menu, { affectsInputRegion: true });
        
        this._resetHiddenState();
        this._updateClip();

        this._signalsHandler.add(
            [
                this.menu,
                'notify::hover',
                () => this._onHoverChanged()
            ],
            [
                this._scrollView,
                'scroll-event', 
                this._onScrollEvent.bind(this)
            ],
            [
                this._dtpSettings,
                [
                    'changed::panel-size',
                    'changed::window-preview-size',
                    'changed::window-preview-padding'
                ],
                () => this._updateClip()
            ]
        );
    },

    disable: function() {
        this._timeoutsHandler.destroy();
        this._signalsHandler.destroy();

        this.close(true);

        Main.layoutManager._untrackActor(this);
        Main.uiGroup.remove_child(this);

        this.destroy();
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
        if (this._currentAppIcon != appIcon) {
            this._currentAppIcon = appIcon;

            this.updateWindows(appIcon);
            this._updatePosition();

            if (!this.opened) {
                this.menu.set_style('background: ' + this._panelWrapper.dynamicTransparency.currentBackgroundColor);
                this.menu.show();
                this.opened = true;
            }
            
            this._animateOpenOrClose(true);
        }
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
            let l = Math.max(windows.length, currentPreviews.length);

            for (let i = 0; i < l; ++i) {
                if (currentPreviews[i] && windows[i] && windows[i] != currentPreviews[i].window) {
                    currentPreviews[i].assignWindow(windows[i], this.opened);
                } else if (!currentPreviews[i]) {
                    let preview = new Preview(this._panelWrapper, this);

                    this._box.add_child(preview);
                    preview.assignWindow(windows[i], this.opened);
                } else if (!windows[i]) {
                    currentPreviews[i][!this.opened ? 'destroy' : 'animateOut']();
                }
            }
        }
    },

    getCurrentAppIcon: function() {
        return this._currentAppIcon;
    },

    _addCloseTimeout: function() {
        this._timeoutsHandler.add([T2, this._dtpSettings.get_int('leave-timeout'), () => this.close()]);
    },

    _onHoverChanged: function() {
        this._endOpenCloseTimeouts();

        if (!this.menu.hover) {
            this._addCloseTimeout();
        }
    },

    _onScrollEvent: function(actor, event) {
        if (!event.is_pointer_emulated()) {
            let vOrh = this._checkIfLeftOrRight() ? 'v' : 'h';
            let adjustment = this._scrollView['get_' + vOrh + 'scroll_bar']().get_adjustment(); 
            let increment = adjustment.step_increment;
            let delta = increment;

            switch (event.get_scroll_direction()) {
                case Clutter.ScrollDirection.UP:
                        delta = -increment;
                    break;
                case Clutter.ScrollDirection.SMOOTH:
                        let [dx, dy] = event.get_scroll_delta();
                        delta = dy * increment;
                        delta += dx * increment;
                    break;
            }
            
            adjustment.set_value(adjustment.get_value() + delta);
        }

        return Clutter.EVENT_STOP;
    },

    _endOpenCloseTimeouts: function() {
        this._timeoutsHandler.remove(T1);
        this._timeoutsHandler.remove(T2);
    },

    _resetHiddenState: function() {
        this.menu.hide();
        this.opened = false;
        this.menu.opacity = 0;
        this.menu[this._translationProp] = this._translationOffset;
        this._box.get_children().forEach(c => c.destroy());
    },

    _updateClip: function() {
        let x, y, w, h;
        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let panelSize = this._dtpSettings.get_int('panel-size');
        let previewSize = this._dtpSettings.get_int('window-preview-size') + 
                          this._dtpSettings.get_int('window-preview-padding') * 2;
        
        if (this._checkIfLeftOrRight()) {
            w = previewSize * scaleFactor;
            h = this._panelWrapper.monitor.height;
            y = this._panelWrapper.monitor.y;
        } else {
            w = this._panelWrapper.monitor.width;
            h = (previewSize + HEADER_HEIGHT) * scaleFactor;
            x = this._panelWrapper.monitor.x;
        }

        if (this._position == St.Side.LEFT) {
            x = this._panelWrapper.monitor.x + panelSize * scaleFactor;
        } else if (this._position == St.Side.RIGHT) {
            x = this._panelWrapper.monitor.x + this._panelWrapper.monitor.width - (panelSize + previewSize) * scaleFactor;
        } else if (this._position == St.Side.TOP) {
            y = this._panelWrapper.monitor.y + panelSize * scaleFactor;
        } else { //St.Side.BOTTOM
            y = this._panelWrapper.monitor.y + this._panelWrapper.monitor.height - (panelSize + previewSize + HEADER_HEIGHT) * scaleFactor;
        }

        this.set_clip(0, 0, w, h);
        this.set_position(x, y);
        this.set_size(w, h);
    },

    _updatePosition: function() {
        let sourceNode = this._currentAppIcon.actor.get_theme_node();
        let sourceContentBox = sourceNode.get_content_box(this._currentAppIcon.actor.get_allocation_box());
        let sourceAllocation = Shell.util_get_transformed_allocation(this._currentAppIcon.actor);
        let [previewsWidth, previewsHeight] = this._getPreviewsSize();
        let x = 0, y = 0;

        previewsWidth = Math.min(previewsWidth, this._panelWrapper.monitor.width);
        previewsHeight = Math.min(previewsHeight, this._panelWrapper.monitor.height);
        
        if (this._checkIfLeftOrRight()) {
            y = sourceAllocation.y1 - this._panelWrapper.monitor.y + (sourceContentBox.y2 - sourceContentBox.y1 - previewsHeight) * .5;
            y = Math.max(y, 0);
            y = Math.min(y, this._panelWrapper.monitor.height - previewsHeight);
        } else {
            x = sourceAllocation.x1 - this._panelWrapper.monitor.x + (sourceContentBox.x2 - sourceContentBox.x1 - previewsWidth) * .5;
            x = Math.max(x, 0);
            x = Math.min(x, this._panelWrapper.monitor.width - previewsWidth);
        }

        if (!this.opened) {
            this.menu.set_position(x, y);
        } else {
            Tweener.addTween(this.menu, getTweenOpts({ x: x, y: y }));
        }
    },

    _getPreviewsSize: function() {
        let previewsWidth = 0;
        let previewsHeight = 0;

        this._box.get_children().forEach(c => {
            if (!c.animatingOut) {
                let [width, height] = c.getSize();

                if (this._checkIfLeftOrRight()) {
                    previewsWidth = Math.max(width, previewsWidth);
                    previewsHeight += height;
                } else {
                    previewsWidth += width;
                    previewsHeight = Math.max(height, previewsHeight);
                }
            }
        });

        return [previewsWidth, previewsHeight];
    },

    _animateOpenOrClose: function(show, onComplete) {
        let isTranslationAnimation = this.menu[this._translationProp] != 0;
        let tweenOpts = {
            opacity: show ? 255 : 0,
            transition: show ? 'easeInOutQuad' : 'easeInCubic',
            onComplete: () => {
                if (isTranslationAnimation) {
                    Main.layoutManager._queueUpdateRegions();
                }
                
                (onComplete || (() => {}))();
            }
        };

        tweenOpts[this._translationProp] = show ? 0 : this._translationOffset;

        Tweener.addTween(this.menu, getTweenOpts(tweenOpts));
    },

    _checkIfLeftOrRight: function() {
        return this._position == St.Side.LEFT || this._position == St.Side.RIGHT; 
    }
});

var Preview = Utils.defineClass({
    Name: 'DashToPanel.Preview',
    Extends: St.Widget,

    _init: function(panelWrapper, previewMenu) {
        this.callParent('_init', { 
            style_class: 'preview-container', 
            reactive: true, 
            y_align: Clutter.ActorAlign.CENTER, 
            x_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BoxLayout({ vertical: false })
        });

        this._panelWrapper = panelWrapper;
        this._previewMenu = previewMenu;
        this._padding = previewMenu._dtpSettings.get_int('window-preview-padding') * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._previewDimensions = this._getPreviewDimensions();
        this.animatingOut = false;

        this._titleBox = new St.BoxLayout({ height: HEADER_HEIGHT });

        this._windowTitle = new St.Label({ y_align: Clutter.ActorAlign.CENTER, style_class: 'preview-label' });

        this._titleBox.add_child(this._windowTitle);

        this.add_actor(this._titleBox)

        this._previewBin = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        
        this._previewBin.set_style('padding: ' + this._padding + 'px');
        this._previewBin.set_size.apply(this._previewBin, this._getBinSize());

        this.add_actor(this._previewBin);
    },

    assignWindow: function(window, animateSize) {
        let clone = this._getWindowClone(window);

        this._resizeClone(clone);
        this._addClone(clone, animateSize);
    },

    animateOut: function() {
        let tweenOpts = getTweenOpts({ opacity: 0, onComplete: () => this.destroy() });

        tweenOpts[this._previewMenu._checkIfLeftOrRight() ? 'height' : 'width'] = 0;
        this.animatingOut = true;

        Tweener.addTween(this, tweenOpts);
    },

    getSize: function() {
        let [binWidth, binHeight] = this._getBinSize();

        binWidth = Math.max(binWidth, this.cloneWidth + this._padding * 2);
        binHeight = Math.max(binHeight, this.cloneHeight + this._padding * 2);

        return [binWidth, binHeight];
    },

    _addClone: function(newClone, animateSize) {
        let currentClones = this._previewBin.get_children();
        let newCloneOpts = getTweenOpts({ opacity: 255 });
        
        if (currentClones.length) {
            let currentClone = currentClones.pop();
            let currentCloneOpts = getTweenOpts({ opacity: 0, onComplete: () => currentClone.destroy() });

            if (newClone.width > currentClone.width) {
                newCloneOpts.width = newClone.width;
                newClone.width = currentClone.width;
            } else {
                currentCloneOpts.width = newClone.width;
            }

            if (newClone.height > currentClone.height) {
                newCloneOpts.height = newClone.height;
                newClone.height = currentClone.height;
            } else {
                currentCloneOpts.height = newClone.height;
            }

            currentClones.forEach(c => c.destroy());
            Tweener.addTween(currentClone, currentCloneOpts);
        } else if (animateSize) {
            if (this._previewMenu._checkIfLeftOrRight()) {
                newClone.height = 0;
                newCloneOpts.height = this.cloneHeight;
            } else {
                newClone.width = 0;
                newCloneOpts.width = this.cloneWidth;
            }
        }

        this._previewBin.add_child(newClone);
        
        Tweener.addTween(newClone, newCloneOpts);
    },
    
    _getWindowClone: function(window) {
        return new Clutter.Clone({ 
            source: window.get_compositor_private(), 
            reactive: true,
            opacity: 0,
            y_align: Clutter.ActorAlign.CENTER, 
            x_align: Clutter.ActorAlign.CENTER
        });
    },

    _getBinSize: function() {
        let [width, height] = this._previewDimensions;

        width += this._padding * 2;
        height += this._padding * 2;

        if (this._previewMenu._checkIfLeftOrRight()) {
            height = -1;
        } else {
            width = -1;
        }

        return [width, height];
    },

    _resizeClone: function(clone) {
        let [width, height] = clone.get_source().get_size();
        let [maxWidth, maxHeight] = this._previewDimensions;
        let ratio = Math.min(maxWidth / width, maxHeight / height);
        
        ratio = ratio < 1 ? ratio : 1;

        this.cloneWidth = Math.floor(width * ratio);
        this.cloneHeight = Math.floor(height * ratio);

        clone.set_size(this.cloneWidth, this.cloneHeight);
    },

    _getPreviewDimensions: function() {
        let size = this._previewMenu._dtpSettings.get_int('window-preview-size') * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let w, h;

        if (this._previewMenu._checkIfLeftOrRight()) {
            w = Math.max(DEFAULT_RATIO.w, size);
            h = w * DEFAULT_RATIO.h / DEFAULT_RATIO.w;
        } else {
            h = Math.max(DEFAULT_RATIO.h, size);
            w = h * DEFAULT_RATIO.w / DEFAULT_RATIO.h;
        }

        return [w, h];
    }
});

function getTweenOpts(opts) {
    let defaults = {
        time: Taskbar.DASH_ANIMATION_TIME * 2,
        transition: 'easeInOutQuad'
    };

    return Utils.mergeObjects(opts || {}, defaults);
}