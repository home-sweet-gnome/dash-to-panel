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


const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Signals = imports.signals;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Mainloop = imports.mainloop;

const Config = imports.misc.config;
const AppDisplay = imports.ui.appDisplay;
const AppFavorites = imports.ui.appFavorites;
const Dash = imports.ui.dash;
const DND = imports.ui.dnd;
const IconGrid = imports.ui.iconGrid;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const Workspace = imports.ui.workspace;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Panel = Me.imports.panel;
const Taskbar = Me.imports.taskbar;
const Progress = Me.imports.progress;
const _ = imports.gettext.domain(Utils.TRANSLATION_DOMAIN).gettext;

//timeout names
const T1 = 'setStyleTimeout';
const T2 = 'mouseScrollTimeout';
const T3 = 'showDotsTimeout';
const T4 = 'overviewWindowDragEndTimeout';
const T5 = 'switchWorkspaceTimeout';
const T6 = 'displayProperIndicatorTimeout';

let LABEL_GAP = 5;
let MAX_INDICATORS = 4;
var DEFAULT_PADDING_SIZE = 4;

let DOT_STYLE = {
    DOTS: "DOTS",
    SQUARES: "SQUARES",
    DASHES: "DASHES",
    SEGMENTED: "SEGMENTED",
    CILIORA: "CILIORA",
    METRO: "METRO",
    SOLID: "SOLID"
}

let DOT_POSITION = {
    TOP: "TOP",
    BOTTOM: "BOTTOM",
    LEFT: 'LEFT',
    RIGHT: 'RIGHT'
}

let recentlyClickedAppLoopId = 0;
let recentlyClickedApp = null;
let recentlyClickedAppWindows = null;
let recentlyClickedAppIndex = 0;
let recentlyClickedAppMonitorIndex;

let tracker = Shell.WindowTracker.get_default();
let menuRedisplayFunc = !!AppDisplay.AppIconMenu.prototype._rebuildMenu ? '_rebuildMenu' : '_redisplay';

/**
 * Extend AppIcon
 *
 * - Apply a css class based on the number of windows of each application (#N);
 * - Draw a dot for each window of the application based on the default "dot" style which is hidden (#N);
 *   a class of the form "running#N" is applied to the AppWellIcon actor.
 *   like the original .running one.
 * - add a .focused style to the focused app
 * - Customize click actions.
 * - Update minimization animation target
 *
 */

