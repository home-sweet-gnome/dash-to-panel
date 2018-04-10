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
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const Workspace = imports.ui.workspace;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const WindowPreview = Me.imports.windowPreview;
const AppIcons = Me.imports.appIcons;

var DASH_ANIMATION_TIME = Dash.DASH_ANIMATION_TIME;
let DASH_ITEM_LABEL_SHOW_TIME = Dash.DASH_ITEM_LABEL_SHOW_TIME;
let DASH_ITEM_LABEL_HIDE_TIME = Dash.DASH_ITEM_LABEL_HIDE_TIME;
var DASH_ITEM_HOVER_TIMEOUT = Dash.DASH_ITEM_HOVER_TIMEOUT;
let HFADE_WIDTH = 48;

function getPosition() {
    return Main.layoutManager.panelBox.anchor_y == 0 ? St.Side.TOP : St.Side.BOTTOM;
}
/**
 * Extend DashItemContainer
 *
 * - set label position based on taskbar orientation
 *
 *  I can't subclass the original object because of this: https://bugzilla.gnome.org/show_bug.cgi?id=688973.
 *  thus use this ugly pattern.
 */

function extendDashItemContainer(dashItemContainer) {
    dashItemContainer.showLabel = AppIcons.ItemShowLabel;
};

/* This class is a fork of the upstream DashActor class (ui.dash.js)
 *
 * Summary of changes:
 * - modified chldBox calculations for when 'show-apps-at-top' option is checked
 * - handle horizontal dash
 */

function findIndex(array, predicate) {
    if (Array.prototype.findIndex) {
        return array.findIndex(predicate);
    }

    for (let i = 0, l = array.length; i < l; ++i) {
        if (predicate(array[i])) {
            return i;
        }
    }

    return -1;
};

var taskbarActor = new Lang.Class({
    Name: 'DashToPanel.TaskbarActor',

    _init: function() {
        this._rtl = Clutter.get_default_text_direction() == Clutter.TextDirection.RTL;

        this._position = getPosition();

        let layout = new Clutter.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });

        this.actor = new Shell.GenericContainer({ name: 'dashtopanelTaskbar',
                      layout_manager: layout,
                      clip_to_allocation: true });
        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));

        this.actor._delegate = this;

    },

    _allocate: function(actor, box, flags) {
        
        this._isHorizontal = true;
        this._isAppAtLeft = true;
        let contentBox = box;
        let availWidth = contentBox.x2 - contentBox.x1;
        let availHeight = contentBox.y2 - contentBox.y1;

        let [appIcons, showAppsButton] = actor.get_children();
        let [showAppsMinHeight, showAppsNatHeight] = showAppsButton.get_preferred_height(availWidth);
        let [showAppsMinWidth, showAppsNatWidth] = showAppsButton.get_preferred_width(availHeight);

        let childBox = new Clutter.ActorBox();
        childBox.x1 = contentBox.x1 + showAppsNatWidth;
        childBox.y1 = contentBox.y1;
        childBox.x2 = contentBox.x2;
        childBox.y2 = contentBox.y2;
        appIcons.allocate(childBox, flags);

        childBox.y1 = contentBox.y1;
        childBox.x1 = contentBox.x1;
        childBox.x2 = contentBox.x1 + showAppsNatWidth;
        childBox.y2 = contentBox.y2;
        showAppsButton.allocate(childBox, flags);
    },

    _getPreferredWidth: function(actor, forHeight, alloc) {
        // We want to request the natural height of all our children
        // as our natural height, so we chain up to StWidget (which
        // then calls BoxLayout)
        let [, natWidth] = this.actor.layout_manager.get_preferred_width(this.actor, forHeight);
        alloc.min_size = 0;
        alloc.natural_size = natWidth + HFADE_WIDTH;
    },

    _getPreferredHeight: function(actor, forWidth, alloc) {
        // We want to request the natural height of all our children
        // as our natural height, so we chain up to StWidget (which
        // then calls BoxLayout)
        let [, natHeight] = this.actor.layout_manager.get_preferred_height(this.actor, forWidth);
        alloc.min_size = 0;
        alloc.natural_size = natHeight;
    }
});

/* This class is a fork of the upstream dash class (ui.dash.js)
 *
 * Summary of changes:
 * - disconnect global signals adding a destroy method;
 * - play animations even when not in overview mode
 * - set a maximum icon size
 * - show running and/or favorite applications
 * - emit a custom signal when an app icon is added
 * - Add scrollview
 *   Ensure actor is visible on keyfocus inside the scrollview
 * - add 128px icon size, might be useful for hidpi display
 * - Sync minimization application target position.
 */

const baseIconSizes = [ 16, 22, 24, 32, 48, 64, 96, 128 ];

