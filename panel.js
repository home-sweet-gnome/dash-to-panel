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
const Utils = Me.imports.utils;
const Taskbar = Me.imports.taskbar;
const PanelStyle = Me.imports.panelStyle;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
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

let tracker = Shell.WindowTracker.get_default();

var dtpPanelWrapper = Utils.defineClass({
    Name: 'DashToPanel.PanelWrapper',

    _init: function(panelManager, monitor, panel, panelBox, isSecondary) {
        this.panelManager = panelManager;
        this._dtpSettings = panelManager._dtpSettings;
        this.panelStyle = new PanelStyle.dtpPanelStyle(panelManager._dtpSettings);

        this.monitor = monitor;
        this.panel = panel;
        this.panelBox = panelBox;
        this.isSecondary = isSecondary;
    },

    enable : function() {
        let taskbarPosition = this._dtpSettings.get_string('taskbar-position');
        if (taskbarPosition == 'CENTEREDCONTENT' || taskbarPosition == 'CENTEREDMONITOR') {
            this.container = this.panel._centerBox;
        } else {
            this.container = this.panel._leftBox;
        }
        this.appMenu = this.panel.statusArea.appMenu;
        
        this._oldPanelActorDelegate = this.panel.actor._delegate;
        this.panel.actor._delegate = this;

        this._oldPanelHeight = this.panel.actor.get_height();

        // The overview uses the this.panel height as a margin by way of a "ghost" transparent Clone
        // This pushes everything down, which isn't desired when the this.panel is moved to the bottom
        // I'm adding a 2nd ghost this.panel and will resize the top or bottom ghost depending on the this.panel position
        this._myPanelGhost = new St.Bin({ 
            child: new Clutter.Clone({ source: this.panel.actor }),
            reactive: false,
            opacity: 0 
        });
        Main.overview._overview.add_actor(this._myPanelGhost)
        this._adjustForOverview();

        this._setPanelPosition();
        
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

        if (!this.isSecondary) {
            if (this.panel.vfunc_allocate) {
                this._panelConnectId = 0;
                Utils.hookVfunc(this.panel.__proto__, 'allocate', (box, flags) => this._vfunc_allocate(box, flags));
            } else {
                this._panelConnectId = this.panel.actor.connect('allocate', (actor,box,flags) => this._allocate(actor,box,flags));
            }
        }

        this.panel.menuManager._oldChangeMenu = this.panel.menuManager._changeMenu;
        this.panel.menuManager._changeMenu = (menu) => {
            if (!this._dtpSettings.get_boolean('stockgs-panelbtn-click-only')) {
                this.panel.menuManager._oldChangeMenu(menu);
            }
        };

        if(this.appMenu)
            this.panel._leftBox.remove_child(this.appMenu.container);

        this.dynamicTransparency = new Transparency.DynamicTransparency(this);
        this.taskbar = new Taskbar.taskbar(this._dtpSettings, this);
        Main.overview.dashIconSize = this.taskbar.iconSize;

        this.container.insert_child_above(this.taskbar.actor, null);
        
        this._setActivitiesButtonVisible(this._dtpSettings.get_boolean('show-activities-button'));
        this._setAppmenuVisible(this._dtpSettings.get_boolean('show-appmenu'));
        this._setClockLocation(this._dtpSettings.get_string('location-clock'));
        this._displayShowDesktopButton(this._dtpSettings.get_boolean('show-showdesktop-button'));
        
        this.panel.actor.add_style_class_name('dashtopanelMainPanel');

        // Since Gnome 3.8 dragging an app without having opened the overview before cause the attemp to
        //animate a null target since some variables are not initialized when the viewSelector is created
        if(Main.overview.viewSelector._activePage == null)
            Main.overview.viewSelector._activePage = Main.overview.viewSelector._workspacesPage;

        if(this.taskbar._showAppsIconWrapper)
            this.taskbar._showAppsIconWrapper._dtpPanel = this;

        this.startIntellihideId = Mainloop.timeout_add(2000, () => {
            this.startIntellihideId = 0;
            this.intellihide = new Intellihide.Intellihide(this);
        });

        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._signalsHandler.add(
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
                this.panel._rightBox,
                'actor-added',
                Lang.bind(this, function() {
                    this._setClockLocation(this._dtpSettings.get_string('location-clock'));
                })
            ],
            [
                this.panel._centerBox,
                'actor-added',
                () => this._setClockLocation(this._dtpSettings.get_string('location-clock'))
            ]
        );

        this._bindSettingsChanges();

        this.panelStyle.enable(this.panel);
        
        // Dynamic transparency is available on Gnome 3.26
        if (this.panel._updateSolidStyle) {
            this._injectionsHandler = new Utils.InjectionsHandler();
            this._injectionsHandler.addWithLabel('transparency', [
                    this.panel,
                    '_updateSolidStyle',
                    () => {}
                ]);
            this.panel.actor.remove_style_class_name('solid');
        }
	    
	// Since we are usually visible but not usually changing, make sure
	// most repaint requests don't actually require us to repaint anything.
	// This saves significant CPU when repainting the screen.
        this.panel.actor.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
    },

    disable: function () {
        this.panelStyle.disable();
        Main.overview._overview.remove_actor(this._myPanelGhost);

        this._signalsHandler.destroy();
        this.container.remove_child(this.taskbar.actor);
        this._setAppmenuVisible(false);
        if(this.appMenu)
            this.panel._leftBox.add_child(this.appMenu.container);
        this.taskbar.destroy();

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

        this.dynamicTransparency.destroy();

        // reset stored icon size  to the default dash
        Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;

        this.panel.actor.remove_style_class_name('dashtopanelMainPanel');

        // remove this.panel styling
        if(this._HeightNotifyListener !== null) {
            this.panelBox.disconnect(this._HeightNotifyListener);
        }
        if(this._ScaleFactorListener !== null) {
            St.ThemeContext.get_for_stage(global.stage).disconnect(this._ScaleFactorListener);
        }

        for (let i = 0; i < this._dtpSettingsSignalIds.length; ++i) {
            this._dtpSettings.disconnect(this._dtpSettingsSignalIds[i]);
        }

        this._removeTopLimit();

        if (this.panel._updateSolidStyle) {
            this._injectionsHandler.removeWithLabel('transparency');
            this._injectionsHandler.destroy();
        }

        this.panel.menuManager._changeMenu = this.panel.menuManager._oldChangeMenu;
        this.panel.actor._delegate = this._oldPanelActorDelegate;

        if (!this.isSecondary) {
            this.panel.actor.set_height(this._oldPanelHeight);
            
            Main.overview._panelGhost.set_height(this._oldPanelHeight);
            this._setActivitiesButtonVisible(true);
            this._setClockLocation("BUTTONSLEFT");
            this._displayShowDesktopButton(false);

            if (this._panelConnectId) {
                this.panel.actor.disconnect(this._panelConnectId);
            } else {
                Utils.hookVfunc(this.panel.__proto__, 'allocate', this.panel.__proto__.vfunc_allocate);
            }

            this.panel._leftBox.allocate = this.panel._leftBox.oldLeftBoxAllocate;
            delete this.panel._leftBox.oldLeftBoxAllocate;

            this.panel._centerBox.allocate = this.panel._centerBox.oldCenterBoxAllocate;
            delete this.panel._centerBox.oldCenterBoxAllocate;
            
            this.panel._rightBox.allocate = this.panel._rightBox.oldRightBoxAllocate;
            delete this.panel._rightBox.oldRightBoxAllocate;
        } else {
            this.panel.delegate = null;
            Main.layoutManager.removeChrome(this.panelBox);
            this.panel.destroy();
            this.panelBox.destroy();
        }

        this.appMenu = null;
        this.container = null;
        this.panel = null;
        this.taskbar = null;
        this._panelConnectId = null;
        this._signalsHandler = null;
        this._HeightNotifyListener = null;
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
        this._dtpSettingsSignalIds = [
            this._dtpSettings.connect('changed::panel-size', Lang.bind(this, function() {
                this._setPanelPosition();
                this.taskbar.resetAppIcons();
            })),

            this._dtpSettings.connect('changed::appicon-margin', Lang.bind(this, function() {
                this.taskbar.resetAppIcons();
            })),

            this._dtpSettings.connect('changed::appicon-padding', Lang.bind(this, function() {
                this.taskbar.resetAppIcons();
            })),

            this._dtpSettings.connect('changed::show-activities-button', Lang.bind(this, function() {
                this._setActivitiesButtonVisible(this._dtpSettings.get_boolean('show-activities-button'));
            })),
            
            this._dtpSettings.connect('changed::show-appmenu', Lang.bind(this, function() {
                this._setAppmenuVisible(this._dtpSettings.get_boolean('show-appmenu'));
            })),

            this._dtpSettings.connect('changed::location-clock', Lang.bind(this, function() {
                this._setClockLocation(this._dtpSettings.get_string('location-clock'));
            })),

            this._dtpSettings.connect('changed::show-showdesktop-button', Lang.bind(this, function() {
                this._displayShowDesktopButton(this._dtpSettings.get_boolean('show-showdesktop-button'));
            })),

            this._dtpSettings.connect('changed::showdesktop-button-width', () => this._setShowDesktopButtonWidth())
        ];
    },

    _adjustForOverview: function() {
        let isFocusedMonitor = this.panelManager.checkIfFocusedMonitor(this.monitor);
        let isOverview = !!Main.overview.visibleTarget;
        let isShown = !isOverview || (isOverview && isFocusedMonitor);

        this.panelBox[isShown ? 'show' : 'hide']();
    },

    _vfunc_allocate: function(box, flags) {
        this.panel.set_allocation(box, flags);
        this._allocate(null, box, flags);
    },
    
    _allocate: function(actor, box, flags) {
        let panelAllocWidth = box.x2 - box.x1;
        let panelAllocHeight = box.y2 - box.y1;

        let [leftMinWidth, leftNaturalWidth] = this.panel._leftBox.get_preferred_width(-1);
        let [centerMinWidth, centerNaturalWidth] = this.panel._centerBox.get_preferred_width(-1);
        let [rightMinWidth, rightNaturalWidth] = this.panel._rightBox.get_preferred_width(-1);
        
        let taskbarPosition = this._dtpSettings.get_string('taskbar-position');

        // The _rightBox is always allocated the same, regardless of taskbar position setting
        let rightAllocWidth = rightNaturalWidth;
        
        // Now figure out how large the _leftBox and _centerBox should be.
        // The box with the taskbar is always the one that is forced to be smaller as the other boxes grow
        let leftAllocWidth, centerStartPosition, centerEndPosition;
        if (taskbarPosition == 'CENTEREDMONITOR') {
            leftAllocWidth = leftNaturalWidth;

            centerStartPosition = Math.max(leftNaturalWidth, Math.floor((panelAllocWidth - centerNaturalWidth)/2));
            centerEndPosition = Math.min(panelAllocWidth-rightNaturalWidth, Math.ceil((panelAllocWidth+centerNaturalWidth))/2);
        } else if (taskbarPosition == 'CENTEREDCONTENT') {
            leftAllocWidth = leftNaturalWidth;

            centerStartPosition = Math.max(leftNaturalWidth, Math.floor((panelAllocWidth - centerNaturalWidth + leftNaturalWidth - rightNaturalWidth) / 2));
            centerEndPosition = Math.min(panelAllocWidth-rightNaturalWidth, Math.ceil((panelAllocWidth + centerNaturalWidth + leftNaturalWidth - rightNaturalWidth) / 2));
        } else if (taskbarPosition == 'LEFTPANEL_FIXEDCENTER') {
            leftAllocWidth = Math.floor((panelAllocWidth - centerNaturalWidth) / 2);
            centerStartPosition = leftAllocWidth;
            centerEndPosition = centerStartPosition + centerNaturalWidth;
        } else if (taskbarPosition == 'LEFTPANEL_FLOATCENTER') {
            let leftAllocWidthMax = panelAllocWidth - rightNaturalWidth - centerNaturalWidth;
            leftAllocWidth = Math.min(leftAllocWidthMax, leftNaturalWidth);

            let freeSpace = panelAllocWidth - leftAllocWidth - rightAllocWidth - centerNaturalWidth;

            centerStartPosition = leftAllocWidth + Math.floor(freeSpace / 2);
            centerEndPosition = centerStartPosition + centerNaturalWidth;
        } else { // LEFTPANEL
            leftAllocWidth = panelAllocWidth - rightNaturalWidth - centerNaturalWidth;
            centerStartPosition = leftAllocWidth;
            centerEndPosition = centerStartPosition + centerNaturalWidth;
        }

        let childBoxLeft = new Clutter.ActorBox();
        let childBoxCenter = new Clutter.ActorBox();
        let childBoxRight = new Clutter.ActorBox();
        childBoxLeft.y1 = childBoxCenter.y1 = childBoxRight.y1 = 0;
        childBoxLeft.y2 = childBoxCenter.y2 = childBoxRight.y2 = panelAllocHeight;

        // if it is a RTL language, the boxes are switched around, and we need to invert the coordinates
        if (this.panel.actor.get_text_direction() == Clutter.TextDirection.RTL) {
            childBoxLeft.x1 = panelAllocWidth - leftAllocWidth;
            childBoxLeft.x2 = panelAllocWidth;

            childBoxCenter.x1 = panelAllocWidth - centerEndPosition;
            childBoxCenter.x2 = panelAllocWidth - centerStartPosition;

            childBoxRight.x1 = 0;
            childBoxRight.x2 = rightAllocWidth;
        } else {
            childBoxLeft.x1 = 0;
            childBoxLeft.x2 = leftAllocWidth;

            childBoxCenter.x1 = centerStartPosition;
            childBoxCenter.x2 = centerEndPosition;

            childBoxRight.x1 = panelAllocWidth - rightAllocWidth;
            childBoxRight.x2 = panelAllocWidth;            
        }
       
        let childBoxLeftCorner = new Clutter.ActorBox();
        let [cornerMinWidth, cornerWidth] = this.panel._leftCorner.actor.get_preferred_width(-1);
        let [cornerMinHeight, cornerHeight] = this.panel._leftCorner.actor.get_preferred_width(-1);
        childBoxLeftCorner.x1 = 0;
        childBoxLeftCorner.x2 = cornerWidth;
        childBoxLeftCorner.y1 = panelAllocHeight;
        childBoxLeftCorner.y2 = panelAllocHeight + cornerHeight;

        let childBoxRightCorner = new Clutter.ActorBox();
        [cornerMinWidth, cornerWidth] = this.panel._rightCorner.actor.get_preferred_width(-1);
        [cornerMinHeight, cornerHeight] = this.panel._rightCorner.actor.get_preferred_width(-1);
        childBoxRightCorner.x1 = panelAllocWidth - cornerWidth;
        childBoxRightCorner.x2 = panelAllocWidth;
        childBoxRightCorner.y1 = panelAllocHeight;
        childBoxRightCorner.y2 = panelAllocHeight + cornerHeight;

        this.panel._leftBox.allocate(childBoxLeft, flags, true);
        this.panel._centerBox.allocate(childBoxCenter, flags, true);
        this.panel._rightBox.allocate(childBoxRight, flags, true);
        this.panel._leftCorner.actor.allocate(childBoxLeftCorner, flags);
        this.panel._rightCorner.actor.allocate(childBoxRightCorner, flags);
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
            this.panelBox.set_position(this.monitor.x, this.monitor.y);

            this._removeTopLimit();
            
            // styles for theming
            if(this.panel.actor.has_style_class_name('dashtopanelBottom'))
                this.panel.actor.remove_style_class_name('dashtopanelBottom');

            if(!this.panel.actor.has_style_class_name('dashtopanelTop'))
                this.panel.actor.add_style_class_name('dashtopanelTop');
        } else {
            this.panelBox.set_position(this.monitor.x, this.monitor.y + this.monitor.height - this.panelBox.height);

            if (!this._topLimit) {
                this._topLimit = new St.BoxLayout({ name: 'topLimit', vertical: true });
                Main.layoutManager.addChrome(this._topLimit, { affectsStruts: true, trackFullscreen: true });
            }

            this._topLimit.set_position(this.monitor.x, this.monitor.y);
            this._topLimit.set_size(this.monitor.width, -1);

            // styles for theming
            if(this.panel.actor.has_style_class_name('dashtopanelTop'))
                this.panel.actor.remove_style_class_name('dashtopanelTop');

            if(!this.panel.actor.has_style_class_name('dashtopanelBottom'))
                this.panel.actor.add_style_class_name('dashtopanelBottom');
        }

        Main.layoutManager._updateHotCorners();
        Main.layoutManager._updatePanelBarrier(this);
    },

    _removeTopLimit: function() {
        if (this._topLimit) {
            Main.layoutManager.removeChrome(this._topLimit);
            this._topLimit = null;
        }
    },

    _setActivitiesButtonVisible: function(isVisible) {
        if(this.panel.statusArea.activities)
            isVisible ? this.panel.statusArea.activities.actor.show() :
                this.panel.statusArea.activities.actor.hide();
    },
    
    _setAppmenuVisible: function(isVisible) {
        let parent;
        if(this.appMenu)
            parent = this.appMenu.container.get_parent();

        if (parent) {
            parent.remove_child(this.appMenu.container);
        }

        if (isVisible && this.appMenu) {
            let taskbarPosition = this._dtpSettings.get_string('taskbar-position');
            if (taskbarPosition == 'CENTEREDCONTENT' || taskbarPosition == 'CENTEREDMONITOR') {
                this.panel._leftBox.insert_child_above(this.appMenu.container, null);
            } else {
                this.panel._centerBox.insert_child_at_index(this.appMenu.container, 0);
            }            
        }
    },

    _setClockLocation: function(loc) {
        if(!this.panel.statusArea.dateMenu)
            return;

        let dateMenuContainer = this.panel.statusArea.dateMenu.container;
        let parent = dateMenuContainer.get_parent();
        let destination;
        let refSibling = null;

        if (!parent) {
            return;
        }

        if (loc.indexOf('BUTTONS') == 0) {
            destination = this.panel._centerBox;
        } else if (loc.indexOf('STATUS') == 0) {
            refSibling = this.panel.statusArea.aggregateMenu ? this.panel.statusArea.aggregateMenu.container : null;
            destination = this.panel._rightBox;
        } else { //TASKBAR
            refSibling = this.taskbar.actor;
            destination = refSibling.get_parent();
        }

        if (parent != destination) {
            parent.remove_actor(dateMenuContainer);
            destination.add_actor(dateMenuContainer);
        }

        destination['set_child_' + (loc.indexOf('RIGHT') > 0 ? 'above' : 'below') + '_sibling'](dateMenuContainer, refSibling);
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

                if (this._dtpSettings.get_boolean('show-showdesktop-hover')) {
                    this._showDesktopTimeoutId = Mainloop.timeout_add(this._dtpSettings.get_int('show-showdesktop-delay'), () => {
                        this._hiddenDesktopWorkspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace();
                        this._toggleWorkspaceWindows(true, this._hiddenDesktopWorkspace);
                        this._showDesktopTimeoutId = 0;
                    });
                }
            }));
            
            this._showDesktopButton.connect('leave-event', Lang.bind(this, function(){
                this._showDesktopButton.remove_style_class_name('showdesktop-button-hovered');

                if (this._dtpSettings.get_boolean('show-showdesktop-hover')) {
                    if (this._showDesktopTimeoutId) {
                        Mainloop.source_remove(this._showDesktopTimeoutId);
                        this._showDesktopTimeoutId = 0;
                    } else {
                        this._toggleWorkspaceWindows(false, this._hiddenDesktopWorkspace);
                    }
                 }
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

    _toggleWorkspaceWindows: function(hide, workspace) {
        workspace.list_windows().forEach(w => 
            Tweener.addTween(w.get_compositor_private(), {
                opacity: hide ? 0 : 255,
                time: this._dtpSettings.get_int('show-showdesktop-time') * .001,
                transition: 'easeOutQuad'
            })
        );
    },

    _onShowDesktopButtonPress: function() {
        if(this._focusAppChangeId){
            tracker.disconnect(this._focusAppChangeId);
            this._focusAppChangeId = null;
        }

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
                this._focusAppChangeId = tracker.connect('notify::focus-app', Lang.bind(this, function () {
                    this._restoreWindowList = null;
                }));
            }));
        }

        Main.overview.hide();
    },
});

