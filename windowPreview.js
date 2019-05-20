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
const Config = imports.misc.config;
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Signals = imports.signals;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;
const Workspace = imports.ui.workspace;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Taskbar = Me.imports.taskbar;
const Utils = Me.imports.utils;

//timeout intervals

//timeout names
const T1 = 'openMenuTimeout';
const T2 = 'closeMenuTimeout';

const MAX_TRANSLATION = 40;
const HEADER_HEIGHT = 38;
const DEFAULT_RATIO = { w: 160, h: 90 };
const FOCUSED_COLOR_OFFSET = 24;
const HEADER_COLOR_OFFSET = -12;

var headerHeight = 0;
var isLeftButtons = false;

var PreviewMenu = Utils.defineClass({
    Name: 'DashToPanel.PreviewMenu',
    Extends: St.Widget,

    _init: function(dtpSettings, panelWrapper) {
        this.callParent('_init', { layout_manager: new Clutter.BinLayout() });

        this._dtpSettings = dtpSettings;
        this._panelWrapper = panelWrapper;
        this.currentAppIcon = null;
        this._focusedPreview = null;
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

        //peek

        // move closing delay setting from "advanced"

        // hook settings (animation time, size, label color)
    },

    enable: function() {
        this._timeoutsHandler = new Utils.TimeoutsHandler();
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        Main.layoutManager.addChrome(this, { trackFullscreen: true, affectsInputRegion: false });
        Main.layoutManager.trackChrome(this.menu, { affectsInputRegion: true });
        
        this._resetHiddenState();
        this._refreshGlobals();
        this._updateClip();
        this.menu.set_position(1, 1);

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
                    'changed::window-preview-padding',
                    'changed::window-preview-show-title'
                ],
                () => {
                    this._refreshGlobals();
                    this._updateClip();
                }
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
        if (this.currentAppIcon != appIcon) {
            this.currentAppIcon = appIcon;

            if (!this.opened) {
                this.menu.set_style('background: ' + this._panelWrapper.dynamicTransparency.currentBackgroundColor);
                this.menu.show();

                this._refreshGlobals();
            }

            this._mergeWindows(appIcon);
            this._updatePosition();
            this._animateOpenOrClose(true);

            this.opened = true;
        }
    },

    close: function(immediate) {
        this.currentAppIcon = null;
        this.removeFocus();
        this._endOpenCloseTimeouts();

        if (immediate) {
            this._resetHiddenState();
        } else {
            this._animateOpenOrClose(false, () => this._resetHiddenState());
        }
    },

    update: function(appIcon, windows) {
        if (this.currentAppIcon == appIcon) {
            if (windows && !windows.length) {
                this.close();
            } else {
                this._addAndRemoveWindows(windows);
                this._updatePosition();
            }
        }
    },

    focusNext: function() {
        let previews = this._box.get_children();
        let currentIndex = this._focusedPreview ? previews.indexOf(this._focusedPreview) : -1;
        let nextIndex = currentIndex + 1;
        
        nextIndex = previews[nextIndex] ? nextIndex : 0;

        this.removeFocus();
        previews[nextIndex].setFocus(true);
        this._focusedPreview = previews[nextIndex];

        return nextIndex;
    },

    activateFocused: function() {
        if (this.opened && this._focusedPreview) {
            this._focusedPreview.activate();
        }
    },

    removeFocus: function() {
        if (this._focusedPreview) {
            this._focusedPreview.setFocus(false);
            this._focusedPreview = null;
        }
    },

    _mergeWindows: function(appIcon, windows) {
        windows = windows || (appIcon.window ? [appIcon.window] : appIcon.getAppIconInterestingWindows());
        windows.sort(Taskbar.sortWindowsCompareFunction);
    
        let currentPreviews = this._box.get_children();
        let l = Math.max(windows.length, currentPreviews.length);

        for (let i = 0; i < l; ++i) {
            if (currentPreviews[i] && windows[i] && windows[i] != currentPreviews[i].window) {
                currentPreviews[i].assignWindow(windows[i], this.opened);
            } else if (!currentPreviews[i]) {
                this._addNewPreview(windows[i]);
            } else if (!windows[i]) {
                currentPreviews[i][!this.opened ? 'destroy' : 'animateOut']();
            }
        }
    },

    _addAndRemoveWindows: function(windows) {
        let currentPreviews = this._box.get_children();

        windows.sort(Taskbar.sortWindowsCompareFunction);

        for (let i = 0, l = windows.length; i < l; ++i) {
            let currentIndex = Utils.findIndex(currentPreviews, c => c.window == windows[i]);
            
            if (currentIndex < 0) {
                this._addNewPreview(windows[i]);
            } else {
                currentPreviews.splice(currentIndex, 1);
            }
        }

        currentPreviews.forEach(c => c.animateOut());
    },

    _addNewPreview: function(window) {
        let preview = new Preview(this._panelWrapper, this);

        this._box.add_child(preview);
        preview.adjustOnStage();
        preview.assignWindow(window, this.opened);
    },

    getCurrentAppIcon: function() {
        return this.currentAppIcon;
    },

    _addCloseTimeout: function() {
        this._timeoutsHandler.add([T2, this._dtpSettings.get_int('leave-timeout'), () => this.close()]);
    },

    _onHoverChanged: function() {
        this._endOpenCloseTimeouts();

        if (this.currentAppIcon && !this.menu.hover) {
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

    _refreshGlobals: function() {
        headerHeight = this._dtpSettings.get_boolean('window-preview-show-title') ? HEADER_HEIGHT : 0;
        isLeftButtons = Meta.prefs_get_button_layout().left_buttons.indexOf(Meta.ButtonFunction.CLOSE) >= 0;
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
            h = (previewSize + headerHeight) * scaleFactor;
            x = this._panelWrapper.monitor.x;
        }

        if (this._position == St.Side.LEFT) {
            x = this._panelWrapper.monitor.x + panelSize * scaleFactor;
        } else if (this._position == St.Side.RIGHT) {
            x = this._panelWrapper.monitor.x + this._panelWrapper.monitor.width - (panelSize + previewSize) * scaleFactor;
        } else if (this._position == St.Side.TOP) {
            y = this._panelWrapper.monitor.y + panelSize * scaleFactor;
        } else { //St.Side.BOTTOM
            y = this._panelWrapper.monitor.y + this._panelWrapper.monitor.height - (panelSize + previewSize + headerHeight) * scaleFactor;
        }

        this.set_clip(0, 0, w, h);
        this.set_position(x, y);
        this.set_size(w, h);
    },

    _updatePosition: function() {
        let sourceNode = this.currentAppIcon.actor.get_theme_node();
        let sourceContentBox = sourceNode.get_content_box(this.currentAppIcon.actor.get_allocation_box());
        let sourceAllocation = Shell.util_get_transformed_allocation(this.currentAppIcon.actor);
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
            track_hover: true,
            layout_manager: new Clutter.BinLayout()
        });

        this._panelWrapper = panelWrapper;
        this._previewMenu = previewMenu;
        this._padding = previewMenu._dtpSettings.get_int('window-preview-padding') * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._previewDimensions = this._getPreviewDimensions();
        this.animatingOut = false;

        let [previewBinWidth, previewBinHeight] = this._getBinSize();
        this._previewBin = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        this._previewBin.set_style('padding: ' + this._padding + 'px;');
        this._previewBin.set_size(previewBinWidth, previewBinHeight);

        let closeButton = new St.Button({ style_class: 'window-close', accessible_name: 'Close window' });

        if (Config.PACKAGE_VERSION >= '3.31.9') {
            closeButton.add_actor(new St.Icon({ icon_name: 'window-close-symbolic' }));
        }

        this._closeButtonBin = new St.Widget({ 
            layout_manager: new Clutter.BinLayout(), 
            opacity: 0, 
            x_expand: true, y_expand: true, 
            x_align: Clutter.ActorAlign[isLeftButtons ? 'START' : 'END'], 
            y_align: Clutter.ActorAlign.START
        })

        this._closeButtonBin.add_child(closeButton);

        if (headerHeight) {
            let headerBox = new St.Widget({ 
                layout_manager: new Clutter.BoxLayout(), 
                y_align: Clutter.ActorAlign.START, 
                y_expand: true, 
                style: this._getBackgroundColor(HEADER_COLOR_OFFSET, .8) 
            });
            
            this._windowTitle = new St.Label({ y_align: Clutter.ActorAlign.CENTER, x_expand: true });

            this._iconBin = new St.Widget({ layout_manager: new Clutter.BinLayout() });
            this._iconBin.set_size(headerHeight, headerHeight);
    
            headerBox.add_child(this._iconBin);
            headerBox.insert_child_at_index(this._windowTitle, isLeftButtons ? 0 : 1);

            this.add_child(headerBox);
            
            this._previewBin.set_position(0, headerHeight);
        }

        closeButton.connect('clicked', () => this._onCloseBtnClick());
        this.connect('notify::hover', () => this._onHoverChanged());
        this.connect('button-release-event', (actor, e) => this._onButtonReleaseEvent(e));

        this.connect('destroy', () => this._onDestroy());

        this.add_child(this._previewBin);
        this.add_child(this._closeButtonBin);

        this.set_size(-1, previewBinHeight + headerHeight);
    },

    adjustOnStage: function() {
        let closeButtonPadding = headerHeight ? Math.round((headerHeight - this._closeButtonBin.height) * .5) : 4;
        let closeButtonBorderRadius = '';

        if (!headerHeight) {
            closeButtonBorderRadius = 'border-radius: ' + (isLeftButtons ? '0 0 4px 0;' : '0 0 0 4px;');
        }

        this._closeButtonBin.set_style(
            'padding: ' + closeButtonPadding + 'px; ' + 
            this._getBackgroundColor(HEADER_COLOR_OFFSET, .8) +
            closeButtonBorderRadius
        );
    },

    assignWindow: function(window, animateSize) {
        let clone = this._getWindowClone(window);

        this._removeWindowSignals();
        this.window = window;
        
        this._updateHeader();
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

    setFocus: function(focused) {
        this._hideOrShowCloseButton(!focused);
        this.set_style(this._getBackgroundColor(FOCUSED_COLOR_OFFSET, focused ? '-' : 0));
    },

    activate: function() {
        Main.activateWindow(this.window);
        this._hideOrShowCloseButton(true);
        this._previewMenu.close();
    },

    _onDestroy: function() {
        this._removeWindowSignals();
    },

    _onHoverChanged: function() {
        this.setFocus(this.hover);
    },

    _onCloseBtnClick: function() {
        this.window.delete(global.get_current_time());
        this._hideOrShowCloseButton(true);

        if (!this._previewMenu._dtpSettings.get_boolean('group-apps')) {
            this._previewMenu.close();
        }
    },

    _onButtonReleaseEvent: function(e) {
        switch (e.get_button()) {
            case 1: // Left click
                this.activate();
                break;
            case 2: // Middle click
                if (this._previewMenu._dtpSettings.get_boolean('preview-middle-click-close')) {
                    this._onCloseBtnClick();
                }
                break;
        }

        return Clutter.EVENT_STOP;
    },

    _removeWindowSignals: function() {
        if (this._titleWindowChangeId) {
            this.window.disconnect(this._titleWindowChangeId);
            this._titleWindowChangeId = 0;
        }
    },

    _updateHeader: function() {
        if (headerHeight) {
            let icon = this._previewMenu.getCurrentAppIcon().app.create_icon_texture(headerHeight * .6);
            let windowTitleStyle = 'max-width: 0px;';
            
            this._iconBin.destroy_all_children();
            this._iconBin.add_child(icon);

            if (isLeftButtons) {
                windowTitleStyle += 'padding-left:' + (headerHeight - icon.width) * .5 + 'px;';
            }

            this._titleWindowChangeId = this.window.connect('notify::title', () => this._updateWindowTitle());

            this._windowTitle.set_style(windowTitleStyle);
            this._updateWindowTitle();
        }
    },

    _updateWindowTitle: function() {
        this._windowTitle.text = (!this._previewMenu._dtpSettings.get_boolean('isolate-workspaces') ? 
                                  '[' + this.window.get_workspace().index() + '] ' : '') + 
                                 this.window.title;
    },

    _hideOrShowCloseButton: function(hide) {
        Tweener.addTween(this._closeButtonBin, getTweenOpts({ opacity: hide ? 0 : 255 }));
    },

    _getBackgroundColor: function(offset, alpha) {
        alpha = Math.abs(alpha);

        if (isNaN(alpha)) {
            alpha = this._panelWrapper.dynamicTransparency.alpha;
        }

        return 'background-color: ' +
                Utils.getrgbaColor(
                    this._panelWrapper.dynamicTransparency.backgroundColorRgb, 
                    alpha,
                    offset
                ) +
                'transition-duration:' + this._panelWrapper.dynamicTransparency.animationDuration;
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
        time: Taskbar.DASH_ANIMATION_TIME * 1.5,
        transition: 'easeInOutQuad'
    };

    return Utils.mergeObjects(opts || {}, defaults);
}