var taskbarAppIcon = Utils.defineClass({
    Name: 'DashToPanel.TaskbarAppIcon',
    Extends: AppDisplay.AppIcon,
    ParentConstrParams: [[0, 'app'], [2]],

    _init: function(appInfo, panel, iconParams, previewMenu) {
        this.dtpPanel = panel;
        this._nWindows = 0;
        this.window = appInfo.window;
        this.isLauncher = appInfo.isLauncher;
        this._previewMenu = previewMenu;

        this._timeoutsHandler = new Utils.TimeoutsHandler();

		// Fix touchscreen issues before the listener is added by the parent constructor.
        this._onTouchEvent = function(actor, event) {
            if (event.type() == Clutter.EventType.TOUCH_BEGIN) {
                // Open the popup menu on long press.
                this._setPopupTimeout();
            } else if (this._menuTimeoutId != 0 && (event.type() == Clutter.EventType.TOUCH_END || event.type() == Clutter.EventType.TOUCH_CANCEL)) {    
                // Activate/launch the application.
                this.activate(1);
                this._removeMenuTimeout();
            }
            // Disable dragging via touch screen as it's buggy as hell. Not perfect for tablet users, but the alternative is way worse.
            // Also, EVENT_PROPAGATE launches applications twice with this solution, so this.activate(1) above must only be called if there's already a window.
            return Clutter.EVENT_STOP;
        };
        // Hack for missing TOUCH_END event.
        this._onLeaveEvent = function(actor, event) {
            this.actor.fake_release();
            if (this._menuTimeoutId != 0) this.activate(1); // Activate/launch the application if TOUCH_END didn't fire.
            this._removeMenuTimeout();
        };

        this.callParent('_init', appInfo.app, iconParams);

        Utils.wrapActor(this.icon);
        Utils.wrapActor(this);
        
        this._dot.set_width(0);
        this._isGroupApps = Me.settings.get_boolean('group-apps');
        
        this._container = new St.Widget({ style_class: 'dtp-container', layout_manager: new Clutter.BinLayout() });
        this._dotsContainer = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        this._dtpIconContainer = new St.Widget({ layout_manager: new Clutter.BinLayout(), style: getIconContainerStyle() });

        this.actor.remove_actor(this._iconContainer);
        
        this._dtpIconContainer.add_child(this._iconContainer);

        if (appInfo.window) {
            let box = new St.BoxLayout();

            this._windowTitle = new St.Label({ 
                y_align: Clutter.ActorAlign.CENTER, 
                x_align: Clutter.ActorAlign.START, 
                style_class: 'overview-label' 
            });
            
            this._updateWindowTitle();
            this._updateWindowTitleStyle();

            this._scaleFactorChangedId = St.ThemeContext.get_for_stage(global.stage).connect('changed', () => this._updateWindowTitleStyle());

            box.add_child(this._dtpIconContainer);
            box.add_child(this._windowTitle);

            this._dotsContainer.add_child(box);
        } else {
            this._dotsContainer.add_child(this._dtpIconContainer);
        }

        this._container.add_child(this._dotsContainer);
        this.actor.set_child(this._container);

        if (Panel.checkIfVertical()) {
            this.actor.set_width(panel.geom.w);
        }

        // Monitor windows-changes instead of app state.
        // Keep using the same Id and function callback (that is extended)
        if(this._stateChangedId > 0) {
            this.app.disconnect(this._stateChangedId);
            this._stateChangedId = 0;
        }

        this._setAppIconPadding();
        this._showDots();

        this._focusWindowChangedId = global.display.connect('notify::focus-window', 
                                                            Lang.bind(this, this._onFocusAppChanged));

        this._windowEnteredMonitorId = this._windowLeftMonitorId = 0;
        this._stateChangedId = this.app.connect('windows-changed', Lang.bind(this, this.onWindowsChanged));

        if (!this.window) {
            if (Me.settings.get_boolean('isolate-monitors')) {
                this._windowEnteredMonitorId = Utils.DisplayWrapper.getScreen().connect('window-entered-monitor', this.onWindowEnteredOrLeft.bind(this));
                this._windowLeftMonitorId = Utils.DisplayWrapper.getScreen().connect('window-left-monitor', this.onWindowEnteredOrLeft.bind(this));
            }
            
            this._titleWindowChangeId = 0;
        } else {
            this._titleWindowChangeId = this.window.connect('notify::title', 
                                                Lang.bind(this, this._updateWindowTitle));
        }
        
        this._scrollEventId = this.actor.connect('scroll-event', this._onMouseScroll.bind(this));

        this._overviewWindowDragEndId = Main.overview.connect('window-drag-end',
                                                Lang.bind(this, this._onOverviewWindowDragEnd));

        this._switchWorkspaceId = global.window_manager.connect('switch-workspace',
                                                Lang.bind(this, this._onSwitchWorkspace));

        this._hoverChangeId = this.actor.connect('notify::hover', () => this._onAppIconHoverChanged());
        
        this._dtpSettingsSignalIds = [
            Me.settings.connect('changed::dot-position', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-size', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-style-focused', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-style-unfocused', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-dominant', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-override', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-1', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-2', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-3', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-4', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-unfocused-different', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-unfocused-1', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-unfocused-2', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-unfocused-3', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::dot-color-unfocused-4', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::focus-highlight', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::focus-highlight-dominant', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::focus-highlight-color', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::focus-highlight-opacity', Lang.bind(this, this._settingsChangeRefresh)),
            Me.settings.connect('changed::group-apps-label-font-size', Lang.bind(this, this._updateWindowTitleStyle)),
            Me.settings.connect('changed::group-apps-label-font-weight', Lang.bind(this, this._updateWindowTitleStyle)),
            Me.settings.connect('changed::group-apps-label-font-color', Lang.bind(this, this._updateWindowTitleStyle)),
            Me.settings.connect('changed::group-apps-label-max-width', Lang.bind(this, this._updateWindowTitleStyle)),
            Me.settings.connect('changed::group-apps-use-fixed-width', Lang.bind(this, this._updateWindowTitleStyle)),
            Me.settings.connect('changed::group-apps-underline-unfocused', Lang.bind(this, this._settingsChangeRefresh))
        ]

        this.forcedOverview = false;

        this._progressIndicator = new Progress.ProgressIndicator(this, panel.progressManager);

        this._numberOverlay();
    },

    getDragActor: function() {
        return this.app.create_icon_texture(this.dtpPanel.taskbar.iconSize);
    },

    shouldShowTooltip: function() {
        if (!Me.settings.get_boolean('show-tooltip') || 
            (!this.isLauncher && Me.settings.get_boolean("show-window-previews") &&
             this.getAppIconInterestingWindows().length > 0)) {
            return false;
        } else {
            return this.actor.hover && !this.window && 
                   (!this._menu || !this._menu.isOpen) && 
                   (this._previewMenu.getCurrentAppIcon() !== this);
        }
    },

    _onAppIconHoverChanged: function() {
        if (!Me.settings.get_boolean('show-window-previews') || 
            (!this.window && !this._nWindows)) {
            return;
        }

        if (this.actor.hover) {
            this._previewMenu.requestOpen(this);
        } else {
            this._previewMenu.requestClose();
        }
    },

    _onDestroy: function() {
        this.callParent('_onDestroy');
        this._destroyed = true;

        this._timeoutsHandler.destroy();

        this._previewMenu.close(true);

        // Disconect global signals
        // stateChangedId is already handled by parent)
        
        if(this._overviewWindowDragEndId)
            Main.overview.disconnect(this._overviewWindowDragEndId);

        if(this._focusWindowChangedId)
            global.display.disconnect(this._focusWindowChangedId);

        if(this._titleWindowChangeId)
            this.window.disconnect(this._titleWindowChangeId);

        if (this._windowEnteredMonitorId) {
            Utils.DisplayWrapper.getScreen().disconnect(this._windowEnteredMonitorId);
            Utils.DisplayWrapper.getScreen().disconnect(this._windowLeftMonitorId);
        }

        if(this._switchWorkspaceId)
            global.window_manager.disconnect(this._switchWorkspaceId);

        if(this._scaleFactorChangedId)
            St.ThemeContext.get_for_stage(global.stage).disconnect(this._scaleFactorChangedId);

        if (this._hoverChangeId) {
            this.actor.disconnect(this._hoverChangeId);
        }

        if (this._scrollEventId) {
            this.actor.disconnect(this._scrollEventId);
        }

        for (let i = 0; i < this._dtpSettingsSignalIds.length; ++i) {
            Me.settings.disconnect(this._dtpSettingsSignalIds[i]);
        }
    },

    onWindowsChanged: function() {
        this._updateWindows();
        this.updateIcon();
    },

    onWindowEnteredOrLeft: function() {
        if (this._checkIfFocusedApp()) {
            this._updateWindows();
            this._displayProperIndicator();
        }
    },

    // Update indicator and target for minimization animation
    updateIcon: function() {

        // If (for unknown reason) the actor is not on the stage the reported size
        // and position are random values, which might exceeds the integer range
        // resulting in an error when assigned to the a rect. This is a more like
        // a workaround to prevent flooding the system with errors.
        if (this.actor.get_stage() == null)
            return;

        let rect = new Meta.Rectangle();

        [rect.x, rect.y] = this.actor.get_transformed_position();
        [rect.width, rect.height] = this.actor.get_transformed_size();

        let windows = this.window ? [this.window] : this.getAppIconInterestingWindows(true);
        windows.forEach(function(w) {
            w.set_icon_geometry(rect);
        });
    },

    _onMouseScroll: function(actor, event) {
        let scrollAction = Me.settings.get_string('scroll-icon-action');
        
        if (scrollAction === 'PASS_THROUGH') {
            return this.dtpPanel._onPanelMouseScroll(actor, event);
        } else if (scrollAction === 'NOTHING' || (!this.window && !this._nWindows)) {
            return;
        }

        let direction = Utils.getMouseScrollDirection(event);

        if (direction && !this._timeoutsHandler.getId(T2)) {
            this._timeoutsHandler.add([T2, Me.settings.get_int('scroll-icon-delay'), () => {}]);

            let windows = this.getAppIconInterestingWindows();

            windows.sort(Taskbar.sortWindowsCompareFunction);
            Utils.activateSiblingWindow(windows, direction, this.window);
        }
    },
    
    _showDots: function() {
        // Just update style if dots already exist
        if (this._focusedDots && this._unfocusedDots) {
            this._updateWindows();
            return;
        }

        if (!this._isGroupApps) {
            this._focusedDots = new St.Widget({ 
                layout_manager: new Clutter.BinLayout(),
                x_expand: true, y_expand: true,
                visible: false
            });

            let mappedId = this.actor.connect('notify::mapped', () => {
                this._displayProperIndicator();
                this.actor.disconnect(mappedId);
            });
        } else {
            this._focusedDots = new St.DrawingArea(), 
            this._unfocusedDots = new St.DrawingArea();
            this._focusedDots._tweeningToSize = null, 
            this._unfocusedDots._tweeningToSize = null;
            
            this._focusedDots.connect('repaint', Lang.bind(this, function() {
                if(this._dashItemContainer.animatingOut) {
                    // don't draw and trigger more animations if the icon is in the middle of
                    // being added to the panel
                    return;
                }
                this._drawRunningIndicator(this._focusedDots, Me.settings.get_string('dot-style-focused'), true);
                this._displayProperIndicator();
            }));
            
            this._unfocusedDots.connect('repaint', Lang.bind(this, function() {
                if(this._dashItemContainer.animatingOut) {
                    // don't draw and trigger more animations if the icon is in the middle of
                    // being added to the panel
                    return;
                }
                this._drawRunningIndicator(this._unfocusedDots, Me.settings.get_string('dot-style-unfocused'), false);
                this._displayProperIndicator();
            }));
                
            this._dotsContainer.add_child(this._unfocusedDots);
    
            this._updateWindows();

            this._timeoutsHandler.add([T3, 0, () => {
                this._resetDots();
                this._displayProperIndicator();
            }]);
        }

        this._dotsContainer.add_child(this._focusedDots);
    },

    _resetDots: function() {
        let position = Me.settings.get_string('dot-position');
        let isHorizontalDots = position == DOT_POSITION.TOP || position == DOT_POSITION.BOTTOM;

        [this._focusedDots, this._unfocusedDots].forEach(d => {
            d._tweeningToSize = null;
            d.set_size(-1, -1);
            d.x_expand = d.y_expand = false;

            d[isHorizontalDots ? 'width' : 'height'] = 1;
            d[(isHorizontalDots ? 'y' : 'x') + '_expand'] = true;
        });
    },

    _settingsChangeRefresh: function() {
        if (this._isGroupApps) {
            this._updateWindows();
            this._resetDots();
            this._focusedDots.queue_repaint();
            this._unfocusedDots.queue_repaint();
        }

        this._displayProperIndicator(true);
    },

    _updateWindowTitleStyle: function() {
        if (this._windowTitle) {
            let useFixedWidth = Me.settings.get_boolean('group-apps-use-fixed-width');
            let maxLabelWidth = Me.settings.get_int('group-apps-label-max-width') * 
                                St.ThemeContext.get_for_stage(global.stage).scale_factor;
            let fontWeight = Me.settings.get_string('group-apps-label-font-weight');
            
            this._windowTitle[(maxLabelWidth > 0 ? 'show' : 'hide')]();

            this._windowTitle.clutter_text.natural_width = useFixedWidth ? maxLabelWidth : 0;
            this._windowTitle.clutter_text.natural_width_set = useFixedWidth;
            this._windowTitle.set_style('font-size: ' + Me.settings.get_int('group-apps-label-font-size') + 'px;' +
                                        'font-weight: ' + fontWeight + ';' +
                                        (useFixedWidth ? '' : 'max-width: ' + maxLabelWidth + 'px;') + 
                                        'color: ' + Me.settings.get_string('group-apps-label-font-color'));
        }
    },

    _updateWindowTitle: function() {
        if (this._windowTitle.text != this.window.title) {
            this._windowTitle.text = (this.window.title ? this.window.title : this.app.get_name()).replace(/\r?\n|\r/g, '').trim();
            
            if (this._focusedDots) {
                this._displayProperIndicator();
            }
        }
    },

    _setIconStyle: function(isFocused) {
        let inlineStyle = 'margin: 0;';

        if(Me.settings.get_boolean('focus-highlight') && 
           this._checkIfFocusedApp() && !this.isLauncher &&  
           (!this.window || isFocused) && !this._isThemeProvidingIndicator() && this._checkIfMonitorHasFocus()) {
            let focusedDotStyle = Me.settings.get_string('dot-style-focused');
            let isWide = this._isWideDotStyle(focusedDotStyle);
            let pos = Me.settings.get_string('dot-position');
            let highlightMargin = isWide ? Me.settings.get_int('dot-size') : 0;

            if(!this.window) {
                let containerWidth = this._dtpIconContainer.get_width() / St.ThemeContext.get_for_stage(global.stage).scale_factor;
                let backgroundSize = containerWidth + "px " + 
                                     (containerWidth - (pos == DOT_POSITION.BOTTOM ? highlightMargin : 0)) + "px;";

                if (focusedDotStyle == DOT_STYLE.CILIORA || focusedDotStyle == DOT_STYLE.SEGMENTED)
                    highlightMargin += 1;

                if (this._nWindows > 1 && focusedDotStyle == DOT_STYLE.METRO) {
                    let bgSvg = '/img/highlight_stacked_bg';

                    if (pos == DOT_POSITION.LEFT || pos == DOT_POSITION.RIGHT) {
                        bgSvg += (Panel.checkIfVertical() ? '_2' : '_3');
                    }

                    inlineStyle += "background-image: url('" + Me.path + bgSvg + ".svg');" + 
                                   "background-position: 0 " + (pos == DOT_POSITION.TOP ? highlightMargin : 0) + "px;" +
                                   "background-size: " + backgroundSize;
                }
            }

            let highlightColor = this._getFocusHighlightColor();
            inlineStyle += "background-color: " + cssHexTocssRgba(highlightColor, Me.settings.get_int('focus-highlight-opacity') * 0.01);
        }
        
        if(this._dotsContainer.get_style() != inlineStyle && this._dotsContainer.mapped) {
            if (!this._isGroupApps) {
                //when the apps are ungrouped, set the style synchronously so the icons don't jump around on taskbar redraw
                this._dotsContainer.set_style(inlineStyle);
            } else if (!this._timeoutsHandler.getId(T1)) {
                //graphical glitches if i dont set this on a timeout
                this._timeoutsHandler.add([T1, 0, () => this._dotsContainer.set_style(inlineStyle)]);
            }
        }
    },

    _checkIfFocusedApp: function() {
        return tracker.focus_app == this.app;
    },

    _checkIfMonitorHasFocus: function() {
        return global.display.focus_window && 
               (!Me.settings.get_boolean('multi-monitors') || // only check same monitor index if multi window is enabled.
                !Me.settings.get_boolean('isolate-monitors') || 
                global.display.focus_window.get_monitor() === this.dtpPanel.monitor.index);
    },

    _setAppIconPadding: function() {
        let padding = getIconPadding();
        let margin = Me.settings.get_int('appicon-margin');
        
        this.actor.set_style('padding:' + (Panel.checkIfVertical() ? margin + 'px 0' : '0 ' + margin + 'px;'));
        this._iconContainer.set_style('padding: ' + padding + 'px;');
    },

    popupMenu: function() {
        this._removeMenuTimeout();
        this.actor.fake_release();
        
        if (this._draggable) { 
            this._draggable.fakeRelease();
        }

        if (!this._menu) {
            this._menu = new taskbarSecondaryMenu(this);
            this._menu.connect('activate-window', Lang.bind(this, function (menu, window) {
                this.activateWindow(window, Me.settings);
            }));
            this._menu.connect('open-state-changed', Lang.bind(this, function (menu, isPoppedUp) {
                if (!isPoppedUp)
                    this._onMenuPoppedDown();
            }));
            let id = Main.overview.connect('hiding', Lang.bind(this, function () { this._menu.close(); }));
            this._menu.actor.connect('destroy', function() {
                Main.overview.disconnect(id);
            });

            this._menuManager.addMenu(this._menu);
        }

        this.emit('menu-state-changed', true);

        this._previewMenu.close(true);

        this.actor.set_hover(true);
        this._menu.actor.add_style_class_name('dashtopanelSecondaryMenu');
        this._menu.popup();
        this._menuManager.ignoreRelease();
        this.emit('sync-tooltip');

        return false;
    },

    _onFocusAppChanged: function(windowTracker) {
        this._displayProperIndicator(true);
    },

    _onOverviewWindowDragEnd: function(windowTracker) {
        this._timeoutsHandler.add([T4, 0, () => this._displayProperIndicator()]);
    },

    _onSwitchWorkspace: function(windowTracker) {
        if (this._isGroupApps) {
            this._timeoutsHandler.add([T5, 0, () => this._displayProperIndicator(true)]);
        } else {
            this._displayProperIndicator();
        }
    },

    _displayProperIndicator: function (force) {
        let isFocused = this._isFocusedWindow();
        let position = Me.settings.get_string('dot-position');
        let isHorizontalDots = position == DOT_POSITION.TOP || position == DOT_POSITION.BOTTOM;

        this._setIconStyle(isFocused);

        if(!this._isGroupApps) {
            if (this.window && (Me.settings.get_boolean('group-apps-underline-unfocused') || isFocused)) {
                let align = Clutter.ActorAlign[position == DOT_POSITION.TOP || position == DOT_POSITION.LEFT ? 'START' : 'END'];
                
                this._focusedDots.set_size(0, 0);
                this._focusedDots[isHorizontalDots ? 'height' : 'width'] = this._getRunningIndicatorSize();

                this._focusedDots.y_align = this._focusedDots.x_align = Clutter.ActorAlign.FILL;
                this._focusedDots[(isHorizontalDots ? 'y' : 'x') + '_align'] = align;
                this._focusedDots.background_color = this._getRunningIndicatorColor(isFocused);
                this._focusedDots.show();
            } else if (this._focusedDots.visible) {
                this._focusedDots.hide();
            }
        } else {
            let sizeProp = isHorizontalDots ? 'width' : 'height';
            let containerSize = this._container[sizeProp];
            let focusedDotStyle = Me.settings.get_string('dot-style-focused');
            let unfocusedDotStyle = Me.settings.get_string('dot-style-unfocused');
            let focusedIsWide = this._isWideDotStyle(focusedDotStyle);
            let unfocusedIsWide = this._isWideDotStyle(unfocusedDotStyle);
    
            let newFocusedDotsSize = 0;
            let newFocusedDotsOpacity = 0;
            let newUnfocusedDotsSize = 0;
            let newUnfocusedDotsOpacity = 0;
            
            isFocused = this._checkIfFocusedApp() && this._checkIfMonitorHasFocus();

            this._timeoutsHandler.add([T6, 0, () => {
                if (!this._destroyed) {
                    if(isFocused) 
                        this.actor.add_style_class_name('focused');
                    else
                        this.actor.remove_style_class_name('focused');
                }
            }]);

            if(focusedIsWide) {
                newFocusedDotsSize = (isFocused && this._nWindows > 0) ? containerSize : 0;
                newFocusedDotsOpacity = 255;
            } else {
                newFocusedDotsSize = containerSize;
                newFocusedDotsOpacity = (isFocused && this._nWindows > 0) ? 255 : 0;
            }
    
            if(unfocusedIsWide) {
                newUnfocusedDotsSize = (!isFocused && this._nWindows > 0) ? containerSize : 0;
                newUnfocusedDotsOpacity = 255;
            } else {
                newUnfocusedDotsSize = containerSize;
                newUnfocusedDotsOpacity = (!isFocused && this._nWindows > 0) ? 255 : 0;
            }
    
            // Only animate if...
            // animation is enabled in settings
            // AND (going from a wide style to a narrow style indicator or vice-versa
            // OR going from an open app to a closed app or vice versa)
            if(Me.settings.get_boolean('animate-app-switch') &&
               ((focusedIsWide != unfocusedIsWide) ||
                (this._focusedDots[sizeProp] != newUnfocusedDotsSize || this._unfocusedDots[sizeProp] != newFocusedDotsSize))) {
                this._animateDotDisplay(this._focusedDots, newFocusedDotsSize, this._unfocusedDots, newUnfocusedDotsOpacity, force, sizeProp);
                this._animateDotDisplay(this._unfocusedDots, newUnfocusedDotsSize, this._focusedDots, newFocusedDotsOpacity, force, sizeProp);
            } else {
                this._focusedDots.opacity = newFocusedDotsOpacity;
                this._unfocusedDots.opacity = newUnfocusedDotsOpacity;
                this._focusedDots[sizeProp] = newFocusedDotsSize;
                this._unfocusedDots[sizeProp] = newUnfocusedDotsSize;
            }
        }
    },

    _animateDotDisplay: function (dots, newSize, otherDots, newOtherOpacity, force, sizeProp) {
        if((dots[sizeProp] != newSize && dots._tweeningToSize !== newSize) || force) {
            let tweenOpts = { 
                time: Taskbar.DASH_ANIMATION_TIME,
                transition: 'easeInOutCubic',
                onStart: Lang.bind(this, function() { 
                    if(newOtherOpacity == 0)
                        otherDots.opacity = newOtherOpacity;
                }),
                onComplete: Lang.bind(this, function() { 
                    if(newOtherOpacity > 0)
                        otherDots.opacity = newOtherOpacity;
                    dots._tweeningToSize = null;
                })
            };

            tweenOpts[sizeProp] = newSize;
            dots._tweeningToSize = newSize;

            Utils.animate(dots, tweenOpts);
        }
    },

    _isFocusedWindow: function() {
        let focusedWindow = global.display.focus_window;
        
        while (focusedWindow) {
            if (focusedWindow == this.window) {
                return true;
            }

            focusedWindow = focusedWindow.get_transient_for();
        }

        return false;
    },

    _isWideDotStyle: function(dotStyle) {
        return dotStyle == DOT_STYLE.SEGMENTED || 
            dotStyle == DOT_STYLE.CILIORA || 
            dotStyle == DOT_STYLE.METRO || 
            dotStyle == DOT_STYLE.SOLID;
    },

    _isThemeProvidingIndicator: function () {
        // This is an attempt to determine if the theme is providing their own
        // running indicator by way of a border image on the icon, for example in
        // the theme Ciliora
        return (this.icon.actor.get_stage() && 
                this.icon.actor.get_theme_node().get_border_image());
    },

    activate: function(button, handleAsGrouped) {
        let event = Clutter.get_current_event();
        let modifiers = event ? event.get_state() : 0;

        // Only consider SHIFT and CONTROL as modifiers (exclude SUPER, CAPS-LOCK, etc.)
        modifiers = modifiers & (Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK);

        // We don't change the CTRL-click behaviour: in such case we just chain
        // up the parent method and return.
        if (modifiers & Clutter.ModifierType.CONTROL_MASK) {
                // Keep default behaviour: launch new window
                // By calling the parent method I make it compatible
                // with other extensions tweaking ctrl + click
                this.callParent('activate', button);
                return;
        }

        // We check what type of click we have and if the modifier SHIFT is
        // being used. We then define what buttonAction should be for this
        // event.
        let buttonAction = 0;
        if (button && button == 2 ) {
            if (modifiers & Clutter.ModifierType.SHIFT_MASK)
                buttonAction = Me.settings.get_string('shift-middle-click-action');
            else
                buttonAction = Me.settings.get_string('middle-click-action');
        }
        else if (button && button == 1) {
            if (modifiers & Clutter.ModifierType.SHIFT_MASK)
                buttonAction = Me.settings.get_string('shift-click-action');
            else
                buttonAction = Me.settings.get_string('click-action');
        }

        let appCount = this.getAppIconInterestingWindows().length;
        let previewedAppIcon = this._previewMenu.getCurrentAppIcon();
        this._previewMenu.close(Me.settings.get_boolean('window-preview-hide-immediate-click'));

        // We check if the app is running, and that the # of windows is > 0 in
        // case we use workspace isolation,
        let appIsRunning = this.app.state == Shell.AppState.RUNNING && appCount > 0;

        // We customize the action only when the application is already running
        if (appIsRunning && !this.isLauncher) {
            if (this.window && !handleAsGrouped) {
                //ungrouped applications behaviors
                switch (buttonAction) {
                    case 'RAISE': case 'CYCLE': case 'CYCLE-MIN': case 'MINIMIZE': case 'TOGGLE-SHOWPREVIEW':
                        if (!Main.overview._shown && 
                            (buttonAction == 'MINIMIZE' || buttonAction == 'TOGGLE-SHOWPREVIEW' || buttonAction == 'CYCLE-MIN') && 
                            (this._isFocusedWindow() || (buttonAction == 'MINIMIZE' && (button == 2 || modifiers & Clutter.ModifierType.SHIFT_MASK)))) {
                                this.window.minimize();
                        } else {
                            Main.activateWindow(this.window);
                        }
                        
                        break;
        
                    case "LAUNCH":
                        this._launchNewInstance();
                        break;

                    case "QUIT":
                        this.window.delete(global.get_current_time());
                        break; 
                }
            } else {
                //grouped application behaviors
                let monitor = this.dtpPanel.monitor;
                let appHasFocus = this._checkIfFocusedApp() && this._checkIfMonitorHasFocus();

                switch (buttonAction) {
                    case "RAISE":
                        activateAllWindows(this.app, monitor);
                        break;
        
                    case "LAUNCH":
                        this._launchNewInstance();
                        break;
        
                    case "MINIMIZE":
                        // In overview just activate the app, unless the acion is explicitely
                        // requested with a keyboard modifier
                        if (!Main.overview._shown || modifiers){
                            // If we have button=2 or a modifier, allow minimization even if
                            // the app is not focused
                            if (appHasFocus || button == 2 || modifiers & Clutter.ModifierType.SHIFT_MASK) {
                                // minimize all windows on double click and always in the case of primary click without
                                // additional modifiers
                                let all_windows = (button == 1 && ! modifiers) || event.get_click_count() > 1;
                                minimizeWindow(this.app, all_windows, monitor);
                            }
                            else
                                activateAllWindows(this.app, monitor);
                        }
                        else
                            this.app.activate();
                        break;
        
                    case "CYCLE":
                        if (!Main.overview._shown){
                            if (appHasFocus) 
                                cycleThroughWindows(this.app, false, false, monitor);
                            else {
                                activateFirstWindow(this.app, monitor);
                            }
                        }
                        else
                            this.app.activate();
                        break;
                    case "CYCLE-MIN":
                        if (!Main.overview._shown){
                            if (appHasFocus || (recentlyClickedApp == this.app && recentlyClickedAppWindows[recentlyClickedAppIndex % recentlyClickedAppWindows.length] == "MINIMIZE")) 
                                cycleThroughWindows(this.app, false, true, monitor);
                            else {
                                activateFirstWindow(this.app, monitor);
                            }
                        }
                        else
                            this.app.activate();
                        break;
                    case "TOGGLE-SHOWPREVIEW":
                        if (!Main.overview._shown) {
                            if (appCount == 1) {
                                if (appHasFocus)
                                    minimizeWindow(this.app, false, monitor);
                                else
                                    activateFirstWindow(this.app, monitor);
                            } else {
                                if (event.get_click_count() > 1) {
                                    // minimize all windows if double clicked
                                    minimizeWindow(this.app, true, monitor);
                                } else if (previewedAppIcon != this) {
                                    this._previewMenu.open(this);
                                }
    
                                this.emit('sync-tooltip');
                            } 
                        }
                        else
                            this.app.activate();
                        break;
        
                    case "QUIT":
                        closeAllWindows(this.app, monitor);
                        break;
                }
            }
        }
        else {
            this._launchNewInstance();
        }

        Main.overview.hide();
    },

    _launchNewInstance: function() {
        if (this.app.can_open_new_window()) {
            let appActions = this.app.get_app_info().list_actions();
            let newWindowIndex = appActions.indexOf('new-window');

            if(Me.settings.get_boolean('animate-window-launch')) {
                this.animateLaunch();
            }

            if (newWindowIndex < 0) {
                this.app.open_new_window(-1);
            } else {
                this.app.launch_action(appActions[newWindowIndex], global.get_current_time(), -1);
            }
        } else {
            let windows = this.window ? [this.window] : this.app.get_windows();

            if (windows.length) {
                Main.activateWindow(windows[0]);
            } else {
                this.app.activate();
            }
        }
    },

    _updateWindows: function() {
        let windows = [this.window];
        
        if (!this.window) {
            windows = this.getAppIconInterestingWindows();
        
            this._nWindows = windows.length;
    
            for (let i = 1; i <= MAX_INDICATORS; i++){
                let className = 'running'+i;
                if(i != this._nWindows)
                    this.actor.remove_style_class_name(className);
                else
                    this.actor.add_style_class_name(className);
            }
        }

        this._previewMenu.update(this, windows);
    },

    _getRunningIndicatorCount: function() {
        return Math.min(this._nWindows, MAX_INDICATORS);
    },

    _getRunningIndicatorSize: function() {
        return Me.settings.get_int('dot-size') * St.ThemeContext.get_for_stage(global.stage).scale_factor;
    },

    _getRunningIndicatorColor: function(isFocused) {
        let color;
        const fallbackColor = new Clutter.Color({ red: 82, green: 148, blue: 226, alpha: 255 });

        if (Me.settings.get_boolean('dot-color-dominant')) {
            let dce = new Utils.DominantColorExtractor(this.app);
            let palette = dce._getColorPalette();
            if (palette) {
                color = Clutter.color_from_string(palette.original)[1];
            } else { // unable to determine color, fall back to theme
                let themeNode = this._dot.get_theme_node();
                color = themeNode.get_background_color();

                // theme didn't provide one, use a default
                if(color.alpha == 0) color = fallbackColor;
            }
        } else if(Me.settings.get_boolean('dot-color-override')) {
            let dotColorSettingPrefix = 'dot-color-';
            
            if(!isFocused && Me.settings.get_boolean('dot-color-unfocused-different'))
                dotColorSettingPrefix = 'dot-color-unfocused-';

            color = Clutter.color_from_string(Me.settings.get_string(dotColorSettingPrefix + (this._getRunningIndicatorCount() || 1) ))[1];
        } else {
            // Re-use the style - background color, and border width and color -
            // of the default dot
            let themeNode = this._dot.get_theme_node();
            color = themeNode.get_background_color();

            // theme didn't provide one, use a default
            if(color.alpha == 0) color = fallbackColor;
        }

        return color;
    },

    _getFocusHighlightColor: function() {
        if (Me.settings.get_boolean('focus-highlight-dominant')) {
            let dce = new Utils.DominantColorExtractor(this.app);
            let palette = dce._getColorPalette();
            if (palette) return palette.original;
        }
        return Me.settings.get_string('focus-highlight-color');
    },

    _drawRunningIndicator: function(area, type, isFocused) {
        let n = this._getRunningIndicatorCount();

        if (!n) {
            return;
        }

        let position = Me.settings.get_string('dot-position');
        let isHorizontalDots = position == DOT_POSITION.TOP || position == DOT_POSITION.BOTTOM;
        let bodyColor = this._getRunningIndicatorColor(isFocused);
        let [areaWidth, areaHeight] = area.get_surface_size();
        let cr = area.get_context();
        let size = this._getRunningIndicatorSize();

        let areaSize = areaWidth;
        let startX = 0;
        let startY = 0;

        if (isHorizontalDots) {
            if (position == DOT_POSITION.BOTTOM) {
                startY = areaHeight - size;
            }
        } else {
            areaSize = areaHeight;

            if (position == DOT_POSITION.RIGHT) {
                startX = areaWidth - size;
            }
        }

        if (type == DOT_STYLE.SOLID || type == DOT_STYLE.METRO) {
            if (type == DOT_STYLE.SOLID || n <= 1) {
                cr.translate(startX, startY);
                Clutter.cairo_set_source_color(cr, bodyColor);
                cr.newSubPath();
                cr.rectangle.apply(cr, [0, 0].concat(isHorizontalDots ? [areaSize, size] : [size, areaSize]));
                cr.fill();
            } else {
                let blackenedLength = (1 / 48) * areaSize; // need to scale with the SVG for the stacked highlight
                let darkenedLength = isFocused ? (2 / 48) * areaSize : (10 / 48) * areaSize;
                let blackenedColor = bodyColor.shade(.3);
                let darkenedColor = bodyColor.shade(.7);
                let solidDarkLength = areaSize - darkenedLength;
                let solidLength = solidDarkLength - blackenedLength;

                cr.translate(startX, startY);

                Clutter.cairo_set_source_color(cr, bodyColor);
                cr.newSubPath();
                cr.rectangle.apply(cr, [0, 0].concat(isHorizontalDots ? [solidLength, size] : [size, solidLength]));
                cr.fill();
                Clutter.cairo_set_source_color(cr, blackenedColor);
                cr.newSubPath();
                cr.rectangle.apply(cr, isHorizontalDots ? [solidLength, 0, 1, size] : [0, solidLength, size, 1]);
                cr.fill();
                Clutter.cairo_set_source_color(cr, darkenedColor);
                cr.newSubPath();
                cr.rectangle.apply(cr, isHorizontalDots ? [solidDarkLength, 0, darkenedLength, size] : [0, solidDarkLength, size, darkenedLength]);
                cr.fill();
            }
        } else {
            let spacing = Math.ceil(areaSize / 18); // separation between the indicators
            let length;
            let dist;
            let indicatorSize;
            let translate;
            let preDraw = () => {};
            let draw;
            let drawDash = (i, dashLength) => {
                dist = i * dashLength + i * spacing;
                cr.rectangle.apply(cr, (isHorizontalDots ? [dist, 0, dashLength, size] : [0, dist, size, dashLength]));
            };
        
            switch (type) {
                case DOT_STYLE.CILIORA:
                    spacing = size;
                    length = areaSize - (size * (n - 1)) - (spacing * (n - 1));
                    translate = () => cr.translate(startX, startY);
                    preDraw = () => {
                        cr.newSubPath();
                        cr.rectangle.apply(cr, [0, 0].concat(isHorizontalDots ? [length, size] : [size, length]));
                    };
                    draw = i => {
                        dist = length + (i * spacing) + ((i - 1) * size);
                        cr.rectangle.apply(cr, (isHorizontalDots ? [dist, 0] : [0, dist]).concat([size, size]));
                    };
                    break;
                case DOT_STYLE.DOTS:
                    let radius = size / 2;

                    translate = () => {
                        indicatorSize = Math.floor((areaSize - n * size - (n - 1) * spacing) / 2);
                        cr.translate.apply(cr, isHorizontalDots ? [indicatorSize, startY] : [startX, indicatorSize]);
                    }
                    draw = i => {
                        dist = (2 * i + 1) * radius + i * spacing;
                        cr.arc.apply(cr, (isHorizontalDots ? [dist, radius] : [radius, dist]).concat([radius, 0, 2 * Math.PI]));
                    };
                    break;
                case DOT_STYLE.SQUARES:
                    translate = () => {
                        indicatorSize = Math.floor((areaSize - n * size - (n - 1) * spacing) / 2);
                        cr.translate.apply(cr, isHorizontalDots ? [indicatorSize, startY] : [startX, indicatorSize]);
                    }
                    draw = i => {
                        dist = i * size + i * spacing;
                        cr.rectangle.apply(cr, (isHorizontalDots ? [dist, 0] : [0, dist]).concat([size, size]));
                    };
                    break;
                case DOT_STYLE.DASHES:
                    length = Math.floor(areaSize / 4) - spacing;
                    translate = () => {
                        indicatorSize = Math.floor((areaSize - n * length - (n - 1) * spacing) / 2);
                        cr.translate.apply(cr, isHorizontalDots ? [indicatorSize, startY] : [startX, indicatorSize]);
                    }
                    draw = i => drawDash(i, length);
                    break;
                case DOT_STYLE.SEGMENTED:
                    length = Math.ceil((areaSize - ((n - 1) * spacing)) / n);
                    translate = () => cr.translate(startX, startY);
                    draw = i => drawDash(i, length);
                    break;
            }

            translate();

            Clutter.cairo_set_source_color(cr, bodyColor);
            preDraw();
            for (let i = 0; i < n; i++) {
                cr.newSubPath();
                draw(i);
            }
            cr.fill();
        }
        
        cr.$dispose();
    },

    _numberOverlay: function() {
        // Add label for a Hot-Key visual aid
        this._numberOverlayLabel = new St.Label({ style_class: 'badge' });
        this._numberOverlayBin = new St.Bin({
            child: this._numberOverlayLabel, y: 2
        });
        this._numberOverlayLabel.add_style_class_name('number-overlay');
        this._numberOverlayOrder = -1;
        this._numberOverlayBin.hide();

        this._dtpIconContainer.add_child(this._numberOverlayBin);
    },

    updateHotkeyNumberOverlay: function() {
        this.updateNumberOverlay(this._numberOverlayBin, true);
    },

    updateNumberOverlay: function(bin, fixedSize) {
        // We apply an overall scale factor that might come from a HiDPI monitor.
        // Clutter dimensions are in physical pixels, but CSS measures are in logical
        // pixels, so make sure to consider the scale.
        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        // Set the font size to something smaller than the whole icon so it is
        // still visible. The border radius is large to make the shape circular
        let [minWidth, natWidth] = this._dtpIconContainer.get_preferred_width(-1);
        let font_size =  Math.round(Math.max(12, 0.3 * natWidth) / scaleFactor);
        let size = Math.round(font_size * 1.3);
        let label = bin.child;
        let style = 'font-size: ' + font_size + 'px;' +
                    'border-radius: ' + this.icon.iconSize + 'px;' +
                    'height: ' + size +'px;';

        if (fixedSize || label.get_text().length == 1) {
            style += 'width: ' + size + 'px;';
        } else {
            style += 'padding: 0 2px;';
        }

        bin.x = fixedSize ? natWidth - size - 2 : 2;
        label.set_style(style);
    },

    setNumberOverlay: function(number) {
        this._numberOverlayOrder = number;
        this._numberOverlayLabel.set_text(number.toString());
    },

    toggleNumberOverlay: function(activate) {
        if (activate && this._numberOverlayOrder > -1)
           this._numberOverlayBin.show();
        else
           this._numberOverlayBin.hide();
    },

    handleDragOver: function(source, actor, x, y, time) {
        if (source == Main.xdndHandler) {
            this._previewMenu.close(true);
        }
            
        return DND.DragMotionResult.CONTINUE;
    },

    // Disable all DnD methods on gnome-shell 3.34
    _onDragBegin: function() {},
    _onDragEnd: function() {},
    acceptDrop: function() { return false; },

    getAppIconInterestingWindows: function(isolateMonitors) {
        return getInterestingWindows(this.app, this.dtpPanel.monitor, isolateMonitors);
    }

});
taskbarAppIcon.prototype.scaleAndFade = taskbarAppIcon.prototype.undoScaleAndFade = () => {};