var dtpSecondaryPanel = Utils.defineClass({
    Name: 'DashToPanel-SecondaryPanel',
    Extends: St.Widget,

    _init: function(settings, monitor) {
        this.callParent('_init', { name: 'panel', reactive: true });
        
        this._dtpSettings = settings;
       
        this.actor = this;
        this._sessionStyle = null;

        this.statusArea = { };

        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this._leftBox = new St.BoxLayout({ name: 'panelLeft' });
        this.add_actor(this._leftBox);
        this._centerBox = new St.BoxLayout({ name: 'panelCenter' });
        this.add_actor(this._centerBox);
        this._rightBox = new St.BoxLayout({ name: 'panelRight' });
        this.add_actor(this._rightBox);

        this._leftCorner = new Panel.PanelCorner(St.Side.LEFT);
        this.add_actor(this._leftCorner.actor);

        this._rightCorner = new Panel.PanelCorner(St.Side.RIGHT);
        this.add_actor(this._rightCorner.actor);

        this._panelMenuSignalIds = [];

        //adding the clock to the centerbox will correctly position it according to dtp settings (event in dtpPanelWrapper)
        this._setPanelMenu('show-status-menu-all-monitors', 'aggregateMenu', dtpSecondaryAggregateMenu, this._rightBox, true);
        this._setPanelMenu('show-clock-all-monitors', 'dateMenu', DateMenu.DateMenuButton, this._centerBox, true);
        
        this.connect('destroy', Lang.bind(this, this._onDestroy));

        if (Main.panel._onButtonPress) {
            this.connect('button-press-event', Main.panel._onButtonPress.bind(this));
            this.connect('touch-event', Main.panel._onButtonPress.bind(this));
        }

        if (Main.panel._onKeyPress) {
            this.connect('key-press-event', Main.panel._onKeyPress.bind(this));
        }
       
        Main.ctrlAltTabManager.addGroup(this, _("Top Bar")+" "+ monitor.index, 'focus-top-bar-symbolic',
                                        { sortGroup: CtrlAltTab.SortGroup.TOP });

    },

    vfunc_allocate: function(box, flags) {
        if(this.delegate) {
            this.delegate._vfunc_allocate(box, flags);
        }
    },
    
    _setPanelMenu: function(settingName, propName, constr, container, isInit) {
        if (isInit) {
            this._panelMenuSignalIds.push(this._dtpSettings.connect(
                'changed::' + settingName, () => this._setPanelMenu(settingName, propName, constr, container)));
        }
        
        if (!this._dtpSettings.get_boolean(settingName)) {
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

    _onDestroy: function() {
	    Main.ctrlAltTabManager.removeGroup(this);
        
        this._panelMenuSignalIds.forEach(id => this._dtpSettings.disconnect(id));
        
        this._removePanelMenu('dateMenu');
        this._removePanelMenu('aggregateMenu');
    },
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
    },
});