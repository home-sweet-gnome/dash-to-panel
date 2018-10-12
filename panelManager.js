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
const Utils = Me.imports.utils;

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Main = imports.ui.main;
const Lang = imports.lang;
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Tweener = imports.ui.tweener;
const Meta = imports.gi.Meta;
const Layout = imports.ui.layout;
const WorkspacesView = imports.ui.workspacesView;

var dtpPanelManager = new Lang.Class({
    Name: 'DashToDock.DockManager',

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
                panelBox.set_size(monitor.width, -1);
                
                let panelWrapper = new Panel.dtpPanelWrapper(this, monitor, panel, panelBox, true);
                panelWrapper.enable();

                this.allPanels.push(panelWrapper);
            });
        }

        if (reset) return;

        this._oldPopupOpen = PopupMenu.PopupMenu.prototype.open;
        PopupMenu.PopupMenu.prototype.open = newPopupOpen;

        this._oldPopupSubMenuOpen = PopupMenu.PopupSubMenu.prototype.open;
        PopupMenu.PopupSubMenu.prototype.open = newPopupSubMenuOpen;

        this._oldViewSelectorAnimateIn = Main.overview.viewSelector._animateIn;
        Main.overview.viewSelector._animateIn = Lang.bind(this.primaryPanel, newViewSelectorAnimateIn);
        this._oldViewSelectorAnimateOut = Main.overview.viewSelector._animateOut;
        Main.overview.viewSelector._animateOut = Lang.bind(this.primaryPanel, newViewSelectorAnimateOut);

        this._oldUpdatePanelBarrier = Main.layoutManager._updatePanelBarrier;
        Main.layoutManager._updatePanelBarrier = Lang.bind(Main.layoutManager, newUpdatePanelBarrier);
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
        this._dtpSettings.connect('changed::primary-monitor', () => this._reset());
        this._dtpSettings.connect('changed::multi-monitors', () => this._reset());
        this._dtpSettings.connect('changed::isolate-monitors', () => this._reset());
        this._monitorsChangedListener = Utils.DisplayWrapper.getMonitorManager().connect("monitors-changed", () => this._reset());
    },

    disable: function(reset) {
        this._overview.disable();
        this.proximityManager.destroy();

        this.allPanels.forEach(p => {
            p.disable();
        });

        if (reset) return;

        if(this._monitorsChangedListener) {
            Utils.DisplayWrapper.getMonitorManager().disconnect(this._monitorsChangedListener);
        }

        PopupMenu.PopupMenu.prototype.open = this._oldPopupOpen;
        PopupMenu.PopupSubMenu.prototype.open = this._oldPopupSubMenuOpen;

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

    setFocusedMonitor: function(monitor) {
        if ((Main.overview._focusedMonitor || 0) != monitor) {
            Main.overview._focusedMonitor = monitor;
            Main.overview.viewSelector._workspacesDisplay._primaryIndex = monitor.index;
            
            Main.overview._overview.clear_constraints();
            Main.overview._overview.add_constraint(new Layout.MonitorConstraint({ index: monitor.index }));
            
            this._newOverviewRelayout.call(Main.overview);
        }
    },

    _reset: function() {
        this.disable(true);
        this.enable(true);
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



function newPopupOpen(animate) {
    if (this.isOpen)
        return;

    if (this.isEmpty())
        return;

    this.isOpen = true;
    
    let side = this._boxPointer._arrowSide;
    let panelPosition = Main.layoutManager.panelBox.anchor_y == 0 ? St.Side.TOP : St.Side.BOTTOM;

    if(side != panelPosition) {
        let actor = this.sourceActor;
        while(actor) {
            if(actor == Main.panel.actor) {
                this._boxPointer._arrowSide = panelPosition;
                break;
            }
            actor = actor.get_parent();
        }
    } 
    
    this._boxPointer.setPosition(this.sourceActor, this._arrowAlignment);
    (this._boxPointer.open || this._boxPointer.show).call(this._boxPointer, animate);

    this.actor.raise_top();

    this.emit('open-state-changed', true);
}


// there seems to be a rounding bug in the shell calculating the submenu size
// when the panel is at the bottom. When the height is too high to fit on the screen
// then the menu does not display at all. There's quiet a few factors involved in 
// calculating the correct height so this is a lousy hack to max it at 50% of the screen 
// height which should cover most real-world scenarios
function newPopupSubMenuOpen(animate) {
    if (this.isOpen)
        return;

    if (this.isEmpty())
        return;


    this.isOpen = true;
    this.emit('open-state-changed', true);

    let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    let subMenuMaxHeight = Math.floor(workArea.height / 2);
    let panelPosition = Main.layoutManager.panelBox.anchor_y == 0 ? St.Side.TOP : St.Side.BOTTOM;
    let isBottomPanelMenu = this._getTopMenu().actor.has_style_class_name('panel-menu') && panelPosition == St.Side.BOTTOM;
    
    if(isBottomPanelMenu) {
        this.actor.style = 'max-height: ' + subMenuMaxHeight + 'px;'
    }

    this.actor.show();

    let needsScrollbar = this._needsScrollbar() || (isBottomPanelMenu && this.actor.height >= subMenuMaxHeight);

    // St.ScrollView always requests space horizontally for a possible vertical
    // scrollbar if in AUTOMATIC mode. Doing better would require implementation
    // of width-for-height in St.BoxLayout and St.ScrollView. This looks bad
    // when we *don't* need it, so turn off the scrollbar when that's true.
    // Dynamic changes in whether we need it aren't handled properly.
    this.actor.vscrollbar_policy =
        needsScrollbar ? Gtk.PolicyType.AUTOMATIC : Gtk.PolicyType.NEVER;

    if (needsScrollbar)
        this.actor.add_style_pseudo_class('scrolled');
    else
        this.actor.remove_style_pseudo_class('scrolled');

    // It looks funny if we animate with a scrollbar (at what point is
    // the scrollbar added?) so just skip that case
    if (animate && needsScrollbar)
        animate = false;

    let targetAngle = this.actor.text_direction == Clutter.TextDirection.RTL ? -90 : 90;

    if (animate) {
        let [minHeight, naturalHeight] = this.actor.get_preferred_height(-1);
        this.actor.height = 0;
        this.actor._arrowRotation = this._arrow.rotation_angle_z;
        Tweener.addTween(this.actor,
                            { _arrowRotation: targetAngle,
                            height: naturalHeight,
                            time: 0.25,
                            onUpdateScope: this,
                            onUpdate: function() {
                                this._arrow.rotation_angle_z = this.actor._arrowRotation;
                            },
                            onCompleteScope: this,
                            onComplete: function() {
                                this.actor.set_height(-1);
                            }
                            });
    } else {
        this._arrow.rotation_angle_z = targetAngle;
    }
}

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
    let panelPosition = Main.layoutManager.panelBox.anchor_y == 0 ? St.Side.TOP : St.Side.BOTTOM;

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

function newUpdatePanelBarrier() {
    if (this._rightPanelBarrier) {
        this._rightPanelBarrier.destroy();
        this._rightPanelBarrier = null;
    }

    if (!this.primaryMonitor)
        return;

    if (this.panelBox.height) {
        let barrierHeight = Math.min(10, this.panelBox.height); 
        let primary = this.primaryMonitor;
        let isTop = Main.layoutManager.panelBox.anchor_y == 0;
        let y1 = isTop ? primary.y : primary.y + primary.height - barrierHeight;
        let y2 = isTop ? primary.y + barrierHeight : primary.y + primary.height;

        this._rightPanelBarrier = new Meta.Barrier({ display: global.display,
                                                     x1: primary.x + primary.width, y1: y1,
                                                     x2: primary.x + primary.width, y2: y2,
                                                     directions: Meta.BarrierDirection.NEGATIVE_X });
    }
}