function getIconContainerStyle() {
    let style = 'padding: ';
    let isVertical = Panel.checkIfVertical();

    if (Me.settings.get_boolean('group-apps')) {
        style += (isVertical ? '0;' : '0 ' + DEFAULT_PADDING_SIZE + 'px;');
    } else {
        style += (isVertical ? '' : '0 ') + DEFAULT_PADDING_SIZE + 'px;';
    }

    return style;
}

function minimizeWindow(app, param, monitor){
    // Param true make all app windows minimize
    let windows = getInterestingWindows(app, monitor);
    let current_workspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace();
    for (let i = 0; i < windows.length; i++) {
        let w = windows[i];
        if (w.get_workspace() == current_workspace && w.showing_on_its_workspace()){
            w.minimize();
            // Just minimize one window. By specification it should be the
            // focused window on the current workspace.
            if(!param)
                break;
        }
    }
}

/*
 * By default only non minimized windows are activated.
 * This activates all windows in the current workspace.
 */
function activateAllWindows(app, monitor){

    // First activate first window so workspace is switched if needed,
    // then activate all other app windows in the current workspace.
    let windows = getInterestingWindows(app, monitor);
    let w = windows[0];
    Main.activateWindow(w);
    let activeWorkspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace_index();

    if (windows.length <= 0)
        return;

    for (let i = windows.length - 1; i >= 0; i--){
        if (windows[i].get_workspace().index() == activeWorkspace){
            Main.activateWindow(windows[i]);
        }
    }
}

