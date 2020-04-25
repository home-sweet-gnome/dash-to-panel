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
const Overview = Me.imports.overview;
const Panel = Me.imports.panel;
const Proximity = Me.imports.proximity;
const Taskbar = Me.imports.taskbar;
const Utils = Me.imports.utils;

const Config = imports.misc.config;
const Lang = imports.lang;
const Gi = imports._gi;
const Clutter = imports.gi.Clutter;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const AppDisplay = imports.ui.appDisplay;
const BoxPointer = imports.ui.boxpointer;
const Dash = imports.ui.dash;
const IconGrid = imports.ui.iconGrid;
const LookingGlass = imports.ui.lookingGlass;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Layout = imports.ui.layout;
const WM = imports.ui.windowManager;
const WorkspacesView = imports.ui.workspacesView;

var dtpPanelManager = Utils.defineClass({
    Name: 'DashToPanel.PanelManager',

    _init: function() {
        this.overview = new Overview.dtpOverview();

        Main.overview.viewSelector.appDisplay._views.forEach(v => {
            Utils.wrapActor(v.view);
            Utils.wrapActor(v.view._grid);
        });
    },

    enable: function(reset) {
        let dtpPrimaryIndex = Me.settings.get_int('primary-monitor');
        if(dtpPrimaryIndex < 0 || dtpPrimaryIndex >= Main.layoutManager.monitors.length)
            dtpPrimaryIndex = Main.layoutManager.primaryIndex;
        
        let dtpPrimaryMonitor = Main.layoutManager.monitors[dtpPrimaryIndex];
        
        this.proximityManager = new Proximity.ProximityManager();

        Utils.wrapActor(Main.panel);
        Utils.wrapActor(Main.overview.dash || 0);

        this.primaryPanel = this._createPanel(dtpPrimaryMonitor);
        this.allPanels = [ this.primaryPanel ];
        
        this.overview.enable(this.primaryPanel);

        if (Me.settings.get_boolean('multi-monitors')) {
            Main.layoutManager.monitors.filter(m => m != dtpPrimaryMonitor).forEach(m => {
                this.allPanels.push(this._createPanel(m, true));
            });
        }

        global.dashToPanel.panels = this.allPanels;
        global.dashToPanel.emit('panels-created');

        let panelPosition = Panel.getPosition();
        this.allPanels.forEach(p => {
            let leftOrRight = (panelPosition == St.Side.LEFT || panelPosition == St.Side.RIGHT);
            
            p.panelBox.set_size(
                leftOrRight ? -1 : p.monitor.width, 
                leftOrRight ? p.monitor.height : -1
            );

            this._findPanelMenuButtons(p.panelBox).forEach(pmb => this._adjustPanelMenuButton(pmb, p.monitor, panelPosition));
        });

        //in 3.32, BoxPointer now inherits St.Widget
        if (BoxPointer.BoxPointer.prototype.vfunc_get_preferred_height) {
            let panelManager = this;

            Utils.hookVfunc(BoxPointer.BoxPointer.prototype, 'get_preferred_height', function(forWidth) {
                let alloc = { min_size: 0, natural_size: 0 };
                
                [alloc.min_size, alloc.natural_size] = this.vfunc_get_preferred_height(forWidth);

                return panelManager._getBoxPointerPreferredHeight(this, alloc);
            });
        }

        this.setFocusedMonitor(dtpPrimaryMonitor);
        
        if (Panel.checkIfVertical()) {
            Main.wm._getPositionForDirection = newGetPositionForDirection;
        }
        
        if (reset) return;

        this._oldViewSelectorAnimateIn = Main.overview.viewSelector._animateIn;
        Main.overview.viewSelector._animateIn = Lang.bind(this.primaryPanel, newViewSelectorAnimateIn);
        this._oldViewSelectorAnimateOut = Main.overview.viewSelector._animateOut;
        Main.overview.viewSelector._animateOut = Lang.bind(this.primaryPanel, newViewSelectorAnimateOut);

        if (Config.PACKAGE_VERSION > '3.35.1') {
            this._oldDoSpringAnimation = AppDisplay.BaseAppView.prototype._doSpringAnimation;
            AppDisplay.BaseAppView.prototype._doSpringAnimation = newDoSpringAnimation;
        }

        this._oldUpdatePanelBarrier = Main.layoutManager._updatePanelBarrier;
        Main.layoutManager._updatePanelBarrier = (panel) => {
            let panelUpdates = panel ? [panel] : this.allPanels;

            panelUpdates.forEach(p => newUpdatePanelBarrier.call(Main.layoutManager, p));
        };
        Main.layoutManager._updatePanelBarrier();

        this._oldUpdateHotCorners = Main.layoutManager._updateHotCorners;
        Main.layoutManager._updateHotCorners = Lang.bind(Main.layoutManager, newUpdateHotCorners);
        Main.layoutManager._updateHotCorners();

        this._forceHotCornerId = Me.settings.connect('changed::stockgs-force-hotcorner', () => Main.layoutManager._updateHotCorners());

        if (Main.layoutManager._interfaceSettings) {
            this._enableHotCornersId = Main.layoutManager._interfaceSettings.connect('changed::enable-hot-corners', () => Main.layoutManager._updateHotCorners());
        }

        this._oldOverviewRelayout = Main.overview._relayout;
        Main.overview._relayout = Lang.bind(Main.overview, this._newOverviewRelayout);

        this._oldUpdateWorkspacesViews = Main.overview.viewSelector._workspacesDisplay._updateWorkspacesViews;
        Main.overview.viewSelector._workspacesDisplay._updateWorkspacesViews = Lang.bind(Main.overview.viewSelector._workspacesDisplay, this._newUpdateWorkspacesViews);

        this._oldGetShowAppsButton = Main.overview.getShowAppsButton;
        Main.overview.getShowAppsButton = this._newGetShowAppsButton.bind(this);

        this._needsDashItemContainerAllocate = !Dash.DashItemContainer.prototype.hasOwnProperty('vfunc_allocate');

        if (this._needsDashItemContainerAllocate) {
            Utils.hookVfunc(Dash.DashItemContainer.prototype, 'allocate', this._newDashItemContainerAllocate);
        }
            
        // Since Gnome 3.8 dragging an app without having opened the overview before cause the attemp to
        //animate a null target since some variables are not initialized when the viewSelector is created
        if(Main.overview.viewSelector._activePage == null)
            Main.overview.viewSelector._activePage = Main.overview.viewSelector._workspacesPage;

        LookingGlass.LookingGlass.prototype._oldResize = LookingGlass.LookingGlass.prototype._resize;
        LookingGlass.LookingGlass.prototype._resize = _newLookingGlassResize;

        LookingGlass.LookingGlass.prototype._oldOpen = LookingGlass.LookingGlass.prototype.open;
        LookingGlass.LookingGlass.prototype.open = _newLookingGlassOpen;

        this._signalsHandler = new Utils.GlobalSignalsHandler();

        if (Config.PACKAGE_VERSION > '3.35.9') {
            let currentAppsView;

            this._oldAnimateIconPosition = IconGrid.animateIconPosition;
            IconGrid.animateIconPosition = newAnimateIconPosition.bind(this);

            this._signalsHandler.add(
                [
                    Utils.DisplayWrapper.getScreen(),
                    'window-entered-monitor',
                    () => this._needsIconAllocate = 1
                ]
            );

            Main.overview.viewSelector.appDisplay._views.forEach(v => {
                if (v.control.has_style_pseudo_class('checked')) {
                    currentAppsView = v;
                }

                this._signalsHandler.add(
                    [
                        v.control, 
                        'clicked', 
                        () => {
                            this._needsIconAllocate = currentAppsView != v;
                            currentAppsView = v;
                        }
                    ],
                    [
                        v.view, 
                        'notify::visible', 
                        () => this._needsIconAllocate = !(currentAppsView != v && !v.view.visible)
                    ],
                    [
                        v.view._grid, 
                        'animation-done', 
                        () => this._needsIconAllocate = 0
                    ]
                );
            });
        }

        //listen settings
        this._signalsHandler.add(
            [
                Me.settings,
                [
                    'changed::primary-monitor',
                    'changed::multi-monitors',
                    'changed::isolate-monitors',
                    'changed::taskbar-position',
                    'changed::panel-position'
                ],
                () => this._reset()
            ],
            [
                Me.settings,
                'changed::intellihide-key-toggle-text',
                () => this._setKeyBindings(true)
            ],
            [
                Utils.DisplayWrapper.getMonitorManager(),
                'monitors-changed', 
                () => {
                    if (Main.layoutManager.primaryMonitor) {
                        this._reset();
                    }
                }
            ]
        );

        Panel.panelBoxes.forEach(c => this._signalsHandler.add(
            [Main.panel[c], 'actor-added', (parent, child) => this._adjustPanelMenuButton(this._getPanelMenuButton(child), this.primaryPanel.monitor, Panel.getPosition())]
        ));

        this._setKeyBindings(true);
    },

    disable: function(reset) {
        this.overview.disable();
        this.proximityManager.destroy();

        this.allPanels.forEach(p => {
            this._findPanelMenuButtons(p.panelBox).forEach(pmb => {
                if (pmb.menu._boxPointer._dtpGetPreferredHeightId) {
                    pmb.menu._boxPointer._container.disconnect(pmb.menu._boxPointer._dtpGetPreferredHeightId);
                }

                pmb.menu._boxPointer.sourceActor = pmb.menu._boxPointer._dtpSourceActor;
                delete pmb.menu._boxPointer._dtpSourceActor;
                pmb.menu._boxPointer._userArrowSide = St.Side.TOP;
            })

            this._removePanelBarriers(p);

            p.disable();

            let clipContainer = p.panelBox.get_parent();

            Main.layoutManager._untrackActor(p.panelBox);
            Main.layoutManager.removeChrome(clipContainer);

            if (p.isSecondary) {
                p.panelBox.destroy();
            } else {
                p.panelBox.remove_child(p);
                p.remove_child(p.panel.actor);
                p.panelBox.add(p.panel.actor);

                p.panelBox.set_position(clipContainer.x, clipContainer.y);

                clipContainer.remove_child(p.panelBox);
                Main.layoutManager.addChrome(p.panelBox, { affectsStruts: true, trackFullscreen: true });
            }
        });

        if (BoxPointer.BoxPointer.prototype.vfunc_get_preferred_height) {
            Utils.hookVfunc(BoxPointer.BoxPointer.prototype, 'get_preferred_height', BoxPointer.BoxPointer.prototype.vfunc_get_preferred_height);
        }

        delete Main.wm._getPositionForDirection;

        if (reset) return;
        
        this._setKeyBindings(false);

        this._signalsHandler.destroy();

        if (Main.layoutManager.primaryMonitor) {
            Main.layoutManager.panelBox.set_position(Main.layoutManager.primaryMonitor.x, Main.layoutManager.primaryMonitor.y);
            Main.layoutManager.panelBox.set_size(Main.layoutManager.primaryMonitor.width, -1);
        }

        Main.layoutManager._updateHotCorners = this._oldUpdateHotCorners;
        Main.layoutManager._updateHotCorners();

        Me.settings.disconnect(this._forceHotCornerId);

        if (this._enableHotCornersId) {
            Main.layoutManager._interfaceSettings.disconnect(this._enableHotCornersId);
        }

        Main.layoutManager._updatePanelBarrier = this._oldUpdatePanelBarrier;
        Main.layoutManager._updatePanelBarrier();

        Main.overview.viewSelector._animateIn = this._oldViewSelectorAnimateIn;
        Main.overview.viewSelector._animateOut = this._oldViewSelectorAnimateOut;

        Main.overview._relayout = this._oldOverviewRelayout;
        Main.overview._relayout();

        Main.overview.viewSelector._workspacesDisplay._updateWorkspacesViews = this._oldUpdateWorkspacesViews;

        Utils.getPanelGhost().set_size(-1, -1);

        if (this._needsDashItemContainerAllocate) {
            Utils.hookVfunc(Dash.DashItemContainer.prototype, 'allocate', function(box, flags) { this.vfunc_allocate(box, flags); });
        }

        if (this._oldDoSpringAnimation) {
            AppDisplay.BaseAppView.prototype._doSpringAnimation = this._oldDoSpringAnimation;
        }

        if (this._oldAnimateIconPosition) {
            IconGrid.animateIconPosition = this._oldAnimateIconPosition;
        }

        LookingGlass.LookingGlass.prototype._resize = LookingGlass.LookingGlass.prototype._oldResize;
        delete LookingGlass.LookingGlass.prototype._oldResize;

        LookingGlass.LookingGlass.prototype.open = LookingGlass.LookingGlass.prototype._oldOpen;
        delete LookingGlass.LookingGlass.prototype._oldOpen
    },

    setFocusedMonitor: function(monitor, ignoreRelayout) {
        if (!this.checkIfFocusedMonitor(monitor)) {
            this._needsIconAllocate = 1;
            Main.overview.viewSelector._workspacesDisplay._primaryIndex = monitor.index;
            
            Main.overview._overview.clear_constraints();
            Main.overview._overview.add_constraint(new Layout.MonitorConstraint({ index: monitor.index }));
            
            if (ignoreRelayout) return;

            this._newOverviewRelayout.call(Main.overview);
        }
    },

    checkIfFocusedMonitor: function(monitor) {
        return Main.overview.viewSelector._workspacesDisplay._primaryIndex == monitor.index;
    },

    _createPanel: function(monitor, isSecondary) {
        let panelBox;
        let panel;
        let clipContainer = new Clutter.Actor();
        
        if (isSecondary) {
            panelBox = new St.BoxLayout({ name: 'panelBox' });
        } else {
            panelBox = Main.layoutManager.panelBox;
            Main.layoutManager._untrackActor(panelBox);
            panelBox.remove_child(Main.panel.actor);
            Main.layoutManager.removeChrome(panelBox);
        }

        Main.layoutManager.addChrome(clipContainer, { affectsInputRegion: false });
        clipContainer.add_child(panelBox);
        Main.layoutManager.trackChrome(panelBox, { trackFullscreen: true, affectsStruts: true, affectsInputRegion: true });
        
        panel = new Panel.dtpPanel(this, monitor, panelBox, isSecondary);
        panelBox.add(panel);
        panel.enable();

        panelBox.visible = !monitor.inFullscreen;
        panelBox.set_position(0, 0);

        return panel;
    },

    _reset: function() {
        this.disable(true);
        this.allPanels = [];
        this.enable(true);
    },

    _adjustPanelMenuButton: function(button, monitor, arrowSide) {
        if (button) {
            Utils.wrapActor(button);
            button.menu._boxPointer._dtpSourceActor = button.menu._boxPointer.sourceActor;
            button.menu._boxPointer.sourceActor = button.actor;
            button.menu._boxPointer._userArrowSide = arrowSide;
            button.menu._boxPointer._dtpInPanel = 1;

            if (!button.menu._boxPointer.vfunc_get_preferred_height) {
                button.menu._boxPointer._dtpGetPreferredHeightId = button.menu._boxPointer._container.connect('get-preferred-height', (actor, forWidth, alloc) => {
                    this._getBoxPointerPreferredHeight(button.menu._boxPointer, alloc, monitor);
                });
            }
        }
    },

    _getBoxPointerPreferredHeight: function(boxPointer, alloc, monitor) {
        if (boxPointer._dtpInPanel && boxPointer.sourceActor && Me.settings.get_boolean('intellihide')) {
            monitor = monitor || Main.layoutManager.findMonitorForActor(boxPointer.sourceActor);
            let excess = alloc.natural_size + Panel.size + 10 - monitor.height; // 10 is arbitrary

            if (excess > 0) {
                alloc.natural_size -= excess;
            }
        }

        return [alloc.min_size, alloc.natural_size];
    },

    _findPanelMenuButtons: function(container) {
        let panelMenuButtons = [];
        let panelMenuButton;

        let find = parent => parent.get_children().forEach(c => {
            if ((panelMenuButton = this._getPanelMenuButton(c))) {
                panelMenuButtons.push(panelMenuButton);
            }

            find(c);
        });

        find(container);

        return panelMenuButtons;
    },

    _removePanelBarriers: function(panel) {
        if (panel.isSecondary && panel._rightPanelBarrier) {
            panel._rightPanelBarrier.destroy();
        }

        if (panel._leftPanelBarrier) {
            panel._leftPanelBarrier.destroy();
            delete panel._leftPanelBarrier;
        }
    },

    _getPanelMenuButton: function(obj) {
        return obj._delegate && obj._delegate instanceof PanelMenu.Button ? obj._delegate : 0;
    },

    _setKeyBindings: function(enable) {
        let keys = {
            'intellihide-key-toggle': () => this.allPanels.forEach(p => p.intellihide.toggle())
        };

        Object.keys(keys).forEach(k => {
            Utils.removeKeybinding(k);

            if (enable) {
                Utils.addKeybinding(k, Me.settings, keys[k], Shell.ActionMode.NORMAL);
            }
        });
    },

    _newOverviewRelayout: function() {
        // To avoid updating the position and size of the workspaces
        // we just hide the overview. The positions will be updated
        // when it is next shown.
        this.hide();

        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.overview.viewSelector._workspacesDisplay._primaryIndex);

        this._coverPane.set_position(0, workArea.y);
        this._coverPane.set_size(workArea.width, workArea.height);

        this._updateBackgrounds();
    },

    _newUpdateWorkspacesViews: function() {
        for (let i = 0; i < this._workspacesViews.length; i++)
            this._workspacesViews[i].destroy();

        this._workspacesViews = [];

        let monitors = Main.layoutManager.monitors;

        for (let i = 0; i < monitors.length; i++) {
            let view;
            if (this._workspacesOnlyOnPrimary && i != Main.layoutManager.primaryIndex) {
                view = new WorkspacesView.ExtraWorkspaceView(i);
                view.getActiveWorkspace = view.getActiveWorkspace || function() { return this._workspace; };
            } else
                view = new WorkspacesView.WorkspacesView(i, this._scrollAdjustment || 0);

            Utils.wrapActor(view);
            view.actor.connect('scroll-event', this._onScrollEvent.bind(this));
            if (i == Main.layoutManager.primaryIndex && view.scrollAdjustment) {
                this._scrollAdjustment = view.scrollAdjustment;
                this._scrollAdjustment.connect('notify::value',
                                            this._scrollValueChanged.bind(this));
            }

            this._workspacesViews.push(view);
        }

        this._workspacesViews.forEach(wv => Main.layoutManager.overviewGroup.add_actor(wv.actor));

        this._updateWorkspacesFullGeometry();
        this._updateWorkspacesActualGeometry();
    },

    _newGetShowAppsButton: function() {
        let focusedMonitorIndex = Utils.findIndex(this.allPanels, p => this.checkIfFocusedMonitor(p.monitor));
        
        return this.allPanels[focusedMonitorIndex].taskbar.showAppsButton;
    },

    _newDashItemContainerAllocate: function(box, flags) {
        if (this.child == null)
            return;

        this.set_allocation(box, flags);

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

        this.child.allocate(childBox, flags);
    },
});

