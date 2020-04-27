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
const Config = imports.misc.config;
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
const Workspace = imports.ui.workspace;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const AppIcons = Me.imports.appIcons;
const Panel = Me.imports.panel;
const Utils = Me.imports.utils;
const WindowPreview = Me.imports.windowPreview;

var DASH_ANIMATION_TIME = Dash.DASH_ANIMATION_TIME / (Dash.DASH_ANIMATION_TIME > 1 ? 1000 : 1);
var DASH_ITEM_HOVER_TIMEOUT = Dash.DASH_ITEM_HOVER_TIMEOUT;
var MIN_ICON_SIZE = 4;

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
var taskbarActor = Utils.defineClass({
    Name: 'DashToPanel-TaskbarActor',
    Extends: St.Widget,

    _init: function(delegate) {
        this._delegate = delegate;
        this._currentBackgroundColor = 0;
        this.callParent('_init', { name: 'dashtopanelTaskbar',
                                   layout_manager: new Clutter.BoxLayout({ orientation: Clutter.Orientation[Panel.getOrientation().toUpperCase()] }),
                                   clip_to_allocation: true });
    },

    vfunc_allocate: function(box, flags)  {
        this.set_allocation(box, flags);

        let availFixedSize = box[Panel.fixedCoord.c2] - box[Panel.fixedCoord.c1];
        let availVarSize = box[Panel.varCoord.c2] - box[Panel.varCoord.c1];
        let [, showAppsButton, scrollview, leftFade, rightFade] = this.get_children();
        let [, showAppsNatSize] = showAppsButton[Panel.sizeFunc](availFixedSize);
        let [, natSize] = this[Panel.sizeFunc](availFixedSize);
        let childBox = new Clutter.ActorBox();
        let orientation = Panel.getOrientation().toLowerCase();

        childBox[Panel.varCoord.c1] = box[Panel.varCoord.c1];
        childBox[Panel.fixedCoord.c1] = box[Panel.fixedCoord.c1];

        childBox[Panel.varCoord.c2] = box[Panel.varCoord.c1] + showAppsNatSize;
        childBox[Panel.fixedCoord.c2] = box[Panel.fixedCoord.c2];
        showAppsButton.allocate(childBox, flags);

        childBox[Panel.varCoord.c1] = box[Panel.varCoord.c1] + showAppsNatSize;
        childBox[Panel.varCoord.c2] = Math.min(availVarSize, natSize);
        scrollview.allocate(childBox, flags);

        let [hvalue, , hupper, , , hpageSize] = scrollview[orientation[0] + 'scroll'].adjustment.get_values();
        hupper = Math.floor(hupper);
        scrollview._dtpFadeSize = hupper > hpageSize ? this._delegate.iconSize : 0;

        if (this._currentBackgroundColor !== this._delegate.dtpPanel.dynamicTransparency.currentBackgroundColor) {
            this._currentBackgroundColor = this._delegate.dtpPanel.dynamicTransparency.currentBackgroundColor;
            let gradientStyle = 'background-gradient-start: ' + this._currentBackgroundColor +
                                'background-gradient-direction: ' + orientation;

            leftFade.set_style(gradientStyle);
            rightFade.set_style(gradientStyle);
        }
        
        childBox[Panel.varCoord.c1] = box[Panel.varCoord.c1] + showAppsNatSize;
        childBox[Panel.varCoord.c2] = childBox[Panel.varCoord.c1] + (hvalue > 0 ? scrollview._dtpFadeSize : 0);
        leftFade.allocate(childBox, flags);

        childBox[Panel.varCoord.c1] = box[Panel.varCoord.c2] - (hvalue + hpageSize < hupper ? scrollview._dtpFadeSize : 0);
        childBox[Panel.varCoord.c2] = box[Panel.varCoord.c2];
        rightFade.allocate(childBox, flags);
    },

    // We want to request the natural size of all our children
    // as our natural width, so we chain up to StWidget (which
    // then calls BoxLayout)
    vfunc_get_preferred_width: function(forHeight) {
        let [, natWidth] = St.Widget.prototype.vfunc_get_preferred_width.call(this, forHeight);
        
        return [0, natWidth];
    },

    vfunc_get_preferred_height: function(forWidth) {
        let [, natHeight] = St.Widget.prototype.vfunc_get_preferred_height.call(this, forWidth);
        
        return [0, natHeight];
    },
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

var taskbar = Utils.defineClass({
    Name: 'DashToPanel.Taskbar',

    _init : function(panel) {
        this.dtpPanel = panel;
        
        // start at smallest size due to running indicator drawing area expanding but not shrinking
        this.iconSize = 16;

        this._shownInitially = false;

        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._showLabelTimeoutId = 0;
        this._resetHoverTimeoutId = 0;
        this._ensureAppIconVisibilityTimeoutId = 0;
        this._labelShowing = false;

        let isVertical = Panel.checkIfVertical();

        this._box = new St.BoxLayout({ vertical: isVertical,
                                       clip_to_allocation: false,
                                       x_align: Clutter.ActorAlign.START,
                                       y_align: Clutter.ActorAlign.START });

        this._container = new taskbarActor(this);
        this._scrollView = new St.ScrollView({ name: 'dashtopanelScrollview',
                                               hscrollbar_policy: Gtk.PolicyType.NEVER,
                                               vscrollbar_policy: Gtk.PolicyType.NEVER,
                                               enable_mouse_scrolling: true });

        this._scrollView.connect('scroll-event', Lang.bind(this, this._onScrollEvent ));
        this._scrollView.add_actor(this._box);

        // Create a wrapper around the real showAppsIcon in order to add a popupMenu.
        this._showAppsIconWrapper = new AppIcons.ShowAppsIconWrapper();
        this._showAppsIconWrapper.connect('menu-state-changed', Lang.bind(this, function(showAppsIconWrapper, opened) {
            this._itemMenuStateChanged(showAppsIconWrapper, opened);
        }));
        // an instance of the showAppsIcon class is encapsulated in the wrapper
        this._showAppsIcon = this._showAppsIconWrapper.realShowAppsIcon;
        this.showAppsButton = this._showAppsIcon.toggleButton;

        if (isVertical) {
            this.showAppsButton.set_width(panel.geom.w);
        }

        this.showAppsButton.connect('notify::checked', Lang.bind(this, this._onShowAppsButtonToggled));
        this.showAppsButton.checked = Main.overview.viewSelector._showAppsButton.checked;

        this._showAppsIcon.childScale = 1;
        this._showAppsIcon.childOpacity = 255;
        this._showAppsIcon.icon.setIconSize(this.iconSize);
        this._hookUpLabel(this._showAppsIcon, this._showAppsIconWrapper);

        this._container.add_child(new St.Widget({ width: 0, reactive: false }));
        this._container.add_actor(this._showAppsIcon);
        this._container.add_actor(this._scrollView);
        
        let fadeStyle = 'background-gradient-direction:' + Panel.getOrientation();
        let fade1 = new St.Widget({ style_class: 'scrollview-fade', reactive: false });
        let fade2 = new St.Widget({ style_class: 'scrollview-fade', 
                                    reactive: false,  
                                    pivot_point: Utils.getPoint({ x: .5, y: .5 }), 
                                    rotation_angle_z: 180 });

        fade1.set_style(fadeStyle);
        fade2.set_style(fadeStyle);

        this._container.add_actor(fade1);
        this._container.add_actor(fade2);

        this.previewMenu = new WindowPreview.PreviewMenu(panel);
        this.previewMenu.enable();

        if (!Me.settings.get_boolean('show-show-apps-button'))
            this.hideShowAppsButton();

        let rtl = Clutter.get_default_text_direction() == Clutter.TextDirection.RTL;
        this.actor = new St.Bin({ child: this._container,
            y_align: St.Align.START, x_align:rtl?St.Align.END:St.Align.START
        });

        // Update minimization animation target position on allocation of the
        // container and on scrollview change.
        this._box.connect('notify::allocation', Lang.bind(this, this._updateAppIcons));
        let scrollViewAdjustment = this._scrollView.hscroll.adjustment;
        scrollViewAdjustment.connect('notify::value', Lang.bind(this, this._updateAppIcons));

        this._workId = Main.initializeDeferredWork(this._box, Lang.bind(this, this._redisplay));

        this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

        this._appSystem = Shell.AppSystem.get_default();

        this._signalsHandler.add(
            [
                this.dtpPanel.panel.actor,
                'notify::height',
                () => this._queueRedisplay()
            ],
            [
                this.dtpPanel.panel.actor,
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
           	    this._appSystem,
           	    'app-state-changed',
          	    Lang.bind(this, this._queueRedisplay)
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
                Utils.DisplayWrapper.getScreen(),
                [
                    'window-entered-monitor',
                    'window-left-monitor'
                ],
                () => {
                    if (Me.settings.get_boolean('isolate-monitors')) {
                        this._queueRedisplay();
                    }
                }
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
                Me.settings,
                'changed::show-show-apps-button',
                Lang.bind(this, function() {
                    if (Me.settings.get_boolean('show-show-apps-button'))
                        this.showShowAppsButton();
                    else
                        this.hideShowAppsButton();

                    this.resetAppIcons();
                })
            ],
            [
                Me.settings,
                [
                    'changed::dot-size',
                    'changed::show-favorites',
                    'changed::show-running-apps',
                    'changed::show-favorites-all-monitors'
                ],
                Lang.bind(this, this._redisplay)
            ],
            [
                Me.settings,
                'changed::group-apps',
                Lang.bind(this, function() {
                    this.isGroupApps = Me.settings.get_boolean('group-apps');
                    this._connectWorkspaceSignals();
                })
            ],
            [
                Me.settings,
                [
                    'changed::group-apps-use-launchers',
                    'changed::taskbar-locked'
                ],
                () => this.resetAppIcons()
            ]
        );

        this.isGroupApps = Me.settings.get_boolean('group-apps');

        this._connectWorkspaceSignals();
    },

    destroy: function() {
        this._signalsHandler.destroy();
        this._signalsHandler = 0;
        this._showAppsIconWrapper.destroy();

        this._container.destroy();
        
        this.previewMenu.disable();
        this.previewMenu.destroy();

        this._disconnectWorkspaceSignals();
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
        case Clutter.ScrollDirection.LEFT:
            delta = -increment;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
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

        this._toggleFavortieHighlight(true);
    },

    _onDragCancelled: function() {
        this._dragCancelled = true;

        if (this._dragInfo) {
            this._box.set_child_at_index(this._dragInfo[1]._dashItemContainer, this._dragInfo[0]);
        }
        
        this._endDrag();
    },

    _onDragEnd: function() {
        if (this._dragCancelled)
            return;

        this._endDrag();
    },

    _endDrag: function() {
        if (this._dragInfo && this._dragInfo[1]._dashItemContainer instanceof DragPlaceholderItem) {
            this._box.remove_child(this._dragInfo[1]._dashItemContainer);
            this._dragInfo[1]._dashItemContainer.destroy();
            delete this._dragInfo[1]._dashItemContainer;
        }

        this._dragInfo = null;
        this._clearEmptyDropTarget();
        this._showAppsIcon.setDragApp(null);
        DND.removeDragMonitor(this._dragMonitor);
        
        this._toggleFavortieHighlight();
    },

    _onDragMotion: function(dragEvent) {
        let app = Dash.getAppFromSource(dragEvent.source);
        if (app == null)
            return DND.DragMotionResult.CONTINUE;

         let showAppsHovered = this._showAppsIcon.contains(dragEvent.targetActor);

        if (showAppsHovered)
            this._showAppsIcon.setDragApp(app);
        else
            this._showAppsIcon.setDragApp(null);

        return DND.DragMotionResult.CONTINUE;
    },

    _toggleFavortieHighlight: function(show) {
        let appFavorites = AppFavorites.getAppFavorites();
        let cssFuncName = (show ? 'add' : 'remove') + '_style_class_name';
        
        this._getAppIcons().filter(appIcon => appFavorites.isFavorite(appIcon.app.get_id()))
                           .forEach(fav => fav._container[cssFuncName]('favorite'));
    },

    handleIsolatedWorkspaceSwitch: function() {
        this._shownInitially = this.isGroupApps;
        this._queueRedisplay();
    },

    _connectWorkspaceSignals: function() {
        this._disconnectWorkspaceSignals();

        this._lastWorkspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace();

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

    _hookUpLabel: function(item, syncHandler) {
        item.child.connect('notify::hover', Lang.bind(this, function() {
            this._syncLabel(item, syncHandler);
        }));

        syncHandler.connect('sync-tooltip', Lang.bind(this, function() {
            this._syncLabel(item, syncHandler);
        }));
    },

    _createAppItem: function(app, window, isLauncher) {
        let appIcon = new AppIcons.taskbarAppIcon(
            {
                app: app, 
                window: window,
                isLauncher: isLauncher
            },
            this.dtpPanel,
            { 
                setSizeManually: true,
                showLabel: false,
                isDraggable: !Me.settings.get_boolean('taskbar-locked'),
            },
            this.previewMenu
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
                    Utils.ensureActorVisibleInScrollView(this._scrollView, appIcon.actor, this._scrollView._dtpFadeSize);
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
                Utils.ensureActorVisibleInScrollView(this._scrollView, actor, this._scrollView._dtpFadeSize);
        }));

        appIcon.actor.connect('key-focus-in', Lang.bind(this, function(actor) {
                let [x_shift, y_shift] = Utils.ensureActorVisibleInScrollView(this._scrollView, actor, this._scrollView._dtpFadeSize);

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
        // Only consider children which are "proper" icons and which are not
        // animating out (which means they will be destroyed at the end of
        // the animation)
        return this._getTaskbarIcons().map(function(actor){
            return actor.child._delegate;
        });
    },

    _getTaskbarIcons: function(includeAnimated) {
        return this._box.get_children().filter(function(actor) {
            return actor.child &&
                   actor.child._delegate &&
                   actor.child._delegate.icon &&
                   (includeAnimated || !actor.animatingOut);
        });
    },

    _updateAppIcons: function() {
        let appIcons = this._getAppIcons();

        appIcons.filter(icon => icon.constructor === AppIcons.taskbarAppIcon).forEach(icon => {
            icon.updateIcon();
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

    _syncLabel: function (item, syncHandler) {
        let shouldShow = syncHandler ? syncHandler.shouldShowTooltip() : item.child.get_hover();

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
        let panelSize = Me.settings.get_int('panel-size');
        let availSize = panelSize - Me.settings.get_int('appicon-padding') * 2;
        let minIconSize = MIN_ICON_SIZE + panelSize % 2;

        if (availSize == this.iconSize)
            return;

        if (availSize < minIconSize) {
            availSize = minIconSize;
        }
        
        // For the icon size, we only consider children which are "proper"
        // icons and which are not animating out (which means they will be 
        // destroyed at the end of the animation)
        let iconChildren = this._getTaskbarIcons().concat([this._showAppsIcon]);
        let scale = this.iconSize / availSize;
        
        this.iconSize = availSize;

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
            icon.icon.set_size(icon.icon.width * scale, icon.icon.height * scale);

            Utils.animate(icon.icon,
                        { width: targetWidth,
                            height: targetHeight,
                            time: DASH_ANIMATION_TIME,
                            transition: 'easeOutQuad',
                        });
        }
    },

    sortAppsCompareFunction: function(appA, appB) {
        return getAppStableSequence(appA, this.dtpPanel.monitor) - 
               getAppStableSequence(appB, this.dtpPanel.monitor);
    },

    getAppInfos: function() {
        //get the user's favorite apps
        let favoriteApps = this._checkIfShowingFavorites() ? AppFavorites.getAppFavorites().getFavorites() : [];

        //find the apps that should be in the taskbar: the favorites first, then add the running apps
        // When using isolation, we filter out apps that have no windows in
        // the current workspace (this check is done in AppIcons.getInterestingWindows)
        let runningApps = this._checkIfShowingRunningApps() ? this._getRunningApps().sort(this.sortAppsCompareFunction.bind(this)) : [];

        if (!this.isGroupApps && Me.settings.get_boolean('group-apps-use-launchers')) {
            return this._createAppInfos(favoriteApps, [], true)
                       .concat(this._createAppInfos(runningApps)
                       .filter(appInfo => appInfo.windows.length));
        } else {
            return this._createAppInfos(favoriteApps.concat(runningApps.filter(app => favoriteApps.indexOf(app) < 0)))
                       .filter(appInfo => appInfo.windows.length || favoriteApps.indexOf(appInfo.app) >= 0);
        }
    },

    _redisplay: function () {
        if (!this._signalsHandler) {
            return;
        }

        //get the currently displayed appIcons
        let currentAppIcons = this._getTaskbarIcons();
        let expectedAppInfos = this.getAppInfos();

        //remove the appIcons which are not in the expected apps list
        for (let i = currentAppIcons.length - 1; i > -1; --i) {
            let appIcon = currentAppIcons[i].child._delegate;
            let appIndex = Utils.findIndex(expectedAppInfos, appInfo => appInfo.app == appIcon.app &&
                                                                        appInfo.isLauncher == appIcon.isLauncher);

            if (appIndex < 0 || 
                (appIcon.window && (this.isGroupApps || expectedAppInfos[appIndex].windows.indexOf(appIcon.window) < 0)) ||
                (!appIcon.window && !appIcon.isLauncher && 
                 !this.isGroupApps && expectedAppInfos[appIndex].windows.length)) {
                currentAppIcons[i][this._shownInitially ? 'animateOutAndDestroy' : 'destroy']();
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
                let matchingAppIconIndex = Utils.findIndex(currentAppIcons, appIcon => appIcon.child._delegate.app == neededAppIcons[j].app && 
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
        this._updateAppIcons();

        // This will update the size, and the corresponding number for each icon on the primary panel
        if (!this.dtpPanel.isSecondary) {
            this._updateNumberOverlay();
        }

        this._shownInitially = true;
    },

    _checkIfShowingRunningApps: function() {
        return Me.settings.get_boolean('show-running-apps');
    },
    
    _checkIfShowingFavorites: function() {
        return Me.settings.get_boolean('show-favorites') && 
               (!this.dtpPanel.isSecondary || Me.settings.get_boolean('show-favorites-all-monitors'));
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
            windows: defaultWindows || AppIcons.getInterestingWindows(app, this.dtpPanel.monitor)
                                               .sort(sortWindowsCompareFunction)
        }));
    },

    // Reset the displayed apps icon to mantain the correct order
    resetAppIcons : function() {
        let children = this._getTaskbarIcons(true);

        for (let i = 0; i < children.length; i++) {
            let item = children[i];
            item.destroy();
        }

        // to avoid ugly animations, just suppress them like when taskbar is first loaded.
        this._shownInitially = false;
        this._redisplay();

        if (Panel.checkIfVertical()) {
            this.showAppsButton.set_width(this.dtpPanel.geom.w);
            this.previewMenu._updateClip();
        }
    },

    _updateNumberOverlay: function() {
        let seenApps = {};
        let counter = 0;

        this._getAppIcons().forEach(function(icon) {
            if (!seenApps[icon.app]) {
                seenApps[icon.app] = 1;
                counter++;
            }

            if (counter <= 10) {
                icon.setNumberOverlay(counter == 10 ? 0 : counter);
            } else {
                // No overlay after 10
                icon.setNumberOverlay(-1);
            }

            icon.updateHotkeyNumberOverlay();
        });

        if (Me.settings.get_boolean('hot-keys') &&
            Me.settings.get_string('hotkeys-overlay-combo') === 'ALWAYS')
            this.toggleNumberOverlay(true);
    },

    toggleNumberOverlay: function(activate) {
        let appIcons = this._getAppIcons();
        appIcons.forEach(function(icon) {
            icon.toggleNumberOverlay(activate);
        });
    },

    _clearEmptyDropTarget: function() {
        if (this._emptyDropTarget) {
            this._emptyDropTarget.animateOutAndDestroy();
            this._emptyDropTarget = null;
        }
    },

    handleDragOver: function(source, actor, x, y, time) {
        if (source == Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;

        // Don't allow favoriting of transient apps
        if (source.app == null || source.app.is_window_backed())
            return DND.DragMotionResult.NO_DROP;

        if (!this._settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;

        let sourceActor = source instanceof St.Widget ? source : source.actor;

        if (!this._box.contains(sourceActor) && !source._dashItemContainer) {
            //not an appIcon of the taskbar, probably from the applications view
            source._dashItemContainer = new DragPlaceholderItem(source, this.iconSize);
            this._box.insert_child_above(source._dashItemContainer, null);
        }
        
        let isVertical = Panel.checkIfVertical();
        let sizeProp = isVertical ? 'height' : 'width';
        let posProp = isVertical ? 'y' : 'x';
        let pos = isVertical ? y : x;

        pos -= this.showAppsButton[sizeProp];

        let currentAppIcons = this._getAppIcons();
        let sourceIndex = currentAppIcons.indexOf(source);
        let hoveredIndex = Utils.findIndex(currentAppIcons, 
                                           appIcon => pos >= appIcon._dashItemContainer[posProp] && 
                                                      pos <= (appIcon._dashItemContainer[posProp] + appIcon._dashItemContainer[sizeProp]));
        
        if (!this._dragInfo) {
            this._dragInfo = [sourceIndex, source];
        }

        if (hoveredIndex >= 0) {
            let isLeft = pos < currentAppIcons[hoveredIndex]._dashItemContainer[posProp] + currentAppIcons[hoveredIndex]._dashItemContainer[sizeProp] * .5;

            // Don't allow positioning before or after self and between icons of same app
            if (!(hoveredIndex === sourceIndex ||
                  (isLeft && hoveredIndex - 1 == sourceIndex) ||
                  (isLeft && hoveredIndex - 1 >= 0 && source.app != currentAppIcons[hoveredIndex - 1].app && 
                   currentAppIcons[hoveredIndex - 1].app == currentAppIcons[hoveredIndex].app) ||
                  (!isLeft && hoveredIndex + 1 == sourceIndex) ||
                  (!isLeft && hoveredIndex + 1 < currentAppIcons.length && source.app != currentAppIcons[hoveredIndex + 1].app && 
                   currentAppIcons[hoveredIndex + 1].app == currentAppIcons[hoveredIndex].app))) {
                    this._box.set_child_at_index(source._dashItemContainer, hoveredIndex);
    
                    // Ensure the next and previous icon are visible when moving the icon
                    // (I assume there's room for both of them)
                    if (hoveredIndex > 1)
                        Utils.ensureActorVisibleInScrollView(this._scrollView, this._box.get_children()[hoveredIndex-1], this._scrollView._dtpFadeSize);
                    if (hoveredIndex < this._box.get_children().length-1)
                        Utils.ensureActorVisibleInScrollView(this._scrollView, this._box.get_children()[hoveredIndex+1], this._scrollView._dtpFadeSize);
            }
        }
        
        return this._dragInfo[0] !== sourceIndex ? DND.DragMotionResult.MOVE_DROP : DND.DragMotionResult.CONTINUE;
    },

    // Draggable target interface
    acceptDrop : function(source, actor, x, y, time) {
        // Don't allow favoriting of transient apps
        if (!source.app || source.app.is_window_backed() || !this._settings.is_writable('favorite-apps')) {
            return false;
        }

        let appIcons = this._getAppIcons();
        let sourceIndex = appIcons.indexOf(source);
        let usingLaunchers = !this.isGroupApps && Me.settings.get_boolean('group-apps-use-launchers');

        // dragging the icon to its original position
        if (this._dragInfo[0] === sourceIndex) {
            return true;
        }

        let appFavorites = AppFavorites.getAppFavorites();
        let sourceAppId = source.app.get_id();
        let appIsFavorite = appFavorites.isFavorite(sourceAppId);
        let replacingIndex = sourceIndex + (sourceIndex > this._dragInfo[0] ? -1 : 1);
        let favoriteIndex = replacingIndex >= 0 ? appFavorites.getFavorites().indexOf(appIcons[replacingIndex].app) : 0;
        let sameApps = appIcons.filter(a => a != source && a.app == source.app);
        let showingFavorites = this._checkIfShowingFavorites();
        let favoritesCount = 0;
        let position = 0;
        let interestingWindows = {};
        let getAppWindows = app => {
            if (!interestingWindows[app]) {
                interestingWindows[app] = AppIcons.getInterestingWindows(app, this.dtpPanel.monitor);
            }

            let appWindows = interestingWindows[app]; //prevents "reference to undefined property Symbol.toPrimitive" warning
            return appWindows;
        };
        
        if (sameApps.length && 
            ((!appIcons[sourceIndex - 1] || appIcons[sourceIndex - 1].app !== source.app) && 
             (!appIcons[sourceIndex + 1] || appIcons[sourceIndex + 1].app !== source.app))) {
            appIcons.splice(appIcons.indexOf(sameApps[0]), sameApps.length);
            Array.prototype.splice.apply(appIcons, [sourceIndex + 1, 0].concat(sameApps));
        }

        for (let i = 0, l = appIcons.length; i < l; ++i) {
            let windows = [];
            
            if (!usingLaunchers || (!source.isLauncher && !appIcons[i].isLauncher)) {
                windows = appIcons[i].window ? [appIcons[i].window] : getAppWindows(appIcons[i].app);
            }

            windows.forEach(w => w._dtpPosition = position++);

            if (showingFavorites && 
                ((usingLaunchers && appIcons[i].isLauncher) || 
                 (!usingLaunchers && appFavorites.isFavorite(appIcons[i].app.get_id())))) {
                ++favoritesCount;
            }
        }

        if (sourceIndex < favoritesCount) {
            if (appIsFavorite) {
                appFavorites.moveFavoriteToPos(sourceAppId, favoriteIndex);
            } else {
                appFavorites.addFavoriteAtPos(sourceAppId, favoriteIndex);
            }
        } else if (appIsFavorite && showingFavorites && (!usingLaunchers || source.isLauncher)) {
            appFavorites.removeFavorite(sourceAppId);
        }

        appFavorites.emit('changed');

        return true;
    },

    _onShowAppsButtonToggled: function() {
        // Sync the status of the default appButtons. Only if the two statuses are
        // different, that means the user interacted with the extension provided
        // application button, cutomize the behaviour. Otherwise the shell has changed the
        // status (due to the _syncShowAppsButtonToggled function below) and it
        // has already performed the desired action.

        let animate = Me.settings.get_boolean('animate-show-apps');
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
                    let grid = Main.overview.viewSelector.appDisplay._views[visibleView].view._grid;
                    let onShownCb;
                    let overviewShownId = Main.overview.connect('shown', () => {
                        Main.overview.disconnect(overviewShownId);
                        onShownCb();
                    });

                    if (animate) {
                        // Animate in the the appview, hide the appGrid to avoiud flashing
                        // Go to the appView before entering the overview, skipping the workspaces.
                        // Do this manually avoiding opacity in transitions so that the setting of the opacity
                        // to 0 doesn't get overwritten.
                        Main.overview.viewSelector._activePage.hide();
                        Main.overview.viewSelector._activePage = Main.overview.viewSelector._appsPage;
                        Main.overview.viewSelector._activePage.show();
                        grid.actor.opacity = 0;

                        // The animation has to be trigered manually because the AppDisplay.animate
                        // method is waiting for an allocation not happening, as we skip the workspace view
                        // and the appgrid could already be allocated from previous shown.
                        // It has to be triggered after the overview is shown as wrong coordinates are obtained
                        // otherwise.
                        onShownCb = () => Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
                            grid.actor.opacity = 255;
                            grid.animateSpring(IconGrid.AnimationDirection.IN, this.showAppsButton);
                        });
                    } else {
                        Main.overview.viewSelector._activePage = Main.overview.viewSelector._appsPage;
                        Main.overview.viewSelector._activePage.show();
                        onShownCb = () => grid.emit('animation-done');
                    }
                }

                //temporarily use as primary the monitor on which the showapps btn was clicked 
                this.dtpPanel.panelManager.setFocusedMonitor(this.dtpPanel.monitor);

                //reset the primary monitor when exiting the overview
                let overviewHiddenId = Main.overview.connect('hidden', () => {
                    Main.overview.disconnect(overviewHiddenId);
                    this.dtpPanel.panelManager.setFocusedMonitor(this.dtpPanel.panelManager.primaryPanel.monitor, true);
                });

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
        let tracker = Shell.WindowTracker.get_default();

        for(let i in appIcons) {
            if(appIcons[i].app == tracker.focus_app) {
                let appIcon = appIcons[i];
                if(appIcon._menu && appIcon._menu.isOpen)
                    appIcon._menu.close();
                else
                    appIcon.popupMenu();

                appIcon.sync_hover();
                break;
            }
        }
    },
});

Signals.addSignalMethods(taskbar.prototype);

var DragPlaceholderItem = Utils.defineClass({
    Name: 'DashToPanel-DragPlaceholderItem',
    Extends: St.Widget,

    _init: function(appIcon, iconSize) {
        this.callParent('_init', { style: AppIcons.getIconContainerStyle(), layout_manager: new Clutter.BinLayout() });

        this.child = { _delegate: appIcon };

        this._clone = new Clutter.Clone({ 
            source: appIcon.icon._iconBin,
            width: iconSize,
            height: iconSize
        });

        this.add_actor(this._clone);
    },

    destroy: function() {
        this._clone.destroy();
        this.callParent('destroy');
    },
});

function getAppStableSequence(app, monitor) {
    let windows = AppIcons.getInterestingWindows(app, monitor);
    
    return windows.reduce((prevWindow, window) => {
        return Math.min(prevWindow, getWindowStableSequence(window));
    }, Infinity);
}

function sortWindowsCompareFunction(windowA, windowB) {
    return getWindowStableSequence(windowA) - getWindowStableSequence(windowB);
}

function getWindowStableSequence(window) {
    return ('_dtpPosition' in window ? window._dtpPosition : window.get_stable_sequence()); 
}
