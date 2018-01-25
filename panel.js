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
const Gtk = imports.gi.Gtk;
const Convenience = Me.imports.convenience;
const Taskbar = Me.imports.taskbar;
const PanelStyle = Me.imports.panelStyle;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Layout = imports.ui.layout;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const DND = imports.ui.dnd;
const Shell = imports.gi.Shell;
const PopupMenu = imports.ui.popupMenu;
const Tweener = imports.ui.tweener;
const IconGrid = imports.ui.iconGrid;
const ViewSelector = imports.ui.viewSelector;

let tracker = Shell.WindowTracker.get_default();

var dtpPanel = new Lang.Class({
    Name: 'DashToPanel.Panel',

    _init: function(settings) {
        this._dtpSettings = settings;
        this.panelStyle = new PanelStyle.dtpPanelStyle(settings);
	//rebuild panel when taskar-position change
        this._dtpSettings.connect('changed::taskbar-position', Lang.bind(this, function() {
            this.disable();
            this.enable();
        }));
    },

    enable : function() {
        this.panel = Main.panel;
	//choose the leftBox or the centerBox to build taskbar
        if (this._dtpSettings.get_string('taskbar-position') == 'LEFTPANEL') {
            this.container = this.panel._leftBox;
        } else {
            this.container = this.panel._centerBox;
        }
        this.appMenu = this.panel.statusArea.appMenu;
        this.panelBox = Main.layoutManager.panelBox;
        
        this._oldPopupOpen = PopupMenu.PopupMenu.prototype.open;
        PopupMenu.PopupMenu.prototype.open = newPopupOpen;

        this._oldPopupSubMenuOpen = PopupMenu.PopupSubMenu.prototype.open;
        PopupMenu.PopupSubMenu.prototype.open = newPopupSubMenuOpen;

        this._oldViewSelectorAnimateIn = Main.overview.viewSelector._animateIn;
        Main.overview.viewSelector._animateIn = Lang.bind(this, newViewSelectorAnimateIn);
        this._oldViewSelectorAnimateOut = Main.overview.viewSelector._animateOut;
        Main.overview.viewSelector._animateOut = Lang.bind(this, newViewSelectorAnimateOut);

        this._oldUpdatePanelBarrier = Main.layoutManager._updatePanelBarrier;
        Main.layoutManager._updatePanelBarrier = Lang.bind(Main.layoutManager, newUpdatePanelBarrier);
        Main.layoutManager._updatePanelBarrier();

        this._oldUpdateHotCorners = Main.layoutManager._updateHotCorners;
        Main.layoutManager._updateHotCorners = Lang.bind(Main.layoutManager, newUpdateHotCorners);
        Main.layoutManager._updateHotCorners();

        this._oldPanelHeight = this.panel.actor.get_height();

        // The overview uses the this.panel height as a margin by way of a "ghost" transparent Clone
        // This pushes everything down, which isn't desired when the this.panel is moved to the bottom
        // I'm adding a 2nd ghost this.panel and will resize the top or bottom ghost depending on the this.panel position
        this._myPanelGhost = new St.Bin({ 
            child: new Clutter.Clone({ source: Main.overview._panelGhost.get_child() }),
            reactive: false,
            opacity: 0 
        });
        Main.overview._overview.add_actor(this._myPanelGhost);
        
        this._setPanelPosition();
        this._MonitorsChangedListener = global.screen.connect("monitors-changed", Lang.bind(this, function(){
            this._setPanelPosition();
            this.taskbar.resetAppIcons();
        }));
        this._HeightNotifyListener = this.panelBox.connect("notify::height", Lang.bind(this, function(){
            this._setPanelPosition();
        }));

        // this is to catch changes to the window scale factor
        this._ScaleFactorListener = St.ThemeContext.get_for_stage(global.stage).connect("changed", Lang.bind(this, function () { 
            this._setPanelPosition();
        }));

        // The main panel's connection to the "allocate" signal is competing with this extension
        // trying to move the centerBox over to the right, creating a never-ending cycle.
        // Since we don't have the ID to disconnect that handler, wrap the allocate() function 
        // it calls instead. If the call didn't originate from this file, ignore it.
        this.panel._leftBox.oldLeftBoxAllocate = this.panel._leftBox.allocate;
        this.panel._leftBox.allocate = Lang.bind(this.panel._leftBox, function(box, flags, isFromDashToPanel) {
            if(isFromDashToPanel === true) 
                this.oldLeftBoxAllocate(box, flags);
        });

        this.panel._centerBox.oldCenterBoxAllocate = this.panel._centerBox.allocate;
        this.panel._centerBox.allocate = Lang.bind(this.panel._centerBox, function(box, flags, isFromDashToPanel) {
            if(isFromDashToPanel === true) 
                this.oldCenterBoxAllocate(box, flags);
        });

        this.panel._rightBox.oldRightBoxAllocate = this.panel._rightBox.allocate;
        this.panel._rightBox.allocate = Lang.bind(this.panel._rightBox, function(box, flags, isFromDashToPanel) {
            if(isFromDashToPanel === true) 
                this.oldRightBoxAllocate(box, flags);
        });

        this._panelConnectId = this.panel.actor.connect('allocate', Lang.bind(this, function(actor,box,flags){this._allocate(actor,box,flags);}));
        this.container.remove_child(this.appMenu.container);
        this.taskbar = new Taskbar.taskbar(this._dtpSettings);
        Main.overview.dashIconSize = this.taskbar.iconSize;

        this.container.insert_child_at_index( this.taskbar.actor, 2 );
        
        this._oldLeftBoxStyle = this.panel._leftBox.get_style();
        this._oldCenterBoxStyle = this.panel._centerBox.get_style();
        this._oldRightBoxStyle = this.panel._rightBox.get_style();
        this._setActivitiesButtonVisible(this._dtpSettings.get_boolean('show-activities-button'));
        this._setAppmenuVisible(this._dtpSettings.get_boolean('show-appmenu'));
        this._setClockLocation(this._dtpSettings.get_string('location-clock'));
        this._displayShowDesktopButton(this._dtpSettings.get_boolean('show-showdesktop-button'));
        
        this.panel.actor.add_style_class_name('dashtopanelMainPanel');

        // Since Gnome 3.8 dragging an app without having opened the overview before cause the attemp to
        //animate a null target since some variables are not initialized when the viewSelector is created
        if(Main.overview.viewSelector._activePage == null)
            Main.overview.viewSelector._activePage = Main.overview.viewSelector._workspacesPage;

        // sync hover after a popupmenu is closed
        this.taskbar.connect('menu-closed', Lang.bind(this, function(){this.container.sync_hover();}));
        
        if(this.taskbar._showAppsIcon)
            this.taskbar._showAppsIcon._dtpPanel = this;

        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._signalsHandler.add(
            // Keep dragged icon consistent in size with this dash
            [
                this.taskbar,
                'icon-size-changed',
                Lang.bind(this, function() {
                    Main.overview.dashIconSize = this.taskbar.iconSize;
                })
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
                this.panel._rightBox,
                'actor-added',
                Lang.bind(this, function() {
                    this._setClockLocation(this._dtpSettings.get_string('location-clock'));
                })
            ]
        );

        this._bindSettingsChanges();

        this.panelStyle.enable(this.panel);
        
        this.panel.handleDragOver = Lang.bind(this.panel, function(source, actor, x, y, time) {
            if (source == Main.xdndHandler) {
                
                // open overview so they can choose a window for focusing
                // and ultimately dropping dragged item onto
                if(Main.overview.shouldToggleByCornerOrButton())
                    Main.overview.show();
            }
            
            return DND.DragMotionResult.CONTINUE;
        });

        // Dynamic transparency is available on Gnome 3.26
        if (this.panel._updateSolidStyle) {
            this._injectionsHandler = new Convenience.InjectionsHandler();
            this.panel._dtpPosition = this._dtpSettings.get_string('panel-position');
            this._injectionsHandler.addWithLabel('transparency', [
                this.panel,
                '_updateSolidStyle',
                Lang.bind(this.panel, this._dtpUpdateSolidStyle)
            ]);

            this.panel._updateSolidStyle();
        }
    },

    disable: function () {
        this.panelStyle.disable();

        this._signalsHandler.destroy();
        this.container.remove_child(this.taskbar.actor);
        this._setAppmenuVisible(false);
        this.container.add_child(this.appMenu.container);
        this.taskbar.destroy();
        this.panel.actor.disconnect(this._panelConnectId);

        // reset stored icon size  to the default dash
        Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;

        this.panel.actor.remove_style_class_name('dashtopanelMainPanel');

        // remove this.panel styling
        if(this._HeightNotifyListener !== null) {
            this.panelBox.disconnect(this._HeightNotifyListener);
        }
        if(this._MonitorsChangedListener !== null) {
            global.screen.disconnect(this._MonitorsChangedListener);
        }
        if(this._ScaleFactorListener !== null) {
            St.ThemeContext.get_for_stage(global.stage).disconnect(this._ScaleFactorListener);
        }
        this.panel.actor.set_height(this._oldPanelHeight);
        this.panelBox.set_anchor_point(0, 0);
        Main.overview._overview.remove_child(this._myPanelGhost);
        Main.overview._panelGhost.set_height(this._oldPanelHeight);
        this._setActivitiesButtonVisible(true);
        this._setClockLocation("NATURAL");
        this._displayShowDesktopButton(false);

        if (this.panel._updateSolidStyle) {
            this._injectionsHandler.removeWithLabel('transparency');
            this._injectionsHandler.destroy();
            delete this.panel._dtpPosition;
        }

        PopupMenu.PopupMenu.prototype.open = this._oldPopupOpen;
        PopupMenu.PopupSubMenu.prototype.open = this._oldPopupSubMenuOpen;

        Main.layoutManager._updateHotCorners = this._oldUpdateHotCorners;
        Main.layoutManager._updateHotCorners();

        Main.layoutManager._updatePanelBarrier = this._oldUpdatePanelBarrier;
        Main.layoutManager._updatePanelBarrier();

        Main.overview.viewSelector._animateIn = this._oldViewSelectorAnimateIn;
        Main.overview.viewSelector._animateOut = this._oldViewSelectorAnimateOut;

        this.panel._leftBox.allocate = this.panel._leftBox.oldLeftBoxAllocate;
        delete this.panel._leftBox.oldLeftBoxAllocate;

        this.panel._centerBox.allocate = this.panel._centerBox.oldCenterBoxAllocate;
        delete this.panel._centerBox.oldCenterBoxAllocate;
        
        this.panel._rightBox.allocate = this.panel._rightBox.oldRightBoxAllocate;
        delete this.panel._rightBox.oldRightBoxAllocate;

        this.appMenu = null;
        this.container = null;
        this.panel = null;
        this.taskbar = null;
        this._panelConnectId = null;
        this._signalsHandler = null;
        this._MonitorsChangedListener = null;
        this._HeightNotifyListener = null;
    },

    _bindSettingsChanges: function() {
        this._dtpSettings.connect('changed::panel-position', Lang.bind(this, function() {
            this._setPanelPosition();
        }));

        this._dtpSettings.connect('changed::panel-size', Lang.bind(this, function() {
            this._setPanelPosition();
            this.taskbar.resetAppIcons();
        }));

        this._dtpSettings.connect('changed::appicon-margin', Lang.bind(this, function() {
            this.taskbar.resetAppIcons();
        }));

        this._dtpSettings.connect('changed::show-activities-button', Lang.bind(this, function() {
            this._setActivitiesButtonVisible(this._dtpSettings.get_boolean('show-activities-button'));
        }));
        
        this._dtpSettings.connect('changed::show-appmenu', Lang.bind(this, function() {
            this._setAppmenuVisible(this._dtpSettings.get_boolean('show-appmenu'));
        }));

        this._dtpSettings.connect('changed::location-clock', Lang.bind(this, function() {
            this._setClockLocation(this._dtpSettings.get_string('location-clock'));
        }));

        this._dtpSettings.connect('changed::show-showdesktop-button', Lang.bind(this, function() {
            this._displayShowDesktopButton(this._dtpSettings.get_boolean('show-showdesktop-button'));
        }));

        this._dtpSettings.connect('changed::showdesktop-button-width', () => this._setShowDesktopButtonWidth());
    },

    _allocate: function(actor, box, flags) {
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;

        let [leftMinWidth, leftNaturalWidth] = this.panel._leftBox.get_preferred_width(-1);
        let [centerMinWidth, centerNaturalWidth] = this.panel._centerBox.get_preferred_width(-1);
        let [rightMinWidth, rightNaturalWidth] = this.panel._rightBox.get_preferred_width(-1);

        let taskbarPosition = this._dtpSettings.get_string('taskbar-position');
        let sideWidth, leftSideWidth, rightSideWidth;
        
        if (taskbarPosition == 'LEFTPANEL') {
            sideWidth = allocWidth - rightNaturalWidth - centerNaturalWidth;
        } else if (taskbarPosition == 'CENTEREDCONTENT') {
            leftSideWidth = (allocWidth - centerNaturalWidth + leftNaturalWidth - rightNaturalWidth) / 2;
            rightSideWidth = (allocWidth - centerNaturalWidth - leftNaturalWidth + rightNaturalWidth) / 2;
        } else if (taskbarPosition == 'CENTEREDMONITOR') {
            leftSideWidth = rightSideWidth = sideWidth = (allocWidth - centerNaturalWidth) / 2;
        }
        
        let childBox = new Clutter.ActorBox();
        
        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (taskbarPosition == 'LEFTPANEL') {
            if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
                childBox.x1 = allocWidth - Math.min(Math.floor(sideWidth), leftNaturalWidth);
                childBox.x2 = allocWidth;
            } else {
                childBox.x1 = 0;
                childBox.x2 = sideWidth;
            }
        } else {
            if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
                childBox.x1 = allocWidth - leftNaturalWidth;
                childBox.x2 = allocWidth;
            } else {
                childBox.x1 = 0;
                childBox.x2 =leftNaturalWidth;
            }
        }
        this.panel._leftBox.allocate(childBox, flags, true);
        
        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (taskbarPosition == 'LEFTPANEL') {
            if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
                childBox.x1 = rightNaturalWidth;
                childBox.x2 = childBox.x1 + centerNaturalWidth;
            } else {
                childBox.x1 = allocWidth - centerNaturalWidth - rightNaturalWidth;
                childBox.x2 = childBox.x1 + centerNaturalWidth;
            }
        } else {
            if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
                childBox.x1 = Math.max(rightNaturalWidth, rightSideWidth);
                childBox.x2 = allocWidth - Math.max(leftNaturalWidth, leftSideWidth);
            } else {
                childBox.x1 = Math.max(leftNaturalWidth, leftSideWidth);
                childBox.x2 = allocWidth - Math.max(rightNaturalWidth, rightSideWidth);
            }
        }
        this.panel._centerBox.allocate(childBox, flags, true);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = rightNaturalWidth;
        } else {
            childBox.x1 = allocWidth - rightNaturalWidth;
            childBox.x2 = allocWidth;
        }
        this.panel._rightBox.allocate(childBox, flags, true);

        let [cornerMinWidth, cornerWidth] = this.panel._leftCorner.actor.get_preferred_width(-1);
        let [cornerMinHeight, cornerHeight] = this.panel._leftCorner.actor.get_preferred_width(-1);
        childBox.x1 = 0;
        childBox.x2 = cornerWidth;
        childBox.y1 = allocHeight;
        childBox.y2 = allocHeight + cornerHeight;
        this.panel._leftCorner.actor.allocate(childBox, flags);

        [cornerMinWidth, cornerWidth] = this.panel._rightCorner.actor.get_preferred_width(-1);
        [cornerMinHeight, cornerHeight] = this.panel._rightCorner.actor.get_preferred_width(-1);
        childBox.x1 = allocWidth - cornerWidth;
        childBox.x2 = allocWidth;
        childBox.y1 = allocHeight;
        childBox.y2 = allocHeight + cornerHeight;
        this.panel._rightCorner.actor.allocate(childBox, flags);
    },

    _setPanelPosition: function() {
        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let size = this._dtpSettings.get_int('panel-size');
        if(scaleFactor)
            size = size*scaleFactor;

        this.panel.actor.set_height(size);

        let position = this._dtpSettings.get_string('panel-position');
        let isTop = position == "TOP";

        Main.overview._panelGhost.set_height(isTop ? size : 0);
        this._myPanelGhost.set_height(isTop ? 0 : size);

        if(isTop) {
            this.panelBox.set_anchor_point(0, 0);
            
            // styles for theming
            if(this.panel.actor.has_style_class_name('dashtopanelBottom'))
                this.panel.actor.remove_style_class_name('dashtopanelBottom');

            if(!this.panel.actor.has_style_class_name('dashtopanelTop'))
                this.panel.actor.add_style_class_name('dashtopanelTop');
        } else {
            this.panelBox.set_anchor_point(0,(-1)*(Main.layoutManager.primaryMonitor.height-this.panelBox.height));

            // styles for theming
            if(this.panel.actor.has_style_class_name('dashtopanelTop'))
                this.panel.actor.remove_style_class_name('dashtopanelTop');

            if(!this.panel.actor.has_style_class_name('dashtopanelBottom'))
                this.panel.actor.add_style_class_name('dashtopanelBottom');
        }

        Main.layoutManager._updateHotCorners();
    },

    _setActivitiesButtonVisible: function(isVisible) {
        if(this.panel.statusArea.activities)
            isVisible ? this.panel.statusArea.activities.actor.show() :
                this.panel.statusArea.activities.actor.hide();
    },
    
    _setAppmenuVisible: function(isVisible) {
        if (this._dtpSettings.get_string('taskbar-position') == 'LEFTPANEL') {
            let centerBox = this.panel._centerBox;
            if (isVisible && centerBox.get_children().indexOf(this.appMenu.container) == -1) {
                centerBox.insert_child_at_index(this.appMenu.container, 0);
            } else if (!isVisible && centerBox.get_children().indexOf(this.appMenu.container) != -1) {
                centerBox.remove_child(this.appMenu.container);
            }
        } else {
            let leftBox = this.panel._leftBox;
            if (isVisible && leftBox.get_children().indexOf(this.appMenu.container) == -1) {
                leftBox.insert_child_above(this.appMenu.container, null);
            } else if (!isVisible && leftBox.get_children().indexOf(this.appMenu.container) != -1) {
                leftBox.remove_child(this.appMenu.container);
            }
        }
    },

    _setClockLocation: function(loc) {
        let centerBox = this.panel._centerBox;
        let rightBox = this.panel._rightBox;
        let dateMenu = this.panel.statusArea.dateMenu;
        let statusMenu = this.panel.statusArea.aggregateMenu;

        if(loc == "NATURAL") {
            // only move the clock back if it's in the right box
            if ( rightBox.get_children().indexOf(dateMenu.container) != -1 ) {
                rightBox.remove_actor(dateMenu.container);
                centerBox.add_actor(dateMenu.container);
            }
        } else {
            // if clock is in left box, remove it and add to right
            if ( centerBox.get_children().indexOf(dateMenu.container) != -1 ) {
                centerBox.remove_actor(dateMenu.container);
                rightBox.insert_child_at_index(dateMenu.container, 0);
            }

            // then, move to its new location
            switch(loc) {
                case "STATUSLEFT":
                    if(statusMenu)
                        rightBox.set_child_below_sibling(dateMenu.container, statusMenu.container);
                    break;
                case "STATUSRIGHT":
                    if(statusMenu)
                        rightBox.set_child_above_sibling(dateMenu.container, statusMenu.container);
                    break;
                default:
                    break;
            }

        }
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

            this._setShowDesktopButtonWidth();

            this._showDesktopButton.connect('button-press-event', Lang.bind(this, this._onShowDesktopButtonPress));

            this._showDesktopButton.connect('enter-event', Lang.bind(this, function(){
                this._showDesktopButton.add_style_class_name('showdesktop-button-hovered');
            }));
            
            this._showDesktopButton.connect('leave-event', Lang.bind(this, function(){
                this._showDesktopButton.remove_style_class_name('showdesktop-button-hovered');
            }));

            this.panel._rightBox.insert_child_at_index(this._showDesktopButton, this.panel._rightBox.get_children().length);
        } else {
            if(!this._showDesktopButton)
                return;

            this.panel._rightBox.remove_child(this._showDesktopButton);
            this._showDesktopButton.destroy();
            this._showDesktopButton = null;
        }
    },

    _setShowDesktopButtonWidth: function() {
        if (this._showDesktopButton) {
            this._showDesktopButton.set_style('width: ' + this._dtpSettings.get_int('showdesktop-button-width') + 'px;');
        }
    },

    _onShowDesktopButtonPress: function() {
        if(this._focusAppChangeId){
            tracker.disconnect(this._focusAppChangeId);
            this._focusAppChangeId = null;
        }

        if(this._restoreWindowList && this._restoreWindowList.length) {
            let current_workspace = global.screen.get_active_workspace();
            let windows = current_workspace.list_windows();
            this._restoreWindowList.forEach(function(w) {
                if(windows.indexOf(w) > -1)
                    Main.activateWindow(w);
            });
            this._restoreWindowList = null;

            Main.overview.hide();
        } else {
            let current_workspace = global.screen.get_active_workspace();
            let windows = current_workspace.list_windows().filter(function (w) {
                return w.showing_on_its_workspace() && !w.skip_taskbar;
            });
            windows = global.display.sort_windows_by_stacking(windows);

            windows.forEach(function(w) {
                w.minimize();
            });
            
            this._restoreWindowList = windows;

            Mainloop.timeout_add(0, Lang.bind(this, function () {
                this._focusAppChangeId = tracker.connect('notify::focus-app', Lang.bind(this, function () {
                    this._restoreWindowList = null;
                }));
            }));

            Main.overview.hide();
        }
    },

    _dtpUpdateSolidStyle: function() {
        if (this.actor.has_style_pseudo_class('overview') || !Main.sessionMode.hasWindows) {
            this._removeStyleClassName('solid');
        } else {
            /* Get all the windows in the active workspace that are in the
            * primary monitor and visible */
            let activeWorkspace = global.screen.get_active_workspace();
            let windows = activeWorkspace.list_windows().filter(function(metaWindow) {
                return metaWindow.is_on_primary_monitor() &&
                    metaWindow.showing_on_its_workspace() &&
                    metaWindow.get_window_type() != Meta.WindowType.DESKTOP;
            });

            /* Check if at least one window is near enough to the panel */
            let [, panelTop] = this.actor.get_transformed_position();
            let panelBottom = panelTop + this.actor.get_height();
            let scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            let isNearEnough = windows.some(Lang.bind(this, function(metaWindow) {
                if (this.hasOwnProperty('_dtpPosition') && this._dtpPosition === 'TOP') {
                    let verticalPosition = metaWindow.get_frame_rect().y;
                    return verticalPosition < panelBottom + 5 * scale;
                } else {
                    let verticalPosition = metaWindow.get_frame_rect().y + metaWindow.get_frame_rect().height;
                    return verticalPosition > panelTop - 5 * scale;
                }
            }));

            if (isNearEnough)
                this._addStyleClassName('solid');
            else
                this._removeStyleClassName('solid');
        }
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
    this._boxPointer.show(animate);

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
}
