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

const AppDisplay = imports.ui.appDisplay;
const AppFavorites = imports.ui.appFavorites;
const Dash = imports.ui.dash;
const DND = imports.ui.dnd;
const IconGrid = imports.ui.iconGrid;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const RemoteMenu = imports.ui.remoteMenu;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const Workspace = imports.ui.workspace;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const WindowPreview = Me.imports.windowPreview;
const Taskbar = Me.imports.taskbar;

let DASH_ANIMATION_TIME = Dash.DASH_ANIMATION_TIME;
let DASH_ITEM_LABEL_SHOW_TIME = Dash.DASH_ITEM_LABEL_SHOW_TIME;
let DASH_ITEM_LABEL_HIDE_TIME = Dash.DASH_ITEM_LABEL_HIDE_TIME;
let DASH_ITEM_HOVER_TIMEOUT = Dash.DASH_ITEM_HOVER_TIMEOUT;
let LABEL_GAP = 5;

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
    BOTTOM: "BOTTOM"
}

let recentlyClickedAppLoopId = 0;
let recentlyClickedApp = null;
let recentlyClickedAppWindows = null;
let recentlyClickedAppIndex = 0;

let tracker = Shell.WindowTracker.get_default();

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

const taskbarAppIcon = new Lang.Class({
    Name: 'DashToPanel.TaskbarAppIcon',
    Extends: AppDisplay.AppIcon,

    _init: function(settings, app, iconParams, onActivateOverride) {

        // a prefix is required to avoid conflicting with the parent class variable
        this._dtpSettings = settings;
        this._nWindows = 0;

        this.parent(app, iconParams, onActivateOverride);

        this._dot.set_width(0);
        this._focused = tracker.focus_app == this.app;

        // Monitor windows-changes instead of app state.
        // Keep using the same Id and function callback (that is extended)
        if(this._stateChangedId > 0) {
            this.app.disconnect(this._stateChangedId);
            this._stateChangedId = 0;
        }

        this._stateChangedId = this.app.connect('windows-changed',
                                                Lang.bind(this, this.onWindowsChanged));
        this._focuseAppChangeId = tracker.connect('notify::focus-app',
                                                Lang.bind(this, this._onFocusAppChanged));
        
        this._focusedDots = null;
        this._unfocusedDots = null;

        this._showDots();

        this._dtpSettings.connect('changed::dot-position', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-size', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-style-focused', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-style-unfocused', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-override', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-1', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-2', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-3', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-4', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-unfocused-different', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-unfocused-1', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-unfocused-2', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-unfocused-3', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::dot-color-unfocused-4', Lang.bind(this, this._settingsChangeRefresh));
        this._dtpSettings.connect('changed::focus-highlight', Lang.bind(this, this._settingsChangeRefresh));

        this._dtpSettings.connect('changed::appicon-margin', Lang.bind(this, this._setIconStyle));
        
        // Creating a new menu manager for window previews as adding it to the
        // using the secondary menu's menu manager (which uses the "ignoreRelease"
        // function) caused the extension to crash.
        this.menuManagerWindowPreview = new PopupMenu.PopupMenuManager(this);

        this.windowPreview = new WindowPreview.thumbnailPreviewMenu(this, this._dtpSettings, this.menuManagerWindowPreview);

        this.windowPreview.connect('open-state-changed', Lang.bind(this, function (menu, isPoppedUp) {
            if (!isPoppedUp)
                this._onMenuPoppedDown();
        }));
        this.menuManagerWindowPreview.addMenu(this.windowPreview);

        // grabHelper.grab() is usually called when the menu is opened. However, there seems to be a bug in the 
        // underlying gnome-shell that causes all window contents to freeze if the grab and ungrab occur
        // in quick succession in timeouts from the Mainloop (for example, clicking the icon as the preview window is opening)
        // So, instead wait until the mouse is leaving the icon (and might be moving toward the open window) to trigger the grab
        // in windowPreview.js
        let windowPreviewMenuData = this.menuManagerWindowPreview._menus[this.menuManagerWindowPreview._findMenu(this.windowPreview)];
        this.windowPreview.disconnect(windowPreviewMenuData.openStateChangeId);
        windowPreviewMenuData.openStateChangeId = this.windowPreview.connect('open-state-changed', Lang.bind(this.menuManagerWindowPreview, function(menu, open) {
            if (open) {
                if (this.activeMenu)
                    this.activeMenu.close(BoxPointer.PopupAnimation.FADE);

                // don't grab here, we are grabbing in onLeave in windowPreview.js
                //this._grabHelper.grab({ actor: menu.actor, focus: menu.sourceActor, onUngrab: Lang.bind(this, this._closeMenu, menu) });
            } else {
                this._grabHelper.ungrab({ actor: menu.actor });
            }
        }));

        this.forcedOverview = false;

        this._numberOverlay();
    },

    shouldShowTooltip: function() {
        if (this._dtpSettings.get_boolean("show-window-previews") && 
            getInterestingWindows(this.app, this._dtpSettings).length > 0) {
            return false;
        } else {
            return this.actor.hover && (!this._menu || !this._menu.isOpen) && (!this.windowPreview || !this.windowPreview.isOpen);
        }
    },

    _onDestroy: function() {
        this.parent();

        // Disconect global signals
        // stateChangedId is already handled by parent)
        if(this._focusAppId>0)
            tracker.disconnect(this._focusAppId);
    },

    onWindowsChanged: function() {
        this._updateCounterClass();
        this.updateIconGeometry();
    },

    // Update taraget for minimization animation
    updateIconGeometry: function() {

        // If (for unknown reason) the actor is not on the stage the reported size
        // and position are random values, which might exceeds the integer range
        // resulting in an error when assigned to the a rect. This is a more like
        // a workaround to prevent flooding the system with errors.
        if (this.actor.get_stage() == null)
            return

        let rect = new Meta.Rectangle();

        [rect.x, rect.y] = this.actor.get_transformed_position();
        [rect.width, rect.height] = this.actor.get_transformed_size();

        let windows = this.app.get_windows();
        windows.forEach(function(w) {
            w.set_icon_geometry(rect);
        });

    },

    _showDots: function() {
        // Just update style if dots already exist
        if (this._focusedDots && this._unfocusedDots) {
            this._updateCounterClass();
            return;
        }

        this._focusedDots = new St.DrawingArea({width:1, y_expand: true});
        this._unfocusedDots = new St.DrawingArea({width:1, y_expand: true});
        
        this._focusedDots.connect('repaint', Lang.bind(this, function() {
            if(this._dashItemContainer.animatingIn || this._dashItemContainer.animatingOut) {
                // don't draw and trigger more animations if the icon is in the middle of
                // being added to the panel
                return;
            }
            this._drawRunningIndicator(this._focusedDots, this._dtpSettings.get_string('dot-style-focused'), true);
            this._displayProperIndicator();
        }));
        
        this._unfocusedDots.connect('repaint', Lang.bind(this, function() {
            if(this._dashItemContainer.animatingIn || this._dashItemContainer.animatingOut) {
                // don't draw and trigger more animations if the icon is in the middle of
                // being added to the panel
                return;
            }
            this._drawRunningIndicator(this._unfocusedDots, this._dtpSettings.get_string('dot-style-unfocused'), false);
            this._displayProperIndicator();
        }));

            
        this._iconContainer.add_child(this._focusedDots);
        this._iconContainer.add_child(this._unfocusedDots);

        this._updateCounterClass();
    },

    _settingsChangeRefresh: function() {
        this._updateCounterClass();
        this._focusedDots.queue_repaint();
        this._unfocusedDots.queue_repaint();
        this._displayProperIndicator(true);
    },

    _setIconStyle: function() {
        let margin = this._dtpSettings.get_int('appicon-margin');
        let inlineStyle = 'margin: 0 ' + margin + 'px;';

        if(this._dtpSettings.get_boolean('focus-highlight') && tracker.focus_app == this.app && !this._isThemeProvidingIndicator()) {
            let containerWidth = this._iconContainer.get_width() / St.ThemeContext.get_for_stage(global.stage).scale_factor;
            let focusedDotStyle = this._dtpSettings.get_string('dot-style-focused');
            let isWide = this._isWideDotStyle(focusedDotStyle);
            let pos = this._dtpSettings.get_string('dot-position');
            let highlightMargin = isWide ? this._dtpSettings.get_int('dot-size') : 0;
                        
            if(focusedDotStyle == DOT_STYLE.CILIORA || focusedDotStyle == DOT_STYLE.SEGMENTED)
                highlightMargin += 1;

            inlineStyle += "background-image: url('" +
                Me.path + "/img/highlight_" + 
                ((this._nWindows > 1 && focusedDotStyle == DOT_STYLE.METRO) ? "stacked_" : "") + 
                "bg.svg'); background-position: 0 " +
                (pos == DOT_POSITION.TOP ? highlightMargin : 0) +
                "px; background-size: " + 
                containerWidth + "px " + 
                (containerWidth - (pos == DOT_POSITION.BOTTOM ? highlightMargin : 0)) + "px;";
        }

        // graphical glitches if i dont set this on a timeout
        if(this.actor.get_style() != inlineStyle)
            Mainloop.timeout_add(0, Lang.bind(this, function() { this.actor.set_style(inlineStyle); }));
    },

    popupMenu: function() {
        this._removeMenuTimeout();
        this.actor.fake_release();
        this._draggable.fakeRelease();

        if (!this._menu) {
            this._menu = new taskbarSecondaryMenu(this, this._dtpSettings);
            this._menu.connect('activate-window', Lang.bind(this, function (menu, window) {
                this.activateWindow(window, this._dtpSettings);
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

        this.windowPreview.close();

        this.actor.set_hover(true);
        this._menu.actor.add_style_class_name('dashtopanelSecondaryMenu');
        this._menu.popup();
        this._menuManager.ignoreRelease();
        this.emit('sync-tooltip');

        return false;
    },

    _onFocusAppChanged: function(windowTracker) {
        this._displayProperIndicator();
    },

    _displayProperIndicator: function (force) {
        let containerWidth = this._iconContainer.get_width();
        let isFocused = (tracker.focus_app == this.app);
        let focusedDotStyle = this._dtpSettings.get_string('dot-style-focused');
        let unfocusedDotStyle = this._dtpSettings.get_string('dot-style-unfocused');
        let focusedIsWide = this._isWideDotStyle(focusedDotStyle);
        let unfocusedIsWide = this._isWideDotStyle(unfocusedDotStyle);

        this._setIconStyle();

        let newFocusedDotsWidth = 0;
        let newFocusedDotsOpacity = 0;
        let newUnfocusedDotsWidth = 0;
        let newUnfocusedDotsOpacity = 0;

        
        if(isFocused) 
            this.actor.add_style_class_name('focused');
        else
            this.actor.remove_style_class_name('focused');

        if(focusedIsWide) {
            newFocusedDotsWidth = (isFocused && this._nWindows > 0) ? containerWidth : 0;
            newFocusedDotsOpacity = 255;
        } else {
            newFocusedDotsWidth = containerWidth;
            newFocusedDotsOpacity = (isFocused && this._nWindows > 0) ? 255 : 0;
        }

        if(unfocusedIsWide) {
            newUnfocusedDotsWidth = (!isFocused && this._nWindows > 0) ? containerWidth : 0;
            newUnfocusedDotsOpacity = 255;
        } else {
            newUnfocusedDotsWidth = containerWidth;
            newUnfocusedDotsOpacity = (!isFocused && this._nWindows > 0) ? 255 : 0;
        }

        // Only animate if...
        // animation is enabled in settings
        // AND (going from a wide style to a narrow style indicator or vice-versa
        // OR going from an open app to a closed app or vice versa)
        if(this._dtpSettings.get_boolean('animate-app-switch') &&
            ((focusedIsWide != unfocusedIsWide) ||
            (this._focusedDots.width != newUnfocusedDotsWidth || this._unfocusedDots.width != newFocusedDotsWidth))) {
            this._animateDotDisplay(this._focusedDots, newFocusedDotsWidth, this._unfocusedDots, newUnfocusedDotsOpacity, force);
            this._animateDotDisplay(this._unfocusedDots, newUnfocusedDotsWidth, this._focusedDots, newFocusedDotsOpacity, force);
        }
        else {
            this._focusedDots.opacity = newFocusedDotsOpacity;
            this._unfocusedDots.opacity = newUnfocusedDotsOpacity;
            this._focusedDots.width = newFocusedDotsWidth;
            this._unfocusedDots.width = newUnfocusedDotsWidth;
        }
    },

    _animateDotDisplay: function (dots, newWidth, otherDots, newOtherOpacity, force) {
        if((dots.width != newWidth && dots._tweeningToWidth !== newWidth) || force) {
                dots._tweeningToWidth = newWidth;
                Tweener.addTween(dots,
                                { width: newWidth,
                                time: DASH_ANIMATION_TIME,
                                transition: 'easeInOutCubic',
                                onStart: Lang.bind(this, function() { 
                                    if(newOtherOpacity == 0)
                                        otherDots.opacity = newOtherOpacity;
                                }),
                                onComplete: Lang.bind(this, function() { 
                                    if(newOtherOpacity > 0)
                                        otherDots.opacity = newOtherOpacity;
                                    dots._tweeningToWidth = null;
                                })
                            });
            }
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

    activate: function(button) {
        this.windowPreview.requestCloseMenu();

        let event = Clutter.get_current_event();
        let modifiers = event ? event.get_state() : 0;
        let focusedApp = tracker.focus_app;

        // Only consider SHIFT and CONTROL as modifiers (exclude SUPER, CAPS-LOCK, etc.)
        modifiers = modifiers & (Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK);

        // We don't change the CTRL-click behaviour: in such case we just chain
        // up the parent method and return.
        if (modifiers & Clutter.ModifierType.CONTROL_MASK) {
                // Keep default behaviour: launch new window
                // By calling the parent method I make it compatible
                // with other extensions tweaking ctrl + click
                this.parent(button);
                return;
        }

        // We check what type of click we have and if the modifier SHIFT is
        // being used. We then define what buttonAction should be for this
        // event.
        let buttonAction = 0;
        if (button && button == 2 ) {
            if (modifiers & Clutter.ModifierType.SHIFT_MASK)
                buttonAction = this._dtpSettings.get_string('shift-middle-click-action');
            else
                buttonAction = this._dtpSettings.get_string('middle-click-action');
        }
        else if (button && button == 1) {
            if (modifiers & Clutter.ModifierType.SHIFT_MASK)
                buttonAction = this._dtpSettings.get_string('shift-click-action');
            else
                buttonAction = this._dtpSettings.get_string('click-action');
        }

        // We check if the app is running, and that the # of windows is > 0 in
        // case we use workspace isolation,
        let appIsRunning = this.app.state == Shell.AppState.RUNNING
            && getInterestingWindows(this.app, this._dtpSettings).length > 0

        // We customize the action only when the application is already running
        if (appIsRunning) {
            switch (buttonAction) {
            case "RAISE":
                activateAllWindows(this.app, this._dtpSettings);
                break;

            case "LAUNCH":
                if(this._dtpSettings.get_boolean('animate-window-launch'))
                    this.animateLaunch();
                this.app.open_new_window(-1);
                break;

            case "MINIMIZE":
                // In overview just activate the app, unless the acion is explicitely
                // requested with a keyboard modifier
                if (!Main.overview._shown || modifiers){
                    // If we have button=2 or a modifier, allow minimization even if
                    // the app is not focused
                    if (this.app == focusedApp || button == 2 || modifiers & Clutter.ModifierType.SHIFT_MASK) {
                        // minimize all windows on double click and always in the case of primary click without
                        // additional modifiers
                        let click_count = 0;
                        if (Clutter.EventType.CLUTTER_BUTTON_PRESS)
                            click_count = event.get_click_count();
                        let all_windows = (button == 1 && ! modifiers) || click_count > 1;
                        minimizeWindow(this.app, all_windows, this._dtpSettings);
                    }
                    else
                        activateAllWindows(this.app, this._dtpSettings);
                }
                else
                    this.app.activate();
                break;

            case "CYCLE":
                if (!Main.overview._shown){
                    if (this.app == focusedApp)
                        cycleThroughWindows(this.app, this._dtpSettings, false, false);
                    else {
                        activateFirstWindow(this.app, this._dtpSettings);
                    }
                }
                else
                    this.app.activate();
                break;
            case "CYCLE-MIN":
                if (!Main.overview._shown){
                    if (this.app == focusedApp || 
                        (recentlyClickedApp == this.app && recentlyClickedAppWindows[recentlyClickedAppIndex % recentlyClickedAppWindows.length] == "MINIMIZE"))
                        cycleThroughWindows(this.app, this._dtpSettings, false, true);
                    else {
                        activateFirstWindow(this.app, this._dtpSettings);
                    }
                }
                else
                    this.app.activate();
                break;

            case "QUIT":
                closeAllWindows(this.app, this._dtpSettings);
                break;
            }
        }
        else {
            if(this._dtpSettings.get_boolean('animate-window-launch'))
                this.animateLaunch();
            this.app.open_new_window(-1);
        }

        Main.overview.hide();
    },

    _updateCounterClass: function() {
        let maxN = 4;
        this._nWindows = Math.min(getInterestingWindows(this.app, this._dtpSettings).length, maxN);

        for (let i = 1; i <= maxN; i++){
            let className = 'running'+i;
            if(i != this._nWindows)
                this.actor.remove_style_class_name(className);
            else
                this.actor.add_style_class_name(className);
        }
    },

    _drawRunningIndicator: function(area, type, isFocused) {
        let bodyColor;
        if(this._dtpSettings.get_boolean('dot-color-override')) {
            let dotColorSettingPrefix = 'dot-color-';
            if(!isFocused && this._dtpSettings.get_boolean('dot-color-unfocused-different'))
                dotColorSettingPrefix = 'dot-color-unfocused-';
            bodyColor = Clutter.color_from_string(this._dtpSettings.get_string(dotColorSettingPrefix + (this._nWindows > 0 ? this._nWindows : 1)))[1];
        } else {
            // Re-use the style - background color, and border width and color -
            // of the default dot
            let themeNode = this._dot.get_theme_node();
            bodyColor = themeNode.get_background_color();
            if(bodyColor.alpha == 0) // theme didn't provide one, use a default
                bodyColor = new Clutter.Color({ red: 82, green: 148, blue: 226, alpha: 255 });
        }

        let [width, height] = area.get_surface_size();
        let cr = area.get_context();
        let n = this._nWindows;
        let size = this._dtpSettings.get_int('dot-size') * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let padding = 0; // distance from the margin
        let yOffset = this._dtpSettings.get_string('dot-position') == DOT_POSITION.TOP ? 0 : (height - padding -  size);
        
        if(type == DOT_STYLE.DOTS) {
            // Draw the required numbers of dots
            let radius = size/2;
            let spacing = Math.ceil(width/18); // separation between the dots
        
            cr.translate((width - (2*n)*radius - (n-1)*spacing)/2, yOffset);

            Clutter.cairo_set_source_color(cr, bodyColor);
            for (let i = 0; i < n; i++) {
                cr.newSubPath();
                cr.arc((2*i+1)*radius + i*spacing, radius, radius, 0, 2*Math.PI);
            }
            cr.fill();
        } else if(type == DOT_STYLE.SQUARES) {
            let spacing = Math.ceil(width/18); // separation between the dots
        
            cr.translate(Math.floor((width - n*size - (n-1)*spacing)/2), yOffset);

            Clutter.cairo_set_source_color(cr, bodyColor);
            for (let i = 0; i < n; i++) {
                cr.newSubPath();
                cr.rectangle(i*size + i*spacing, 0, size, size);
            }
            cr.fill();
        } else if(type == DOT_STYLE.DASHES) {
            let spacing = Math.ceil(width/18); // separation between the dots
            let dashLength = Math.floor(width/4) - spacing;
        
            cr.translate(Math.floor((width - n*dashLength - (n-1)*spacing)/2), yOffset);

            Clutter.cairo_set_source_color(cr, bodyColor);
            for (let i = 0; i < n; i++) {
                cr.newSubPath();
                cr.rectangle(i*dashLength + i*spacing, 0, dashLength, size);
            }
            cr.fill();
        } else if(type == DOT_STYLE.SEGMENTED) {
            let spacing = Math.ceil(width/18); // separation between the dots
            let dashLength = Math.ceil((width - ((n-1)*spacing))/n);
        
            cr.translate(0, yOffset);

            Clutter.cairo_set_source_color(cr, bodyColor);
            for (let i = 0; i < n; i++) {
                cr.newSubPath();
                cr.rectangle(i*dashLength + i*spacing, 0, dashLength, size);
            }
            cr.fill();
        } else if (type == DOT_STYLE.CILIORA) {
            let spacing = size; // separation between the dots
            let lineLength = width - (size*(n-1)) - (spacing*(n-1));
        
            cr.translate(0, yOffset);

            Clutter.cairo_set_source_color(cr, bodyColor);
            cr.newSubPath();
            cr.rectangle(0, 0, lineLength, size);
            for (let i = 1; i < n; i++) {
                cr.newSubPath();
                cr.rectangle(lineLength + (i*spacing) + ((i-1)*size), 0, size, size);
            }
            cr.fill();
        } else if (type == DOT_STYLE.METRO) {
            if(n <= 1) {
                cr.translate(0, yOffset);
                Clutter.cairo_set_source_color(cr, bodyColor);
                cr.newSubPath();
                cr.rectangle(0, 0, width, size);
                cr.fill();
            } else {
                let blackenedLength = (1/48)*width; // need to scale with the SVG for the stacked highlight
                let darkenedLength = isFocused ? (2/48)*width : (10/48)*width;
                let blackenedColor = bodyColor.shade(.3);
                let darkenedColor = bodyColor.shade(.7);

                cr.translate(0, yOffset);

                Clutter.cairo_set_source_color(cr, bodyColor);
                cr.newSubPath();
                cr.rectangle(0, 0, width - darkenedLength - blackenedLength, size);
                cr.fill();
                Clutter.cairo_set_source_color(cr, blackenedColor);
                cr.newSubPath();
                cr.rectangle(width - darkenedLength - blackenedLength, 0, 1, size);
                cr.fill();
                Clutter.cairo_set_source_color(cr, darkenedColor);
                cr.newSubPath();
                cr.rectangle(width - darkenedLength, 0, darkenedLength, size);
                cr.fill();
            }
        } else { // solid
            cr.translate(0, yOffset);
            Clutter.cairo_set_source_color(cr, bodyColor);
            cr.newSubPath();
            cr.rectangle(0, 0, width, size);
            cr.fill();
        }

        cr.$dispose();
    },

    _numberOverlay: function() {
        // Add label for a Hot-Key visual aid
        this._numberOverlayLabel = new St.Label();
        this._numberOverlayBin = new St.Bin({
            child: this._numberOverlayLabel,
            x_align: St.Align.START, y_align: St.Align.START,
            x_expand: true, y_expand: true
        });
        this._numberOverlayStyle = 'background-color: rgba(0,0,0,0.8);'
        this._numberOverlayOrder = -1;
        this._numberOverlayBin.hide();

        this._iconContainer.add_child(this._numberOverlayBin);

    },

    updateNumberOverlay: function() {
        // Set the font size to something smaller than the whole icon so it is
        // still visible. The border radius is large to make the shape circular
        let [minWidth, natWidth] = this._iconContainer.get_preferred_width(-1);
        let font_size =  Math.round(Math.max(12, 0.3*natWidth));
        let size = Math.round(font_size*1.2);
        this._numberOverlayLabel.set_style(
            this._numberOverlayStyle +
           'font-size: ' + font_size + 'px;' +
           'text-align: center;' +
           'border-radius: ' + this.icon.iconSize + 'px;' +
           'width: ' + size + 'px; height: ' + size +'px;'
        );
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
    }

});

function minimizeWindow(app, param, settings){
    // Param true make all app windows minimize
    let windows = getInterestingWindows(app, settings);
    let current_workspace = global.screen.get_active_workspace();
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
function activateAllWindows(app, settings){

    // First activate first window so workspace is switched if needed,
    // then activate all other app windows in the current workspace.
    let windows = getInterestingWindows(app, settings);
    let w = windows[0];
    Main.activateWindow(w);
    let activeWorkspace = global.screen.get_active_workspace_index();

    if (windows.length <= 0)
        return;

    let activatedWindows = 0;

    for (let i = windows.length - 1; i >= 0; i--){
        if (windows[i].get_workspace().index() == activeWorkspace){
            Main.activateWindow(windows[i]);
            activatedWindows++;
        }
    }
}

function activateFirstWindow(app, settings){

    let windows = getInterestingWindows(app, settings);
    Main.activateWindow(windows[0]);
}

function cycleThroughWindows(app, settings, reversed, shouldMinimize) {
    // Store for a little amount of time last clicked app and its windows
    // since the order changes upon window interaction
    let MEMORY_TIME=3000;

    let app_windows = getInterestingWindows(app, settings);

    if(shouldMinimize)
        app_windows.push("MINIMIZE");

    if (recentlyClickedAppLoopId > 0)
        Mainloop.source_remove(recentlyClickedAppLoopId);
    recentlyClickedAppLoopId = Mainloop.timeout_add(MEMORY_TIME, resetRecentlyClickedApp);

    // If there isn't already a list of windows for the current app,
    // or the stored list is outdated, use the current windows list.
    if (!recentlyClickedApp ||
        recentlyClickedApp.get_id() != app.get_id() ||
        recentlyClickedAppWindows.length != app_windows.length) {
        recentlyClickedApp = app;
        recentlyClickedAppWindows = app_windows;
        recentlyClickedAppIndex = 0;
    }

    if (reversed) {
        recentlyClickedAppIndex--;
        if (recentlyClickedAppIndex < 0) recentlyClickedAppIndex = recentlyClickedAppWindows.length - 1;
    } else {
        recentlyClickedAppIndex++;
    }
    let index = recentlyClickedAppIndex % recentlyClickedAppWindows.length;
    
    if(recentlyClickedAppWindows[index] === "MINIMIZE")
        minimizeWindow(app, true, settings);
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

    return false;
}

function closeAllWindows(app, settings) {
    let windows = getInterestingWindows(app, settings);
    for (let i = 0; i < windows.length; i++)
        windows[i].delete(global.get_current_time());
}

// Filter out unnecessary windows, for instance
// nautilus desktop window.
function getInterestingWindows(app, settings) {
    let windows = app.get_windows().filter(function(w) {
        return !w.skip_taskbar;
    });

    // When using workspace isolation, we filter out windows
    // that are not in the current workspace
    if (settings.get_boolean('isolate-workspaces'))
        windows = windows.filter(function(w) {
            return w.get_workspace().index() == global.screen.get_active_workspace_index();
        });

    return windows;
}

/**
 * Extend AppIconMenu
 *
 * - set popup arrow side based on taskbar orientation
 * - Add close windows option based on quitfromdash extension
 *   (https://github.com/deuill/shell-extension-quitfromdash)
 */

const taskbarSecondaryMenu = new Lang.Class({
    Name: 'DashToPanel.SecondaryMenu',
    Extends: AppDisplay.AppIconMenu,

    _init: function(source, settings) {
        this._dtpSettings = settings;

        let side = Taskbar.getPosition();

        // Damm it, there has to be a proper way of doing this...
        // As I can't call the parent parent constructor (?) passing the side
        // parameter, I overwite what I need later
        this.parent(source);

        // Change the initialized side where required.
        this._arrowSide = side;
        this._boxPointer._arrowSide = side;
        this._boxPointer._userArrowSide = side;
    },

    // helper function for the quit windows abilities
    _closeWindowInstance: function(metaWindow) {
        metaWindow.delete(global.get_current_time());
    },

    _redisplay: function() {
        this.removeAll();

        let appMenu = this._source.app.menu;
        if(appMenu) {
            let remoteMenu = new RemoteMenu.RemoteMenu(this._source.actor, this._source.app.menu, this._source.app.action_group);
            let appMenuItems = remoteMenu._getMenuItems();
            let isItemsAdded = false;
            for(let appMenuIdx in appMenuItems){
                let menuItem = appMenuItems[appMenuIdx];
                let labelText = menuItem.actor.label_actor.text;
                if(labelText == _("New Window") || labelText == _("Quit"))
                    continue;
                
                if(menuItem instanceof PopupMenu.PopupSeparatorMenuItem)
                    continue;

                isItemsAdded = true;

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
                    this.addMenuItem(newSubMenuMenuItem);
                } else 
                    this.addMenuItem(menuItem);

            }
            
            if(isItemsAdded)
                this._appendSeparator();
        }

        let windows = this._source.app.get_windows().filter(function(w) {
            return !w.skip_taskbar;
        });

        // Display the app windows menu items and the separator between windows
        // of the current desktop and other windows.
        let activeWorkspace = global.screen.get_active_workspace();
        let separatorShown = windows.length > 0 && windows[0].get_workspace() != activeWorkspace;

        for (let i = 0; i < windows.length; i++) {
            let window = windows[i];
            if (!separatorShown && window.get_workspace() != activeWorkspace) {
                this._appendSeparator();
                separatorShown = true;
            }
            let item = this._appendMenuItem(window.title);
            item.connect('activate', Lang.bind(this, function() {
                this.emit('activate-window', window);
            }));
        }

        if (!this._source.app.is_window_backed()) {
            this._appendSeparator();

            let appInfo = this._source.app.get_app_info();
            let actions = appInfo.list_actions();
            if (this._source.app.can_open_new_window() &&
                actions.indexOf('new-window') == -1) {
                this._newWindowMenuItem = this._appendMenuItem(_("New Window"));
                this._newWindowMenuItem.connect('activate', Lang.bind(this, function() {
                    if (this._source.app.state == Shell.AppState.STOPPED)
                        this._source.animateLaunch();

                    this._source.app.open_new_window(-1);
                    this.emit('activate-window', null);
                }));
                this._appendSeparator();
            }

            if (PopupMenu.discreteGpuAvailable &&
                this._source.app.state == Shell.AppState.STOPPED &&
                actions.indexOf('activate-discrete-gpu') == -1) {
                this._onDiscreteGpuMenuItem = this._appendMenuItem(_("Launch using Dedicated Graphics Card"));
                this._onDiscreteGpuMenuItem.connect('activate', Lang.bind(this, function() {
                    if (this._source.app.state == Shell.AppState.STOPPED)
                        this._source.animateLaunch();

                    this._source.app.launch(0, -1, true);
                    this.emit('activate-window', null);
                }));
            }

            for (let i = 0; i < actions.length; i++) {
                let action = actions[i];
                let item = this._appendMenuItem(appInfo.get_action_name(action));
                item.connect('activate', Lang.bind(this, function(emitter, event) {
                    this._source.app.launch_action(action, event.get_time(), -1);
                    this.emit('activate-window', null);
                }));
            }

            let canFavorite = global.settings.is_writable('favorite-apps');

            if (canFavorite) {
                this._appendSeparator();

                let isFavorite = AppFavorites.getAppFavorites().isFavorite(this._source.app.get_id());

                if (isFavorite) {
                    let item = this._appendMenuItem(_("Remove from Favorites"));
                    item.connect('activate', Lang.bind(this, function() {
                        let favs = AppFavorites.getAppFavorites();
                        favs.removeFavorite(this._source.app.get_id());
                    }));
                } else {
                    let item = this._appendMenuItem(_("Add to Favorites"));
                    item.connect('activate', Lang.bind(this, function() {
                        let favs = AppFavorites.getAppFavorites();
                        favs.addFavorite(this._source.app.get_id());
                    }));
                }
            }

            // if (Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop')) {
            //     this._appendSeparator();
            //     let item = this._appendMenuItem(_("Show Details"));
            //     item.connect('activate', Lang.bind(this, function() {
            //         let id = this._source.app.get_id();
            //         let args = GLib.Variant.new('(ss)', [id, '']);
            //         Gio.DBus.get(Gio.BusType.SESSION, null,
            //             function(o, res) {
            //                 let bus = Gio.DBus.get_finish(res);
            //                 bus.call('org.gnome.Software',
            //                          '/org/gnome/Software',
            //                          'org.gtk.Actions', 'Activate',
            //                          GLib.Variant.new('(sava{sv})',
            //                                           ['details', [args], null]),
            //                          null, 0, -1, null, null);
            //                 Main.overview.hide();
            //             });
            //     }));
            // }
        }

        // quit menu
        let app = this._source.app;
        let count = getInterestingWindows(app, this._dtpSettings).length;
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
                let windows = app.get_windows();
                for (let i = 0; i < windows.length; i++) {
                    this._closeWindowInstance(windows[i])
                }
            }));
        }
    }
});
Signals.addSignalMethods(taskbarSecondaryMenu.prototype);

/**
 * This function is used for both extendShowAppsIcon and extendDashItemContainer
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

    let x, y, xOffset, yOffset;

    let position = Taskbar.getPosition();
    let labelOffset = node.get_length('-x-offset');

    switch(position) {
      case St.Side.TOP:
          y = stageY + labelOffset + itemHeight;
          xOffset = Math.floor((itemWidth - labelWidth) / 2);
          x = stageX + xOffset;
          break;
      case St.Side.BOTTOM:
          yOffset = labelOffset;
          y = stageY - labelHeight - yOffset;
          xOffset = Math.floor((itemWidth - labelWidth) / 2);
          x = stageX + xOffset;
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

    this.label.set_position(x, y);
    Tweener.addTween(this.label,
      { opacity: 255,
        time: DASH_ITEM_LABEL_SHOW_TIME,
        transition: 'easeOutQuad',
      });
};


/**
 * Extend ShowAppsIcon
 *
 * - Pass settings to the constructor
 * - set label position based on dash orientation
 * - implement a popupMenu based on the AppIcon code
 *
 *  I can't subclass the original object because of this: https://bugzilla.gnome.org/show_bug.cgi?id=688973.
 *  thus use this ugly pattern.
 */
function extendShowAppsIcon(showAppsIcon, settings) {
    showAppsIcon._dtpSettings = settings;
    /* the variable equivalent to toggleButton has a different name in the appIcon class
     (actor): duplicate reference to easily reuse appIcon methods */
    showAppsIcon.actor =  showAppsIcon.toggleButton;

    // Re-use appIcon methods
    showAppsIcon._removeMenuTimeout = AppDisplay.AppIcon.prototype._removeMenuTimeout;
    showAppsIcon._setPopupTimeout = AppDisplay.AppIcon.prototype._setPopupTimeout;
    showAppsIcon._onButtonPress = AppDisplay.AppIcon.prototype._onButtonPress;
    showAppsIcon._onKeyboardPopupMenu = AppDisplay.AppIcon.prototype._onKeyboardPopupMenu;
    showAppsIcon._onLeaveEvent = AppDisplay.AppIcon.prototype._onLeaveEvent;
    showAppsIcon._onTouchEvent = AppDisplay.AppIcon.prototype._onTouchEvent;
    showAppsIcon._onMenuPoppedDown = AppDisplay.AppIcon.prototype._onMenuPoppedDown;


    // No action on clicked (showing of the appsview is controlled elsewhere)
    showAppsIcon._onClicked = function(actor, button) {
        showAppsIcon._removeMenuTimeout();
    };

    showAppsIcon.actor.connect('leave-event', Lang.bind(showAppsIcon, showAppsIcon._onLeaveEvent));
    showAppsIcon.actor.connect('button-press-event', Lang.bind(showAppsIcon, showAppsIcon._onButtonPress));
    showAppsIcon.actor.connect('touch-event', Lang.bind(showAppsIcon, showAppsIcon._onTouchEvent));
    showAppsIcon.actor.connect('clicked', Lang.bind(showAppsIcon, showAppsIcon._onClicked));
    showAppsIcon.actor.connect('popup-menu', Lang.bind(showAppsIcon, showAppsIcon._onKeyboardPopupMenu));

    showAppsIcon._menu = null;
    showAppsIcon._menuManager = new PopupMenu.PopupMenuManager(showAppsIcon);
    showAppsIcon._menuTimeoutId = 0;

    showAppsIcon.showLabel = ItemShowLabel;

    showAppsIcon.popupMenu = function() {
        showAppsIcon._removeMenuTimeout();
        showAppsIcon.actor.fake_release();

        if (!showAppsIcon._menu) {
            showAppsIcon._menu = new MyShowAppsIconMenu(showAppsIcon, showAppsIcon._dtpSettings);
            showAppsIcon._menu.connect('open-state-changed', Lang.bind(showAppsIcon, function(menu, isPoppedUp) {
                if (!isPoppedUp)
                    showAppsIcon._onMenuPoppedDown();
            }));
            let id = Main.overview.connect('hiding', Lang.bind(showAppsIcon, function() {
                showAppsIcon._menu.close();
            }));
            showAppsIcon._menu.actor.connect('destroy', function() {
                Main.overview.disconnect(id);
            });
            showAppsIcon._menuManager.addMenu(showAppsIcon._menu);
        }

        showAppsIcon.emit('menu-state-changed', true);

        showAppsIcon.actor.set_hover(true);
        showAppsIcon._menu.popup();
        showAppsIcon._menuManager.ignoreRelease();
        showAppsIcon.emit('sync-tooltip');

        return false;
    };

    Signals.addSignalMethods(showAppsIcon);
}

/**
 * A menu for the showAppsIcon
 */
const MyShowAppsIconMenu = new Lang.Class({
    Name: 'DashToPanel.ShowAppsIconMenu',
    Extends: taskbarSecondaryMenu,

    _redisplay: function() {
        this.removeAll();

        let settingsMenuItem = this._appendMenuItem('Dash to Panel ' + _('Settings'));
        settingsMenuItem.connect('activate', function () {
            Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
        });

        if(this._source._dtpPanel) {
            this._appendSeparator();
            let item = this._appendMenuItem(this._source._dtpPanel._restoreWindowList ? _('Restore Windows') : _('Show Desktop'));
            item.connect('activate', Lang.bind(this._source._dtpPanel, this._source._dtpPanel._onShowDesktopButtonPress));
        }
    }
});