var taskbar = new Lang.Class({
    Name: 'DashToPanel.Taskbar',

    _init : function(settings) {
        this._dtpSettings = settings;
        
        // start at smallest size due to running indicator drawing area expanding but not shrinking
        this.iconSize = baseIconSizes[0];

        this._availableIconSizes = baseIconSizes;
        this._shownInitially = false;

        this._position = getPosition();
        this._signalsHandler = new Convenience.GlobalSignalsHandler();

        this._dragPlaceholder = null;
        this._dragPlaceholderPos = -1;
        this._animatingPlaceholdersCount = 0;
        this._showLabelTimeoutId = 0;
        this._resetHoverTimeoutId = 0;
        this._ensureAppIconVisibilityTimeoutId = 0;
        this._labelShowing = false;

        this._containerObject = new taskbarActor();
        this._container = this._containerObject.actor;
        this._scrollView = new St.ScrollView({ name: 'dashtopanelScrollview',
                                               hscrollbar_policy: Gtk.PolicyType.NEVER,
                                               vscrollbar_policy: Gtk.PolicyType.NEVER,
                                               enable_mouse_scrolling: true });

        this._scrollView.connect('scroll-event', Lang.bind(this, this._onScrollEvent ));

        this._box = new St.BoxLayout({ vertical: false,
                                       clip_to_allocation: false,
                                       x_align: Clutter.ActorAlign.START,
                                       y_align: Clutter.ActorAlign.START });
        this._box._delegate = this;
        this._container.add_actor(this._scrollView);
        this._scrollView.add_actor(this._box);

        this._showAppsIcon = new Dash.ShowAppsIcon();
        AppIcons.extendShowAppsIcon(this._showAppsIcon, this._dtpSettings);
        this.showAppsButton = this._showAppsIcon.toggleButton;
             
        this.showAppsButton.connect('notify::checked', Lang.bind(this, this._onShowAppsButtonToggled));

        this._showAppsIcon.childScale = 1;
        this._showAppsIcon.childOpacity = 255;
        this._showAppsIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(this._showAppsIcon);

        let appsIcon = this._showAppsIcon;
        appsIcon.connect('menu-state-changed', Lang.bind(this, function(appsIcon, opened) {
            this._itemMenuStateChanged(appsIcon, opened);
        }));

        this._container.add_actor(this._showAppsIcon);

        if (!this._dtpSettings.get_boolean('show-show-apps-button'))
            this.hideShowAppsButton();

        let rtl = Clutter.get_default_text_direction() == Clutter.TextDirection.RTL;
        this.actor = new St.Bin({ child: this._container,
            y_align: St.Align.START, x_align:rtl?St.Align.END:St.Align.START
        });

        // Update minimization animation target position on allocation of the
        // container and on scrollview change.
        this._box.connect('notify::allocation', Lang.bind(this, this._updateAppIconsGeometry));
        let scrollViewAdjustment = this._scrollView.hscroll.adjustment;
        scrollViewAdjustment.connect('notify::value', Lang.bind(this, this._updateAppIconsGeometry));

        this._workId = Main.initializeDeferredWork(this._box, Lang.bind(this, this._redisplay));

        this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

        this._appSystem = Shell.AppSystem.get_default();

        this._signalsHandler.add(
            [
                Main.panel.actor,
                'notify::height',
                () => this._queueRedisplay()
            ],
            [
                Main.panel.actor,
                'notify::width',
                () => this._queueRedisplay()
            ],
            [
                this._appSystem,
                'installed-changed',
                Lang.bind(this, function() {
                    AppFavorites.getAppFavorites().reload();
                    this._queueRedisplay();
                })
            ],
            [
                AppFavorites.getAppFavorites(),
                'changed',
                Lang.bind(this, this._queueRedisplay)
            ],
            [
                global.window_manager,
                'switch-workspace', 
                () => this._connectWorkspaceSignals()
            ],
            [
                Main.overview,
                'item-drag-begin',
                Lang.bind(this, this._onDragBegin)
            ],
            [
                Main.overview,
                'item-drag-end',
                Lang.bind(this, this._onDragEnd)
            ],
            [
                Main.overview,
                'item-drag-cancelled',
                Lang.bind(this, this._onDragCancelled)
            ],
            [
                // Ensure the ShowAppsButton status is kept in sync
                Main.overview.viewSelector._showAppsButton,
                'notify::checked',
                Lang.bind(this, this._syncShowAppsButtonToggled)
            ],
            [
                this._dtpSettings,
                'changed::show-window-previews',
                Lang.bind(this, this._toggleWindowPreview)
            ]
        );

        this.isGroupApps = this._dtpSettings.get_boolean('group-apps');

        this._connectWorkspaceSignals();

        this._bindSettingsChanges();
    },

    destroy: function() {
        this._signalsHandler.destroy();
        this._signalsHandler = 0;

        this._container.destroy();
        this._disconnectWorkspaceSignals();
    },

    _bindSettingsChanges: function () {
        this._dtpSettings.connect('changed::show-show-apps-button', Lang.bind(this, function() {
            if (this._dtpSettings.get_boolean('show-show-apps-button'))
                this.showShowAppsButton();
            else
                this.hideShowAppsButton();
        }));

        this._dtpSettings.connect('changed::dot-size', Lang.bind(this, this._redisplay));

        this._dtpSettings.connect('changed::show-favorites', Lang.bind(this, this._redisplay));

        this._dtpSettings.connect('changed::group-apps', Lang.bind(this, function() {
            this.isGroupApps = this._dtpSettings.get_boolean('group-apps');
            this._connectWorkspaceSignals();
            this.resetAppIcons();
        }));

        this._dtpSettings.connect('changed::group-apps-use-launchers', Lang.bind(this, function() {
            this.resetAppIcons();
        }));
    },

    _onScrollEvent: function(actor, event) {

        // Event coordinates are relative to the stage but can be transformed
        // as the actor will only receive events within his bounds.
        let stage_x, stage_y, ok, event_x, event_y, actor_w, actor_h;
        [stage_x, stage_y] = event.get_coords();
        [ok, event_x, event_y] = actor.transform_stage_point(stage_x, stage_y);
        [actor_w, actor_h] = actor.get_size();

        // reset timeout to avid conflicts with the mousehover event
        if (this._ensureAppIconVisibilityTimeoutId>0) {
            Mainloop.source_remove(this._ensureAppIconVisibilityTimeoutId);
            this._ensureAppIconVisibilityTimeoutId = 0;
        }

        // Skip to avoid double events mouse
        if (event.is_pointer_emulated())
            return Clutter.EVENT_STOP;

        let adjustment, delta;

        adjustment = this._scrollView.get_hscroll_bar().get_adjustment();

        let increment = adjustment.step_increment;

        switch ( event.get_scroll_direction() ) {
        case Clutter.ScrollDirection.UP:
            delta = -increment;
            break;
        case Clutter.ScrollDirection.DOWN:
            delta = +increment;
            break;
        case Clutter.ScrollDirection.SMOOTH:
            let [dx, dy] = event.get_scroll_delta();
            delta = dy*increment;
            delta += dx*increment;
            break;

        }

        adjustment.set_value(adjustment.get_value() + delta);

        return Clutter.EVENT_STOP;

    },

    _onDragBegin: function() {
        this._dragCancelled = false;
        this._dragMonitor = {
            dragMotion: Lang.bind(this, this._onDragMotion)
        };
        DND.addDragMonitor(this._dragMonitor);

        if (this._box.get_n_children() == 0) {
            this._emptyDropTarget = new Dash.EmptyDropTargetItem();
            this._box.insert_child_at_index(this._emptyDropTarget, 0);
            this._emptyDropTarget.show(true);
        }
    },

    _onDragCancelled: function() {
        this._dragCancelled = true;
        this._endDrag();
    },

    _onDragEnd: function() {
        if (this._dragCancelled)
            return;

        this._endDrag();
    },

    _endDrag: function() {
        this._clearDragPlaceholder();
        this._clearEmptyDropTarget();
        this._showAppsIcon.setDragApp(null);
        DND.removeDragMonitor(this._dragMonitor);
    },

    _onDragMotion: function(dragEvent) {
        let app = Dash.getAppFromSource(dragEvent.source);
        if (app == null)
            return DND.DragMotionResult.CONTINUE;

         let showAppsHovered = this._showAppsIcon.contains(dragEvent.targetActor);

        if (!this._box.contains(dragEvent.targetActor) || showAppsHovered)
            this._clearDragPlaceholder();

        if (showAppsHovered)
            this._showAppsIcon.setDragApp(app);
        else
            this._showAppsIcon.setDragApp(null);

        return DND.DragMotionResult.CONTINUE;
    },

    _appIdListToHash: function(apps) {
        let ids = {};
        for (let i = 0; i < apps.length; i++)
            ids[apps[i].get_id()] = apps[i];
        return ids;
    },

    handleIsolatedWorkspaceSwitch: function() {
        if (this.isGroupApps) {
            this._queueRedisplay();
        } else {
            this.resetAppIcons();
        }
    },

    _connectWorkspaceSignals: function() {
        this._disconnectWorkspaceSignals();

        this._lastWorkspace = global.screen.get_active_workspace();

        this._workspaceWindowAddedId = this._lastWorkspace.connect('window-added', () => this._queueRedisplay());
        this._workspaceWindowRemovedId = this._lastWorkspace.connect('window-removed', () => this._queueRedisplay());
    },

    _disconnectWorkspaceSignals: function() {
        if (this._lastWorkspace) {
            this._lastWorkspace.disconnect(this._workspaceWindowAddedId);
            this._lastWorkspace.disconnect(this._workspaceWindowRemovedId);

            this._lastWorkspace = null;
        }
    },

    _queueRedisplay: function () {
        Main.queueDeferredWork(this._workId);
    },

    _hookUpLabel: function(item, appIcon) {
        item.child.connect('notify::hover', Lang.bind(this, function() {
            this._syncLabel(item, appIcon);
        }));

        if (appIcon) {
            appIcon.connect('sync-tooltip', Lang.bind(this, function() {
                this._syncLabel(item, appIcon);
            }));
        }
    },

    _createAppItem: function(app, window, isLauncher) {
        let appIcon = new AppIcons.taskbarAppIcon(
            this._dtpSettings, 
            {
                app: app, 
                window: window,
                isLauncher: isLauncher
            },
            { 
                setSizeManually: true,
                showLabel: false 
            }
        );

        if (appIcon._draggable) {
            appIcon._draggable.connect('drag-begin',
                                       Lang.bind(this, function() {
                                           appIcon.actor.opacity = 50;
                                       }));
            appIcon._draggable.connect('drag-end',
                                       Lang.bind(this, function() {
                                           appIcon.actor.opacity = 255;
                                       }));
        }

        appIcon.connect('menu-state-changed',
                        Lang.bind(this, function(appIcon, opened) {
                            this._itemMenuStateChanged(item, opened);
                        }));

        let item = new Dash.DashItemContainer();

        extendDashItemContainer(item);

        item.setChild(appIcon.actor);
        appIcon._dashItemContainer = item;

        appIcon.actor.connect('notify::hover', Lang.bind(this, function() {
            if (appIcon.actor.hover){
                this._ensureAppIconVisibilityTimeoutId = Mainloop.timeout_add(100, Lang.bind(this, function(){
                    ensureActorVisibleInScrollView(this._scrollView, appIcon.actor);
                    this._ensureAppIconVisibilityTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                }));
            } else {
                if (this._ensureAppIconVisibilityTimeoutId>0) {
                    Mainloop.source_remove(this._ensureAppIconVisibilityTimeoutId);
                    this._ensureAppIconVisibilityTimeoutId = 0;
                }
            }
        }));

        appIcon.actor.connect('clicked',
            Lang.bind(this, function(actor) {
                ensureActorVisibleInScrollView(this._scrollView, actor);
        }));

        appIcon.actor.connect('key-focus-in', Lang.bind(this, function(actor) {
                let [x_shift, y_shift] = ensureActorVisibleInScrollView(this._scrollView, actor);

                // This signal is triggered also by mouse click. The popup menu is opened at the original
                // coordinates. Thus correct for the shift which is going to be applied to the scrollview.
                if (appIcon._menu) {
                    appIcon._menu._boxPointer.xOffset = -x_shift;
                    appIcon._menu._boxPointer.yOffset = -y_shift;
                }
        }));
        
        // Override default AppIcon label_actor, now the
        // accessible_name is set at DashItemContainer.setLabelText
        appIcon.actor.label_actor = null;
        item.setLabelText(app.get_name());

        appIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(item, appIcon);

        return item;
    },

    _toggleWindowPreview: function() {
        if (this._dtpSettings.get_boolean('show-window-previews'))
            this._enableWindowPreview();
        else
            this._disableWindowPreview();
    },

    _enableWindowPreview: function() {
        let appIcons = this._getAppIcons();
        
        appIcons.filter(appIcon => !appIcon.isLauncher)
                .forEach(function (appIcon) {
            appIcon.enableWindowPreview(appIcons);
        });
    },

    _disableWindowPreview: function() {
        let appIcons = this._getAppIcons();
        appIcons.forEach(function (appIcon) {
            appIcon.disableWindowPreview();
        });
    },

    // Return an array with the "proper" appIcons currently in the taskbar
    _getAppIcons: function() {
        // Only consider children which are "proper"
        // icons (i.e. ignoring drag placeholders) and which are not
        // animating out (which means they will be destroyed at the end of
        // the animation)
        return this._getTaskbarIcons().map(function(actor){
            return actor.child._delegate;
        });
    },

    _getTaskbarIcons: function() {
        return this._box.get_children().filter(function(actor) {
            return actor.child &&
                   actor.child._delegate &&
                   actor.child._delegate.icon &&
                   !actor.animatingOut;
        });
    },

    _updateAppIconsGeometry: function() {
        let appIcons = this._getAppIcons();
        appIcons.forEach(function(icon){
            icon.updateIconGeometry();
        });
    },

    _itemMenuStateChanged: function(item, opened) {
        // When the menu closes, it calls sync_hover, which means
        // that the notify::hover handler does everything we need to.
        if (opened) {
            if (this._showLabelTimeoutId > 0) {
                Mainloop.source_remove(this._showLabelTimeoutId);
                this._showLabelTimeoutId = 0;
            }

            item.hideLabel();
        } else {
            // I want to listen from outside when a menu is closed. I used to
            // add a custom signal to the appIcon, since gnome 3.8 the signal
            // calling this callback was added upstream.
            this.emit('menu-closed');
        }
    },

    _syncLabel: function (item, appIcon) {
        let shouldShow = appIcon ? appIcon.shouldShowTooltip() : item.child.get_hover();

        if (shouldShow) {
            if (this._showLabelTimeoutId == 0) {
                let timeout = this._labelShowing ? 0 : DASH_ITEM_HOVER_TIMEOUT;
                this._showLabelTimeoutId = Mainloop.timeout_add(timeout,
                    Lang.bind(this, function() {
                        this._labelShowing = true;
                        item.showLabel();
                        this._showLabelTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }));
                GLib.Source.set_name_by_id(this._showLabelTimeoutId, '[gnome-shell] item.showLabel');
                if (this._resetHoverTimeoutId > 0) {
                    Mainloop.source_remove(this._resetHoverTimeoutId);
                    this._resetHoverTimeoutId = 0;
                }
            }
        } else {
            if (this._showLabelTimeoutId > 0)
                Mainloop.source_remove(this._showLabelTimeoutId);
            this._showLabelTimeoutId = 0;
            item.hideLabel();
            if (this._labelShowing) {
                this._resetHoverTimeoutId = Mainloop.timeout_add(DASH_ITEM_HOVER_TIMEOUT,
                    Lang.bind(this, function() {
                        this._labelShowing = false;
                        this._resetHoverTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }));
                GLib.Source.set_name_by_id(this._resetHoverTimeoutId, '[gnome-shell] this._labelShowing');
            }
        }
    },

    _adjustIconSize: function() {
        // For the icon size, we only consider children which are "proper"
        // icons (i.e. ignoring drag placeholders) and which are not
        // animating out (which means they will be destroyed at the end of
        // the animation)
        let iconChildren = this._getTaskbarIcons();

        iconChildren.push(this._showAppsIcon);

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let iconSizes = this._availableIconSizes.map(function(s) {
            return s * scaleFactor;
        });

        // Getting the panel height and making sure that the icon padding is at
        // least the size of the app running indicator on both the top and bottom.
        let availSize = Main.panel.actor.get_height() - (this._dtpSettings.get_int('dot-size') * scaleFactor * 2);

        let newIconSize = this._availableIconSizes[0];
        for (let i = 0; i < iconSizes.length ; i++) {
            if (iconSizes[i] < availSize) {
                newIconSize = this._availableIconSizes[i];
            }
        }

        if (newIconSize == this.iconSize)
            return;

        let oldIconSize = this.iconSize;
        this.iconSize = newIconSize;
        this.emit('icon-size-changed');

        let scale = oldIconSize / newIconSize;
        for (let i = 0; i < iconChildren.length; i++) {
            let icon = iconChildren[i].child._delegate.icon;

            // Set the new size immediately, to keep the icons' sizes
            // in sync with this.iconSize
            icon.setIconSize(this.iconSize);

            // Don't animate the icon size change when the overview
            // is transitioning, or when initially filling
            // the taskbar
            if (Main.overview.animationInProgress ||
                !this._shownInitially)
                continue;

            let [targetWidth, targetHeight] = icon.icon.get_size();

            // Scale the icon's texture to the previous size and
            // tween to the new size
            icon.icon.set_size(icon.icon.width * scale,
                                icon.icon.height * scale);

            Tweener.addTween(icon.icon,
                        { width: targetWidth,
                            height: targetHeight,
                            time: DASH_ANIMATION_TIME,
                            transition: 'easeOutQuad',
                        });
        }
    },

    sortAppsCompareFunction: function(appA, appB) {
        return getAppStableSequence(appA) - getAppStableSequence(appB);
    },

    sortWindowsCompareFunction: function(windowA, windowB) {
        return windowA.get_stable_sequence() - windowB.get_stable_sequence();
    },

    _redisplay: function () {
        if (!this._signalsHandler) {
            return;
        }
        
        let showFavorites = this._dtpSettings.get_boolean('show-favorites');
        //get the currently displayed appIcons
        let currentAppIcons = this._getTaskbarIcons();
        //get the user's favorite apps
        let favoriteAppsMap = showFavorites ? AppFavorites.getAppFavorites().getFavoriteMap() : {};
        let favoriteApps = Object.keys(favoriteAppsMap).map(appId => favoriteAppsMap[appId]);

        //find the apps that should be in the taskbar: the favorites first, then add the running apps
        // When using isolation, we filter out apps that have no windows in
        // the current workspace (this check is done in AppIcons.getInterstingWindows)
        let runningApps = this._getRunningApps().sort(this.sortAppsCompareFunction);
        let expectedAppInfos;
        
        if (!this.isGroupApps && this._dtpSettings.get_boolean('group-apps-use-launchers')) {
            expectedAppInfos = this._createAppInfos(favoriteApps, [], true)
                                   .concat(this._createAppInfos(runningApps)
                                               .filter(appInfo => appInfo.windows.length));
        } else {
            expectedAppInfos = this._createAppInfos(favoriteApps.concat(runningApps.filter(app => favoriteApps.indexOf(app) < 0)))
                                   .filter(appInfo => appInfo.windows.length || favoriteApps.indexOf(appInfo.app) >= 0);
        }

        //remove the appIcons which are not in the expected apps list
        for (let i = currentAppIcons.length - 1; i > -1; --i) {
            let appIcon = currentAppIcons[i].child._delegate;
            let appIndex = findIndex(expectedAppInfos, appInfo => appInfo.app == appIcon.app &&
                                                                  appInfo.isLauncher == appIcon.isLauncher);

            if (appIndex < 0 || 
                (appIcon.window && (this.isGroupApps || expectedAppInfos[appIndex].windows.indexOf(appIcon.window) < 0)) ||
                (!appIcon.window && !appIcon.isLauncher && 
                 !this.isGroupApps && expectedAppInfos[appIndex].windows.length)) {
                currentAppIcons[i].animateOutAndDestroy();
                currentAppIcons.splice(i, 1);
            }
        }

        //if needed, reorder the existing appIcons and create the missing ones
        let currentPosition = 0;
        for (let i = 0, l = expectedAppInfos.length; i < l; ++i) {
            let neededAppIcons = this.isGroupApps || !expectedAppInfos[i].windows.length ? 
                                 [{ app: expectedAppInfos[i].app, window: null, isLauncher: expectedAppInfos[i].isLauncher }] : 
                                 expectedAppInfos[i].windows.map(window => ({ app: expectedAppInfos[i].app, window: window, isLauncher: false }));
                                 
            for (let j = 0, ll = neededAppIcons.length; j < ll; ++j) {
                //check if the icon already exists
                let matchingAppIconIndex = findIndex(currentAppIcons, appIcon => appIcon.child._delegate.app == neededAppIcons[j].app && 
                                                                                 appIcon.child._delegate.window == neededAppIcons[j].window);

                if (matchingAppIconIndex > 0 && matchingAppIconIndex != currentPosition) {
                    //moved icon, reposition it
                    this._box.remove_child(currentAppIcons[matchingAppIconIndex]);
                    this._box.insert_child_at_index(currentAppIcons[matchingAppIconIndex], currentPosition);
                } else if (matchingAppIconIndex < 0) {
                    //the icon doesn't exist yet, create a new one
                    let newAppIcon = this._createAppItem(neededAppIcons[j].app, neededAppIcons[j].window, neededAppIcons[j].isLauncher);
                    
                    this._box.insert_child_at_index(newAppIcon, currentPosition);
                    currentAppIcons.splice(currentPosition, 0, newAppIcon);
                    
                    // Emit a custom signal notifying that a new item has been added
                    this.emit('item-added', newAppIcon);
                    
                    // Skip animations on first run when adding the initial set
                    // of items, to avoid all items zooming in at once
                    newAppIcon.show(this._shownInitially);
                }

                ++currentPosition;
            }
        }

        this._adjustIconSize();

        // Workaround for https://bugzilla.gnome.org/show_bug.cgi?id=692744
        // Without it, StBoxLayout may use a stale size cache
        this._box.queue_relayout();

        // This is required for icon reordering when the scrollview is used.
        this._updateAppIconsGeometry();

        // This will update the size, and the corresponding number for each icon
        this._updateNumberOverlay();

        // Connect windows previews to hover events
        this._toggleWindowPreview();

        this._shownInitially = true;
    },

    _getRunningApps: function() {
        let tracker = Shell.WindowTracker.get_default();
        let windows = global.get_window_actors();
        let apps = [];

        for (let i = 0, l = windows.length; i < l; ++i) {
            let app = tracker.get_window_app(windows[i].metaWindow);

            if (app && apps.indexOf(app) < 0) {
                apps.push(app);
            }
        }
        
        return apps;
    },

    _createAppInfos: function(apps, defaultWindows, defaultIsLauncher) {
        return apps.map(app => ({ 
            app: app, 
            isLauncher: defaultIsLauncher || false,
            windows: defaultWindows || AppIcons.getInterestingWindows(app, this._dtpSettings)
                                               .sort(this.sortWindowsCompareFunction)
        }));
    },

    // Reset the displayed apps icon to mantain the correct order
    resetAppIcons : function() {
        
        let children = this._box.get_children().filter(function(actor) {
            return actor.child &&
                actor.child._delegate &&
                actor.child._delegate.icon;
        });
        for (let i = 0; i < children.length; i++) {
            let item = children[i];
            item.destroy();
        }

        // to avoid ugly animations, just suppress them like when taskbar is first loaded.
        this._shownInitially = false;
        this._redisplay();

    },

    _updateNumberOverlay: function() {
        let appIcons = this._getAppIcons();
        let counter = 1;
        appIcons.forEach(function(icon) {
            if (counter < 10){
                icon.setNumberOverlay(counter);
                counter++;
            }
            else if (counter == 10) {
                icon.setNumberOverlay(0);
                counter++;
            }
            else {
                // No overlay after 10
                icon.setNumberOverlay(-1);
            }
            icon.updateNumberOverlay();
        });

        if (this._dtpSettings.get_boolean('hot-keys') &&
            this._dtpSettings.get_string('hotkeys-overlay-combo') === 'ALWAYS')
            this.toggleNumberOverlay(true);
    },

    toggleNumberOverlay: function(activate) {
        let appIcons = this._getAppIcons();
        appIcons.forEach(function(icon) {
            icon.toggleNumberOverlay(activate);
        });
    },

    _clearDragPlaceholder: function() {
        if (this._dragPlaceholder) {
            this._animatingPlaceholdersCount++;
            this._dragPlaceholder.animateOutAndDestroy();
            this._dragPlaceholder.connect('destroy',
                Lang.bind(this, function() {
                    this._animatingPlaceholdersCount--;
                }));
            this._dragPlaceholder = null;
        }
        this._dragPlaceholderPos = -1;
    },

    _clearEmptyDropTarget: function() {
        if (this._emptyDropTarget) {
            this._emptyDropTarget.animateOutAndDestroy();
            this._emptyDropTarget = null;
        }
    },

    handleDragOver : function(source, actor, x, y, time) {
        if (source == Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;
        
        let app = Dash.getAppFromSource(source);

        // Don't allow favoriting of transient apps
        if (app == null || app.is_window_backed())
            return DND.DragMotionResult.NO_DROP;

        if (!this._settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;

        let favorites = AppFavorites.getAppFavorites().getFavorites();
        let numFavorites = favorites.length;

        let favPos = favorites.indexOf(app);

        let children = this._box.get_children();
        let numChildren = children.length;
        let boxHeight = 0;
        for (let i = 0; i < numChildren; i++) {
            boxHeight += children[i].width;
        }

        // Keep the placeholder out of the index calculation; assuming that
        // the remove target has the same size as "normal" items, we don't
        // need to do the same adjustment there.
        if (this._dragPlaceholder) {
            boxHeight -= this._dragPlaceholder.width;
            numChildren--;
        }

        let pos;
        if (!this._emptyDropTarget){
            pos = Math.floor(x * numChildren / boxHeight);
            if (pos >  numChildren)
                pos = numChildren;
        } else
            pos = 0; // always insert at the top when taskbar is empty

        /* Take into account childredn position in rtl*/
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            pos = numChildren - pos;

        if (pos != this._dragPlaceholderPos && pos <= numFavorites && this._animatingPlaceholdersCount == 0) {
            this._dragPlaceholderPos = pos;

            // Don't allow positioning before or after self
            if (favPos != -1 && (pos == favPos || pos == favPos + 1)) {
                this._clearDragPlaceholder();
                return DND.DragMotionResult.CONTINUE;
            }

            // If the placeholder already exists, we just move
            // it, but if we are adding it, expand its size in
            // an animation
            let fadeIn;
            if (this._dragPlaceholder) {
                this._dragPlaceholder.destroy();
                fadeIn = false;
            } else {
                fadeIn = true;
            }

            this._dragPlaceholder = new Dash.DragPlaceholderItem();
            this._dragPlaceholder.child.set_width(this.iconSize);
            this._dragPlaceholder.child.set_height(this.iconSize);
            this._box.insert_child_at_index(this._dragPlaceholder,
                                            this._dragPlaceholderPos);
            this._dragPlaceholder.show(fadeIn);
            // Ensure the next and previous icon are visible when moving the placeholder
            // (I assume there's room for both of them)
            if (this._dragPlaceholderPos > 1)
                ensureActorVisibleInScrollView(this._scrollView, this._box.get_children()[this._dragPlaceholderPos-1]);
            if (this._dragPlaceholderPos < this._box.get_children().length-1)
                ensureActorVisibleInScrollView(this._scrollView, this._box.get_children()[this._dragPlaceholderPos+1]);
        }

        // Remove the drag placeholder if we are not in the
        // "favorites zone"
        if (pos > numFavorites)
            this._clearDragPlaceholder();

        if (!this._dragPlaceholder)
            return DND.DragMotionResult.NO_DROP;

        let srcIsFavorite = (favPos != -1);

        if (srcIsFavorite)
            return DND.DragMotionResult.MOVE_DROP;

        return DND.DragMotionResult.COPY_DROP;
    },

    // Draggable target interface
    acceptDrop : function(source, actor, x, y, time) {

        let app = Dash.getAppFromSource(source);

        // Don't allow favoriting of transient apps
        if (app == null || app.is_window_backed()) {
            return false;
        }

        if (!this._settings.is_writable('favorite-apps'))
            return false;

        let id = app.get_id();

        let favorites = AppFavorites.getAppFavorites().getFavoriteMap();

        let srcIsFavorite = (id in favorites);

        let favPos = 0;
        let children = this._box.get_children();
        for (let i = 0; i < this._dragPlaceholderPos; i++) {
            if (this._dragPlaceholder &&
                children[i] == this._dragPlaceholder)
                continue;

            let childId = children[i].child._delegate.app.get_id();
            if (childId == id)
                continue;
            if (childId in favorites)
                favPos++;
        }

        // No drag placeholder means we don't wan't to favorite the app
        // and we are dragging it to its original position
        if (!this._dragPlaceholder)
            return true;

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
            function () {
                let appFavorites = AppFavorites.getAppFavorites();
                if (srcIsFavorite)
                    appFavorites.moveFavoriteToPos(id, favPos);
                else
                    appFavorites.addFavoriteAtPos(id, favPos);
                return false;
            }));

        return true;
    },

    _onShowAppsButtonToggled: function() {
        // Sync the status of the default appButtons. Only if the two statuses are
        // different, that means the user interacted with the extension provided
        // application button, cutomize the behaviour. Otherwise the shell has changed the
        // status (due to the _syncShowAppsButtonToggled function below) and it
        // has already performed the desired action.

        let animate = this._dtpSettings.get_boolean('animate-show-apps');
        let selector = Main.overview.viewSelector;

        if (selector._showAppsButton.checked !== this.showAppsButton.checked) {
            // find visible view
            let visibleView;
            Main.overview.viewSelector.appDisplay._views.every(function(v, index) {
                if (v.view.actor.visible) {
                    visibleView = index;
                    return false;
                }
                else
                    return true;
            });

            if (this.showAppsButton.checked) {
                // force spring animation triggering.By default the animation only
                // runs if we are already inside the overview.
                if (!Main.overview._shown) {
                    this.forcedOverview = true;
                    let view = Main.overview.viewSelector.appDisplay._views[visibleView].view;
                    let grid = view._grid;
                    if (animate) {
                        // Animate in the the appview, hide the appGrid to avoiud flashing
                        // Go to the appView before entering the overview, skipping the workspaces.
                        // Do this manually avoiding opacity in transitions so that the setting of the opacity
                        // to 0 doesn't get overwritten.
                        Main.overview.viewSelector._activePage.opacity = 0;
                        Main.overview.viewSelector._activePage.hide();
                        Main.overview.viewSelector._activePage = Main.overview.viewSelector._appsPage;
                        Main.overview.viewSelector._activePage.show();
                        grid.actor.opacity = 0;

                        // The animation has to be trigered manually because the AppDisplay.animate
                        // method is waiting for an allocation not happening, as we skip the workspace view
                        // and the appgrid could already be allocated from previous shown.
                        // It has to be triggered after the overview is shown as wrong coordinates are obtained
                        // otherwise.
                        let overviewShownId = Main.overview.connect('shown', Lang.bind(this, function() {
                            Main.overview.disconnect(overviewShownId);
                            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
                                grid.actor.opacity = 255;
                                grid.animateSpring(IconGrid.AnimationDirection.IN, this.showAppsButton);
                            }));
                        }));
                    } else {
                        Main.overview.viewSelector._activePage = Main.overview.viewSelector._appsPage;
                        Main.overview.viewSelector._activePage.show();
                        grid.actor.opacity = 255;

                    }
                }

                // Finally show the overview
                selector._showAppsButton.checked = true;
                Main.overview.show();
            }
            else {
                if (this.forcedOverview) {
                    // force exiting overview if needed

                    if (animate) {
                        // Manually trigger springout animation without activating the
                        // workspaceView to avoid the zoomout animation. Hide the appPage
                        // onComplete to avoid ugly flashing of original icons.
                        let view = Main.overview.viewSelector.appDisplay._views[visibleView].view;
                        let grid = view._grid;
                        view.animate(IconGrid.AnimationDirection.OUT, Lang.bind(this, function() {
                            Main.overview.viewSelector._appsPage.hide();
                            Main.overview.hide();
                            selector._showAppsButton.checked = false;
                            this.forcedOverview = false;
                        }));
                    }
                    else {
                        Main.overview.hide();
                        this.forcedOverview = false;
                    }
                }
                else {
                    selector._showAppsButton.checked = false;
                    this.forcedOverview = false;
                }
            }
        }

        // whenever the button is unactivated even if not by the user still reset the
        // forcedOverview flag
        if (this.showAppsButton.checked == false)
            this.forcedOverview = false;
    },
    
    _syncShowAppsButtonToggled: function() {
        let status = Main.overview.viewSelector._showAppsButton.checked;
        if (this.showAppsButton.checked !== status)
            this.showAppsButton.checked = status;
    },
    
    showShowAppsButton: function() {
        this.showAppsButton.visible = true;
        this.showAppsButton.set_width(-1);
        this.showAppsButton.set_height(-1);
    },

    hideShowAppsButton: function() {
        this.showAppsButton.hide();
        this.showAppsButton.set_width(0);
        this.showAppsButton.set_height(0);
    },

    popupFocusedAppSecondaryMenu: function() {
        let appIcons = this._getAppIcons();
        for(let i in appIcons) {
            if(appIcons[i].app == tracker.focus_app) {
                let appIcon = appIcons[i];
                if(appIcon._menu && appIcon._menu.isOpen)
                    appIcon._menu.close();
                else
                    appIcons[i].popupMenu();
                break;
            }
        }
    }

});