function activateFirstWindow(app, monitor){

    let windows = getInterestingWindows(app, monitor);
    Main.activateWindow(windows[0]);
}

function cycleThroughWindows(app, reversed, shouldMinimize, monitor) {
    // Store for a little amount of time last clicked app and its windows
    // since the order changes upon window interaction
    let MEMORY_TIME=3000;

    let app_windows = getInterestingWindows(app, monitor);

    if(shouldMinimize)
        app_windows.push("MINIMIZE");

    if (recentlyClickedAppLoopId > 0)
        Mainloop.source_remove(recentlyClickedAppLoopId);
        
    recentlyClickedAppLoopId = Mainloop.timeout_add(MEMORY_TIME, resetRecentlyClickedApp);

    // If there isn't already a list of windows for the current app,
    // or the stored list is outdated, use the current windows list.
    if (!recentlyClickedApp ||
        recentlyClickedApp.get_id() != app.get_id() ||
        recentlyClickedAppWindows.length != app_windows.length ||
        recentlyClickedAppMonitorIndex != monitor.index) {
        recentlyClickedApp = app;
        recentlyClickedAppWindows = app_windows;
        recentlyClickedAppIndex = 0;
        recentlyClickedAppMonitorIndex = monitor.index;
    }

    if (reversed) {
        recentlyClickedAppIndex--;
        if (recentlyClickedAppIndex < 0) recentlyClickedAppIndex = recentlyClickedAppWindows.length - 1;
    } else {
        recentlyClickedAppIndex++;
    }
    let index = recentlyClickedAppIndex % recentlyClickedAppWindows.length;
    
    if(recentlyClickedAppWindows[index] === "MINIMIZE")
        minimizeWindow(app, true, monitor);
    else
        Main.activateWindow(recentlyClickedAppWindows[index]);
}

