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
 * Credits:
 * This file is based on code from the Dash to Dock extension by micheleg
 * and code from the Taskbar extension by Zorin OS
 * 
 * Code to re-anchor the panel was taken from Thoma5 BottomPanel:
 * https://github.com/Thoma5/gnome-shell-extension-bottompanel
 * 
 * Pattern for moving clock based on Frippery Move Clock by R M Yorston
 * http://frippery.org/extensions/
 * 
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Clutter = imports.gi.Clutter;
const Config = imports.misc.config;
const Gtk = imports.gi.Gtk;
const Gi = imports._gi;
const AppIcons = Me.imports.appIcons;
const Utils = Me.imports.utils;
const Taskbar = Me.imports.taskbar;
const WorkspaceSwitcher = Me.imports.workspaceSwitcher;
const PanelStyle = Me.imports.panelStyle;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Dash = imports.ui.dash;
const CtrlAltTab = imports.ui.ctrlAltTab;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const DND = imports.ui.dnd;
const Shell = imports.gi.Shell;
const PopupMenu = imports.ui.popupMenu;
const IconGrid = imports.ui.iconGrid;
const ViewSelector = imports.ui.viewSelector;
const DateMenu = imports.ui.dateMenu;
const Tweener = imports.ui.tweener;

const Intellihide = Me.imports.intellihide;
const Transparency = Me.imports.transparency;
const _ = imports.gettext.domain(Me.imports.utils.TRANSLATION_DOMAIN).gettext;

let tracker = Shell.WindowTracker.get_default();
var sizeFunc;
var fixedCoord;
var varCoord;
var size;

function getPosition() {
    let position = Me.settings.get_string('panel-position');
    
    if (position == 'TOP') {
        return St.Side.TOP;
    } else if (position == 'RIGHT') {
        return St.Side.RIGHT;
    } else if (position == 'BOTTOM') {
        return St.Side.BOTTOM;
    }
    
    return St.Side.LEFT;
}

function checkIfVertical() {
    let position = getPosition();

    return (position == St.Side.LEFT || position == St.Side.RIGHT);
}

function getOrientation() {
    return (checkIfVertical() ? 'vertical' : 'horizontal');
}

function setMenuArrow(arrowIcon, side) {
    let parent = arrowIcon.get_parent();
    let iconNames = {
        '0': 'pan-down-symbolic',   //TOP
        '1': 'pan-start-symbolic',  //RIGHT
        '2': 'pan-up-symbolic',     //BOTTOM
        '3': 'pan-end-symbolic'     //LEFT
    };

    parent.remove_child(arrowIcon);
    arrowIcon.set_icon_name(iconNames[side]);
    parent.add_child(arrowIcon);
}

