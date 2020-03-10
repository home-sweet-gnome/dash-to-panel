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
const Lang = imports.lang;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;

const Meta = imports.gi.Meta;

const GS_HOTKEYS_KEY = 'switch-to-application-';

var dtpOverview = Utils.defineClass({
    Name: 'DashToPanel.Overview',

    _init: function() {
        this._numHotkeys = 10;
    },

    enable : function(panel) {
        this._panel = panel;
        this.taskbar = panel.taskbar;

        this._injectionsHandler = new Utils.InjectionsHandler();
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._optionalWorkspaceIsolation();
        this._optionalHotKeys();
        this._optionalNumberOverlay();
        this._toggleDash();
        
        this._signalsHandler.add([
            Me.settings,
            'changed::stockgs-keep-dash', 
            () => this._toggleDash()
        ]);
    },

    disable: function () {
        this._signalsHandler.destroy();
        this._injectionsHandler.destroy();
        
        this._toggleDash(true);

        // Remove key bindings
        this._disableHotKeys();
        this._disableExtraShortcut();
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
                if (!this._hotkeyPreviewCycleInfo) {
                    this._hotkeyPreviewCycleInfo = {
                        appIcon: appIcon,
                        currentWindow: appIcon.window,
                        keyFocusOutId: appIcon.actor.connect('key-focus-out', () => appIcon.actor.grab_key_focus()),
                        capturedEventId: global.stage.connect('captured-event', (actor, e) => {
                            if (e.type() == Clutter.EventType.KEY_RELEASE && e.get_key_symbol() == Clutter.Super_L) {
                                this._endHotkeyPreviewCycle();
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

    _endHotkeyPreviewCycle: function() {
        if (this._hotkeyPreviewCycleInfo) {
            global.stage.disconnect(this._hotkeyPreviewCycleInfo.capturedEventId);
            this._hotkeyPreviewCycleInfo.appIcon.actor.disconnect(this._hotkeyPreviewCycleInfo.keyFocusOutId);

            this._hotkeyPreviewCycleInfo.appIcon._previewMenu.activateFocused();
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
    }
});