function resetRecentlyClickedApp() {
    if (recentlyClickedAppLoopId > 0)
        Mainloop.source_remove(recentlyClickedAppLoopId);

    recentlyClickedAppLoopId=0;
    recentlyClickedApp =null;
    recentlyClickedAppWindows = null;
    recentlyClickedAppIndex = 0;
    recentlyClickedAppMonitorIndex = null;

    return false;
}

function closeAllWindows(app, monitor) {
    let windows = getInterestingWindows(app, monitor);
    for (let i = 0; i < windows.length; i++)
        windows[i].delete(global.get_current_time());
}

// Filter out unnecessary windows, for instance
// nautilus desktop window.
function getInterestingWindows(app, monitor, isolateMonitors) {
    let windows = app.get_windows().filter(function(w) {
        return !w.skip_taskbar;
    });

    // When using workspace or monitor isolation, we filter out windows
    // that are not in the current workspace or on the same monitor as the appicon
    if (Me.settings.get_boolean('isolate-workspaces'))
        windows = windows.filter(function(w) {
            return w.get_workspace().index() == Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace_index();
        });

    if (monitor && Me.settings.get_boolean('multi-monitors') && (isolateMonitors || Me.settings.get_boolean('isolate-monitors'))) {
        windows = windows.filter(function(w) {
            return w.get_monitor() == monitor.index;
        });
    }
    
    return windows;
}