var dtpPanel = Utils.defineClass({
    Name: 'DashToPanel-Panel',
    Extends: St.Widget,

    _init: function(panelManager, monitor, panelBox, isSecondary) {
        let position = getPosition();

        this.callParent('_init', { name: 'panel', reactive: true });
        this.bg = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        this.bg.add_child(this);

        Utils.wrapActor(this);
        this._delegate = this;
        
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this.panelManager = panelManager;
        this.panelStyle = new PanelStyle.dtpPanelStyle();

        this.monitor = monitor;
        this.panelBox = panelBox;
        this.isSecondary = isSecondary;
        this._sessionStyle = null;

        if (position == St.Side.TOP) {
            this._leftCorner = new Panel.PanelCorner(St.Side.LEFT);
            this.add_actor(this._leftCorner.actor);
    
            this._rightCorner = new Panel.PanelCorner(St.Side.RIGHT);
            this.add_actor(this._rightCorner.actor);
        }

        if (isSecondary) {
            this.statusArea = {};

            this._leftBox = new St.BoxLayout({ name: 'panelLeft' });
            this._centerBox = new St.BoxLayout({ name: 'panelCenter' });
            this._rightBox = new St.BoxLayout({ name: 'panelRight' });

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.grabOwner = this;

            //adding the clock to the centerbox will correctly position it according to dtp settings (event actor-added)
            this._setPanelMenu('show-status-menu-all-monitors', 'aggregateMenu', dtpSecondaryAggregateMenu, this._rightBox, true);
            this._setPanelMenu('show-clock-all-monitors', 'dateMenu', DateMenu.DateMenuButton, this._centerBox, true);
        } else {
            this.statusArea = Main.panel.statusArea;
            this.menuManager = Main.panel.menuManager;
            this.grabOwner = Main.panel;

            setMenuArrow(this.statusArea.aggregateMenu._indicators.get_last_child(), position);

            ['_leftBox', '_centerBox', '_rightBox'].forEach(p => {
                Main.panel.actor.remove_child(Main.panel[p]);
                this[p] = Main.panel[p];
            });
        }

        this.add_child(this._leftBox);
        this.add_child(this._centerBox);
        this.add_child(this._rightBox);

        Utils.wrapActor(this.statusArea.activities || 0);

        if (Main.panel._onButtonPress) {
            this._signalsHandler.add([
                this, 
                [
                    'button-press-event', 
                    'touch-event'
                ],
                this._onButtonPress.bind(this)
            ]);
        }

        if (Main.panel._onKeyPress) {
            this._signalsHandler.add([this, 'key-press-event', Main.panel._onKeyPress.bind(this)]);
        }
       
        Main.ctrlAltTabManager.addGroup(this, _("Top Bar")+" "+ monitor.index, 'focus-top-bar-symbolic',
                                        { sortGroup: CtrlAltTab.SortGroup.TOP });
    },

    enable : function() {
        let taskbarPosition = Me.settings.get_string('taskbar-position');
        let isVertical = checkIfVertical();

        if (taskbarPosition == 'CENTEREDCONTENT' || taskbarPosition == 'CENTEREDMONITOR') {
            this.container = this._centerBox;
        } else {
            this.container = this._leftBox;
        }

        if (this.statusArea.aggregateMenu) {
            this.statusArea.aggregateMenu._volume.indicators._dtpIgnoreScroll = 1;
        }

        this.geom = this.getGeometry();
        
        // The overview uses the panel height as a margin by way of a "ghost" transparent Clone
        // This pushes everything down, which isn't desired when the panel is moved to the bottom
        // I'm adding a 2nd ghost panel and will resize the top or bottom ghost depending on the panel position
        this._myPanelGhost = new Clutter.Actor({ 
            x: this.geom.x,
            y: this.geom.y ,
            reactive: false, 
            opacity: 0
        });

        if (this.geom.position == St.Side.TOP) {
            Main.overview._overview.insert_child_at_index(this._myPanelGhost, 0);
        } else {
             if (this.geom.position == St.Side.BOTTOM) {
                Main.overview._overview.add_actor(this._myPanelGhost);
            } else if (this.geom.position == St.Side.LEFT) {
                Main.overview._controls._group.insert_child_at_index(this._myPanelGhost, 0);
            } else {
                Main.overview._controls._group.add_actor(this._myPanelGhost);
            }
        }

        this._adjustForOverview();
        this._setPanelGhostSize();
        this._setPanelPosition();

        if (!this.isSecondary && this.statusArea.dateMenu) {
            // remove the extra space before the clock when the message-indicator is displayed
            Utils.hookVfunc(DateMenu.IndicatorPad.prototype, 'get_preferred_width', () => [0,0]);
            Utils.hookVfunc(DateMenu.IndicatorPad.prototype, 'get_preferred_height', () => [0,0]);
        }

        this.menuManager._oldChangeMenu = this.menuManager._changeMenu;
        this.menuManager._changeMenu = (menu) => {
            if (!Me.settings.get_boolean('stockgs-panelbtn-click-only')) {
                this.menuManager._oldChangeMenu(menu);
            }
        };

        if (this.statusArea.appMenu) {
            setMenuArrow(this.statusArea.appMenu._arrow, getPosition());
            this._leftBox.remove_child(this.statusArea.appMenu.container);
        }

        //the timeout makes sure the theme's styles are computed before initially applying the transparency
        this.startDynamicTransparencyId = Mainloop.timeout_add(0, () => {
            this.startDynamicTransparencyId = 0;
            this.dynamicTransparency = new Transparency.DynamicTransparency(this);
        });
        
        this.taskbar = new Taskbar.taskbar(this);
        this.workspaceSwitcher = new WorkspaceSwitcher.WorkspaceSwitcher(this);

        Main.overview.dashIconSize = this.taskbar.iconSize;

        this.container.insert_child_above(this.taskbar.actor, null);
        
        this._setActivitiesButtonVisible(Me.settings.get_boolean('show-activities-button'));
        this._setWorkspaceSwitcherVisible(Me.settings.get_boolean('show-workspace-switcher'));
        this._setAppmenuVisible(Me.settings.get_boolean('show-appmenu'));
        this._setClockLocation(Me.settings.get_string('location-clock'));
        this._displayShowDesktopButton(Me.settings.get_boolean('show-showdesktop-button'));
        
        this.add_style_class_name('dashtopanelPanel ' + getOrientation());

        // Since Gnome 3.8 dragging an app without having opened the overview before cause the attemp to
        //animate a null target since some variables are not initialized when the viewSelector is created
        if(Main.overview.viewSelector._activePage == null)
            Main.overview.viewSelector._activePage = Main.overview.viewSelector._workspacesPage;

        if(this.taskbar._showAppsIconWrapper)
            this.taskbar._showAppsIconWrapper._dtpPanel = this;

        this.startIntellihideId = Mainloop.timeout_add(Me.settings.get_int('intellihide-enable-start-delay'), () => {
            this.startIntellihideId = 0;
            this.intellihide = new Intellihide.Intellihide(this);
        });

        this._signalsHandler.add(
            [
                this.panelBox, 
                'notify::height', 
                () => this._setPanelPosition()
            ],
            // this is to catch changes to the window scale factor
            [
                St.ThemeContext.get_for_stage(global.stage), 
                'changed', 
                () => this._setPanelPosition()
            ],
            // Keep dragged icon consistent in size with this dash
            [
                this.taskbar,
                'icon-size-changed',
                Lang.bind(this, function() {
                    Main.overview.dashIconSize = this.taskbar.iconSize;
                })
            ],
            [
                // sync hover after a popupmenu is closed
                this.taskbar,
                'menu-closed', 
                Lang.bind(this, function(){this.container.sync_hover();})
            ],
            // This duplicate the similar signal which is in overview.js.
            // Being connected and thus executed later this effectively
            // overwrite any attempt to use the size of the default dash
            // which given the customization is usually much smaller.
            // I can't easily disconnect the original signal
            [
                Main.overview._controls.dash,
                'icon-size-changed',
                Lang.bind(this, function() {
                    Main.overview.dashIconSize = this.taskbar.iconSize;
                })
            ],
            [
                Main.overview,
                [
                    'showing',
                    'hiding'
                ],
                () => this._adjustForOverview()
            ],
            [
                this._centerBox,
                'actor-added',
                () => this._onBoxActorAdded(this._centerBox)
            ],
            [
                this._rightBox,
                'actor-added',
                () => this._onBoxActorAdded(this._rightBox)
            ],
            [
                this,
                'scroll-event',
                this._onPanelMouseScroll.bind(this)
            ],
            [
                Main.layoutManager,
                'startup-complete',
                () => this._resetGeometry(true)
            ]
        );

        if (isVertical) {
            this._signalsHandler.add(
                [
                    this._centerBox,
                    'notify::allocation',
                    () => this._refreshVerticalAlloc()
                ],
                [
                    this._rightBox,
                    'notify::allocation',
                    () => this._refreshVerticalAlloc()
                ]
            );
        }

        this._bindSettingsChanges();

        this.panelStyle.enable(this);

        if (this.statusArea.dateMenu && isVertical) {
            this.statusArea.dateMenu._clock.time_only = true;
            this._formatVerticalClock();
            
            this._signalsHandler.add([
                this.statusArea.dateMenu._clock,
                'notify::clock',
                () => this._formatVerticalClock()
            ]);
        }

        // Since we are usually visible but not usually changing, make sure
        // most repaint requests don't actually require us to repaint anything.
        // This saves significant CPU when repainting the screen.
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
    },

    disable: function () {
        this.panelStyle.disable();

        this._signalsHandler.destroy();
        this.container.remove_child(this.taskbar.actor);
        this._setAppmenuVisible(false);
        this._setWorkspaceSwitcherVisible(false);

        if (this.statusArea.appMenu) {
            setMenuArrow(this.statusArea.appMenu._arrow, St.Side.TOP);
            this._leftBox.add_child(this.statusArea.appMenu.container);
        }

        if (this.startIntellihideId) {
            Mainloop.source_remove(this.startIntellihideId);
            this.startIntellihideId = 0;
        } else {
            this.intellihide.destroy();
        }

        if (this._showDesktopTimeoutId) {
            Mainloop.source_remove(this._showDesktopTimeoutId);
            this._showDesktopTimeoutId = 0;
        }

        if (this._scrollPanelDelayTimeoutId) {
            Mainloop.source_remove(this._scrollPanelDelayTimeoutId);
            this._scrollPanelDelayTimeoutId = 0;
        }

        if (this.startDynamicTransparencyId) {
            Mainloop.source_remove(this.startDynamicTransparencyId);
            this.startDynamicTransparencyId = 0;
        } else {
            this.dynamicTransparency.destroy();
        }

        if (this._allocationThrottleId) {
            Mainloop.source_remove(this._allocationThrottleId);
            this._allocationThrottleId = 0;
        }

        this.taskbar.destroy();
        this.workspaceSwitcher.destroy();

        // reset stored icon size  to the default dash
        Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;

        this.menuManager._changeMenu = this.menuManager._oldChangeMenu;

        this._myPanelGhost.get_parent().remove_actor(this._myPanelGhost);
        
        if (!this.isSecondary) {
            this._setVertical(this, false);

            this.remove_style_class_name('dashtopanelPanel vertical horizontal');

            ['_leftBox', '_centerBox', '_rightBox'].forEach(p => {
                this.remove_child(Main.panel[p]);
                Main.panel.actor.add_child(Main.panel[p]);
            });
            
            this._setActivitiesButtonVisible(true);
            this._setClockLocation("BUTTONSLEFT");
            this._displayShowDesktopButton(false);

            if (this.statusArea.aggregateMenu) {
                delete this.statusArea.aggregateMenu._volume.indicators._dtpIgnoreScroll;
                setMenuArrow(this.statusArea.aggregateMenu._indicators.get_last_child(), St.Side.TOP);
            }

            if (this.statusArea.dateMenu) {
                this.statusArea.dateMenu._clock.time_only = false;
                this.statusArea.dateMenu._clockDisplay.text = this.statusArea.dateMenu._clock.clock;

                Utils.hookVfunc(DateMenu.IndicatorPad.prototype, 'get_preferred_width', DateMenu.IndicatorPad.prototype.vfunc_get_preferred_width);
                Utils.hookVfunc(DateMenu.IndicatorPad.prototype, 'get_preferred_height', DateMenu.IndicatorPad.prototype.vfunc_get_preferred_height);
            }
        } else {
            this._removePanelMenu('dateMenu');
            this._removePanelMenu('aggregateMenu');
        }

        Main.ctrlAltTabManager.removeGroup(this);
    },

    //next 3 functions are needed by other extensions to add elements to the secondary panel
    addToStatusArea: function(role, indicator, position, box) {
        return Main.panel.addToStatusArea.call(this, role, indicator, position, box);
    },

    _addToPanelBox: function(role, indicator, position, box) {
        Main.panel._addToPanelBox.call(this, role, indicator, position, box);
    },

    _onMenuSet: function(indicator) {
        Main.panel._onMenuSet.call(this, indicator);
    },

    handleDragOver: function(source, actor, x, y, time) {
        if (source == Main.xdndHandler) {
            
            // open overview so they can choose a window for focusing
            // and ultimately dropping dragged item onto
            if(Main.overview.shouldToggleByCornerOrButton())
                Main.overview.show();
        }
        
        return DND.DragMotionResult.CONTINUE;
    },

    _bindSettingsChanges: function() {
        let isVertical = checkIfVertical();
        
        this._signalsHandler.add(
            [
                Me.settings,
                [
                    'changed::panel-size',
                    'changed::group-apps'
                ],
                () => this._resetGeometry()
            ],
            [
                Me.settings,
                [
                    'changed::appicon-margin',
                    'changed::appicon-padding'
                ],
                () => this.taskbar.resetAppIcons()
            ],
            [
                Me.settings,
                'changed::show-activities-button',
                () => this._setActivitiesButtonVisible(Me.settings.get_boolean('show-activities-button'))
            ],
            [
                Me.settings,
                'changed::show-workspace-switcher',
                () => this._setWorkspaceSwitcherVisible(Me.settings.get_boolean('show-workspace-switcher'))
            ],
            [
                Me.settings,
                'changed::show-appmenu',
                () => this._setAppmenuVisible(Me.settings.get_boolean('show-appmenu'))
            ],
            [
                Me.settings,
                'changed::location-clock',
                () => this._setClockLocation(Me.settings.get_string('location-clock'))
            ],
            [
                Me.settings,
                'changed::show-showdesktop-button',
                () => this._displayShowDesktopButton(Me.settings.get_boolean('show-showdesktop-button'))
            ],
            [
                Me.settings,
                'changed::showdesktop-button-width',
                () => this._setShowDesktopButtonSize()
            ],
            [
                Me.desktopSettings,
                'changed::clock-format',
                () => {
                    this._clockFormat = null;
                    
                    if (isVertical) {
                        this._formatVerticalClock();
                    }
                }
            ]
        );

        if (isVertical) {
            this._signalsHandler.add([Me.settings, 'changed::group-apps-label-max-width', () => this._resetGeometry()]);
        }
    },

    _setPanelMenu: function(settingName, propName, constr, container, isInit) {
        if (isInit) {
            this._signalsHandler.add([Me.settings, 'changed::' + settingName, () => this._setPanelMenu(settingName, propName, constr, container)]);
        }
        
        if (!Me.settings.get_boolean(settingName)) {
            this._removePanelMenu(propName);
        } else if (!this.statusArea[propName]) {
            this.statusArea[propName] = new constr();
            this.menuManager.addMenu(this.statusArea[propName].menu);
            container.insert_child_at_index(this.statusArea[propName].container, 0);
        }
    },
    
    _removePanelMenu: function(propName) {
        if (this.statusArea[propName]) {
            let parent = this.statusArea[propName].container.get_parent();

            if (parent) {
                parent.remove_actor(this.statusArea[propName].container);
            }

            //this.statusArea[propName].destroy(); //buggy for now, gnome-shell never destroys those menus
            this.menuManager.removeMenu(this.statusArea[propName].menu);
            this.statusArea[propName] = null;
        }
    },

    _setPanelGhostSize: function() {
        this._myPanelGhost.set_size(this.geom.w, checkIfVertical() ? 1 : this.geom.h); 
    },

    _adjustForOverview: function() {
        let isFocusedMonitor = this.panelManager.checkIfFocusedMonitor(this.monitor);
        let isOverview = !!Main.overview.visibleTarget;
        let isOverviewFocusedMonitor = isOverview && isFocusedMonitor;
        let isShown = !isOverview || isOverviewFocusedMonitor;

        this.panelBox[isShown ? 'show' : 'hide']();

        if (isOverview) {
            this._myPanelGhost[isOverviewFocusedMonitor ? 'show' : 'hide']();

            if (isOverviewFocusedMonitor) {
                Main.overview._panelGhost.set_height(this.geom.position == St.Side.TOP ? 0 : Main.panel.height);
            }
        }
    },

    _resetGeometry: function(clockOnly) {
        if (!clockOnly) {
            this.geom = this.getGeometry();
            this._setPanelGhostSize();
            this._setPanelPosition();
            this.taskbar.resetAppIcons();
        }

        if (checkIfVertical()) {
            this._formatVerticalClock();
        }
    },

    getGeometry: function() {
        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        let position = getPosition();
        let x = 0, y = 0;
        let w = 0, h = 0;

        size = Me.settings.get_int('panel-size') * scaleFactor;

        if (checkIfVertical()) {
            if (!Me.settings.get_boolean('group-apps')) {
                // add window title width and side padding of _dtpIconContainer when vertical
                size += Me.settings.get_int('group-apps-label-max-width') + AppIcons.DEFAULT_PADDING_SIZE * 2 / scaleFactor;
            }

            sizeFunc = 'get_preferred_height',
            fixedCoord = { c1: 'x1', c2: 'x2' },
            varCoord = { c1: 'y1', c2: 'y2' };

            w = size;
            h = this.monitor.height;
        } else {
            sizeFunc = 'get_preferred_width';
            fixedCoord = { c1: 'y1', c2: 'y2' };
            varCoord = { c1: 'x1', c2: 'x2' };

            w = this.monitor.width;
            h = size;
        }

        if (position == St.Side.TOP || position == St.Side.LEFT) {
            x = this.monitor.x;
            y = this.monitor.y;
        } else if (position == St.Side.RIGHT) {
            x = this.monitor.x + this.monitor.width - size;
            y = this.monitor.y;
        } else { //BOTTOM
            x = this.monitor.x; 
            y = this.monitor.y + this.monitor.height - size;
        }

        return {
            x: x, y: y, 
            w: w, h: h,
            position: position
        };
    },

    vfunc_allocate: function(box, flags) {
        this.set_allocation(box, flags);
        
        let panelAllocVarSize = box[varCoord.c2] - box[varCoord.c1];
        let panelAllocFixedSize = box[fixedCoord.c2] - box[fixedCoord.c1];
        let [, leftNaturalSize] = this._leftBox[sizeFunc](-1);
        let [, centerNaturalSize] = this._centerBox[sizeFunc](-1);
        let [, rightNaturalSize] = this._rightBox[sizeFunc](-1);
        let taskbarPosition = Me.settings.get_string('taskbar-position');

        // The _rightBox is always allocated the same, regardless of taskbar position setting
        let rightAllocSize = rightNaturalSize;
        
        // Now figure out how large the _leftBox and _centerBox should be.
        // The box with the taskbar is always the one that is forced to be smaller as the other boxes grow
        let leftAllocSize, centerStartPosition, centerEndPosition;
        let childBoxLeft = new Clutter.ActorBox();
        let childBoxCenter = new Clutter.ActorBox();
        let childBoxRight = new Clutter.ActorBox();

        if (taskbarPosition == 'CENTEREDMONITOR') {
            leftAllocSize = leftNaturalSize;

            centerStartPosition = Math.max(leftNaturalSize, Math.floor((panelAllocVarSize - centerNaturalSize)/2));
            centerEndPosition = Math.min(panelAllocVarSize-rightNaturalSize, Math.ceil((panelAllocVarSize+centerNaturalSize))/2);
        } else if (taskbarPosition == 'CENTEREDCONTENT') {
            leftAllocSize = leftNaturalSize;

            centerStartPosition = Math.max(leftNaturalSize, Math.floor((panelAllocVarSize - centerNaturalSize + leftNaturalSize - rightNaturalSize) / 2));
            centerEndPosition = Math.min(panelAllocVarSize-rightNaturalSize, Math.ceil((panelAllocVarSize + centerNaturalSize + leftNaturalSize - rightNaturalSize) / 2));
        } else if (taskbarPosition == 'LEFTPANEL_FIXEDCENTER') {
            leftAllocSize = Math.floor((panelAllocVarSize - centerNaturalSize) / 2);
            centerStartPosition = leftAllocSize;
            centerEndPosition = centerStartPosition + centerNaturalSize;
        } else if (taskbarPosition == 'LEFTPANEL_FLOATCENTER') {
            let leftAllocSizeMax = panelAllocVarSize - rightNaturalSize - centerNaturalSize;
            leftAllocSize = Math.min(leftAllocSizeMax, leftNaturalSize);

            let freeSpace = panelAllocVarSize - leftAllocSize - rightAllocSize - centerNaturalSize;

            centerStartPosition = leftAllocSize + Math.floor(freeSpace / 2);
            centerEndPosition = centerStartPosition + centerNaturalSize;
        } else { // LEFTPANEL
            leftAllocSize = panelAllocVarSize - rightNaturalSize - centerNaturalSize;
            centerStartPosition = leftAllocSize;
            centerEndPosition = centerStartPosition + centerNaturalSize;
        }

        childBoxLeft[fixedCoord.c1] = childBoxCenter[fixedCoord.c1] = childBoxRight[fixedCoord.c1] = 0;
        childBoxLeft[fixedCoord.c2] = childBoxCenter[fixedCoord.c2] = childBoxRight[fixedCoord.c2] = panelAllocFixedSize;

        // if it is a RTL language, the boxes are switched around, and we need to invert the coordinates
        if (this.get_text_direction() == Clutter.TextDirection.RTL) {
            childBoxLeft[varCoord.c1] = panelAllocVarSize - leftAllocSize;
            childBoxLeft[varCoord.c2] = panelAllocVarSize;

            childBoxCenter[varCoord.c1] = panelAllocVarSize - centerEndPosition;
            childBoxCenter[varCoord.c2] = panelAllocVarSize - centerStartPosition;

            childBoxRight[varCoord.c1] = 0;
            childBoxRight[varCoord.c2] = rightAllocSize;
        } else {
            childBoxLeft[varCoord.c1] = 0;
            childBoxLeft[varCoord.c2] = leftAllocSize;

            childBoxCenter[varCoord.c1] = centerStartPosition;
            childBoxCenter[varCoord.c2] = centerEndPosition;

            childBoxRight[varCoord.c1] = panelAllocVarSize - rightAllocSize;
            childBoxRight[varCoord.c2] = panelAllocVarSize;            
        }

        if (this._leftCorner) {
            let childBoxLeftCorner = new Clutter.ActorBox();
            let [ , cornerSize] = this._leftCorner.actor[sizeFunc](-1);
            childBoxLeftCorner[varCoord.c1] = 0;
            childBoxLeftCorner[varCoord.c2] = cornerSize;
            childBoxLeftCorner[fixedCoord.c1] = panelAllocFixedSize;
            childBoxLeftCorner[fixedCoord.c2] = panelAllocFixedSize + cornerSize;

            let childBoxRightCorner = new Clutter.ActorBox();
            [ , cornerSize] = this._rightCorner.actor[sizeFunc](-1);
            childBoxRightCorner[varCoord.c1] = panelAllocVarSize - cornerSize;
            childBoxRightCorner[varCoord.c2] = panelAllocVarSize;
            childBoxRightCorner[fixedCoord.c1] = panelAllocFixedSize;
            childBoxRightCorner[fixedCoord.c2] = panelAllocFixedSize + cornerSize;

            this._leftCorner.actor.allocate(childBoxLeftCorner, flags);
            this._rightCorner.actor.allocate(childBoxRightCorner, flags);
        }

        this._leftBox.allocate(childBoxLeft, flags);
        this._centerBox.allocate(childBoxCenter, flags);
        this._rightBox.allocate(childBoxRight, flags);
    },

    _setPanelPosition: function() {
        let container = this.intellihide && this.intellihide.enabled ? this.panelBox.get_parent() : this.panelBox;

        this.set_size(this.geom.w, this.geom.h);
        container.set_position(this.geom.x, this.geom.y)

        this._setVertical(this, checkIfVertical());

        // styles for theming
        Object.keys(St.Side).forEach(p => {
            let cssName = p.charAt(0) + p.slice(1).toLowerCase();
            
            this[(p == this.geom.position ? 'add' : 'remove') + '_style_class_name'](cssName);
        });

        Main.layoutManager._updateHotCorners();
        Main.layoutManager._updatePanelBarrier(this);
    },

    _onButtonPress: function(actor, event) {
        let type = event.type();
        let isPress = type == Clutter.EventType.BUTTON_PRESS;
        let button = isPress ? event.get_button() : -1;

        if (Main.modalCount > 0 || event.get_source() != actor || 
            (!isPress && type != Clutter.EventType.TOUCH_BEGIN) ||
            (isPress && button != 1)) {
            return Clutter.EVENT_PROPAGATE;
        }

        let [stageX, stageY] = event.get_coords();
        let params = checkIfVertical() ? [stageY, 'y', 'height'] : [stageX, 'x', 'width'];
        let dragWindow = this._getDraggableWindowForPosition.apply(this, params.concat(['maximized_' + getOrientation() + 'ly']));

        if (!dragWindow)
            return Clutter.EVENT_PROPAGATE;

        global.display.begin_grab_op(dragWindow,
                                     Meta.GrabOp.MOVING,
                                     false, /* pointer grab */
                                     true, /* frame action */
                                     button,
                                     event.get_state(),
                                     event.get_time(),
                                     stageX, stageY);

        return Clutter.EVENT_STOP;
    },

    _getDraggableWindowForPosition: function(stageCoord, coord, dimension, maximizedProp) {
        let workspace = Utils.getCurrentWorkspace();
        let allWindowsByStacking = global.display.sort_windows_by_stacking(
            workspace.list_windows()
        ).reverse();

        return allWindowsByStacking.find(metaWindow => {
            let rect = metaWindow.get_frame_rect();

            return metaWindow.get_monitor() == this.monitor.index &&
                   metaWindow.showing_on_its_workspace() &&
                   metaWindow.get_window_type() != Meta.WindowType.DESKTOP &&
                   metaWindow[maximizedProp] &&
                   stageCoord > rect[coord] && stageCoord < rect[coord] + rect[dimension];
        });
    },

    _onBoxActorAdded: function(box) {
        this._setClockLocation(Me.settings.get_string('location-clock'));
    },

    _refreshVerticalAlloc: function() {
        if (!this._allocationThrottleId) {
            this._allocationThrottleId = Mainloop.timeout_add(200, () => {
                this._setVertical(this._centerBox, true);
                this._setVertical(this._rightBox, true);
                this._formatVerticalClock();
                this._allocationThrottleId = 0;
            });
        }
    },

    _setVertical: function(actor, isVertical) {
        let _set = (actor, isVertical) => {
            if (!actor || actor instanceof Dash.DashItemContainer) {
                return;
            }

            if (actor instanceof St.BoxLayout) {
                actor.vertical = isVertical;
            } else if (actor instanceof PanelMenu.ButtonBox && actor != this.statusArea.appMenu) {
                let child = actor.get_first_child();

                if (child) {
                    let [, natWidth] = actor.get_preferred_width(-1);

                    child.x_align = Clutter.ActorAlign[isVertical ? 'CENTER' : 'START'];
                    actor.set_width(isVertical ? size : -1);
                    isVertical = isVertical && (natWidth > size);
                    actor[(isVertical ? 'add' : 'remove') + '_style_class_name']('vertical');
                }
            }

            actor.get_children().forEach(c => _set(c, isVertical));
        };

        _set(actor, false);
        _set(actor, isVertical);
    },

    _setActivitiesButtonVisible: function(isVisible) {
        if(this.statusArea.activities)
            isVisible ? this.statusArea.activities.actor.show() :
                this.statusArea.activities.actor.hide();
    },
    
    _setWorkspaceSwitcherVisible: function(isVisible) {
        let parent = this.workspaceSwitcher.actor.get_parent();

        if (parent) {
            parent.remove_child(this.workspaceSwitcher.actor);
        }

        if (isVisible) {
            this.container.insert_child_below(this.workspaceSwitcher.actor, this.taskbar.actor);
        }
    },

    _setAppmenuVisible: function(isVisible) {
        let parent;
        let appMenu = this.statusArea.appMenu;

        if(appMenu)
            parent = appMenu.container.get_parent();

        if (parent) {
            parent.remove_child(appMenu.container);
        }

        if (isVisible && appMenu) {
            let taskbarPosition = Me.settings.get_string('taskbar-position');
            if (taskbarPosition == 'CENTEREDCONTENT' || taskbarPosition == 'CENTEREDMONITOR') {
                this._leftBox.insert_child_above(appMenu.container, null);
            } else {
                this._centerBox.insert_child_at_index(appMenu.container, 0);
            }            
        }
    },

    _formatVerticalClock: function() {
        let time = this.statusArea.dateMenu._clock.clock;
        let clockText = this.statusArea.dateMenu._clockDisplay.clutter_text;
        
        clockText.set_text(time);
        clockText.get_allocation_box();

        if (clockText.get_layout().is_ellipsized()) {
            let timeParts = time.split('∶');

            if (!this._clockFormat) {
                this._clockFormat = Me.desktopSettings.get_string('clock-format');
            }

            if (this._clockFormat == '12h') {
                timeParts.push.apply(timeParts, timeParts.pop().split(' '));
            }

            clockText.set_text(timeParts.join('\n<span size="xx-small">‧‧</span>\n').trim());
            clockText.set_use_markup(true);
        }
    },

    _setClockLocation: function(loc) {
        if(!this.statusArea.dateMenu)
            return;

        let dateMenuContainer = this.statusArea.dateMenu.container;
        let parent = dateMenuContainer.get_parent();
        let destination;
        let refSibling = null;

        if (!parent) {
            return;
        }

        if (loc.indexOf('BUTTONS') == 0) {
            destination = this._centerBox;
        } else if (loc.indexOf('STATUS') == 0) {
            refSibling = this.statusArea.aggregateMenu ? this.statusArea.aggregateMenu.container : null;
            destination = this._rightBox;
        } else { //TASKBAR
            refSibling = this.taskbar.actor;
            destination = refSibling.get_parent();
        }

        if (parent != destination) {
            parent.remove_actor(dateMenuContainer);
            destination.add_actor(dateMenuContainer);
        }

        destination['set_child_' + (loc.indexOf('RIGHT') > 0 ? 'above' : 'below') + '_sibling'](dateMenuContainer, refSibling);
        destination.queue_relayout();
    },

    _displayShowDesktopButton: function (isVisible) {
        if(isVisible) {
            if(this._showDesktopButton)
                return;

            this._showDesktopButton = new St.Bin({ style_class: 'showdesktop-button',
                            reactive: true,
                            can_focus: true,
                            x_fill: true,
                            y_fill: true,
                            track_hover: true });

            this._setShowDesktopButtonSize();

            this._showDesktopButton.connect('button-press-event', () => this._onShowDesktopButtonPress());
            this._showDesktopButton.connect('enter-event', () => {
                this._showDesktopButton.add_style_class_name('showdesktop-button-hovered');

                if (Me.settings.get_boolean('show-showdesktop-hover')) {
                    this._showDesktopTimeoutId = Mainloop.timeout_add(Me.settings.get_int('show-showdesktop-delay'), () => {
                        this._hiddenDesktopWorkspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace();
                        this._toggleWorkspaceWindows(true, this._hiddenDesktopWorkspace);
                        this._showDesktopTimeoutId = 0;
                    });
                }
            });
            
            this._showDesktopButton.connect('leave-event', () => {
                this._showDesktopButton.remove_style_class_name('showdesktop-button-hovered');

                if (Me.settings.get_boolean('show-showdesktop-hover')) {
                    if (this._showDesktopTimeoutId) {
                        Mainloop.source_remove(this._showDesktopTimeoutId);
                        this._showDesktopTimeoutId = 0;
                    } else {
                        this._toggleWorkspaceWindows(false, this._hiddenDesktopWorkspace);
                    }
                 }
            });

            this._rightBox.insert_child_at_index(this._showDesktopButton, this._rightBox.get_children().length);
        } else {
            if(!this._showDesktopButton)
                return;

            this._rightBox.remove_child(this._showDesktopButton);
            this._showDesktopButton.destroy();
            this._showDesktopButton = null;
        }
    },

    _setShowDesktopButtonSize: function() {
        if (this._showDesktopButton) {
            let buttonSize = Me.settings.get_int('showdesktop-button-width') + 'px;';
            let isVertical = checkIfVertical();
            let sytle = isVertical ? 'border-top-width:1px;height:' + buttonSize : 'border-left-width:1px;width:' + buttonSize;
            
            this._showDesktopButton.set_style(sytle);
            this._showDesktopButton[(isVertical ? 'x' : 'y') + '_expand'] = true;
        }
    },

    _toggleWorkspaceWindows: function(hide, workspace) {
        workspace.list_windows().forEach(w => 
            Tweener.addTween(w.get_compositor_private(), {
                opacity: hide ? 0 : 255,
                time: Me.settings.get_int('show-showdesktop-time') * .001,
                transition: 'easeOutQuad'
            })
        );
    },

    _onShowDesktopButtonPress: function() {
        let label = 'trackerFocusApp';

        this._signalsHandler.removeWithLabel(label);

        if(this._restoreWindowList && this._restoreWindowList.length) {
            if (this._showDesktopTimeoutId) {
                Mainloop.source_remove(this._showDesktopTimeoutId);
                this._showDesktopTimeoutId = 0;
            }
            
            let current_workspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace();
            let windows = current_workspace.list_windows();
            this._restoreWindowList.forEach(function(w) {
                if(windows.indexOf(w) > -1)
                    Main.activateWindow(w);
            });
            this._restoreWindowList = null;
        } else {
            let current_workspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace();
            let windows = current_workspace.list_windows().filter(function (w) {
                return w.showing_on_its_workspace() && !w.skip_taskbar;
            });
            windows = global.display.sort_windows_by_stacking(windows);

            windows.forEach(function(w) {
                w.minimize();
            });
            
            this._restoreWindowList = windows;

            Mainloop.timeout_add(0, Lang.bind(this, function () {
                this._signalsHandler.addWithLabel(label, [tracker, 'notify::focus-app', () => this._restoreWindowList = null]);
            }));
        }

        Main.overview.hide();
    },

    _onPanelMouseScroll: function(actor, event) {
        let scrollAction = Me.settings.get_string('scroll-panel-action');
        let direction = Utils.getMouseScrollDirection(event);

        if (!this._checkIfIgnoredSrollSource(event.get_source()) && direction && !this._scrollPanelDelayTimeoutId) {
            this._scrollPanelDelayTimeoutId = Mainloop.timeout_add(Me.settings.get_int('scroll-panel-delay'), () => {
                this._scrollPanelDelayTimeoutId = 0;
            });

            if (scrollAction === 'SWITCH_WORKSPACE') {
                let args = [global.display];

                //gnome-shell < 3.30 needs an additional "screen" param
                global.screen ? args.push(global.screen) : 0;

                Main.wm._showWorkspaceSwitcher.apply(Main.wm, args.concat([0, { get_name: () => 'switch---' + direction }]));
            } else if (scrollAction === 'CYCLE_WINDOWS') {
                let windows = this.taskbar.getAppInfos().reduce((ws, appInfo) => ws.concat(appInfo.windows), []);
                
                Utils.activateSiblingWindow(windows, direction);
            }
        }
    },

    _checkIfIgnoredSrollSource: function(source) {
        let ignoredConstr = ['WorkspaceIndicator'];

        return source._dtpIgnoreScroll || ignoredConstr.indexOf(source.constructor.name) >= 0;
    }
});

