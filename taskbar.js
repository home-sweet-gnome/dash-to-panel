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
const SecondaryMenu = Me.imports.secondaryMenu;
const WindowPreview = Me.imports.windowPreview;

let DASH_ANIMATION_TIME = Dash.DASH_ANIMATION_TIME;
let DASH_ITEM_LABEL_SHOW_TIME = Dash.DASH_ITEM_LABEL_SHOW_TIME;
let DASH_ITEM_LABEL_HIDE_TIME = Dash.DASH_ITEM_LABEL_HIDE_TIME;
let DASH_ITEM_HOVER_TIMEOUT = Dash.DASH_ITEM_HOVER_TIMEOUT;
let LABEL_GAP = 5;
let RUNNING_INDICATOR_SIZE = 3;
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

// define first this function to use it in extendDashItemContainer
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

    let position = getPosition();
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

function extendDashItemContainer(dashItemContainer) {
    dashItemContainer.showLabel = ItemShowLabel;
};

/* This class is a fork of the upstream DashActor class (ui.dash.js)
 *
 * Summary of changes:
 * - modified chldBox calculations for when 'show-apps-at-top' option is checked
 * - handle horizontal dash
 */

const taskbarActor = new Lang.Class({
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

const taskbar = new Lang.Class({
    Name: 'DashToPanel.Taskbar',

    _init : function(settings) {
        this._dtpSettings = settings;
        this._maxWidth = -1;
        this.iconSize = 32;
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
        this._showAppsIcon.showLabel = ItemShowLabel;
        this.showAppsButton = this._showAppsIcon.toggleButton;
        this._showAppsIcon.actor = this.showAppsButton;
             
        this.showAppsButton.connect('notify::checked', Lang.bind(this, this._onShowAppsButtonToggled));

        this._showAppsIcon.childScale = 1;
        this._showAppsIcon.childOpacity = 255;
        this._showAppsIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(this._showAppsIcon);

        this._container.add_actor(this._showAppsIcon);

        if (!this._dtpSettings.get_boolean('show-show-apps-button'))
            this.hideShowAppsButton();

        let rtl = Clutter.get_default_text_direction() == Clutter.TextDirection.RTL;
        this.actor = new St.Bin({ child: this._container,
            y_align: St.Align.START, x_align:rtl?St.Align.END:St.Align.START
        });

        Main.panel.actor.connect('notify::height', Lang.bind(this,
            function() {
                this._queueRedisplay();
            }));

        this.actor.connect('notify::width', Lang.bind(this,
            function() {
                if (this._maxWidth < this.actor.width) {
                    this._maxWidth = this.actor.width;
                    this._queueRedisplay();
                }
            }));

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
                this._appSystem,
                'app-state-changed',
                Lang.bind(this, this._queueRedisplay)
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
            ]
        );

        this._bindSettingsChanges();
    },

    destroy: function() {
        this._signalsHandler.destroy();
    },

    _bindSettingsChanges: function () {
        this._dtpSettings.connect('changed::show-show-apps-button', Lang.bind(this, function() {
            if (this._dtpSettings.get_boolean('show-show-apps-button'))
                this.showShowAppsButton();
            else
                this.hideShowAppsButton();
        }));
    },

    _onScrollEvent: function(actor, event) {

        // Event coordinates are relative to the stage but can be transformed
        // as the actor will only receive events within his bounds.
        let stage_x, stage_y, ok, event_x, event_y, actor_w, actor_h;
        [stage_x, stage_y] = event.get_coords();
        [ok, event_x, event_y] = actor.transform_stage_point(stage_x, stage_y);
        [actor_w, actor_h] = actor.get_size();

        // If the scroll event is within a 1px margin from
        // the relevant edge of the actor, let the event propagate.
        if ((this._position == St.Side.TOP && event_y <= 1) ||
            (this._position == St.Side.BOTTOM && event_y >= actor_h - 2))
            return Clutter.EVENT_PROPAGATE;

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
        DND.removeDragMonitor(this._dragMonitor);
    },

    _onDragMotion: function(dragEvent) {
        let app = Dash.getAppFromSource(dragEvent.source);
        if (app == null)
            return DND.DragMotionResult.CONTINUE;

        if (!this._box.contains(dragEvent.targetActor))
            this._clearDragPlaceholder();

        return DND.DragMotionResult.CONTINUE;
    },

    _appIdListToHash: function(apps) {
        let ids = {};
        for (let i = 0; i < apps.length; i++)
            ids[apps[i].get_id()] = apps[i];
        return ids;
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

    _createAppItem: function(app) {
        let appIcon = new taskbarAppIcon(this._dtpSettings, app,
                                             { setSizeManually: true,
                                               showLabel: false });

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

        appIcon.windowPreview.connect('menu-closed', Lang.bind(this, function(menu) {
            let appIcons = this._getAppIcons();
            // enter-event doesn't fire on an app icon when the popup menu from a previously
            // hovered app icon is still open, so when a preview menu closes we need to
            // see if a new app icon is hovered and open its preview menu now.
            // also, for some reason actor doesn't report being hovered by get_hover()
            // if the hover started when a popup was opened. So, look for the actor by mouse position.
            let [x, y,] = global.get_pointer();
            let hoveredActor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            let appIconToOpen;
            appIcons.forEach(function (appIcon) {
                if(appIcon.actor == hoveredActor) {
                    appIconToOpen = appIcon;
                } else if(appIcon.windowPreview && appIcon.windowPreview.isOpen) {
                    appIcon.windowPreview.close();
                }
            });

            if(appIconToOpen) {
                appIconToOpen.actor.sync_hover();
                if(appIconToOpen.windowPreview && appIconToOpen.windowPreview != menu) 
                    appIconToOpen.windowPreview._onEnter();
            }
            return GLib.SOURCE_REMOVE;

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

    // Return an array with the "proper" appIcons currently in the taskbar
    _getAppIcons: function() {
        // Only consider children which are "proper"
        // icons (i.e. ignoring drag placeholders) and which are not
        // animating out (which means they will be destroyed at the end of
        // the animation)
        let iconChildren = this._box.get_children().filter(function(actor) {
            return actor.child &&
                   actor.child._delegate &&
                   actor.child._delegate.icon &&
                   !actor.animatingOut;
        });

        let appIcons = iconChildren.map(function(actor){
            return actor.child._delegate;
        });

        return appIcons;
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
        let iconChildren = this._box.get_children().filter(function(actor) {
            return actor.child &&
                   actor.child._delegate &&
                   actor.child._delegate.icon &&
                   !actor.animatingOut;
        });

        iconChildren.push(this._showAppsIcon);

        if (this._maxWidth == -1)
            return;

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let iconSizes = this._availableIconSizes.map(function(s) {
            return s * scaleFactor;
        });

        // Getting the panel height and making sure that the icon padding is at
        // least the size of the app running indicator on both the top and bottom.
        let availSize = Main.panel.actor.get_height() - (RUNNING_INDICATOR_SIZE * 2);

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
        let windowA = getAppInterestingWindows(appA)[0];
        let windowB = getAppInterestingWindows(appB)[0];
        return windowA.get_stable_sequence() > windowB.get_stable_sequence();
    },

    _redisplay: function () {
        let favorites = AppFavorites.getAppFavorites().getFavoriteMap();

        let running = this._appSystem.get_running().sort(this.sortAppsCompareFunction);
        if (this._dtpSettings.get_boolean('isolate-workspaces')) {
            // When using isolation, we filter out apps that have no windows in
            // the current workspace
            let settings = this._dtpSettings;
            running = running.filter(function(_app) {
                return getInterestingWindows(_app, settings).length != 0;
            });
        }

        let children = this._box.get_children().filter(function(actor) {
                return actor.child &&
                       actor.child._delegate &&
                       actor.child._delegate.app;
            });
        // Apps currently in the taskbar
        let oldApps = children.map(function(actor) {
                return actor.child._delegate.app;
            });
        // Apps supposed to be in the taskbar
        let newApps = [];

        // Adding favorites
        for (let id in favorites)
            newApps.push(favorites[id]);

        // Adding running apps
        for (let i = 0; i < running.length; i++) {
            let app = running[i];
            if (app.get_id() in favorites)
                continue;
            newApps.push(app);
        }

        // Figure out the actual changes to the list of items; we iterate
        // over both the list of items currently in the taskbar and the list
        // of items expected there, and collect additions and removals.
        // Moves are both an addition and a removal, where the order of
        // the operations depends on whether we encounter the position
        // where the item has been added first or the one from where it
        // was removed.
        // There is an assumption that only one item is moved at a given
        // time; when moving several items at once, everything will still
        // end up at the right position, but there might be additional
        // additions/removals (e.g. it might remove all the launchers
        // and add them back in the new order even if a smaller set of
        // additions and removals is possible).
        // If above assumptions turns out to be a problem, we might need
        // to use a more sophisticated algorithm, e.g. Longest Common
        // Subsequence as used by diff.
        let addedItems = [];
        let removedActors = [];

        let newIndex = 0;
        let oldIndex = 0;
        while (newIndex < newApps.length || oldIndex < oldApps.length) {
            // No change at oldIndex/newIndex
            if (oldApps[oldIndex] == newApps[newIndex]) {
                oldIndex++;
                newIndex++;
                continue;
            }

            // App removed at oldIndex
            if (oldApps[oldIndex] &&
                newApps.indexOf(oldApps[oldIndex]) == -1) {
                removedActors.push(children[oldIndex]);
                oldIndex++;
                continue;
            }

            // App added at newIndex
            if (newApps[newIndex] &&
                oldApps.indexOf(newApps[newIndex]) == -1) {
                addedItems.push({ app: newApps[newIndex],
                                  item: this._createAppItem(newApps[newIndex]),
                                  pos: newIndex });
                newIndex++;
                continue;
            }

            // App moved
            let insertHere = newApps[newIndex + 1] &&
                             newApps[newIndex + 1] == oldApps[oldIndex];
            let alreadyRemoved = removedActors.reduce(function(result, actor) {
                let removedApp = actor.child._delegate.app;
                return result || removedApp == newApps[newIndex];
            }, false);

            if (insertHere || alreadyRemoved) {
                let newItem = this._createAppItem(newApps[newIndex]);
                addedItems.push({ app: newApps[newIndex],
                                  item: newItem,
                                  pos: newIndex + removedActors.length });
                newIndex++;
            } else {
                removedActors.push(children[oldIndex]);
                oldIndex++;
            }
        }

        for (let i = 0; i < addedItems.length; i++)
            this._box.insert_child_at_index(addedItems[i].item,
                                            addedItems[i].pos);

        for (let i = 0; i < removedActors.length; i++) {
            let item = removedActors[i];
            item.animateOutAndDestroy();
        }

        this._adjustIconSize();

        for (let i = 0; i < addedItems.length; i++){
            // Emit a custom signal notifying that a new item has been added
            this.emit('item-added', addedItems[i]);
        }

        // Skip animations on first run when adding the initial set
        // of items, to avoid all items zooming in at once

        let animate = this._shownInitially;

        if (!this._shownInitially)
            this._shownInitially = true;

        for (let i = 0; i < addedItems.length; i++) {
            addedItems[i].item.show(animate);
        }

        // Workaround for https://bugzilla.gnome.org/show_bug.cgi?id=692744
        // Without it, StBoxLayout may use a stale size cache
        this._box.queue_relayout();

        // This is required for icon reordering when the scrollview is used.
        this._updateAppIconsGeometry();
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
                    if (animate) {
                        let view = Main.overview.viewSelector.appDisplay._views[visibleView].view;
                        let grid = view._grid;

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
    }

});

Signals.addSignalMethods(taskbar.prototype);


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

let tracker = Shell.WindowTracker.get_default();

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

        this._dots = null;

        this._dtpSettings.connect('changed::dot-position', Lang.bind(this, this._showDots));
        this._showDots();

        this._dtpSettings.connect('changed::appicon-margin', Lang.bind(this, this._setMargin));
        this._setMargin();        

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
        // in quick succession (for example, clicking the icon as the preview window is opening)
        // So, instead I'll issue the grab when the preview menu is actually entered.
        // Alternatively, I was able to solve this by waiting a 100ms timeout to ensure the menu was
        // still open, but this waiting until the menu is entered seems a bit safer if it doesn't cause other issues
        let windowPreviewMenuData = this.menuManagerWindowPreview._menus[this.menuManagerWindowPreview._findMenu(this.windowPreview)];
        this.windowPreview.disconnect(windowPreviewMenuData.openStateChangeId);
        windowPreviewMenuData.openStateChangeId = this.windowPreview.connect('open-state-changed', Lang.bind(this.menuManagerWindowPreview, function(menu, open) {
            if (open) {
                if (this.activeMenu)
                    this.activeMenu.close(BoxPointer.PopupAnimation.FADE);

                // Mainloop.timeout_add(100, Lang.bind(this, function() {
                //     if(menu.isOpen)
                //         this._grabHelper.grab({ actor: menu.actor, focus: menu.sourceActor, onUngrab: Lang.bind(this, this._closeMenu, menu) });
                // }));
            } else {
                this._grabHelper.ungrab({ actor: menu.actor });
            }
        }));
        
        this.forcedOverview = false;
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
        this._updateRunningStyle();
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
        if (this._dots) {
            this._updateCounterClass();
            return;
        }

        this._dots = new St.DrawingArea({x_expand: true, y_expand: true});
        this._dots.connect('repaint', Lang.bind(this,
            function() {
                    this._drawCircles(this._dots);
                    this._onFocusAppChanged();
            }));
        this._iconContainer.add_child(this._dots);
        this._updateCounterClass();

    },

    _setMargin: function() {
        let margin = this._dtpSettings.get_int('appicon-margin');
        if(margin != null)
            this.actor.set_style('margin: 0 ' + margin + 'px;');
    },

    _updateRunningStyle: function() {
        // When using workspace isolation, we need to hide the dots of apps with
        // no windows in the current workspace
        if (this._dtpSettings.get_boolean('isolate-workspaces')) {
            if (this.app.state != Shell.AppState.STOPPED
                && getInterestingWindows(this.app, this._dtpSettings).length != 0)
                this._dot.show();
            else
                this._dot.hide();
        }

        this._updateCounterClass();
    },

    popupMenu: function() {
        this._removeMenuTimeout();
        this.actor.fake_release();
        this._draggable.fakeRelease();

        if (!this._menu) {
            this._menu = new SecondaryMenu.taskbarSecondaryMenu(this, this._dtpSettings);
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

    _onFocusAppChanged: function() {
        if(tracker.focus_app == this.app) {
            this._dot.opacity = 255;
            this.actor.add_style_class_name('focused');
            Tweener.addTween(this._dot,
                             { width: this._iconContainer.get_width(),
                               height: RUNNING_INDICATOR_SIZE,
                               time: DASH_ANIMATION_TIME,
                               transition: 'easeInOutCubic',
                             });
             Tweener.addTween(this._dots,
                              { opacity: 0,
                                time: DASH_ANIMATION_TIME,
                                transition: 'easeInOutCubic',
                              });
        } else {
            this._dot.opacity = 255;
            this.actor.remove_style_class_name('focused');
            Tweener.addTween(this._dot,
                             { width: 0,
                               height: RUNNING_INDICATOR_SIZE,
                               time: DASH_ANIMATION_TIME,
                               transition: 'easeInOutCubic',
                             });
             Tweener.addTween(this._dots,
                              { opacity: 255,
                                time: DASH_ANIMATION_TIME,
                                transition: 'easeInOutCubic',
                              });
        }
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
                        activateNextWindow(this.app, false, this._dtpSettings);
                    else {
                        activateFirstWindow(this.app, this._dtpSettings);
                    }
                }
                else
                    this.app.activate();
                break;
            case "CYCLE-MIN":
                if (!Main.overview._shown){
                    if (this.app == focusedApp)
                        activateNextWindow(this.app, true, this._dtpSettings);
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
            this.animateLaunch();
            this.app.open_new_window(-1);
        }

        Main.overview.hide();
    },

    _updateCounterClass: function() {

        if(this._dtpSettings.get_string('dot-position') == "TOP")
            this._dot.set_y_align(Clutter.ActorAlign.START);
        else
            this._dot.set_y_align(Clutter.ActorAlign.END);

        let maxN = 4;
        this._nWindows = Math.min(getInterestingWindows(this.app, this._dtpSettings).length, maxN);

        for (let i = 1; i <= maxN; i++){
            let className = 'running'+i;
            if(i != this._nWindows)
                this.actor.remove_style_class_name(className);
            else
                this.actor.add_style_class_name(className);
        }

        if (this._dots)
            this._dots.queue_repaint();
    },

    _drawCircles: function(area) {
        // Re-use the style - background color, and border width and color -
        // of the default dot
        let themeNode = this._dot.get_theme_node();
        let bodyColor = themeNode.get_background_color();

        let [width, height] = area.get_surface_size();
        let cr = area.get_context();

        // Draw the required numbers of dots
        let radius = RUNNING_INDICATOR_SIZE/2;
        let padding = 0; // distance from the margin
        let spacing = width/22; // separation between the dots
        let n = this._nWindows;

        Clutter.cairo_set_source_color(cr, bodyColor);

        cr.translate((width - (2*n)*radius - (n-1)*spacing)/2, this._dtpSettings.get_string('dot-position') == "TOP" ? 0 : (height- padding- 2*radius));
        for (let i = 0; i < n; i++) {
            cr.newSubPath();
            cr.arc((2*i+1)*radius + i*spacing, radius, radius, 0, 2*Math.PI);
        }

        cr.fill();
        cr.$dispose();
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

    let windows = getInterestingWindows(app, settings).sort(function(windowA, windowB) {
        return windowA.get_stable_sequence() > windowB.get_stable_sequence();
    });

    Main.activateWindow(windows[0]);
}

/*
 * Activate the next running window for the current application
 */
function activateNextWindow(app, shouldMinimize, settings){

    let windows = getInterestingWindows(app, settings).sort(function(windowA, windowB) {
        return windowA.get_stable_sequence() > windowB.get_stable_sequence();
    });

    let focused_window = global.display.focus_window;

    for (let i = 0 ; i < windows.length; i++){
        if(windows[i] == focused_window) {
            if(i < windows.length - 1)
                Main.activateWindow(windows[i + 1]);
            else
                shouldMinimize ? minimizeWindow(app, true, settings) : Main.activateWindow(windows[0]); 

            break;
        }
    }
}

function closeAllWindows(app, settings) {
    let windows = getInterestingWindows(app, settings);
    for (let i = 0; i < windows.length; i++)
        windows[i].delete(global.get_current_time());
}

function getAppInterestingWindows(app, settings) {
    let windows = app.get_windows().filter(function(w) {
        return !w.skip_taskbar;
    });

    return windows;
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