function cssHexTocssRgba(cssHex, opacity) {
    var bigint = parseInt(cssHex.slice(1), 16);
    var r = (bigint >> 16) & 255;
    var g = (bigint >> 8) & 255;
    var b = bigint & 255;

    return 'rgba(' + [r, g, b].join(',') + ',' + opacity + ')';
}

function getIconPadding() {
    let panelSize = Me.settings.get_int('panel-size');
    let padding = Me.settings.get_int('appicon-padding');
    let availSize = panelSize - Taskbar.MIN_ICON_SIZE - panelSize % 2;

    if (padding * 2 > availSize) {
        padding = availSize * .5;
    }

    return padding;
}

/**
 * Extend AppIconMenu
 *
 * - set popup arrow side based on taskbar orientation
 * - Add close windows option based on quitfromdash extension
 *   (https://github.com/deuill/shell-extension-quitfromdash)
 */

var taskbarSecondaryMenu = Utils.defineClass({
    Name: 'DashToPanel.SecondaryMenu',
    Extends: AppDisplay.AppIconMenu,
    ParentConstrParams: [[0]],

    _init: function(source) {
        // Damm it, there has to be a proper way of doing this...
        // As I can't call the parent parent constructor (?) passing the side
        // parameter, I overwite what I need later
        this.callParent('_init', source);

        let side = Panel.getPosition();
        // Change the initialized side where required.
        this._arrowSide = side;
        this._boxPointer._arrowSide = side;
        this._boxPointer._userArrowSide = side;
    },

    // helper function for the quit windows abilities
    _closeWindowInstance: function(metaWindow) {
        metaWindow.delete(global.get_current_time());
    },

    _dtpRedisplay: function(parentFunc) {
        this.callParent(parentFunc);

        // Remove "Show Details" menu item
        if(!Me.settings.get_boolean('secondarymenu-contains-showdetails')) {
            let existingMenuItems = this._getMenuItems();
            for(let idx in existingMenuItems) {
                if(existingMenuItems[idx].actor.label_actor.text == _("Show Details")) {
                    this.box.remove_child(existingMenuItems[idx].actor);
                    if(existingMenuItems[idx-1] instanceof PopupMenu.PopupSeparatorMenuItem)
                        this.box.remove_child(existingMenuItems[idx-1].actor);
                    break;
                }
            }
        }

        // prepend items from the appMenu (for native gnome apps)
        if(Me.settings.get_boolean('secondarymenu-contains-appmenu')) {
            let appMenu = this._source.app.menu;
            if(appMenu) {
                let remoteMenu = new imports.ui.remoteMenu.RemoteMenu(this._source.actor, this._source.app.menu, this._source.app.action_group);
                let appMenuItems = remoteMenu._getMenuItems();
                for(var i = 0, l = appMenuItems.length || 0; i < l; ++i) {
                    let menuItem = appMenuItems[i];
                    let labelText = menuItem.actor.label_actor.text;
                    if(labelText == _("New Window") || labelText == _("Quit"))
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
                        this.addMenuItem(newSubMenuMenuItem, i);
                    } else 
                        this.addMenuItem(menuItem, i);
                }
                
                if(i > 0) {
                    let separator = new PopupMenu.PopupSeparatorMenuItem();
                    this.addMenuItem(separator, i);
                }
            }
        }

        // quit menu
        let app = this._source.app;
        let window = this._source.window;
        let count = window ? 1 : getInterestingWindows(app).length;
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
                let windows = window ? [window] : app.get_windows();
                for (i = 0; i < windows.length; i++) {
                    this._closeWindowInstance(windows[i])
                }
            }));
        }
    }
});
Signals.addSignalMethods(taskbarSecondaryMenu.prototype);
adjustMenuRedisplay(taskbarSecondaryMenu.prototype);