Signals.addSignalMethods(taskbar.prototype);

function getAppInterestingWindows(app, settings) {
    let windows = app.get_windows().filter(function(w) {
        return !w.skip_taskbar;
    });

    return windows;
}

function getAppStableSequence(app) {
    let windows = getAppInterestingWindows(app);
    
    return windows.reduce((prevWindow, window) => {
        return Math.min(prevWindow, window.get_stable_sequence());
    }, Infinity);
}

/*
 * This is a copy of the same function in utils.js, but also adjust horizontal scrolling
 * and perform few further cheks on the current value to avoid changing the values when
 * it would be clamp to the current one in any case.
 * Return the amount of shift applied
*/
function ensureActorVisibleInScrollView(scrollView, actor) {

    let adjust_v = true;
    let adjust_h = true;

    let vadjustment = scrollView.vscroll.adjustment;
    let hadjustment = scrollView.hscroll.adjustment;
    let [vvalue, vlower, vupper, vstepIncrement, vpageIncrement, vpageSize] = vadjustment.get_values();
    let [hvalue, hlower, hupper, hstepIncrement, hpageIncrement, hpageSize] = hadjustment.get_values();

    let [hvalue0, vvalue0] = [hvalue, vvalue];

    let voffset = 0;
    let hoffset = 0;
    let fade = scrollView.get_effect("fade");
    if (fade){
        voffset = fade.vfade_offset;
        hoffset = fade.hfade_offset;
    }

    let box = actor.get_allocation_box();
    let y1 = box.y1, y2 = box.y2, x1 = box.x1, x2 = box.x2;

    let parent = actor.get_parent();
    while (parent != scrollView) {
        if (!parent)
            throw new Error("actor not in scroll view");

        let box = parent.get_allocation_box();
        y1 += box.y1;
        y2 += box.y1;
        x1 += box.x1;
        x2 += box.x1;
        parent = parent.get_parent();
    }

    if (y1 < vvalue + voffset)
        vvalue = Math.max(0, y1 - voffset);
    else if (vvalue < vupper - vpageSize && y2 > vvalue + vpageSize - voffset)
        vvalue = Math.min(vupper -vpageSize, y2 + voffset - vpageSize);

    if (x1 < hvalue + hoffset)
        hvalue = Math.max(0, x1 - hoffset);
    else if (hvalue < hupper - hpageSize && x2 > hvalue + hpageSize - hoffset)
        hvalue = Math.min(hupper - hpageSize, x2 + hoffset - hpageSize);

    if (vvalue !== vvalue0) {
        Tweener.addTween(vadjustment,
                         { value: vvalue,
                           time: Util.SCROLL_TIME,
                           transition: 'easeOutQuad' });
    }

    if (hvalue !== hvalue0) {
        Tweener.addTween(hadjustment,
                         { value: hvalue,
                           time: Util.SCROLL_TIME,
                           transition: 'easeOutQuad' });
    }

    return [hvalue- hvalue0, vvalue - vvalue0];
}
