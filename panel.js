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
const GObject = imports.gi.GObject;
const Gi = imports._gi;
const AppIcons = Me.imports.appIcons;
const Utils = Me.imports.utils;
const { Taskbar, TaskbarItemContainer } = Me.imports.taskbar;
const Pos = Me.imports.panelPositions;
const PanelSettings = Me.imports.panelSettings;
const { PanelStyle } = Me.imports.panelStyle;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Dash = imports.ui.dash;
const CtrlAltTab = imports.ui.ctrlAltTab;
const GSPanel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const DND = imports.ui.dnd;
const Shell = imports.gi.Shell;
const PopupMenu = imports.ui.popupMenu;
const IconGrid = imports.ui.iconGrid;
const DateMenu = imports.ui.dateMenu;
const Volume = imports.ui.status.volume;
const Progress = Me.imports.progress;

const Intellihide = Me.imports.intellihide;
const Transparency = Me.imports.transparency;
const _ = imports.gettext.domain(Me.imports.utils.TRANSLATION_DOMAIN).gettext;

let tracker = Shell.WindowTracker.get_default();
var panelBoxes = ['_leftBox', '_centerBox', '_rightBox'];

//timeout names
const T2 = 'startIntellihideTimeout';
const T4 = 'showDesktopTimeout';
const T5 = 'trackerFocusAppTimeout';
const T6 = 'scrollPanelDelayTimeout';
const T7 = 'waitPanelBoxAllocation';