/**
 * This function is used for extendDashItemContainer
 */
function ItemShowLabel()  {
    if (!this._labelText)
        return;

    this.label.set_text(this._labelText);
    this.label.opacity = 0;
    this.label.show();

    let [stageX, stageY] = this.get_transformed_position();
    let node = this.label.get_theme_node();

    let itemWidth  = this.allocation.x2 - this.allocation.x1;
    let itemHeight = this.allocation.y2 - this.allocation.y1;

    let labelWidth = this.label.get_width();
    let labelHeight = this.label.get_height();

    let position = Panel.getPosition();
    let labelOffset = node.get_length('-x-offset');

    let xOffset = Math.floor((itemWidth - labelWidth) / 2);
    let x = stageX + xOffset
    let y = stageY + (itemHeight - labelHeight) * .5;

    switch(position) {
      case St.Side.TOP:
          y = stageY + labelOffset + itemHeight;
          break;
      case St.Side.BOTTOM:
          y = stageY - labelHeight - labelOffset;
          break;
      case St.Side.LEFT:
          x = stageX + labelOffset + itemWidth;
          break;
      case St.Side.RIGHT:
          x = stageX - labelWidth - labelOffset;
          break;
    }

    // keep the label inside the screen border
    // Only needed for the x coordinate.

    // Leave a few pixel gap
    let gap = LABEL_GAP;
    let monitor = Main.layoutManager.findMonitorForActor(this);
    if ( x - monitor.x < gap)
        x += monitor.x - x + labelOffset;
    else if ( x + labelWidth > monitor.x + monitor.width - gap)
        x -= x + labelWidth -( monitor.x + monitor.width) + gap;

    this.label.set_position(Math.round(x), Math.round(y));

    let duration = Dash.DASH_ITEM_LABEL_SHOW_TIME; 
    
    if (duration > 1) {
        duration /= 1000;
    }
        
    Utils.animate(this.label, { 
        opacity: 255,
        time: duration,
        transition: 'easeOutQuad',
    });
};

/**
 * A wrapper class around the ShowAppsIcon class.
 *
 * - Pass settings to the constructor
 * - set label position based on dash orientation (Note, I am reusing most machinery of the appIcon class)
 * - implement a popupMenu based on the AppIcon code (Note, I am reusing most machinery of the appIcon class)
 *
 * I can't subclass the original object because of this: https://bugzilla.gnome.org/show_bug.cgi?id=688973.
 * thus use this pattern where the real showAppsIcon object is encaptulated, and a reference to it will be properly wired upon
 * use of this class in place of the original showAppsButton.
 *
 */
