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
const GObject = imports.gi.GObject;
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
const PanelManager = Me.imports.panelManager;
const PanelSettings = Me.imports.panelSettings;
const Pos = Me.imports.panelPositions;
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

const iconAnimationSettings = {
    _getDictValue: function(key) {
        let type = Me.settings.get_string('animate-appicon-hover-animation-type');
        return Me.settings.get_value(key).deep_unpack()[type] || 0;
    },

    get type() {
        if (!Me.settings.get_boolean('animate-appicon-hover'))
            return "";

        return Me.settings.get_string('animate-appicon-hover-animation-type');
    },

    get convexity() {
        return Math.max(0, this._getDictValue('animate-appicon-hover-animation-convexity'));
    },

    get duration() {
        return this._getDictValue('animate-appicon-hover-animation-duration');
    },

    get extent() {
        return Math.max(1, this._getDictValue('animate-appicon-hover-animation-extent'));
    },

    get rotation() {
        return this._getDictValue('animate-appicon-hover-animation-rotation');
    },

    get travel() {
        return Math.max(0, this._getDictValue('animate-appicon-hover-animation-travel'));
    },

    get zoom() {
        return Math.max(1, this._getDictValue('animate-appicon-hover-animation-zoom'));
    },
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
                                   layout_manager: new Clutter.BoxLayout({ orientation: Clutter.Orientation[delegate.dtpPanel.getOrientation().toUpperCase()] }),
                                   clip_to_allocation: true });
    },

    vfunc_allocate: function(box, flags)  {
        Utils.setAllocation(this, box, flags);

        let panel = this._delegate.dtpPanel;
        let availFixedSize = box[panel.fixedCoord.c2] - box[panel.fixedCoord.c1];
        let availVarSize = box[panel.varCoord.c2] - box[panel.varCoord.c1];
        let [dummy, scrollview, leftFade, rightFade] = this.get_children();
        let [, natSize] = this[panel.sizeFunc](availFixedSize);
        let childBox = new Clutter.ActorBox();
        let orientation = panel.getOrientation();

        Utils.allocate(dummy, childBox, flags);

        childBox[panel.varCoord.c1] = box[panel.varCoord.c1];
        childBox[panel.varCoord.c2] = Math.min(availVarSize, natSize);
        childBox[panel.fixedCoord.c1] = box[panel.fixedCoord.c1];
        childBox[panel.fixedCoord.c2] = box[panel.fixedCoord.c2];

        Utils.allocate(scrollview, childBox, flags);

        let [value, , upper, , , pageSize] = scrollview[orientation[0] + 'scroll'].adjustment.get_values();
        upper = Math.floor(upper);
        scrollview._dtpFadeSize = upper > pageSize ? this._delegate.iconSize : 0;

        if (this._currentBackgroundColor !== panel.dynamicTransparency.currentBackgroundColor) {
            this._currentBackgroundColor = panel.dynamicTransparency.currentBackgroundColor;
            let gradientStyle = 'background-gradient-start: ' + this._currentBackgroundColor +
                                'background-gradient-direction: ' + orientation;

            leftFade.set_style(gradientStyle);
            rightFade.set_style(gradientStyle);
        }
        
        childBox[panel.varCoord.c2] = childBox[panel.varCoord.c1] + (value > 0 ? scrollview._dtpFadeSize : 0);
        Utils.allocate(leftFade, childBox, flags);

        childBox[panel.varCoord.c1] = box[panel.varCoord.c2] - (value + pageSize < upper ? scrollview._dtpFadeSize : 0);
        childBox[panel.varCoord.c2] = box[panel.varCoord.c2];
        Utils.allocate(rightFade, childBox, flags);
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
        this.fullScrollView = 0;

        let isVertical = panel.checkIfVertical();

        this._box = new St.BoxLayout({ vertical: isVertical,
                                       clip_to_allocation: false,
                                       x_align: Clutter.ActorAlign.START,
                                       y_align: Clutter.ActorAlign.START });

        this._container = new taskbarActor(this);
        this._scrollView = new St.ScrollView({ name: 'dashtopanelScrollview',
                                               hscrollbar_policy: Gtk.PolicyType.NEVER,
                                               vscrollbar_policy: Gtk.PolicyType.NEVER,
                                               enable_mouse_scrolling: true });

        this._scrollView.connect('leave-event', Lang.bind(this, this._onLeaveEvent));
        this._scrollView.connect('motion-event', Lang.bind(this, this._onMotionEvent));
        this._scrollView.connect('scroll-event', Lang.bind(this, this._onScrollEvent));
        this._scrollView.add_actor(this._box);

        this._showAppsIconWrapper = panel.showAppsIconWrapper;
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
        this._container.add_actor(this._scrollView);
        
        let orientation = panel.getOrientation();
        let fadeStyle = 'background-gradient-direction:' + orientation;
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

        let rtl = Clutter.get_default_text_direction() == Clutter.TextDirection.RTL;
        this.actor = new St.Bin({ child: this._container,
            y_align: St.Align.START, x_align:rtl?St.Align.END:St.Align.START
        });

        let adjustment = this._scrollView[orientation[0] + 'scroll'].adjustment;
        
        this._workId = Main.initializeDeferredWork(this._box, Lang.bind(this, this._redisplay));

        this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell' });

        this._appSystem = Shell.AppSystem.get_default();

        this.iconAnimator = new PanelManager.IconAnimator(this.dtpPanel.panel.actor);

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
            ],
            [
                adjustment,
                [
                    'notify::upper',
                    'notify::pageSize'
                ],
                () => this._onScrollSizeChange(adjustment)
            ]
        );

        this.isGroupApps = Me.settings.get_boolean('group-apps');

        this._onScrollSizeChange(adjustment);
        this._connectWorkspaceSignals();
    },

    destroy: function() {
        this.iconAnimator.destroy();

        this._signalsHandler.destroy();
        this._signalsHandler = 0;

        this._container.destroy();
        
        this.previewMenu.disable();
        this.previewMenu.destroy();

        this._disconnectWorkspaceSignals();
    },

    _dropIconAnimations: function() {
        this._getTaskbarIcons().forEach(item => {
            item.raise(0);
            item.stretch(0);
        });
    },

    _updateIconAnimations: function(pointerX, pointerY) {
        this._iconAnimationTimestamp = Date.now();
        let type = iconAnimationSettings.type;

        if (!pointerX || !pointerY)
            [pointerX, pointerY] = global.get_pointer();

        this._getTaskbarIcons().forEach(item => {
            let [x, y] = item.get_transformed_position();
            let [width, height] = item.get_transformed_size();
            let [centerX, centerY] = [x + width / 2, y + height / 2];
            let size = this._box.vertical ? height : width;
            let difference = this._box.vertical ? pointerY - centerY : pointerX - centerX;
            let distance = Math.abs(difference);
            let maxDistance = (iconAnimationSettings.extent / 2) * size;

            if (type == 'PLANK') {
                // Make the position stable for items that are far from the pointer.
                let translation = distance <= maxDistance ?
                                  distance / (2 + 8 * distance / maxDistance) :
                                  // the previous expression with distance = maxDistance
                                  maxDistance / 10;

                if (difference > 0)
                    translation *= -1;

                item.stretch(translation);
            }

            if (distance <= maxDistance) {
                let level = (maxDistance - distance) / maxDistance;
                level = Math.pow(level, iconAnimationSettings.convexity);
                item.raise(level);
            } else {
                item.raise(0);
            }
        });
    },

    _onLeaveEvent: function(actor) {
        let [stageX, stageY] = global.get_pointer();
        let [success, x, y] = actor.transform_stage_point(stageX, stageY);
        if (success && !actor.allocation.contains(x, y) && (iconAnimationSettings.type == 'RIPPLE' || iconAnimationSettings.type == 'PLANK'))
            this._dropIconAnimations();

        return Clutter.EVENT_PROPAGATE;
    },

    _onMotionEvent: function(actor_, event) {
        if (iconAnimationSettings.type == 'RIPPLE' || iconAnimationSettings.type == 'PLANK') {
            let timestamp = Date.now();
            if (!this._iconAnimationTimestamp ||
                (timestamp - this._iconAnimationTimestamp >= iconAnimationSettings.duration / 2)) {
                let [pointerX, pointerY] = event.get_coords();
                this._updateIconAnimations(pointerX, pointerY);
            }
        }

        return Clutter.EVENT_PROPAGATE;
    },

    _onScrollEvent: function(actor, event) {

        let orientation = this.dtpPanel.getOrientation();

        // reset timeout to avid conflicts with the mousehover event
        if (this._ensureAppIconVisibilityTimeoutId>0) {
            Mainloop.source_remove(this._ensureAppIconVisibilityTimeoutId);
            this._ensureAppIconVisibilityTimeoutId = 0;
        }

        // Skip to avoid double events mouse
        if (event.is_pointer_emulated())
            return Clutter.EVENT_STOP;

        let adjustment, delta;

        adjustment = this._scrollView[orientation[0] + 'scroll'].get_adjustment();

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

    _onScrollSizeChange: function(adjustment) {
        // Update minimization animation target position on scrollview change.
        this._updateAppIcons();

        // When applications are ungrouped and there is some empty space on the horizontal taskbar,
        // force a fixed label width to prevent the icons from "wiggling" when an animation runs
        // (adding or removing an icon). When the taskbar is full, revert to a dynamic label width
        // to allow them to resize and make room for new icons.
        if (!this.dtpPanel.checkIfVertical() && !this.isGroupApps) {
            let initial = this.fullScrollView;

            if (!this.fullScrollView && Math.floor(adjustment.upper) > adjustment.page_size) {
                this.fullScrollView = adjustment.page_size;
            } else if (adjustment.page_size < this.fullScrollView) {
                this.fullScrollView = 0;
            }

            if (initial != this.fullScrollView) {
                this._getAppIcons().forEach(a => a.updateTitleStyle());
            }
        }
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
            this.previewMenu,
            this.iconAnimator
        );

        if (appIcon._draggable) {
            appIcon._draggable.connect('drag-begin',
                                       Lang.bind(this, function() {
                                           appIcon.actor.opacity = 0;
                                           appIcon.isDragged = 1;
                                           this._dropIconAnimations();
                                       }));
            appIcon._draggable.connect('drag-end',
                                       Lang.bind(this, function() {
                                           appIcon.actor.opacity = 255;
                                           delete appIcon.isDragged;
                                           this._updateAppIcons();
                                       }));
        }

        appIcon.connect('menu-state-changed',
                        Lang.bind(this, function(appIcon, opened) {
                            this._itemMenuStateChanged(item, opened);
                        }));

        let item = new TaskbarItemContainer();

        item._dtpPanel = this.dtpPanel
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

                if (!appIcon.isDragged && iconAnimationSettings.type == 'SIMPLE')
                    appIcon.actor.get_parent().raise(1);
                else if (!appIcon.isDragged && (iconAnimationSettings.type == 'RIPPLE' || iconAnimationSettings.type == 'PLANK'))
                    this._updateIconAnimations();
            } else {
                if (this._ensureAppIconVisibilityTimeoutId>0) {
                    Mainloop.source_remove(this._ensureAppIconVisibilityTimeoutId);
                    this._ensureAppIconVisibilityTimeoutId = 0;
                }

                if (!appIcon.isDragged && iconAnimationSettings.type == 'SIMPLE')
                    appIcon.actor.get_parent().raise(0);
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

            // The icon menu grabs the events and, once it is closed, the pointer is maybe
            // no longer over the taskbar and the animations are not dropped.
            if (iconAnimationSettings.type == 'RIPPLE' || iconAnimationSettings.type == 'PLANK') {
                this._scrollView.sync_hover();
                if (!this._scrollView.hover)
                    this._dropIconAnimations();
            }
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
        const thisMonitorIndex = this.dtpPanel.monitor.index;
        let panelSize = PanelSettings.getPanelSize(Me.settings, thisMonitorIndex);
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
        if (this.dtpPanel.isPrimary) {
            this._updateNumberOverlay();
        }

        this._shownInitially = true;
    },

    _checkIfShowingRunningApps: function() {
        return Me.settings.get_boolean('show-running-apps');
    },
    
    _checkIfShowingFavorites: function() {
        return Me.settings.get_boolean('show-favorites') && 
               (this.dtpPanel.isPrimary || Me.settings.get_boolean('show-favorites-all-monitors'));
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
    resetAppIcons : function(geometryChange) {
        let children = this._getTaskbarIcons(true);

        for (let i = 0; i < children.length; i++) {
            let item = children[i];
            item.destroy();
        }

        // to avoid ugly animations, just suppress them like when taskbar is first loaded.
        this._shownInitially = false;
        this._redisplay();

        if (geometryChange && this.dtpPanel.checkIfVertical()) {
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
        let isVertical = this.dtpPanel.checkIfVertical();

        if (!this._box.contains(sourceActor) && !source._dashItemContainer) {
            //not an appIcon of the taskbar, probably from the applications view
            source._dashItemContainer = new DragPlaceholderItem(source, this.iconSize, isVertical);
            this._box.insert_child_above(source._dashItemContainer, null);
        }

        let sizeProp = isVertical ? 'height' : 'width';
        let posProp = isVertical ? 'y' : 'x';
        let pos = isVertical ? y : x;

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
            Utils.getAppDisplayViews().every(function(v, index) {
                if (v.view.actor.visible) {
                    visibleView = index;
                    return false;
                }
                else
                    return true;
            });

            if (this.showAppsButton.checked) {
                if (Me.settings.get_boolean('show-apps-override-escape')) {
                    //override escape key to return to the desktop when entering the overview using the showapps button
                    Main.overview.viewSelector._onStageKeyPress = function(actor, event) {
                        if (Main.modalCount == 1 && event.get_key_symbol() === Clutter.KEY_Escape) {
                            this._searchActive ? this.reset() : Main.overview.hide();
    
                            return Clutter.EVENT_STOP;
                        }
    
                        return this.__proto__._onStageKeyPress.call(this, actor, event);
                    };
                }

                // force spring animation triggering.By default the animation only
                // runs if we are already inside the overview.
                if (!Main.overview._shown) {
                    this.forcedOverview = true;
                    let grid = Utils.getAppDisplayViews()[visibleView].view._grid;
                    let onShownCb;
                    let overviewSignal = Config.PACKAGE_VERSION > '3.38.1' ? 'showing' : 'shown';
                    let overviewShowingId = Main.overview.connect(overviewSignal, () => {
                        Main.overview.disconnect(overviewShowingId);
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

                //temporarily use as primary the monitor on which the showapps btn was clicked, this is
                //restored by the panel when exiting the overview
                this.dtpPanel.panelManager.setFocusedMonitor(this.dtpPanel.monitor);

                let overviewHiddenId = Main.overview.connect('hidden', () => {
                    Main.overview.disconnect(overviewHiddenId);
                    delete Main.overview.viewSelector._onStageKeyPress;
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
                        let view = Utils.getAppDisplayViews()[visibleView].view;
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

const CloneContainerConstraint = Utils.defineClass({
    Name: 'DashToPanel-CloneContainerConstraint',
    Extends: Clutter.BindConstraint,

    vfunc_update_allocation: function(actor, actorBox) {
        if (!this.source)
            return;

        let [stageX, stageY] = this.source.get_transformed_position();
        let [width, height] = this.source.get_transformed_size();

        actorBox.set_origin(stageX, stageY);
        actorBox.set_size(width, height);
    },
});

const TaskbarItemContainer = Utils.defineClass({
    Name: 'DashToPanel-TaskbarItemContainer',
    Extends: Dash.DashItemContainer,

    vfunc_allocate: function(box, flags) {
        if (this.child == null)
            return;

        Utils.setAllocation(this, box, flags);

        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;
        let [minChildWidth, minChildHeight, natChildWidth, natChildHeight] = this.child.get_preferred_size();
        let [childScaleX, childScaleY] = this.child.get_scale();

        let childWidth = Math.min(natChildWidth * childScaleX, availWidth);
        let childHeight = Math.min(natChildHeight * childScaleY, availHeight);
        let childBox = new Clutter.ActorBox();

        childBox.x1 = (availWidth - childWidth) / 2;
        childBox.y1 = (availHeight - childHeight) / 2;
        childBox.x2 = childBox.x1 + childWidth;
        childBox.y2 = childBox.y1 + childHeight;

        Utils.allocate(this.child, childBox, flags);
    },

    // In case appIcon is removed from the taskbar while it is hovered,
    // restore opacity before dashItemContainer.animateOutAndDestroy does the destroy animation.
    animateOutAndDestroy: function() {
        if (this._raisedClone) {
            this._raisedClone.source.opacity = 255;
            this._raisedClone.destroy();
        }

        this.callParent('animateOutAndDestroy');
    },

    // For ItemShowLabel
    _getIconAnimationOffset: function() {
        if (!Me.settings.get_boolean('animate-appicon-hover'))
            return 0;

        let travel = iconAnimationSettings.travel;
        let zoom = iconAnimationSettings.zoom;
        return this._dtpPanel.dtpSize * (travel + (zoom - 1) / 2);
    },

    _updateCloneContainerPosition: function(cloneContainer) {
        let [stageX, stageY] = this.get_transformed_position();

        if (Config.PACKAGE_VERSION >= '3.36')
            cloneContainer.set_position(stageX - this.translation_x, stageY - this.translation_y);
        else
            cloneContainer.set_position(stageX, stageY);
    },

    _createRaisedClone: function() {
        let [width, height] = this.get_transformed_size();

        // "clone" of this child (appIcon actor)
        let cloneButton = this.child._delegate.getCloneButton();

        // "clone" of this (taskbarItemContainer)
        let cloneContainer = new St.Bin({
            child: cloneButton,
            width: width, height: height,
            reactive: false,
        });

        this._updateCloneContainerPosition(cloneContainer);

        // For the stretch animation
        if (Config.PACKAGE_VERSION >= '3.36') {
            let boundProperty = this._dtpPanel.checkIfVertical() ? 'translation_y' : 'translation_x';
            this.bind_property(boundProperty, cloneContainer, boundProperty, GObject.BindingFlags.SYNC_CREATE);
        } else {
            let constraint = new CloneContainerConstraint({ source: this });
            cloneContainer.add_constraint(constraint);
        }

        // The clone follows its source when the taskbar is scrolled.
        let taskbarScrollView = this.get_parent().get_parent();
        let adjustment = this._dtpPanel.checkIfVertical() ? taskbarScrollView.vscroll.get_adjustment() : taskbarScrollView.hscroll.get_adjustment();
        let adjustmentChangedId = adjustment.connect('notify::value', () => this._updateCloneContainerPosition(cloneContainer));

        // Update clone position when an item is added to / removed from the taskbar.
        let taskbarBox = this.get_parent();
        let taskbarBoxAllocationChangedId = taskbarBox.connect('notify::allocation', () => this._updateCloneContainerPosition(cloneContainer));

        // The clone itself
        this._raisedClone = cloneButton.child;
        this._raisedClone.connect('destroy', () => {
            adjustment.disconnect(adjustmentChangedId);
            taskbarBox.disconnect(taskbarBoxAllocationChangedId);
            Mainloop.idle_add(() => cloneContainer.destroy());
            delete this._raisedClone;
        });

        this._raisedClone.source.opacity = 0;
        Main.uiGroup.add_actor(cloneContainer);
    },

    // Animate the clone.
    // AppIcon actors cannot go outside the taskbar so the animation is done with a clone.
    // If level is zero, the clone is dropped and destroyed.
    raise: function(level) {
        if (this._raisedClone)
            Utils.stopAnimations(this._raisedClone);
        else if (level)
            this._createRaisedClone();
        else
            return;

        let panelPosition = this._dtpPanel.getPosition();
        let panelElementPositions = this._dtpPanel.panelManager.panelsElementPositions[this._dtpPanel.monitor.index] || Pos.defaults;
        let taskbarPosition = panelElementPositions.filter(pos => pos.element == 'taskbar')[0].position;

        let vertical = panelPosition == St.Side.LEFT || panelPosition == St.Side.RIGHT;
        let translationDirection = panelPosition == St.Side.TOP || panelPosition == St.Side.LEFT ? 1 : -1;
        let rotationDirection;
        if (panelPosition == St.Side.LEFT || taskbarPosition == Pos.STACKED_TL)
            rotationDirection = -1;
        else if (panelPosition == St.Side.RIGHT || taskbarPosition == Pos.STACKED_BR)
            rotationDirection = 1;
        else {
            let items = this.get_parent().get_children();
            let index = items.indexOf(this);
            rotationDirection = (index - (items.length - 1) / 2) / ((items.length - 1) / 2);
        }

        let duration = iconAnimationSettings.duration / 1000;
        let rotation = iconAnimationSettings.rotation;
        let travel = iconAnimationSettings.travel;
        let zoom = iconAnimationSettings.zoom;

        // level is about 1 for the icon that is hovered, less for others.
        // time depends on the translation to do.
        let [width, height] = this._raisedClone.source.get_transformed_size();
        let translationMax = (vertical ? width : height) * (travel + (zoom - 1) / 2);
        let translationEnd = translationMax * level;
        let translationDone = vertical ? this._raisedClone.translation_x : this._raisedClone.translation_y;
        let translationTodo = Math.abs(translationEnd - translationDone);
        let scale = 1 + (zoom - 1) * level;
        let rotationAngleZ = rotationDirection * rotation * level;
        let time = duration * translationTodo / translationMax;

        let options = {
            scale_x: scale, scale_y: scale,
            rotation_angle_z: rotationAngleZ,
            time: time,
            transition: 'easeOutQuad',
            onComplete: () => {
                if (!level) {
                    this._raisedClone.source.opacity = 255;
                    this._raisedClone.destroy();
                    delete this._raisedClone;
                }
            },
        };
        options[vertical ? 'translation_x' : 'translation_y'] = translationDirection * translationEnd;

        Utils.animate(this._raisedClone, options);
    },

    // Animate this and cloneContainer, since cloneContainer translation is bound to this.
    stretch: function(translation) {
        let duration = iconAnimationSettings.duration / 1000;
        let zoom = iconAnimationSettings.zoom;
        let animatedProperty = this._dtpPanel.checkIfVertical() ? 'translation_y' : 'translation_x';
        let isShowing = this.opacity != 255 || this.child.opacity != 255;

        if (isShowing) {
            // Do no stop the animation initiated in DashItemContainer.show.
            this[animatedProperty] = zoom * translation;
        } else {
            let options = {
                time: duration,
                transition: 'easeOutQuad',
            };
            options[animatedProperty] = zoom * translation;

            Utils.stopAnimations(this);
            Utils.animate(this, options);
        }
    },
});

var DragPlaceholderItem = Utils.defineClass({
    Name: 'DashToPanel-DragPlaceholderItem',
    Extends: St.Widget,

    _init: function(appIcon, iconSize, isVertical) {
        this.callParent('_init', { style: AppIcons.getIconContainerStyle(isVertical), layout_manager: new Clutter.BinLayout() });

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