function newViewSelectorAnimateIn(oldPage) {
    if (oldPage)
        oldPage.hide();

    let vs = Main.overview.viewSelector;

    vs.emit('page-empty');

    vs._activePage.show();

    if (vs._activePage == vs._appsPage && oldPage == vs._workspacesPage) {
        // Restore opacity, in case we animated via _fadePageOut
        vs._activePage.opacity = 255;
        let animate = Me.settings.get_boolean('animate-show-apps');
        if(animate)
            vs.appDisplay.animate(IconGrid.AnimationDirection.IN);
    } else {
        vs._fadePageIn();
    }
}

function newViewSelectorAnimateOut(page) {
    let oldPage = page;
    let vs = Main.overview.viewSelector;

    if (page == vs._appsPage &&
        vs._activePage == vs._workspacesPage &&
        !Main.overview.animationInProgress) {
        let animate = Me.settings.get_boolean('animate-show-apps');
        if(animate)
            vs.appDisplay.animate(IconGrid.AnimationDirection.OUT, Lang.bind(this,
                function() {
                    vs._animateIn(oldPage)
            }));
        else
            vs._animateIn(oldPage)
    } else {
        vs._fadePageOut(page);
    }
}

function newGetPositionForDirection(direction, fromWs, toWs) {
    let [xDest, yDest] = WM.WindowManager.prototype._getPositionForDirection(direction, fromWs, toWs);

    if (direction == Meta.MotionDirection.UP ||
        direction == Meta.MotionDirection.UP_LEFT ||
        direction == Meta.MotionDirection.UP_RIGHT) {
        yDest -= Main.panel.height;
    } else if (direction != Meta.MotionDirection.LEFT &&
               direction != Meta.MotionDirection.RIGHT) {
        yDest += Main.panel.height;
    }

    return [xDest, yDest];
}