var ShowAppsIconWrapper = Utils.defineClass({
    Name: 'DashToPanel.ShowAppsIconWrapper',

    _init: function() {
        this.realShowAppsIcon = new Dash.ShowAppsIcon();

        Utils.wrapActor(this.realShowAppsIcon);
        Utils.wrapActor(this.realShowAppsIcon.toggleButton);

        /* the variable equivalent to toggleButton has a different name in the appIcon class
        (actor): duplicate reference to easily reuse appIcon methods */
        this.actor = this.realShowAppsIcon.toggleButton;
        this.realShowAppsIcon.show(false);

        // Re-use appIcon methods
        this._removeMenuTimeout = AppDisplay.AppIcon.prototype._removeMenuTimeout;
        this._setPopupTimeout = AppDisplay.AppIcon.prototype._setPopupTimeout;
        this._onKeyboardPopupMenu = AppDisplay.AppIcon.prototype._onKeyboardPopupMenu;

        // No action on clicked (showing of the appsview is controlled elsewhere)
        this._onClicked = Lang.bind(this, function(actor, button) {
            this._removeMenuTimeout();
        });

        this.actor.connect('leave-event', Lang.bind(this, this._onLeaveEvent));
        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        this.actor.connect('touch-event', Lang.bind(this, this._onTouchEvent));
        this.actor.connect('clicked', Lang.bind(this, this._onClicked));
        this.actor.connect('popup-menu', Lang.bind(this, this._onKeyboardPopupMenu));

        this._menu = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
        this._menuTimeoutId = 0;

        Taskbar.extendDashItemContainer(this.realShowAppsIcon);

        let customIconPath = Me.settings.get_string('show-apps-icon-file');

        this.realShowAppsIcon.icon.createIcon = function(size) {
            this._iconActor = new St.Icon({ icon_name: 'view' + (Config.PACKAGE_VERSION < '3.20' ? '' : '-app') + '-grid-symbolic',
                                            icon_size: size,
                                            style_class: 'show-apps-icon',
                                            track_hover: true });

            if (customIconPath) {
                this._iconActor.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(customIconPath) });
            }
            
            return this._iconActor;
        };

        this._changedShowAppsIconId = Me.settings.connect('changed::show-apps-icon-file', () => {
            customIconPath = Me.settings.get_string('show-apps-icon-file');
            this.realShowAppsIcon.icon._createIconTexture(this.realShowAppsIcon.icon.iconSize);
        });

        this._changedAppIconPaddingId = Me.settings.connect('changed::appicon-padding', () => this.setShowAppsPadding());
        this._changedAppIconSidePaddingId = Me.settings.connect('changed::show-apps-icon-side-padding', () => this.setShowAppsPadding());
        
        this.setShowAppsPadding();
    },
    
    _onButtonPress: function(_actor, event) {
        let button = event.get_button();
        if (button == 1) {
            this._setPopupTimeout();
        } else if (button == 3) {
            this.popupMenu();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    },

    _onLeaveEvent: function(_actor, _event) {
        this.actor.fake_release();
        this._removeMenuTimeout();
    },

    _onTouchEvent: function(actor, event) {
        if (event.type() == Clutter.EventType.TOUCH_BEGIN)
            this._setPopupTimeout();

        return Clutter.EVENT_PROPAGATE;
    },

    _onMenuPoppedDown: function() {
        this._menu.sourceActor = this.actor;
        this.actor.sync_hover();
        this.emit('menu-state-changed', false);
    },

    setShowAppsPadding: function() {
        let padding = getIconPadding(); 
        let sidePadding = Me.settings.get_int('show-apps-icon-side-padding');
        let isVertical = Panel.checkIfVertical();

        this.actor.set_style('padding:' + (padding + (isVertical ? sidePadding : 0)) + 'px ' + (padding + (isVertical ? 0 : sidePadding)) + 'px;');
    },

    createMenu: function() {
        if (!this._menu) {
            this._menu = new MyShowAppsIconMenu(this.actor);
            this._menu.connect('open-state-changed', Lang.bind(this, function(menu, isPoppedUp) {
                if (!isPoppedUp)
                    this._onMenuPoppedDown();
            }));
            let id = Main.overview.connect('hiding', Lang.bind(this, function() {
                this._menu.close();
            }));
            this._menu.actor.connect('destroy', function() {
                Main.overview.disconnect(id);
            });
            this._menuManager.addMenu(this._menu);
        }
    },

    popupMenu: function() {
        this._removeMenuTimeout();
        this.actor.fake_release();
        this.createMenu(this.actor);

        //this.emit('menu-state-changed', true);

        this.actor.set_hover(true);
        this._menu.popup();
        this._menuManager.ignoreRelease();
        this.emit('sync-tooltip');

        return false;
    },

    shouldShowTooltip: function() {
        return Me.settings.get_boolean('show-tooltip') && 
               (this.actor.hover && (!this._menu || !this._menu.isOpen));
    },

    destroy: function() {
        Me.settings.disconnect(this._changedShowAppsIconId);
        Me.settings.disconnect(this._changedAppIconSidePaddingId);
        Me.settings.disconnect(this._changedAppIconPaddingId);
    }
});
Signals.addSignalMethods(ShowAppsIconWrapper.prototype);

/**
 * A menu for the showAppsIcon
 */
var MyShowAppsIconMenu = Utils.defineClass({
    Name: 'DashToPanel.ShowAppsIconMenu',
    Extends: taskbarSecondaryMenu,
    ParentConstrParams: [[0]],

    _dtpRedisplay: function() {
        this.removeAll();
        
        // Only add menu entries for commands that exist in path
        function _appendItem(obj, info) {
            if (Utils.checkIfCommandExists(info.cmd[0])) {
                let item = obj._appendMenuItem(_(info.title));

                item.connect('activate', function() {
                    Util.spawn(info.cmd);
                });
                return item;
            }

            return null;
        }
        
        function _appendList(obj, commandList, titleList) {
            if (commandList.length != titleList.length) {
                return;
            }
            
            for (var entry = 0; entry < commandList.length; entry++) {
                _appendItem(obj, {
                    title: titleList[entry],
                    cmd: commandList[entry].split(' ')
                });
            }
        }

        if (this.sourceActor != Main.layoutManager.dummyCursor) {
            _appendItem(this, {
                title: 'Power options',
                cmd: ['gnome-control-center', 'power']
            });

            _appendItem(this, {
                title: 'Event logs',
                cmd: ['gnome-logs']
            });

            _appendItem(this, {
                title: 'System',
                cmd: ['gnome-control-center', 'info-overview']
            });

            _appendItem(this, {
                title: 'Device Management',
                cmd: ['gnome-control-center', 'display']
            });

            _appendItem(this, {
                title: 'Disk Management',
                cmd: ['gnome-disks']
            });

            _appendList(
                this,
                Me.settings.get_strv('show-apps-button-context-menu-commands'),
                Me.settings.get_strv('show-apps-button-context-menu-titles')
            )

            this._appendSeparator();
        }

        _appendItem(this, {
            title: 'Terminal',
            cmd: ['gnome-terminal']
        });

        _appendItem(this, {
            title: 'System monitor',
            cmd: ['gnome-system-monitor']
        });

        _appendItem(this, {
            title: 'Files',
            cmd: ['nautilus']
        });

        _appendItem(this, {
            title: 'Extensions',
            cmd: ['gnome-shell-extension-prefs']
        });

        _appendItem(this, {
            title: 'Settings',
            cmd: ['gnome-control-center', 'wifi']
        });

        _appendList(
            this,
            Me.settings.get_strv('panel-context-menu-commands'),
            Me.settings.get_strv('panel-context-menu-titles')
        )

        this._appendSeparator();

        let lockTaskbarMenuItem = this._appendMenuItem(Me.settings.get_boolean('taskbar-locked') ? _('Unlock taskbar') : _('Lock taskbar'));
        lockTaskbarMenuItem.connect('activate', () => {
            Me.settings.set_boolean('taskbar-locked', !Me.settings.get_boolean('taskbar-locked'));
        });

        let settingsMenuItem = this._appendMenuItem(_('Dash to Panel Settings'));
        settingsMenuItem.connect('activate', function () {
            let command = ["gnome-shell-extension-prefs"];

            if (Config.PACKAGE_VERSION > '3.36') {
                command = ["gnome-extensions", "prefs"];
            }

            Util.spawn(command.concat([Me.metadata.uuid]));
        });

        if(this._source._dtpPanel) {
            this._appendSeparator();
            let item = this._appendMenuItem(this._source._dtpPanel._restoreWindowList ? _('Restore Windows') : _('Show Desktop'));
            item.connect('activate', Lang.bind(this._source._dtpPanel, this._source._dtpPanel._onShowDesktopButtonPress));
        }
    }
});
adjustMenuRedisplay(MyShowAppsIconMenu.prototype);

function adjustMenuRedisplay(menuProto) {
    menuProto[menuRedisplayFunc] = function() { this._dtpRedisplay(menuRedisplayFunc) };
}
