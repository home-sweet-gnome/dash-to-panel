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

const Lang = imports.lang;
const Gi = imports._gi;
const Clutter = imports.gi.Clutter;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const BoxPointer = imports.ui.boxpointer;
const Dash = imports.ui.dash;
const IconGrid = imports.ui.iconGrid;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Layout = imports.ui.layout;
const WorkspacesView = imports.ui.workspacesView;

var dtpPanelManager = Utils.defineClass({
    Name: 'DashToPanel.PanelManager',

    _init: function(settings) {
        this._dtpSettings = settings;
        this.overview = new Overview.dtpOverview(settings);
    },

    enable: function(reset) {
        let dtpPrimaryIndex = this._dtpSettings.get_int('primary-monitor');
        if(dtpPrimaryIndex < 0 || dtpPrimaryIndex >= Main.layoutManager.monitors.length)
            dtpPrimaryIndex = Main.layoutManager.primaryIndex;
        
        let dtpPrimaryMonitor = Main.layoutManager.monitors[dtpPrimaryIndex];
        
        this.proximityManager = new Proximity.ProximityManager();

        this.primaryPanel = new Panel.dtpPanelWrapper(this, dtpPrimaryMonitor, Main.panel, Main.layoutManager.panelBox);
        this.primaryPanel.enable();
        this.allPanels = [ this.primaryPanel ];
        
        this.overview.enable(this.primaryPanel);

        if (this._dtpSettings.get_boolean('multi-monitors')) {
            Main.layoutManager.monitors.forEach(monitor => {
                if (monitor == dtpPrimaryMonitor)
                    return;

                let panelBox = new St.BoxLayout({ name: 'dashtopanelSecondaryPanelBox', vertical: true });
                Main.layoutManager.addChrome(panelBox, { affectsStruts: true, trackFullscreen: true });

                let panel = new Panel.dtpSecondaryPanel(this._dtpSettings, monitor);
                panelBox.add(panel.actor);
                
                let panelWrapper = new Panel.dtpPanelWrapper(this, monitor, panel, panelBox, true);
                panel.delegate = panelWrapper;
                panelWrapper.enable();

                this.allPanels.push(panelWrapper);
            });
        }

        let panelPosition = Taskbar.getPosition();
        this.allPanels.forEach(p => {
            p.panelBox.set_size(p.monitor.width, -1);
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
        
        if (reset) return;

        this._oldViewSelectorAnimateIn = Main.overview.viewSelector._animateIn;
        Main.overview.viewSelector._animateIn = Lang.bind(this.primaryPanel, newViewSelectorAnimateIn);
        this._oldViewSelectorAnimateOut = Main.overview.viewSelector._animateOut;
        Main.overview.viewSelector._animateOut = Lang.bind(this.primaryPanel, newViewSelectorAnimateOut);

        this._oldUpdatePanelBarrier = Main.layoutManager._updatePanelBarrier;
        Main.layoutManager._updatePanelBarrier = (panel) => {
            let panelUpdates = panel ? [panel] : this.allPanels;

            panelUpdates.forEach(p => newUpdatePanelBarrier.call(Main.layoutManager, p, this._dtpSettings));
        };
        Main.layoutManager._updatePanelBarrier();

        this._oldUpdateHotCorners = Main.layoutManager._updateHotCorners;
        Main.layoutManager._updateHotCorners = Lang.bind(Main.layoutManager, newUpdateHotCorners);
        Main.layoutManager._updateHotCorners();

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

        //listen settings
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._signalsHandler.add(
            [
                this._dtpSettings,
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
                this._dtpSettings,
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

        ['_leftBox', '_centerBox', '_rightBox'].forEach(c => this._signalsHandler.add(
            [Main.panel[c], 'actor-added', (parent, child) => this._adjustPanelMenuButton(this._getPanelMenuButton(child), this.primaryPanel.monitor, Taskbar.getPosition())]
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
        });

        if (BoxPointer.BoxPointer.prototype.vfunc_get_preferred_height) {
            Utils.hookVfunc(BoxPointer.BoxPointer.prototype, 'get_preferred_height', BoxPointer.BoxPointer.prototype.vfunc_get_preferred_height);
        }

        if (reset) return;

        this._setKeyBindings(false);

        this._signalsHandler.destroy();

        Main.layoutManager._updateHotCorners = this._oldUpdateHotCorners;
        Main.layoutManager._updateHotCorners();

        Main.layoutManager._updatePanelBarrier = this._oldUpdatePanelBarrier;
        Main.layoutManager._updatePanelBarrier();

        Main.overview.viewSelector._animateIn = this._oldViewSelectorAnimateIn;
        Main.overview.viewSelector._animateOut = this._oldViewSelectorAnimateOut;

        Main.overview._relayout = this._oldOverviewRelayout;
        Main.overview._relayout();

        Main.overview.viewSelector._workspacesDisplay._updateWorkspacesViews = this._oldUpdateWorkspacesViews;
        Main.overview.getShowAppsButton = this._oldGetShowAppsButton;

        if (Main.layoutManager.primaryMonitor) {
            Main.layoutManager.panelBox.set_position(Main.layoutManager.primaryMonitor.x, Main.layoutManager.primaryMonitor.y);
            Main.layoutManager.panelBox.set_size(Main.layoutManager.primaryMonitor.width, -1);
        }

        if (this._needsDashItemContainerAllocate) {
            Utils.hookVfunc(Dash.DashItemContainer.prototype, 'allocate', function(box, flags) { this.vfunc_allocate(box, flags); });
        }
    },

    setFocusedMonitor: function(monitor, ignoreRelayout) {
        if (!this.checkIfFocusedMonitor(monitor)) {
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

    _reset: function() {
        this.disable(true);
        this.enable(true);
    },

    _adjustPanelMenuButton: function(button, monitor, arrowSide) {
        if (button) {
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
        if (boxPointer._dtpInPanel && this._dtpSettings.get_boolean('intellihide')) {
            monitor = monitor || Main.layoutManager.findMonitorForActor(boxPointer.sourceActor);
            let excess = alloc.natural_size + this._dtpSettings.get_int('panel-size') + 10 - monitor.height; // 10 is arbitrary

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
            if (Main.wm._allowedKeybindings[k]) {
                Main.wm.removeKeybinding(k);
            }

            if (enable) {
                Main.wm.addKeybinding(k, this._dtpSettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, keys[k]);
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
            let view = new WorkspacesView.WorkspacesView(i);

            view.actor.connect('scroll-event', this._onScrollEvent.bind(this));
            if (i == this._primaryIndex) {
                this._scrollAdjustment = view.scrollAdjustment;
                this._scrollAdjustment.connect('notify::value',
                                            this._scrollValueChanged.bind(this));
            }

            this._workspacesViews.push(view);
            Main.layoutManager.overviewGroup.add_actor(view.actor);
        }

        this._updateWorkspacesFullGeometry();
        this._updateWorkspacesActualGeometry();
    },

    _newGetShowAppsButton: function() {
        let focusedMonitorIndex = Taskbar.findIndex(this.allPanels, p => this.checkIfFocusedMonitor(p.monitor));
        
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
        let animate = this._dtpSettings.get_boolean('animate-show-apps');
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
        let animate = this._dtpSettings.get_boolean('animate-show-apps');
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

function newUpdateHotCorners() {
    // destroy old hot corners
    this.hotCorners.forEach(function(corner) {
        if (corner)
            corner.destroy();
    });
    this.hotCorners = [];
    
    //ubuntu specific setting to disable the hot corner (Tweak tool > Top Bar > Activities Overview Hot Corner)
    if (global.settings.list_keys().indexOf('enable-hot-corners') >= 0 && 
        !global.settings.get_boolean('enable-hot-corners')) {
        this.emit('hot-corners-changed');
        return;
    }

    let size = this.panelBox.height;
    let panelPosition = Taskbar.getPosition();

    // build new hot corners
    for (let i = 0; i < this.monitors.length; i++) {
        let monitor = this.monitors[i];
        let cornerX = this._rtl ? monitor.x + monitor.width : monitor.x;
        let cornerY = monitor.y;

        let haveTopLeftCorner = true;
        
        // If the panel is on the bottom, don't add a topleft hot corner unless it is actually
        // a top left panel. Otherwise, it stops the mouse as you are dragging across
        // In the future, maybe we will automatically move the hotcorner to the bottom
        // when the panel is positioned at the bottom
        if (i != this.primaryIndex || panelPosition == St.Side.BOTTOM) {
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
            corner.setBarrierSize(size);
            this.hotCorners.push(corner);
        } else {
            this.hotCorners.push(null);
        }
    }

    this.emit('hot-corners-changed');
}

function newUpdatePanelBarrier(panel, dtpSettings) {
    let barriers = {
        '_rightPanelBarrier': [(panel.isSecondary ? panel : this), panel.monitor.x + panel.monitor.width, Meta.BarrierDirection.NEGATIVE_X],
        '_leftPanelBarrier': [panel, panel.monitor.x, Meta.BarrierDirection.POSITIVE_X]
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

    let barrierHeight = Math.min(10, panel.panelBox.height); 
    let isTop = dtpSettings.get_string('panel-position') === 'TOP';
    let y1 = isTop ? panel.monitor.y : panel.monitor.y + panel.monitor.height - barrierHeight;
    let y2 = isTop ? panel.monitor.y + barrierHeight : panel.monitor.y + panel.monitor.height;

    Object.keys(barriers).forEach(k => {
        barriers[k][0][k] = new Meta.Barrier({ display: global.display,
                                               x1: barriers[k][1], y1: y1,
                                               x2: barriers[k][1], y2: y2,
                                               directions: barriers[k][2] });
    });
}