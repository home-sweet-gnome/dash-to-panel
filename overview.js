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
 * 
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Intellihide = Me.imports.intellihide;
const Utils = Me.imports.utils;

const Clutter = imports.gi.Clutter;
const Config = imports.misc.config;
const Lang = imports.lang;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const IconGrid = imports.ui.iconGrid;
const OverviewControls = imports.ui.overviewControls;
const Workspace = imports.ui.workspace;
const St = imports.gi.St;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;

const Meta = imports.gi.Meta;

const GS_HOTKEYS_KEY = 'switch-to-application-';
const BACKGROUND_MARGIN = 12;
const SMALL_WORKSPACE_RATIO = 0.15;
const DASH_MAX_HEIGHT_RATIO = 0.15;


//timeout names
const T1 = 'swipeEndTimeout';

var dtpOverview = Utils.defineClass({
    Name: 'DashToPanel.Overview',

    _init: function() {
        this._numHotkeys = 10;
        this._timeoutsHandler = new Utils.TimeoutsHandler();
    },

    enable : function(panel) {
        this._panel = panel;
        this.taskbar = panel.taskbar;

        this._injectionsHandler = new Utils.InjectionsHandler();
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._optionalWorkspaceIsolation();
        this._optionalHotKeys();
        this._optionalNumberOverlay();
        this._optionalClickToExit();
        this._toggleDash();
        this._hookupAllocation();

        this._signalsHandler.add([
            Me.settings,
            'changed::stockgs-keep-dash', 
            () => this._toggleDash()
        ]);
    
    },

    disable: function () {
        Utils.hookVfunc(Workspace.WorkspaceBackground.prototype, 'allocate', Workspace.WorkspaceBackground.prototype.vfunc_allocate);
        Utils.hookVfunc(OverviewControls.ControlsManagerLayout.prototype, 'allocate', OverviewControls.ControlsManagerLayout.prototype.vfunc_allocate);
        OverviewControls.ControlsManagerLayout.prototype._computeWorkspacesBoxForState = this._oldComputeWorkspacesBoxForState;

        this._signalsHandler.destroy();
        this._injectionsHandler.destroy();
        
        this._toggleDash(true);

        // Remove key bindings
        this._disableHotKeys();
        this._disableExtraShortcut();
        this._disableClickToExit();
    },

    _toggleDash: function(visible) {
        // To hide the dash, set its width to 1, so it's almost not taken into account by code
        // calculaing the reserved space in the overview. The reason to keep it at 1 is
        // to allow its visibility change to trigger an allocaion of the appGrid which
        // in turn is triggergin the appsIcon spring animation, required when no other
        // actors has this effect, i.e in horizontal mode and without the workspaceThumnails
        // 1 static workspace only)

        if (visible === undefined) {
            visible = Me.settings.get_boolean('stockgs-keep-dash');
        }

        let visibilityFunc = visible ? 'show' : 'hide';
        let width = visible ? -1 : 1;
        let overviewControls = Main.overview._overview._controls || Main.overview._controls;

        overviewControls.dash.actor[visibilityFunc]();
        overviewControls.dash.actor.set_width(width);

        // This force the recalculation of the icon size
        overviewControls.dash._maxHeight = -1;
    },

    /**
     * Isolate overview to open new windows for inactive apps
     */
    _optionalWorkspaceIsolation: function() {
        let label = 'optionalWorkspaceIsolation';
        
        this._signalsHandler.add([
            Me.settings,
            'changed::isolate-workspaces',
            Lang.bind(this, function() {
                this._panel.panelManager.allPanels.forEach(p => p.taskbar.resetAppIcons());

                if (Me.settings.get_boolean('isolate-workspaces'))
                    Lang.bind(this, enable)();
                else
                    Lang.bind(this, disable)();
            })
        ]);

        if (Me.settings.get_boolean('isolate-workspaces'))
            Lang.bind(this, enable)();

        function enable() {
            this._injectionsHandler.removeWithLabel(label);

            this._injectionsHandler.addWithLabel(label, [
                Shell.App.prototype,
                'activate',
                IsolatedOverview
            ]);

            this._signalsHandler.removeWithLabel(label);

            this._signalsHandler.addWithLabel(label, [
                global.window_manager,
                'switch-workspace',
                () => this._panel.panelManager.allPanels.forEach(p => p.taskbar.handleIsolatedWorkspaceSwitch())
            ]);
        }

        function disable() {
            this._signalsHandler.removeWithLabel(label);
            this._injectionsHandler.removeWithLabel(label);
        }

        function IsolatedOverview() {
            // These lines take care of Nautilus for icons on Desktop
            let activeWorkspace = Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace();
            let windows = this.get_windows().filter(w => w.get_workspace().index() == activeWorkspace.index());

            if (windows.length > 0 && 
                (!(windows.length == 1 && windows[0].skip_taskbar) || 
                 this.is_on_workspace(activeWorkspace)))
                return Main.activateWindow(windows[0]);
            
            return this.open_new_window(-1);
        }
    },

    // Hotkeys
    _activateApp: function(appIndex) {
        let seenApps = {};
        let apps = [];
        
        this.taskbar._getAppIcons().forEach(function(appIcon) {
            if (!seenApps[appIcon.app]) {
                apps.push(appIcon);
            }

            seenApps[appIcon.app] = (seenApps[appIcon.app] || 0) + 1;
        });

        this._showOverlay();

        if (appIndex < apps.length) {
            let appIcon = apps[appIndex];
            let seenAppCount = seenApps[appIcon.app];
            let windowCount = appIcon.window || appIcon._hotkeysCycle ? seenAppCount : appIcon._nWindows;

            if (Me.settings.get_boolean('shortcut-previews') && windowCount > 1 && 
                !(Clutter.get_current_event().get_state() & ~(Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.MOD4_MASK))) { //ignore the alt (MOD1_MASK) and super key (MOD4_MASK)
                if (this._hotkeyPreviewCycleInfo && this._hotkeyPreviewCycleInfo.appIcon != appIcon) {
                    this._endHotkeyPreviewCycle();
                }
                
                if (!this._hotkeyPreviewCycleInfo) {
                    this._hotkeyPreviewCycleInfo = {
                        appIcon: appIcon,
                        currentWindow: appIcon.window,
                        keyFocusOutId: appIcon.actor.connect('key-focus-out', () => appIcon.actor.grab_key_focus()),
                        capturedEventId: global.stage.connect('captured-event', (actor, e) => {
                            if (e.type() == Clutter.EventType.KEY_RELEASE && e.get_key_symbol() == (Clutter.KEY_Super_L || Clutter.Super_L)) {
                                this._endHotkeyPreviewCycle(true);
                            }
        
                            return Clutter.EVENT_PROPAGATE;
                        })
                    };

                    appIcon._hotkeysCycle = appIcon.window;
                    appIcon.window = null;
                    appIcon._previewMenu.open(appIcon);
                    appIcon.actor.grab_key_focus();
                }
                
                appIcon._previewMenu.focusNext();
            } else {
                // Activate with button = 1, i.e. same as left click
                let button = 1;
                this._endHotkeyPreviewCycle();
                appIcon.activate(button, true);
            }
        }
    },

    _endHotkeyPreviewCycle: function(focusWindow) {
        if (this._hotkeyPreviewCycleInfo) {
            global.stage.disconnect(this._hotkeyPreviewCycleInfo.capturedEventId);
            this._hotkeyPreviewCycleInfo.appIcon.actor.disconnect(this._hotkeyPreviewCycleInfo.keyFocusOutId);

            if (focusWindow) {
                this._hotkeyPreviewCycleInfo.appIcon._previewMenu.activateFocused();
            }

            this._hotkeyPreviewCycleInfo.appIcon.window = this._hotkeyPreviewCycleInfo.currentWindow;
            delete this._hotkeyPreviewCycleInfo.appIcon._hotkeysCycle;
            this._hotkeyPreviewCycleInfo = 0;
        }
    },

    _optionalHotKeys: function() {
        this._hotKeysEnabled = false;
        if (Me.settings.get_boolean('hot-keys'))
            this._enableHotKeys();

        this._signalsHandler.add([
            Me.settings,
            'changed::hot-keys',
            Lang.bind(this, function() {
                    if (Me.settings.get_boolean('hot-keys'))
                        Lang.bind(this, this._enableHotKeys)();
                    else
                        Lang.bind(this, this._disableHotKeys)();
            })
        ]);
    },

    _resetHotkeys: function() {
        this._disableHotKeys();
        this._enableHotKeys();
    },

    _enableHotKeys: function() {
        if (this._hotKeysEnabled)
            return;

        //3.32 introduced app hotkeys, disable them to prevent conflicts
        if (Main.wm._switchToApplication) {
            for (let i = 1; i < 10; ++i) {
                Utils.removeKeybinding(GS_HOTKEYS_KEY + i);
            }
        }

        // Setup keyboard bindings for taskbar elements
        let shortcutNumKeys = Me.settings.get_string('shortcut-num-keys');
        let bothNumKeys = shortcutNumKeys == 'BOTH';
        let keys = [];
        
        if (bothNumKeys || shortcutNumKeys == 'NUM_ROW') {
            keys.push('app-hotkey-', 'app-shift-hotkey-', 'app-ctrl-hotkey-'); // Regular numbers
        }
        
        if (bothNumKeys || shortcutNumKeys == 'NUM_KEYPAD') {
            keys.push('app-hotkey-kp-', 'app-shift-hotkey-kp-', 'app-ctrl-hotkey-kp-'); // Key-pad numbers
        }

        keys.forEach( function(key) {
            for (let i = 0; i < this._numHotkeys; i++) {
                let appNum = i;

                Utils.addKeybinding(key + (i + 1), Me.settings, () => this._activateApp(appNum));
            }
        }, this);

        this._hotKeysEnabled = true;

        if (Me.settings.get_string('hotkeys-overlay-combo') === 'ALWAYS')
            this.taskbar.toggleNumberOverlay(true);
    },

    _disableHotKeys: function() {
        if (!this._hotKeysEnabled)
            return;

        let keys = ['app-hotkey-', 'app-shift-hotkey-', 'app-ctrl-hotkey-',  // Regular numbers
                    'app-hotkey-kp-', 'app-shift-hotkey-kp-', 'app-ctrl-hotkey-kp-']; // Key-pad numbers
        keys.forEach( function(key) {
            for (let i = 0; i < this._numHotkeys; i++) {
                Utils.removeKeybinding(key + (i + 1));
            }
        }, this);
        
        if (Main.wm._switchToApplication) {
            let gsSettings = new Gio.Settings({ schema_id: imports.ui.windowManager.SHELL_KEYBINDINGS_SCHEMA });

            for (let i = 1; i < 10; ++i) {
                Utils.addKeybinding(GS_HOTKEYS_KEY + i, gsSettings, Main.wm._switchToApplication.bind(Main.wm));
            }
        }

        this._hotKeysEnabled = false;

        this.taskbar.toggleNumberOverlay(false);
    },

    _optionalNumberOverlay: function() {
        // Enable extra shortcut
        if (Me.settings.get_boolean('hot-keys'))
            this._enableExtraShortcut();

        this._signalsHandler.add([
            Me.settings,
            'changed::hot-keys',
            Lang.bind(this, this._checkHotkeysOptions)
        ], [
            Me.settings,
            'changed::hotkeys-overlay-combo',
            Lang.bind(this, function() {
                if (Me.settings.get_boolean('hot-keys') && Me.settings.get_string('hotkeys-overlay-combo') === 'ALWAYS')
                    this.taskbar.toggleNumberOverlay(true);
                else
                    this.taskbar.toggleNumberOverlay(false);
            })
        ], [
            Me.settings,
            'changed::shortcut-num-keys',
            () =>  this._resetHotkeys()
        ]);
    },

    _checkHotkeysOptions: function() {
        if (Me.settings.get_boolean('hot-keys'))
            this._enableExtraShortcut();
        else
            this._disableExtraShortcut();
    },

    _enableExtraShortcut: function() {
        Utils.addKeybinding('shortcut', Me.settings, () => this._showOverlay(true));
    },

    _disableExtraShortcut: function() {
        Utils.removeKeybinding('shortcut');
    },

    _showOverlay: function(overlayFromShortcut) {
        //wait for intellihide timeout initialization
        if (!this._panel.intellihide) {
            return;
        }

        // Restart the counting if the shortcut is pressed again
        if (this._numberOverlayTimeoutId) {
            Mainloop.source_remove(this._numberOverlayTimeoutId);
            this._numberOverlayTimeoutId = 0;
        }

        let hotkey_option = Me.settings.get_string('hotkeys-overlay-combo');

        if (hotkey_option === 'NEVER')
            return;

        if (hotkey_option === 'TEMPORARILY' || overlayFromShortcut)
            this.taskbar.toggleNumberOverlay(true);

        this._panel.intellihide.revealAndHold(Intellihide.Hold.TEMPORARY);

        let timeout = Me.settings.get_int('overlay-timeout');
        
        if (overlayFromShortcut) {
            timeout = Me.settings.get_int('shortcut-timeout');
        }

        // Hide the overlay/dock after the timeout
        this._numberOverlayTimeoutId = Mainloop.timeout_add(timeout, Lang.bind(this, function() {
            this._numberOverlayTimeoutId = 0;
            
            if (hotkey_option != 'ALWAYS') {
                this.taskbar.toggleNumberOverlay(false);
            }
            
            this._panel.intellihide.release(Intellihide.Hold.TEMPORARY);
        }));
    },

    _optionalClickToExit: function() {
        this._clickToExitEnabled = false;
        if (Me.settings.get_boolean('overview-click-to-exit'))
            this._enableClickToExit();

        this._signalsHandler.add([
            Me.settings,
            'changed::overview-click-to-exit',
            Lang.bind(this, function() {
                    if (Me.settings.get_boolean('overview-click-to-exit'))
                        Lang.bind(this, this._enableClickToExit)();
                    else
                        Lang.bind(this, this._disableClickToExit)();
            })
        ]);
    },

    _enableClickToExit: function() {
        if (this._clickToExitEnabled)
            return;

        let view = imports.ui.appDisplay;
        this._oldOverviewReactive = Main.overview._overview.reactive

        Main.overview._overview.reactive = true;

        this._clickAction = new Clutter.ClickAction();
        this._clickAction.connect('clicked', () => {
            
            if (this._swiping)
                return Clutter.EVENT_PROPAGATE;
  
            let [x, y] = global.get_pointer();
            let pickedActor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);

            Main.overview.toggle();
         });
         Main.overview._overview.add_action(this._clickAction);

        this._clickToExitEnabled = true;
    },

    _disableClickToExit: function () {
        if (!this._clickToExitEnabled)
            return;
        
        Main.overview._overview.remove_action(this._clickAction);
        Main.overview._overview.reactive = this._oldOverviewReactive;

        this._signalsHandler.removeWithLabel('clickToExit');
    
        this._clickToExitEnabled = false;
    },

    _onSwipeBegin: function() {
        this._swiping = true;
        return true;
    },

    _onSwipeEnd: function() {
        this._timeoutsHandler.add([
            T1,
            0, 
            () => this._swiping = false
        ]);
        return true;
    },

    _hookupAllocation: function() {
        Utils.hookVfunc(OverviewControls.ControlsManagerLayout.prototype, 'allocate', function vfunc_allocate(container, box) {
            const childBox = new Clutter.ActorBox();
        
            const { spacing } = this;
        
            let startY = 0;
            let startX = 0;

            if (Me.settings.get_boolean('stockgs-keep-top-panel') && Main.layoutManager.panelBox.y === Main.layoutManager.primaryMonitor.y) {
                startY = Main.layoutManager.panelBox.height;
                box.y1 += startY;
            }
            
            const panel = global.dashToPanel.panels[0];
            if(panel) {
                switch (panel.getPosition()) {
                    case St.Side.TOP:
                        startY = panel.panelBox.height;
                        box.y1 += startY;
                        break;
                    case St.Side.LEFT:
                        startX = panel.panelBox.width;
                        box.x1 += startX;
                        break;
                    case St.Side.RIGHT:
                        box.x2 -= panel.panelBox.width;
                        break;

                }
            }
                 
            
            const [width, height] = box.get_size();
            let availableHeight = height;
        
            // Search entry
            let [searchHeight] = this._searchEntry.get_preferred_height(width);
            childBox.set_origin(startX, startY);
            childBox.set_size(width, searchHeight);
            this._searchEntry.allocate(childBox);
        
            availableHeight -= searchHeight + spacing;
        
            // Dash
            const maxDashHeight = Math.round(box.get_height() * DASH_MAX_HEIGHT_RATIO);
            this._dash.setMaxSize(width, maxDashHeight);
        
            let [, dashHeight] = this._dash.get_preferred_height(width);
            if (Me.settings.get_boolean('stockgs-keep-dash'))
                dashHeight = Math.min(dashHeight, maxDashHeight);
            else
                dashHeight = spacing*5; // todo: determine proper spacing for window labels on maximized windows on workspace display
            childBox.set_origin(startX, startY + height - dashHeight);
            childBox.set_size(width, dashHeight);
            this._dash.allocate(childBox);
        
            availableHeight -= dashHeight + spacing;
        
            // Workspace Thumbnails
            let thumbnailsHeight = 0;
            if (this._workspacesThumbnails.visible) {
                const { expandFraction } = this._workspacesThumbnails;
                [thumbnailsHeight] =
                    this._workspacesThumbnails.get_preferred_height(width);
                thumbnailsHeight = Math.min(
                    thumbnailsHeight * expandFraction,
                    height * WorkspaceThumbnail.MAX_THUMBNAIL_SCALE);
                childBox.set_origin(startX, startY + searchHeight + spacing);
                childBox.set_size(width, thumbnailsHeight);
                this._workspacesThumbnails.allocate(childBox);
            }
        
            // Workspaces
            let params = [box, startX, startY, searchHeight, dashHeight, thumbnailsHeight];
            const transitionParams = this._stateAdjustment.getStateTransitionParams();
        
            // Update cached boxes
            for (const state of Object.values(OverviewControls.ControlsState)) {
                this._cachedWorkspaceBoxes.set(
                    state, this._computeWorkspacesBoxForState(state, ...params));
            }
        
            let workspacesBox;
            if (!transitionParams.transitioning) {
                workspacesBox = this._cachedWorkspaceBoxes.get(transitionParams.currentState);
            } else {
                const initialBox = this._cachedWorkspaceBoxes.get(transitionParams.initialState);
                const finalBox = this._cachedWorkspaceBoxes.get(transitionParams.finalState);
                workspacesBox = initialBox.interpolate(finalBox, transitionParams.progress);
            }
        
            this._workspacesDisplay.allocate(workspacesBox);
        
            // AppDisplay
            if (this._appDisplay.visible) {
                const workspaceAppGridBox =
                    this._cachedWorkspaceBoxes.get(OverviewControls.ControlsState.APP_GRID);
    
                if (Config.PACKAGE_VERSION > '40.3') {
                    const monitor = Main.layoutManager.findMonitorForActor(this._container);
                    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
                    const workAreaBox = new Clutter.ActorBox();
    
                    workAreaBox.set_origin(startX, startY);
                    workAreaBox.set_size(workArea.width, workArea.height);
    
                    params = [workAreaBox, searchHeight, dashHeight, workspaceAppGridBox]
                } else {
                    params = [box, startX, searchHeight, dashHeight, workspaceAppGridBox];
                }

                let appDisplayBox;
                if (!transitionParams.transitioning) {
                    appDisplayBox =
                        this._getAppDisplayBoxForState(transitionParams.currentState, ...params);
                } else {
                    const initialBox =
                        this._getAppDisplayBoxForState(transitionParams.initialState, ...params);
                    const finalBox =
                        this._getAppDisplayBoxForState(transitionParams.finalState, ...params);
        
                    appDisplayBox = initialBox.interpolate(finalBox, transitionParams.progress);
                }
        
                this._appDisplay.allocate(appDisplayBox);
            }
        
            // Search
            childBox.set_origin(0, startY + searchHeight + spacing);
            childBox.set_size(width, availableHeight);
        
            this._searchController.allocate(childBox);
        
            this._runPostAllocation();
        });

        this._oldComputeWorkspacesBoxForState = OverviewControls.ControlsManagerLayout.prototype._computeWorkspacesBoxForState;
        OverviewControls.ControlsManagerLayout.prototype._computeWorkspacesBoxForState = function _computeWorkspacesBoxForState(state, box, startX, startY, searchHeight, dashHeight, thumbnailsHeight) {
            const workspaceBox = box.copy();
            const [width, height] = workspaceBox.get_size();
            const { spacing } = this;
            const { expandFraction } = this._workspacesThumbnails;

            switch (state) {
            case OverviewControls.ControlsState.HIDDEN:
                break;
            case OverviewControls.ControlsState.WINDOW_PICKER:
                workspaceBox.set_origin(startX,
                    startY + searchHeight + spacing +
                    thumbnailsHeight + spacing * expandFraction);
                workspaceBox.set_size(width,
                    height - 
                    dashHeight - spacing -
                    searchHeight - spacing -
                    thumbnailsHeight - spacing * expandFraction);
                break;
            case OverviewControls.ControlsState.APP_GRID:
                workspaceBox.set_origin(startX, startY + searchHeight + spacing);
                workspaceBox.set_size(
                    width,
                    Math.round(height * SMALL_WORKSPACE_RATIO));
                break;
            }
    
            return workspaceBox;
        }

        Utils.hookVfunc(Workspace.WorkspaceBackground.prototype, 'allocate', function vfunc_allocate(box) {
            const [width, height] = box.get_size();
            const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
            const scaledHeight = height - (BACKGROUND_MARGIN * 2 * scaleFactor);
            const scaledWidth = (scaledHeight / height) * width;
    
            const scaledBox = box.copy();
            scaledBox.set_origin(
                box.x1 + (width - scaledWidth) / 2,
                box.y1 + (height - scaledHeight) / 2);
            scaledBox.set_size(scaledWidth, scaledHeight);
    
            const progress = this._stateAdjustment.value;
    
            if (progress === 1)
                box = scaledBox;
            else if (progress !== 0)
                box = box.interpolate(scaledBox, progress);
    
            this.set_allocation(box);
    
            const themeNode = this.get_theme_node();
            const contentBox = themeNode.get_content_box(box);
    
            this._bin.allocate(contentBox);
    
            
            const [contentWidth, contentHeight] = contentBox.get_size();
            const monitor = Main.layoutManager.monitors[this._monitorIndex];
            let xOff = (contentWidth / this._workarea.width) *
                (this._workarea.x - monitor.x);
            let yOff = (contentHeight / this._workarea.height) *
                (this._workarea.y - monitor.y);
    
            let startX = -xOff;
            let startY = -yOff;
            const panel = Utils.find(global.dashToPanel.panels, p => p.monitor.index == this._monitorIndex);
            switch (panel.getPosition()) {
                case St.Side.TOP:
                    yOff += panel.panelBox.height;
                    startY -= panel.panelBox.height;
                    break;
                case St.Side.BOTTOM:
                    yOff += panel.panelBox.height;
                    break;
                case St.Side.RIGHT:
                    xOff += panel.panelBox.width;
                    break;
            }
            contentBox.set_origin(startX, startY);
            contentBox.set_size(xOff + contentWidth, yOff + contentHeight);
            this._backgroundGroup.allocate(contentBox);
        });
    
    }
});