function newDoSpringAnimation(animationDirection) {
    this._grid.opacity = 255;
    this._grid.animateSpring(animationDirection, Main.overview.getShowAppsButton());
}

function newAnimateIconPosition(icon, box, flags, nChangedIcons) {
    if (this._needsIconAllocate) {
        icon.allocate(box, flags);
        return;
    }

    return this._oldAnimateIconPosition(icon, box, flags, nChangedIcons);;
}

function newUpdateHotCorners() {
    // destroy old hot corners
    this.hotCorners.forEach(function(corner) {
        if (corner)
            corner.destroy();
    });
    this.hotCorners = [];

    //global.settings is ubuntu specific setting to disable the hot corner (Tweak tool > Top Bar > Activities Overview Hot Corner)
    //this._interfaceSettings is for the setting to disable the hot corner introduced in gnome-shell 3.34 
    if ((global.settings.list_keys().indexOf('enable-hot-corners') >= 0 && !global.settings.get_boolean('enable-hot-corners')) ||
        (this._interfaceSettings && !this._interfaceSettings.get_boolean('enable-hot-corners'))) {
        this.emit('hot-corners-changed');
        return;
    }

    let panelPosition = Panel.getPosition();
    let panelTopLeft = panelPosition == St.Side.TOP || panelPosition == St.Side.LEFT;

    // build new hot corners
    for (let i = 0; i < this.monitors.length; i++) {
        let monitor = this.monitors[i];
        let cornerX = this._rtl ? monitor.x + monitor.width : monitor.x;
        let cornerY = monitor.y;

        let haveTopLeftCorner = true;
        
        // If the panel is on the bottom, unless this is explicitly forced, don't add a topleft 
        // hot corner unless it is actually a top left panel. Otherwise, it stops the mouse 
        // as you are dragging across. In the future, maybe we will automatically move the 
        // hotcorner to the bottom when the panel is positioned at the bottom
        if (i != this.primaryIndex || (!panelTopLeft && !Me.settings.get_boolean('stockgs-force-hotcorner'))) {
            // Check if we have a top left (right for RTL) corner.
            // I.e. if there is no monitor directly above or to the left(right)
            let besideX = this._rtl ? monitor.x + 1 : cornerX - 1;
            let besideY = cornerY;
            let aboveX = cornerX;
            let aboveY = cornerY - 1;

            for (let j = 0; j < this.monitors.length; j++) {
                if (i == j)
                    continue;
                let otherMonitor = this.monitors[j];
                if (besideX >= otherMonitor.x &&
                    besideX < otherMonitor.x + otherMonitor.width &&
                    besideY >= otherMonitor.y &&
                    besideY < otherMonitor.y + otherMonitor.height) {
                    haveTopLeftCorner = false;
                    break;
                }
                if (aboveX >= otherMonitor.x &&
                    aboveX < otherMonitor.x + otherMonitor.width &&
                    aboveY >= otherMonitor.y &&
                    aboveY < otherMonitor.y + otherMonitor.height) {
                    haveTopLeftCorner = false;
                    break;
                }
            }
        }

        if (haveTopLeftCorner) {
            let corner = new Layout.HotCorner(this, monitor, cornerX, cornerY);

            corner.setBarrierSize = size => corner.__proto__.setBarrierSize.call(corner, Math.min(size, 32));
            corner.setBarrierSize(Panel.size);
            this.hotCorners.push(corner);
        } else {
            this.hotCorners.push(null);
        }
    }

    this.emit('hot-corners-changed');
}