var Panel = GObject.registerClass({
}, class Panel extends St.Widget {

    _init(panelManager, monitor, panelBox, isStandalone) {
        super._init({ layout_manager: new Clutter.BinLayout() });

        this._timeoutsHandler = new Utils.TimeoutsHandler();
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this.panelManager = panelManager;
        this.panelStyle = new PanelStyle();

        this.monitor = monitor;
        this.panelBox = panelBox;

        // when the original gnome-shell top panel is kept, all panels are "standalone",
        // so in this case use isPrimary to get the panel on the primary dtp monitor, which
        // might be different from the system's primary monitor.
        this.isStandalone = isStandalone;
        this.isPrimary = !isStandalone || (Me.settings.get_boolean('stockgs-keep-top-panel') && 
                                           monitor == panelManager.dtpPrimaryMonitor);

        this._sessionStyle = null;
        this._unmappedButtons = [];
        this._elementGroups = [];

        let systemMenuInfo = Utils.getSystemMenuInfo();

        if (isStandalone) {
            this.panel = new SecondaryPanel({ name: 'panel', reactive: true });
            this.statusArea = this.panel.statusArea = {};

            //next 3 functions are needed by other extensions to add elements to the secondary panel
            this.panel.addToStatusArea = function(role, indicator, position, box) {
                return Main.panel.addToStatusArea.call(this, role, indicator, position, box);
            };

            this.panel._addToPanelBox = function(role, indicator, position, box) {
                Main.panel._addToPanelBox.call(this, role, indicator, position, box);
            };

            this.panel._onMenuSet = function(indicator) {
                Main.panel._onMenuSet.call(this, indicator);
            };

            this._leftBox = this.panel._leftBox = new St.BoxLayout({ name: 'panelLeft' });
            this._centerBox = this.panel._centerBox = new St.BoxLayout({ name: 'panelCenter' });
            this._rightBox = this.panel._rightBox = new St.BoxLayout({ name: 'panelRight' });

            this.menuManager = this.panel.menuManager = new PopupMenu.PopupMenuManager(this.panel);

            this._setPanelMenu(systemMenuInfo.name, systemMenuInfo.constructor, this.panel);
            this._setPanelMenu('dateMenu', DateMenu.DateMenuButton, this.panel);
            this._setPanelMenu('activities', GSPanel.ActivitiesButton, this.panel);

            this.panel.add_child(this._leftBox);
            this.panel.add_child(this._centerBox);
            this.panel.add_child(this._rightBox);
        } else {
            this.panel = Main.panel;
            this.statusArea = Main.panel.statusArea;
            this.menuManager = Main.panel.menuManager;

            panelBoxes.forEach(p => this[p] = Main.panel[p]);

            ['activities', systemMenuInfo.name, 'dateMenu'].forEach(b => {
                let container = this.statusArea[b].container;
                let parent = container.get_parent();

                container._dtpOriginalParent = parent;
                parent ? parent.remove_child(container) : null;
                this.panel.add_child(container);
            });
        }

        // Create a wrapper around the real showAppsIcon in order to add a popupMenu. Most of 
        // its behavior is handled by the taskbar, but its positioning is done at the panel level
        this.showAppsIconWrapper = new AppIcons.ShowAppsIconWrapper(this);
        this.panel.add_child(this.showAppsIconWrapper.realShowAppsIcon);

        this.panel._delegate = this;
        
        this.add_child(this.panel);

        if (Main.panel._onButtonPress || Main.panel._tryDragWindow) {
            this._signalsHandler.add([
                this.panel, 
                [
                    'button-press-event', 
                    'touch-event'
                ],
                this._onButtonPress.bind(this)
            ]);
        }

        if (Main.panel._onKeyPress) {
            this._signalsHandler.add([this.panel, 'key-press-event', Main.panel._onKeyPress.bind(this)]);
        }
       
        Main.ctrlAltTabManager.addGroup(this, _("Top Bar")+" "+ monitor.index, 'focus-top-bar-symbolic',
                                        { sortGroup: CtrlAltTab.SortGroup.TOP });
    }

    enable () {
        let { name: systemMenuName } = Utils.getSystemMenuInfo();

        if (this.statusArea[systemMenuName]) {
            Utils.getIndicators(this.statusArea[systemMenuName]._volume)._dtpIgnoreScroll = 1;
        }

        this.geom = this.getGeometry();
        
        this._setPanelPosition();

        if (!this.isStandalone) {
            Utils.hookVfunc(Object.getPrototypeOf(this.panel), 'allocate', (box) => this._mainPanelAllocate(box));

            // remove the extra space before the clock when the message-indicator is displayed
            if (DateMenu.IndicatorPad) {
                Utils.hookVfunc(DateMenu.IndicatorPad.prototype, 'get_preferred_width', () => [0,0]);
                Utils.hookVfunc(DateMenu.IndicatorPad.prototype, 'get_preferred_height', () => [0,0]);
            }
        }

        if (!DateMenu.IndicatorPad && this.statusArea.dateMenu) {
            //3.36 switched to a size constraint applied on an anonymous child
            let indicatorPad = this.statusArea.dateMenu.get_first_child().get_first_child();

            this._dateMenuIndicatorPadContraints = indicatorPad.get_constraints();
            indicatorPad.clear_constraints();
        }

        this.menuManager._oldChangeMenu = this.menuManager._changeMenu;
        this.menuManager._changeMenu = (menu) => {
            if (!Me.settings.get_boolean('stockgs-panelbtn-click-only')) {
                this.menuManager._oldChangeMenu(menu);
            }
        };

        this.dynamicTransparency = new Transparency.DynamicTransparency(this);
        
        this.taskbar = new Taskbar(this);

        this.panel.add_child(this.taskbar.actor);

        this._setAppmenuVisible(Me.settings.get_boolean('show-appmenu'));
        this._setShowDesktopButton(true);
        
        this._setAllocationMap();

        this.panel.add_style_class_name('dashtopanelMainPanel ' + this.getOrientation());

        this._timeoutsHandler.add([T2, Me.settings.get_int('intellihide-enable-start-delay'), () => this.intellihide = new Intellihide.Intellihide(this)]);

        this._signalsHandler.add(
            // this is to catch changes to the theme or window scale factor
            [
                Utils.getStageTheme(), 
                'changed', 
                () => (this._resetGeometry(), this._setShowDesktopButtonStyle()),
            ],
            [
                // sync hover after a popupmenu is closed
                this.taskbar,
                'menu-closed', 
                () => this.panel.sync_hover()
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
                Main.overview,
                'hidden',
                () => {
                    if (this.isPrimary) {
                        //reset the primary monitor when exiting the overview
                        this.panelManager.setFocusedMonitor(this.monitor);
                    }
                }
            ],
            [
                this.statusArea.activities,
                'captured-event', 
                (actor, e) => {
                    if (e.type() == Clutter.EventType.BUTTON_PRESS || e.type() == Clutter.EventType.TOUCH_BEGIN) {
                        //temporarily use as primary the monitor on which the activities btn was clicked 
                        this.panelManager.setFocusedMonitor(this.monitor);
                    }
                }
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
                this.panel,
                'scroll-event',
                this._onPanelMouseScroll.bind(this)
            ],
            [
                Main.layoutManager,
                'startup-complete',
                () => this._resetGeometry()
            ]
        );

        this._bindSettingsChanges();

        this.panelStyle.enable(this);

        if (this.checkIfVertical()) {
            this._signalsHandler.add([
                this.panelBox,
                'notify::visible',
                () => {
                    if (this.panelBox.visible) {
                        this._refreshVerticalAlloc();
                    }
                }
            ]);

            if (this.statusArea.dateMenu) {
                this._formatVerticalClock();
                
                this._signalsHandler.add([
                    this.statusArea.dateMenu._clock,
                    'notify::clock',
                    () => this._formatVerticalClock()
                ]);
            }
        }

        // Since we are usually visible but not usually changing, make sure
        // most repaint requests don't actually require us to repaint anything.
        // This saves significant CPU when repainting the screen.
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

        this._initProgressManager();
    }

    disable() {
        this.panelStyle.disable();

        this._timeoutsHandler.destroy();
        this._signalsHandler.destroy();
        
        this.panel.remove_child(this.taskbar.actor);
        this._setAppmenuVisible(false);

        if (this.intellihide) {
            this.intellihide.destroy();
        }

        this.dynamicTransparency.destroy();

        this.progressManager.destroy();

        this.taskbar.destroy();
        this.showAppsIconWrapper.destroy();

        this.menuManager._changeMenu = this.menuManager._oldChangeMenu;

        this._unmappedButtons.forEach(a => this._disconnectVisibleId(a));

        if (this.statusArea.dateMenu) {
            this.statusArea.dateMenu._clockDisplay.text = this.statusArea.dateMenu._clock.clock;
            this.statusArea.dateMenu._clockDisplay.clutter_text.set_width(-1);

            if (this._dateMenuIndicatorPadContraints) {
                let indicatorPad = this.statusArea.dateMenu.get_first_child().get_first_child();

                this._dateMenuIndicatorPadContraints.forEach(c => indicatorPad.add_constraint(c));
            }
        }

        this._setVertical(this.panel, false);
        this._setVertical(this._centerBox, false);
        this._setVertical(this._rightBox, false);

        let { name: systemMenuName } = Utils.getSystemMenuInfo();

        if (!this.isStandalone) {
            ['vertical', 'horizontal', 'dashtopanelMainPanel'].forEach(c => this.panel.remove_style_class_name(c));

            if (!Main.sessionMode.isLocked) {
                [['activities', 0], [systemMenuName, -1], ['dateMenu', 0]].forEach(b => {
                    let container = this.statusArea[b[0]].container;
                    let originalParent = container._dtpOriginalParent;
    
                    this.panel.remove_child(container);
                    originalParent ? originalParent.insert_child_at_index(container, b[1]) : null;
                    delete container._dtpOriginalParent;
                });
            }

            this._setShowDesktopButton(false);

            delete Utils.getIndicators(this.statusArea[systemMenuName]._volume)._dtpIgnoreScroll;

            if (DateMenu.IndicatorPad) {
                Utils.hookVfunc(DateMenu.IndicatorPad.prototype, 'get_preferred_width', DateMenu.IndicatorPad.prototype.vfunc_get_preferred_width);
                Utils.hookVfunc(DateMenu.IndicatorPad.prototype, 'get_preferred_height', DateMenu.IndicatorPad.prototype.vfunc_get_preferred_height);
            }

            Utils.hookVfunc(Object.getPrototypeOf(this.panel), 'allocate', Object.getPrototypeOf(this.panel).vfunc_allocate);
            
            this.panel._delegate = this.panel;
        } else {
            this._removePanelMenu('dateMenu');
            this._removePanelMenu(systemMenuName);
            this._removePanelMenu('activities');
        }

        Main.ctrlAltTabManager.removeGroup(this);
    }

    handleDragOver(source, actor, x, y, time) {
        if (source == Main.xdndHandler) {
            
            // open overview so they can choose a window for focusing
            // and ultimately dropping dragged item onto
            if(Main.overview.shouldToggleByCornerOrButton())
                Main.overview.show();
        }
        
        return DND.DragMotionResult.CONTINUE;
    }

    getPosition() {
        let position = PanelSettings.getPanelPosition(Me.settings, this.monitor.index);

        if (position == Pos.TOP) {
            return St.Side.TOP;
        } else if (position == Pos.RIGHT) {
            return St.Side.RIGHT;
        } else if (position == Pos.BOTTOM) {
            return St.Side.BOTTOM;
        }
        
        return St.Side.LEFT;
    }

    checkIfVertical() {
        let position = this.getPosition();
    
        return (position == St.Side.LEFT || position == St.Side.RIGHT);
    }
    
    getOrientation() {
        return (this.checkIfVertical() ? 'vertical' : 'horizontal');
    }

    updateElementPositions() {
        let panelPositions = this.panelManager.panelsElementPositions[this.monitor.index] || Pos.defaults;

        this._updateGroupedElements(panelPositions);

        this.panel.hide();
        this.panel.show();
    }

    _updateGroupedElements(panelPositions) {
        let previousPosition = 0;
        let previousCenteredPosition = 0;
        let currentGroup = -1;

        this._elementGroups = [];

        panelPositions.forEach(pos => {
            let allocationMap = this.allocationMap[pos.element];

            if (allocationMap.actor) {
                allocationMap.actor.visible = pos.visible;

                if (!pos.visible) {
                    return;
                }

                let currentPosition = pos.position;
                let isCentered = Pos.checkIfCentered(currentPosition);

                if (currentPosition == Pos.STACKED_TL && previousPosition == Pos.STACKED_BR) {
                    currentPosition = Pos.STACKED_BR;
                }

                if (!previousPosition || 
                    (previousPosition == Pos.STACKED_TL && currentPosition != Pos.STACKED_TL) ||
                    (previousPosition != Pos.STACKED_BR && currentPosition == Pos.STACKED_BR) ||
                    (isCentered && previousPosition != currentPosition && previousPosition != Pos.STACKED_BR)) {
                    this._elementGroups[++currentGroup] = { elements: [], index: this._elementGroups.length, expandableIndex: -1 };
                    previousCenteredPosition = 0;
                }

                if (pos.element == Pos.TASKBAR) {
                    this._elementGroups[currentGroup].expandableIndex = this._elementGroups[currentGroup].elements.length;
                }

                if (isCentered && !this._elementGroups[currentGroup].isCentered) {
                    this._elementGroups[currentGroup].isCentered = 1;
                    previousCenteredPosition = currentPosition;
                }

                this._elementGroups[currentGroup].position = previousCenteredPosition || currentPosition;
                this._elementGroups[currentGroup].elements.push(allocationMap);

                allocationMap.position = currentPosition;
                previousPosition = currentPosition;
            }
        });
    }

    _bindSettingsChanges() {
        let isVertical = this.checkIfVertical();

        this._signalsHandler.add(
            [
                Me.settings,
                [
                    'changed::panel-sizes',
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
                'changed::show-appmenu',
                () => this._setAppmenuVisible(Me.settings.get_boolean('show-appmenu'))
            ],
            [
                Me.settings,
                [
                    'changed::showdesktop-button-width',
                    'changed::trans-use-custom-bg',
                    'changed::desktop-line-use-custom-color',
                    'changed::desktop-line-custom-color',
                    'changed::trans-bg-color'
                ],
                () => this._setShowDesktopButtonStyle()
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
            ],
            [
                Me.settings,
                'changed::progress-show-bar',
                () => this._initProgressManager()
            ],
            [
                Me.settings,
                'changed::progress-show-count',
                () => this._initProgressManager()
            ]
        );

        if (isVertical) {
            this._signalsHandler.add([Me.settings, 'changed::group-apps-label-max-width', () => this._resetGeometry()]);
        }
    }

    _setPanelMenu(propName, constr, container) {
        if (!this.statusArea[propName]) {
            this.statusArea[propName] = this._getPanelMenu(propName, constr);
            this.menuManager.addMenu(this.statusArea[propName].menu);
            container.insert_child_at_index(this.statusArea[propName].container, 0);
        }
    }
    
    _removePanelMenu(propName) {
        if (this.statusArea[propName]) {
            let parent = this.statusArea[propName].container.get_parent();

            if (parent) {
                parent.remove_actor(this.statusArea[propName].container);
            }

            //calling this.statusArea[propName].destroy(); is buggy for now, gnome-shell never
            //destroys those panel menus...
            //since we can't destroy the menu (hence properly disconnect its signals), let's 
            //store it so the next time a panel needs one of its kind, we can reuse it instead 
            //of creating a new one
            let panelMenu = this.statusArea[propName];

            this.menuManager.removeMenu(panelMenu.menu);
            Me.persistentStorage[propName].push(panelMenu);
            this.statusArea[propName] = null;
        }
    }

    _getPanelMenu(propName, constr) {
        Me.persistentStorage[propName] = Me.persistentStorage[propName] || [];

        if (!Me.persistentStorage[propName].length) {
            Me.persistentStorage[propName].push(new constr());
        }

        return Me.persistentStorage[propName].pop();
    }

    _adjustForOverview() {
        let isFocusedMonitor = this.panelManager.checkIfFocusedMonitor(this.monitor);
        let isOverview = !!Main.overview.visibleTarget;
        let isOverviewFocusedMonitor = isOverview && isFocusedMonitor;
        let isShown = !isOverview || isOverviewFocusedMonitor;
        let actorData = Utils.getTrackedActorData(this.panelBox)

        // prevent the "chrome" to update the panelbox visibility while in overview
        actorData.trackFullscreen = !isOverview

        this.panelBox[isShown ? 'show' : 'hide']();
    }

    _resetGeometry() {
        this.geom = this.getGeometry();
        this._setPanelPosition();
        this.taskbar.resetAppIcons(true);
        this.dynamicTransparency.updateExternalStyle();

        if (this.intellihide && this.intellihide.enabled) {
            this.intellihide.reset();
        }

        if (this.checkIfVertical()) {
            this.showAppsIconWrapper.realShowAppsIcon.toggleButton.set_width(this.geom.w);
            this._refreshVerticalAlloc();
        }
    }

    getGeometry() {
        let scaleFactor = Utils.getScaleFactor();
        let panelBoxTheme = this.panelBox.get_theme_node();
        let lrPadding = panelBoxTheme.get_padding(St.Side.RIGHT) + panelBoxTheme.get_padding(St.Side.LEFT);
        let topPadding = panelBoxTheme.get_padding(St.Side.TOP);
        let tbPadding = topPadding + panelBoxTheme.get_padding(St.Side.BOTTOM);
        let position = this.getPosition();
        let length = PanelSettings.getPanelLength(Me.settings, this.monitor.index) / 100;
        let anchor = PanelSettings.getPanelAnchor(Me.settings, this.monitor.index);
        let anchorPlaceOnMonitor = 0;
        let gsTopPanelOffset = 0;
        let x = 0, y = 0;
        let w = 0, h = 0;

        const panelSize = PanelSettings.getPanelSize(Me.settings, this.monitor.index);
        this.dtpSize = panelSize * scaleFactor;

        if (Me.settings.get_boolean('stockgs-keep-top-panel') && Main.layoutManager.primaryMonitor == this.monitor) {
            gsTopPanelOffset = Main.layoutManager.panelBox.height - topPadding;
        }

        if (this.checkIfVertical()) {
            if (!Me.settings.get_boolean('group-apps')) {
                // add window title width and side padding of _dtpIconContainer when vertical
                this.dtpSize += Me.settings.get_int('group-apps-label-max-width') + AppIcons.DEFAULT_PADDING_SIZE * 2 / scaleFactor;
            }

            this.sizeFunc = 'get_preferred_height',
            this.fixedCoord = { c1: 'x1', c2: 'x2' }
            this.varCoord = { c1: 'y1', c2: 'y2' };

            w = this.dtpSize;
            h = this.monitor.height * length - tbPadding - gsTopPanelOffset;
        } else {
            this.sizeFunc = 'get_preferred_width';
            this.fixedCoord = { c1: 'y1', c2: 'y2' };
            this.varCoord = { c1: 'x1', c2: 'x2' };

            w = this.monitor.width * length - lrPadding;
            h = this.dtpSize;
        }

        if (position == St.Side.TOP || position == St.Side.LEFT) {
            x = this.monitor.x;
            y = this.monitor.y + gsTopPanelOffset;
        } else if (position == St.Side.RIGHT) {
            x = this.monitor.x + this.monitor.width - this.dtpSize - lrPadding;
            y = this.monitor.y + gsTopPanelOffset;
        } else { //BOTTOM
            x = this.monitor.x;
            y = this.monitor.y + this.monitor.height - this.dtpSize - tbPadding;
        }

        if (this.checkIfVertical()) {
            let viewHeight = this.monitor.height - gsTopPanelOffset;
            
            if (anchor === Pos.MIDDLE) {
                anchorPlaceOnMonitor = (viewHeight - h) / 2;
            } else if (anchor === Pos.END) {
                anchorPlaceOnMonitor = viewHeight - h;
            } else { // Pos.START
                anchorPlaceOnMonitor = 0;
            }
            y = y + anchorPlaceOnMonitor;
        } else {
            if (anchor === Pos.MIDDLE) {
                anchorPlaceOnMonitor = (this.monitor.width - w) / 2;
            } else if (anchor === Pos.END) {
                anchorPlaceOnMonitor = this.monitor.width - w;
            } else { // Pos.START
                anchorPlaceOnMonitor = 0;
            }
            x = x + anchorPlaceOnMonitor;
        }

        return {
            x, y, 
            w, h,
            lrPadding,
            tbPadding,
            position
        };
    }

    _setAllocationMap() {
        this.allocationMap = {};
        let setMap = (name, actor) => this.allocationMap[name] = { 
            actor: actor,
            box: new Clutter.ActorBox() 
        };
        
        setMap(Pos.SHOW_APPS_BTN, this.showAppsIconWrapper.realShowAppsIcon);
        setMap(Pos.ACTIVITIES_BTN, this.statusArea.activities ? this.statusArea.activities.container : 0);
        setMap(Pos.LEFT_BOX, this._leftBox);
        setMap(Pos.TASKBAR, this.taskbar.actor);
        setMap(Pos.CENTER_BOX, this._centerBox);
        setMap(Pos.DATE_MENU, this.statusArea.dateMenu.container);
        setMap(Pos.SYSTEM_MENU, this.statusArea[Utils.getSystemMenuInfo().name].container);
        setMap(Pos.RIGHT_BOX, this._rightBox);
        setMap(Pos.DESKTOP_BTN, this._showDesktopButton);
    }

    _mainPanelAllocate(box) {
        this.panel.set_allocation(box);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        let fixed = 0;
        let centeredMonitorGroup;
        let panelAlloc = new Clutter.ActorBox({ x1: 0, y1: 0, x2: this.geom.w, y2: this.geom.h });
        let assignGroupSize = (group, update) => {
            group.size = 0;
            group.tlOffset = 0;
            group.brOffset = 0;

            group.elements.forEach(element => {
                if (!update) {
                    element.box[this.fixedCoord.c1] = panelAlloc[this.fixedCoord.c1];
                    element.box[this.fixedCoord.c2] = panelAlloc[this.fixedCoord.c2];
                    element.natSize = element.actor[this.sizeFunc](-1)[1];
                }

                if (!group.isCentered || Pos.checkIfCentered(element.position)) {
                    group.size += element.natSize;
                } else if (element.position == Pos.STACKED_TL) {
                    group.tlOffset += element.natSize;
                } else { // Pos.STACKED_BR
                    group.brOffset += element.natSize;
                }
            });

            if (group.isCentered) {
                group.size += Math.max(group.tlOffset, group.brOffset) * 2;
                group.tlOffset = Math.max(group.tlOffset - group.brOffset, 0);
            }
        };
        let allocateGroup = (group, tlLimit, brLimit) => {
            let startPosition = tlLimit;
            let currentPosition = 0;

            if (group.expandableIndex >= 0) {
                let availableSize = brLimit - tlLimit;
                let expandable = group.elements[group.expandableIndex];
                let i = 0;
                let l = this._elementGroups.length;
                let tlSize = 0;
                let brSize = 0;

                if (centeredMonitorGroup && (centeredMonitorGroup != group || expandable.position != Pos.CENTERED_MONITOR)) {
                    if (centeredMonitorGroup.index < group.index || (centeredMonitorGroup == group && expandable.position == Pos.STACKED_TL)) {
                        i = centeredMonitorGroup.index;
                    } else {
                        l = centeredMonitorGroup.index;
                    }
                }

                for (; i < l; ++i) {
                    let refGroup = this._elementGroups[i];

                    if (i < group.index && (!refGroup.fixed || refGroup[this.varCoord.c2] > tlLimit)) {
                        tlSize += refGroup.size;
                    } else if (i > group.index && (!refGroup.fixed || refGroup[this.varCoord.c1] < brLimit)) {
                        brSize += refGroup.size;
                    }
                }
                
                if (group.isCentered) {
                    availableSize -= Math.max(tlSize, brSize) * 2;
                } else {
                    availableSize -= tlSize + brSize;
                }
                
                if (availableSize < group.size) {
                    expandable.natSize -= (group.size - availableSize) * (group.isCentered && !Pos.checkIfCentered(expandable.position) ? .5 : 1);
                    assignGroupSize(group, true);
                }
            }
            
            if (group.isCentered) {
                startPosition = tlLimit + (brLimit - tlLimit - group.size) * .5;
            } else if (group.position == Pos.STACKED_BR) {
                startPosition = brLimit - group.size;
            }

            currentPosition = group.tlOffset + startPosition;

            group.elements.forEach(element => {
                element.box[this.varCoord.c1] = Math.round(currentPosition);
                element.box[this.varCoord.c2] = Math.round((currentPosition += element.natSize));

                element.actor.allocate(element.box);
            });

            group[this.varCoord.c1] = startPosition;
            group[this.varCoord.c2] = currentPosition;
            group.fixed = 1;
            ++fixed;
        };

        this.panel.allocate(panelAlloc);

        this._elementGroups.forEach(group => {
            group.fixed = 0;

            assignGroupSize(group);

            if (group.position == Pos.CENTERED_MONITOR) {
                centeredMonitorGroup = group;
            }
        });

        if (centeredMonitorGroup) {
            allocateGroup(centeredMonitorGroup, panelAlloc[this.varCoord.c1], panelAlloc[this.varCoord.c2]);
        }

        let iterations = 0; //failsafe
        while (fixed < this._elementGroups.length && ++iterations < 10) {
            for (let i = 0, l = this._elementGroups.length; i < l; ++i) {
                let group = this._elementGroups[i];

                if (group.fixed) {
                    continue;
                }

                let prevGroup = this._elementGroups[i - 1];
                let nextGroup = this._elementGroups[i + 1];
                let prevLimit = prevGroup && prevGroup.fixed ? prevGroup[this.varCoord.c2] : 
                                    centeredMonitorGroup && group.index > centeredMonitorGroup.index ? centeredMonitorGroup[this.varCoord.c2] : panelAlloc[this.varCoord.c1];
                let nextLimit = nextGroup && nextGroup.fixed ? nextGroup[this.varCoord.c1] : 
                                    centeredMonitorGroup && group.index < centeredMonitorGroup.index ? centeredMonitorGroup[this.varCoord.c1] : panelAlloc[this.varCoord.c2];

                if (group.position == Pos.STACKED_TL) {
                    allocateGroup(group, panelAlloc[this.varCoord.c1], nextLimit);
                } else if (group.position == Pos.STACKED_BR) {
                    allocateGroup(group, prevLimit, panelAlloc[this.varCoord.c2]);
                } else if ((!prevGroup || prevGroup.fixed) && (!nextGroup || nextGroup.fixed)) { // CENTERED
                    allocateGroup(group, prevLimit, nextLimit);
                }
            }
        }
    }

    _setPanelPosition() {
        let clipContainer = this.panelBox.get_parent();

        this.set_size(this.geom.w, this.geom.h);
        clipContainer.set_position(this.geom.x, this.geom.y);

        this._setVertical(this.panel, this.checkIfVertical());

        // styles for theming
        Object.keys(St.Side).forEach(p => {
            let cssName = 'dashtopanel' + p.charAt(0) + p.slice(1).toLowerCase();
            
            this.panel[(St.Side[p] == this.geom.position ? 'add' : 'remove') + '_style_class_name'](cssName);
        });

        this._setPanelClip(clipContainer);

        Main.layoutManager._updateHotCorners();
        Main.layoutManager._updatePanelBarrier(this);
    }

    _setPanelClip(clipContainer) {
        clipContainer = clipContainer || this.panelBox.get_parent();
        this._timeoutsHandler.add([T7, 0, () => Utils.setClip(clipContainer, clipContainer.x, clipContainer.y, this.panelBox.width, this.panelBox.height)]);
    }

    _onButtonPress(actor, event) {
        let type = event.type();
        let isPress = type == Clutter.EventType.BUTTON_PRESS;
        let button = isPress ? event.get_button() : -1;
        let [stageX, stageY] = event.get_coords();

        if (button == 3 && global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, stageX, stageY) == this.panel) {
            //right click on an empty part of the panel, temporarily borrow and display the showapps context menu
            Main.layoutManager.setDummyCursorGeometry(stageX, stageY, 0, 0);

            this.showAppsIconWrapper.createMenu();
            this.showAppsIconWrapper.popupMenu(Main.layoutManager.dummyCursor);

            return Clutter.EVENT_STOP;
        } else if (Main.modalCount > 0 || event.get_source() != actor || 
            (!isPress && type != Clutter.EventType.TOUCH_BEGIN) ||
            (isPress && button != 1)) {
            return Clutter.EVENT_PROPAGATE;
        }

        let params = this.checkIfVertical() ? [stageY, 'y', 'height'] : [stageX, 'x', 'width'];
        let dragWindow = this._getDraggableWindowForPosition.apply(this, params.concat(['maximized_' + this.getOrientation() + 'ly']));

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
    }

    _getDraggableWindowForPosition(stageCoord, coord, dimension, maximizedProp) {
        let workspace = Utils.getCurrentWorkspace();
        let allWindowsByStacking = global.display.sort_windows_by_stacking(
            workspace.list_windows()
        ).reverse();

        return Utils.find(allWindowsByStacking, metaWindow => {
            let rect = metaWindow.get_frame_rect();

            return metaWindow.get_monitor() == this.monitor.index &&
                   metaWindow.showing_on_its_workspace() &&
                   metaWindow.get_window_type() != Meta.WindowType.DESKTOP &&
                   metaWindow[maximizedProp] &&
                   stageCoord > rect[coord] && stageCoord < rect[coord] + rect[dimension];
        });
    }

    _onBoxActorAdded(box) {
        if (this.checkIfVertical()) {
            this._setVertical(box, true);
        }
    }

    _refreshVerticalAlloc() {
        this._setVertical(this._centerBox, true);
        this._setVertical(this._rightBox, true);
        this._formatVerticalClock();
    }

    _setVertical(actor, isVertical) {
        let _set = (actor, isVertical) => {
            if (!actor || actor instanceof Dash.DashItemContainer || actor instanceof TaskbarItemContainer) {
                return;
            }

            if (actor instanceof St.BoxLayout) {
                actor.vertical = isVertical;
            } else if ((actor._delegate || actor) instanceof PanelMenu.ButtonBox && actor != this.statusArea.appMenu) {
                let child = actor.get_first_child();

                if (isVertical && !actor.visible && !actor._dtpVisibleId) {
                    this._unmappedButtons.push(actor);
                    actor._dtpVisibleId = actor.connect('notify::visible', () => {
                        this._disconnectVisibleId(actor);
                        this._refreshVerticalAlloc();
                    });
                    actor._dtpDestroyId = actor.connect('destroy', () => this._disconnectVisibleId(actor));
                }

                if (child) {
                    let [, natWidth] = actor.get_preferred_width(-1);

                    child.x_align = Clutter.ActorAlign[isVertical ? 'CENTER' : 'START'];
                    actor.set_width(isVertical ? this.dtpSize : -1);
                    isVertical = isVertical && (natWidth > this.dtpSize);
                    actor[(isVertical ? 'add' : 'remove') + '_style_class_name']('vertical');
                }
            }

            actor.get_children().forEach(c => _set(c, isVertical));
        };

        _set(actor, false);
        
        if (isVertical)
            _set(actor, isVertical);
    }

    _disconnectVisibleId(actor) {
        actor.disconnect(actor._dtpVisibleId);
        actor.disconnect(actor._dtpDestroyId);

        delete actor._dtpVisibleId;
        delete actor._dtpDestroyId;
        
        this._unmappedButtons.splice(this._unmappedButtons.indexOf(actor), 1);
    }

    _setAppmenuVisible(isVisible) {
        let parent;
        let appMenu = this.statusArea.appMenu;

        if(appMenu)
            parent = appMenu.container.get_parent();

        if (parent) {
            parent.remove_child(appMenu.container);
        }

        if (isVisible && appMenu) {
            this._leftBox.insert_child_above(appMenu.container, null);
        }
    }

    _formatVerticalClock() {
        // https://github.com/GNOME/gnome-desktop/blob/master/libgnome-desktop/gnome-wall-clock.c#L310
        if (this.statusArea.dateMenu) {
            let datetime = this.statusArea.dateMenu._clock.clock;
            let datetimeParts = datetime.split(' ');
            let time = datetimeParts[1];
            let clockText = this.statusArea.dateMenu._clockDisplay.clutter_text;
            let setClockText = (text, useTimeSeparator) => {
                let stacks = text instanceof Array;
                let separator = `\n<span size="8192"> ${useTimeSeparator ? '‧‧' : '—' } </span>\n`;
        
                clockText.set_text((stacks ? text.join(separator) : text).trim());
                clockText.set_use_markup(stacks);
                clockText.get_allocation_box();
        
                return !clockText.get_layout().is_ellipsized();
            };

            if (clockText.ellipsize == Pango.EllipsizeMode.NONE) {
                //on gnome-shell 3.36.4, the clockdisplay isn't ellipsize anymore, so set it back 
                clockText.ellipsize = Pango.EllipsizeMode.END;
            }

            clockText.natural_width = this.dtpSize;

            if (!time) {
                datetimeParts = datetime.split(' ');
                time = datetimeParts.pop();
                datetimeParts = [datetimeParts.join(' '), time];
            }

            if (!setClockText(datetime) && 
                !setClockText(datetimeParts) && 
                !setClockText(time)) {
                let timeParts = time.split('∶');

                if (!this._clockFormat) {
                    this._clockFormat = Me.desktopSettings.get_string('clock-format');
                }

                if (this._clockFormat == '12h') {
                    timeParts.push.apply(timeParts, timeParts.pop().split(' '));
                }

                setClockText(timeParts, true);
            }
        }
    }

    _setShowDesktopButton(add) {
        if (add) {
            if(this._showDesktopButton)
                return;

            this._showDesktopButton = new St.Bin({ style_class: 'showdesktop-button',
                            reactive: true,
                            can_focus: true,
                            // x_fill: true,
                            // y_fill: true,
                            track_hover: true });

            this._setShowDesktopButtonStyle();

            this._showDesktopButton.connect('button-press-event', () => this._onShowDesktopButtonPress());
            this._showDesktopButton.connect('enter-event', () => {
                this._showDesktopButton.add_style_class_name(this._getBackgroundBrightness() ?
                            'showdesktop-button-light-hovered' : 'showdesktop-button-dark-hovered');

                if (Me.settings.get_boolean('show-showdesktop-hover')) {
                    this._timeoutsHandler.add([T4, Me.settings.get_int('show-showdesktop-delay'), () => {
                        this._hiddenDesktopWorkspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace();
                        this._toggleWorkspaceWindows(true, this._hiddenDesktopWorkspace);
                    }]);
                }
            });
            
            this._showDesktopButton.connect('leave-event', () => {
                this._showDesktopButton.remove_style_class_name(this._getBackgroundBrightness() ?
                            'showdesktop-button-light-hovered' : 'showdesktop-button-dark-hovered');

                if (Me.settings.get_boolean('show-showdesktop-hover')) {
                    if (this._timeoutsHandler.getId(T4)) {
                        this._timeoutsHandler.remove(T4);
                    } else if (this._hiddenDesktopWorkspace) {
                        this._toggleWorkspaceWindows(false, this._hiddenDesktopWorkspace);
                    }
                }
            });

            this.panel.add_child(this._showDesktopButton);
        } else {
            if(!this._showDesktopButton)
                return;

            this.panel.remove_child(this._showDesktopButton);
            this._showDesktopButton.destroy();
            this._showDesktopButton = null;
        }
    }

    _setShowDesktopButtonStyle() {
        let rgb = this._getBackgroundBrightness() ? "rgba(55, 55, 55, .2)" : "rgba(200, 200, 200, .2)";

        let isLineCustom = Me.settings.get_boolean('desktop-line-use-custom-color');
        rgb = isLineCustom ? Me.settings.get_string('desktop-line-custom-color') : rgb;

        if (this._showDesktopButton) {
            let buttonSize = Me.settings.get_int('showdesktop-button-width') + 'px;';
            let isVertical = this.checkIfVertical();

            let sytle = "border: 0 solid " + rgb + ";";
            sytle += isVertical ? 'border-top-width:1px;height:' + buttonSize : 'border-left-width:1px;width:' + buttonSize;

            this._showDesktopButton.set_style(sytle);
            this._showDesktopButton[(isVertical ? 'x' : 'y') + '_expand'] = true;
        }
    }

    // _getBackgroundBrightness: return true if panel has a bright background color
    _getBackgroundBrightness() {
        return Utils.checkIfColorIsBright(this.dynamicTransparency.backgroundColorRgb);
    }

    _toggleWorkspaceWindows(hide, workspace) {
        let time = Me.settings.get_int('show-showdesktop-time') * .001;

        workspace.list_windows().forEach(w => {
            if (!w.minimized && !w.customJS_ding) {
                let tweenOpts = {
                    opacity: hide ? 0 : 255,
                    time: time,
                    transition: 'easeOutQuad'
                };
                
                Utils.animateWindowOpacity(w.get_compositor_private(), tweenOpts);
            }
        });
    }

    _onShowDesktopButtonPress() {
        let label = 'trackerFocusApp';

        this._signalsHandler.removeWithLabel(label);
        this._timeoutsHandler.remove(T5);

        if(this._restoreWindowList && this._restoreWindowList.length) {
            this._timeoutsHandler.remove(T4);

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

            this._timeoutsHandler.add([T5, 20, () => this._signalsHandler.addWithLabel(
                label, 
                [
                    tracker, 
                    'notify::focus-app', 
                    () => this._restoreWindowList = null
                ]
            )]);
        }

        Main.overview.hide();
    }

    _onPanelMouseScroll(actor, event) {
        let scrollAction = Me.settings.get_string('scroll-panel-action');
        let direction = Utils.getMouseScrollDirection(event);

        if (!this._checkIfIgnoredScrollSource(event.get_source()) && !this._timeoutsHandler.getId(T6)) {
            if (direction && scrollAction === 'SWITCH_WORKSPACE') {
                let args = [global.display];

                //adjust for horizontal workspaces
                if (Utils.DisplayWrapper.getWorkspaceManager().layout_rows === 1) {
                    direction = direction == 'up' ? 'left' : 'right';
                }

                //gnome-shell < 3.30 needs an additional "screen" param
                global.screen ? args.push(global.screen) : 0;

                let showWsPopup = Me.settings.get_boolean('scroll-panel-show-ws-popup');
                showWsPopup ? 0 : Main.wm._workspaceSwitcherPopup = { display: () => {} };
                Main.wm._showWorkspaceSwitcher.apply(Main.wm, args.concat([0, { get_name: () => 'switch---' + direction }]));
                showWsPopup ? 0 : Main.wm._workspaceSwitcherPopup = null;
            } else if (direction && scrollAction === 'CYCLE_WINDOWS') {
                let windows = this.taskbar.getAppInfos().reduce((ws, appInfo) => ws.concat(appInfo.windows), []);
                
                Utils.activateSiblingWindow(windows, direction);
            } else if (scrollAction === 'CHANGE_VOLUME' && !event.is_pointer_emulated()) {
                let proto = Volume.Indicator.prototype;
                let func = proto._handleScrollEvent || proto.vfunc_scroll_event || proto._onScrollEvent;
                let indicator = Main.panel.statusArea[Utils.getSystemMenuInfo().name]._volume;

                if (indicator.quickSettingsItems)
                    // new quick settings menu in gnome-shell > 42
                    func(indicator.quickSettingsItems[0], event);
                else
                    func.call(indicator, 0, event);
            } else {
                return;
            }

            var scrollDelay = Me.settings.get_int('scroll-panel-delay');

            if (scrollDelay) {
                this._timeoutsHandler.add([T6, scrollDelay, () => {}]);
            }
        }
    }

    _checkIfIgnoredScrollSource(source) {
        let ignoredConstr = ['WorkspaceIndicator'];

        return source.get_parent()._dtpIgnoreScroll || ignoredConstr.indexOf(source.constructor.name) >= 0;
    }

    _initProgressManager() {
        const progressVisible = Me.settings.get_boolean('progress-show-bar');
        const countVisible = Me.settings.get_boolean('progress-show-count');
        const pm = this.progressManager;

        if(!pm && (progressVisible || countVisible))
            this.progressManager = new Progress.ProgressManager();
        else if (pm)
            Object.keys(pm._entriesByDBusName).forEach((k) => pm._entriesByDBusName[k].setCountVisible(countVisible));
    }
});

var SecondaryPanel = GObject.registerClass({
}, class SecondaryPanel extends St.Widget {

    _init(params) {
        super._init(params);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
    }
});