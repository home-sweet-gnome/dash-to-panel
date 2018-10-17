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

const BoxPointer = imports.ui.boxpointer;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Lang = imports.lang;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Layout = imports.ui.layout;
const WorkspacesView = imports.ui.workspacesView;

var dtpPanelManager = new Lang.Class({
    Name: 'DashToPanel.PanelManager',

    _init: function(settings) {
        this._dtpSettings = settings;
        this._overview = new Overview.dtpOverview(settings);
    },

    enable: function(reset) {
        let dtpPrimaryMonitor = Main.layoutManager.monitors[(Main.layoutManager.primaryIndex + this._dtpSettings.get_int('primary-monitor')) % Main.layoutManager.monitors.length];
        this.proximityManager = new Proximity.ProximityManager();

        this.primaryPanel = new Panel.dtpPanelWrapper(this, dtpPrimaryMonitor, Main.panel, Main.layoutManager.panelBox);
        this.primaryPanel.enable();
        this.allPanels = [ this.primaryPanel ];
        
        this._overview.enable(this.primaryPanel);

        if (this._dtpSettings.get_boolean('multi-monitors')) {
            Main.layoutManager.monitors.forEach(monitor => {
                if (monitor == dtpPrimaryMonitor)
                    return;

                let panelBox = new St.BoxLayout({ name: 'dashtopanelSecondaryPanelBox', vertical: true });
                Main.layoutManager.addChrome(panelBox, { affectsStruts: true, trackFullscreen: true });
                Main.uiGroup.set_child_below_sibling(panelBox, Main.layoutManager.panelBox);

                let panel = new Panel.dtpSecondaryPanel(this._dtpSettings, monitor);
                panelBox.add(panel.actor);
                
                let panelWrapper = new Panel.dtpPanelWrapper(this, monitor, panel, panelBox, true);
                panelWrapper.enable();

                this.allPanels.push(panelWrapper);
            });
        }

        let panelPosition = Taskbar.getPosition();
        this.allPanels.forEach(p => {
            p.panelBox.set_size(p.monitor.width, -1);
            this._findPanelBoxPointers(p.panelBox).forEach(bp => this._adjustBoxPointer(bp, p.monitor, panelPosition));
        });

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

        this.setFocusedMonitor(dtpPrimaryMonitor);

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
                Utils.DisplayWrapper.getMonitorManager(),
                'monitors-changed', 
                () => this._reset()
            ]
        );

        ['_leftBox', '_centerBox', '_rightBox'].forEach(c => this._signalsHandler.add(
            [Main.panel[c], 'actor-added', (parent, child) => this._adjustBoxPointer(this._getPanelButtonBoxPointer(child), this.primaryPanel.monitor, Taskbar.getPosition())]
        ));
    },

    disable: function(reset) {
        this._overview.disable();
        this.proximityManager.destroy();

        this.allPanels.forEach(p => {
            this._findPanelBoxPointers(p.panelBox).forEach(bp => {
                bp._container.disconnect(bp._dtpGetPreferredHeightId);
                bp._userArrowSide = St.Side.TOP;
            })
            p.disable();
        });

        if (reset) return;

        this._signalsHandler.destroy();

        Main.layoutManager._updateHotCorners = this._oldUpdateHotCorners;
        Main.layoutManager._updateHotCorners();

        Main.layoutManager._updatePanelBarrier = this._oldUpdatePanelBarrier;
        Main.layoutManager._updatePanelBarrier();

        Main.overview.viewSelector._animateIn = this._oldViewSelectorAnimateIn;
        Main.overview.viewSelector._animateOut = this._oldViewSelectorAnimateOut;

        Main.overview._relayout = this._oldOverviewRelayout;
        delete Main.overview._focusedMonitor;
        Main.overview._relayout();

        Main.overview.viewSelector._workspacesDisplay._updateWorkspacesViews = this._oldUpdateWorkspacesViews;
        Main.overview.viewSelector._workspacesDisplay._updateWorkspacesViews();

        Main.layoutManager.panelBox.set_position(Main.layoutManager.primaryMonitor.x, Main.layoutManager.primaryMonitor.y);
        Main.layoutManager.panelBox.set_size(Main.layoutManager.primaryMonitor.width, -1);
    },

    setFocusedMonitor: function(monitor, ignoreRelayout) {
        if ((Main.overview._focusedMonitor || 0) != monitor) {
            Main.overview._focusedMonitor = monitor;
            Main.overview.viewSelector._workspacesDisplay._primaryIndex = monitor.index;
            
            Main.overview._overview.clear_constraints();
            Main.overview._overview.add_constraint(new Layout.MonitorConstraint({ index: monitor.index }));
            
            if (ignoreRelayout) return;

            this._newOverviewRelayout.call(Main.overview);
        }
    },

    _reset: function() {
        this.disable(true);
        this.enable(true);
    },

    _adjustBoxPointer: function(boxPointer, monitor, arrowSide) {
        if (boxPointer) {
            boxPointer._userArrowSide = arrowSide;
            boxPointer._dtpGetPreferredHeightId = boxPointer._container.connect('get-preferred-height', (actor, forWidth, alloc) => {
                if (this._dtpSettings.get_boolean('intellihide')) {
                    let excess = alloc.natural_size + this._dtpSettings.get_int('panel-size') + 20 - monitor.height; // 20 is arbitrary

                    if (excess > 0) {
                        alloc.natural_size -= excess;
                    }
                }
            });
        }
    },

    _findPanelBoxPointers: function(container) {
        let panelBoxPointers = [];
        let boxPointer;

        let find = parent => parent.get_children().forEach(c => {
            if ((boxPointer = this._getPanelButtonBoxPointer(c))) {
                panelBoxPointers.push(boxPointer);
            }

            find(c);
        });

        find(container);

        return panelBoxPointers;
    },

    _getPanelButtonBoxPointer: function(obj) {
        if (obj._delegate && obj._delegate instanceof PanelMenu.Button) {
            return obj._delegate.menu._boxPointer;
        }
    },

    _newOverviewRelayout: function() {
        // To avoid updating the position and size of the workspaces
        // we just hide the overview. The positions will be updated
        // when it is next shown.
        this.hide();

        let workArea = Main.layoutManager.getWorkAreaForMonitor(this._focusedMonitor.index);

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
    }
    
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
    let propName = '_rightPanelBarrier';
    let targetObj = panel.isSecondary ? panel : this;
    
    if (targetObj[propName]) {
        targetObj[propName].destroy();
        targetObj[propName] = null;
    }
    
    if (!this.primaryMonitor || !targetObj['panelBox'].height) {
        return;
    }

    let barrierHeight = Math.min(10, panel.panelBox.height); 
    let isTop = dtpSettings.get_string('panel-position') === 'TOP';
    let y1 = isTop ? panel.monitor.y : panel.monitor.y + panel.monitor.height - barrierHeight;
    let y2 = isTop ? panel.monitor.y + barrierHeight : panel.monitor.y + panel.monitor.height;
    let x = panel.monitor.x + panel.monitor.width;
    
    targetObj[propName] = new Meta.Barrier({ display: global.display,
                                             x1: x, y1: y1,
                                             x2: x, y2: y2,
                                             directions: Meta.BarrierDirection.NEGATIVE_X });
}