function newUpdatePanelBarrier(panel) {
    let barriers = {
        _rightPanelBarrier: [(panel.isSecondary ? panel : this)],
        _leftPanelBarrier: [panel]
    };

    Object.keys(barriers).forEach(k => {
        let obj = barriers[k][0];

        if (obj[k]) {
            obj[k].destroy();
            obj[k] = null;
        }
    });

    if (!this.primaryMonitor || !panel.panelBox.height) {
        return;
    }

    let barrierSize = Math.min(10, panel.panelBox.height); 
    let fixed1 = panel.monitor.y;
    let fixed2 = panel.monitor.y + barrierSize;
    
    if (Panel.checkIfVertical()) {
        barriers._rightPanelBarrier.push(panel.monitor.y + panel.monitor.height, Meta.BarrierDirection.POSITIVE_Y);
        barriers._leftPanelBarrier.push(panel.monitor.y, Meta.BarrierDirection.NEGATIVE_Y);
    } else {
        barriers._rightPanelBarrier.push(panel.monitor.x + panel.monitor.width, Meta.BarrierDirection.NEGATIVE_X);
        barriers._leftPanelBarrier.push(panel.monitor.x, Meta.BarrierDirection.POSITIVE_X);
    }

    switch (Panel.getPosition()) {
        //values are initialized as St.Side.TOP 
        case St.Side.BOTTOM:
            fixed1 = panel.monitor.y + panel.monitor.height - barrierSize;
            fixed2 = panel.monitor.y + panel.monitor.height;
            break;
        case St.Side.LEFT:
            fixed1 = panel.monitor.x;
            fixed2 = panel.monitor.x + barrierSize;
            break;
        case St.Side.RIGHT:
            fixed1 = panel.monitor.x + panel.monitor.width;
            fixed2 = panel.monitor.x + panel.monitor.width - barrierSize;
            break;
    }

    //remove left barrier if it overlaps one of the hotcorners
    for (let k in this.hotCorners) {
        let hc = this.hotCorners[k];

        if (hc && hc._monitor == panel.monitor && 
            ((fixed1 == hc._x || fixed2 == hc._x) || fixed1 == hc._y || fixed2 == hc._y)) {
                delete barriers._leftPanelBarrier;
                break;
        }
    }

    Object.keys(barriers).forEach(k => {
        let barrierOptions = { 
            display: global.display,
            directions: barriers[k][2]
        };
        
        barrierOptions[Panel.varCoord.c1] = barrierOptions[Panel.varCoord.c2] = barriers[k][1];
        barrierOptions[Panel.fixedCoord.c1] = fixed1;
        barrierOptions[Panel.fixedCoord.c2] = fixed2;

        barriers[k][0][k] = new Meta.Barrier(barrierOptions);
    });
}

function _newLookingGlassResize() {
    let topOffset = Panel.getPosition() == St.Side.TOP ? Panel.size : 0;

    this._oldResize();
    Utils.wrapActor(this);
    Utils.wrapActor(this._objInspector);

    this._hiddenY = Main.layoutManager.primaryMonitor.y + topOffset - this.actor.height;
    this._targetY = this._hiddenY + this.actor.height;
    this.actor.y = this._hiddenY;

    this._objInspector.actor.set_position(this.actor.x + Math.floor(this.actor.width * 0.1), this._targetY + Math.floor(this.actor.height * 0.1));
}

function _newLookingGlassOpen() {
    if (this._open)
        return;

    this._resize();
    this._oldOpen();
}