var dtpSecondaryAggregateMenu = Utils.defineClass({
    Name: 'dtpSecondaryAggregateMenu',
    Extends: PanelMenu.Button,

    _init: function() {
        this.callParent('_init', 0.0, C_("System menu in the top bar", "System"), false);

        this.menu.actor.add_style_class_name('aggregate-menu');

        let menuLayout = new Panel.AggregateLayout();
        this.menu.box.set_layout_manager(menuLayout);

        this._indicators = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this.actor.add_child(this._indicators);

        if (Config.HAVE_NETWORKMANAGER && Config.PACKAGE_VERSION >= '3.24') {
            this._network = new imports.ui.status.network.NMApplet();
        } else {
            this._network = null;
        }
        if (Config.HAVE_BLUETOOTH) {
            this._bluetooth = new imports.ui.status.bluetooth.Indicator();
        } else {
            this._bluetooth = null;
        }

        this._power = new imports.ui.status.power.Indicator();
        this._volume = new imports.ui.status.volume.Indicator();
        this._brightness = new imports.ui.status.brightness.Indicator();
        this._system = new imports.ui.status.system.Indicator();
        this._screencast = new imports.ui.status.screencast.Indicator();
        
        if (Config.PACKAGE_VERSION >= '3.24') {
            this._nightLight = new imports.ui.status.nightLight.Indicator();
        }

        if (Config.PACKAGE_VERSION >= '3.28') {
            this._thunderbolt = new imports.ui.status.thunderbolt.Indicator();
        }

        if (this._thunderbolt) {
            this._indicators.add_child(this._thunderbolt.indicators);
        }
        this._indicators.add_child(this._screencast.indicators);
        if (this._nightLight) {
            this._indicators.add_child(this._nightLight.indicators);
        }
        if (this._network) {
            this._indicators.add_child(this._network.indicators);
        }
        if (this._bluetooth) {
            this._indicators.add_child(this._bluetooth.indicators);
        }
        this._indicators.add_child(this._volume.indicators);
        this._indicators.add_child(this._power.indicators);
        this._indicators.add_child(PopupMenu.arrowIcon(St.Side.BOTTOM));

        this.menu.addMenuItem(this._volume.menu);
        this._volume._volumeMenu._readOutput();
        this._volume._volumeMenu._readInput();
        
        this.menu.addMenuItem(this._brightness.menu);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        if (this._network) {
            this.menu.addMenuItem(this._network.menu);
        }
        if (this._bluetooth) {
            this.menu.addMenuItem(this._bluetooth.menu);
        }
        this.menu.addMenuItem(this._power.menu);
        this._power._sync();

        if (this._nightLight) {
            this.menu.addMenuItem(this._nightLight.menu);
        }
        this.menu.addMenuItem(this._system.menu);

        menuLayout.addSizeChild(this._power.menu.actor);
        menuLayout.addSizeChild(this._system.menu.actor);

        setMenuArrow(this._indicators.get_last_child(), getPosition());
    },
});
