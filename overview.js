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

    _init: function(settings) {
        this._numHotkeys = 10;
        this._currentHotkeyFocusIndex = -1;
        this._dtpSettings = settings;
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
            this._dtpSettings,
            'changed::stockgs-keep-dash', 
            () => this._toggleDash()
        ]);
    },

    disable: function () {
        this._signalsHandler.destroy();
        this._injectionsHandler.destroy();
        
        this._toggleDash(true);

        // reset stored icon size  to the default dash
        Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;

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
            visible = this._dtpSettings.get_boolean('stockgs-keep-dash');
        }

        let visibilityFunc = visible ? 'show' : 'hide';
        let width = visible ? -1 : 1;
        
        Main.overview._controls.dash.actor[visibilityFunc]();
        Main.overview._controls.dash.actor.set_width(width);

        // This force the recalculation of the icon size
        Main.overview._controls.dash._maxHeight = -1;
    },

    /**
     * Isolate overview to open new windows for inactive apps
     */
    _optionalWorkspaceIsolation: function() {
        let label = 'optionalWorkspaceIsolation';
        
        this._signalsHandler.add([
            this._dtpSettings,
            'changed::isolate-workspaces',
            Lang.bind(this, function() {
                this._panel.panelManager.allPanels.forEach(p => p.taskbar.resetAppIcons());

                if (this._dtpSettings.get_boolean('isolate-workspaces'))
                    Lang.bind(this, enable)();
                else
                    Lang.bind(this, disable)();
            })
        ]);

        if (this._dtpSettings.get_boolean('isolate-workspaces'))
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
            let windows = this.get_windows().filter(function(w) {
                return w.get_workspace().index() == Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace_index();
            });
            if (windows.length == 1)
                if (windows[0].skip_taskbar)
                    return this.open_new_window(-1);

            if (this.is_on_workspace(Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace()))
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

            if (this._dtpSettings.get_boolean('shortcut-previews') && windowCount > 1) {
                if (this._currentHotkeyFocusIndex < 0) {
                    let currentWindow = appIcon.window;
                    let keyFocusOutId = appIcon.actor.connect('key-focus-out', () => appIcon.actor.grab_key_focus());
                    let capturedEventId = global.stage.connect('captured-event', (actor, e) => {
                        if (e.type() == Clutter.EventType.KEY_RELEASE && e.get_key_symbol() == Clutter.Super_L) {
                            global.stage.disconnect(capturedEventId);
                            appIcon.actor.disconnect(keyFocusOutId);

                            appIcon._previewMenu.activateFocused();
                            appIcon.window = currentWindow;
                            delete appIcon._hotkeysCycle;
                            this._currentHotkeyFocusIndex = -1;
                        }
    
                        return Clutter.EVENT_PROPAGATE;
                    });

                    appIcon._hotkeysCycle = appIcon.window;
                    appIcon.window = null;
                    appIcon._previewMenu.open(appIcon);
                    appIcon.actor.grab_key_focus();
                }
                
                this._currentHotkeyFocusIndex = appIcon._previewMenu.focusNext();
            } else {
                // Activate with button = 1, i.e. same as left click
                let button = 1;
                appIcon.activate(button, true);
            }
        }
    },

    _optionalHotKeys: function() {
        this._hotKeysEnabled = false;
        if (this._dtpSettings.get_boolean('hot-keys'))
            this._enableHotKeys();

        this._signalsHandler.add([
            this._dtpSettings,
            'changed::hot-keys',
            Lang.bind(this, function() {
                    if (this._dtpSettings.get_boolean('hot-keys'))
                        Lang.bind(this, this._enableHotKeys)();
                    else
                        Lang.bind(this, this._disableHotKeys)();
            })
        ]);
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
        let keys = ['app-hotkey-', 'app-shift-hotkey-', 'app-ctrl-hotkey-',  // Regular numbers
                    'app-hotkey-kp-', 'app-shift-hotkey-kp-', 'app-ctrl-hotkey-kp-']; // Key-pad numbers
        keys.forEach( function(key) {
            for (let i = 0; i < this._numHotkeys; i++) {
                let appNum = i;

                Utils.addKeybinding(key + (i + 1), this._dtpSettings, () => this._activateApp(appNum));
            }
        }, this);

        this._hotKeysEnabled = true;

        if (this._dtpSettings.get_string('hotkeys-overlay-combo') === 'ALWAYS')
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
        if (this._dtpSettings.get_boolean('hot-keys'))
            this._enableExtraShortcut();

        this._signalsHandler.add([
            this._dtpSettings,
            'changed::hot-keys',
            Lang.bind(this, this._checkHotkeysOptions)
        ], [
            this._dtpSettings,
            'changed::hotkeys-overlay-combo',
            Lang.bind(this, function() {
                if (this._dtpSettings.get_boolean('hot-keys') && this._dtpSettings.get_string('hotkeys-overlay-combo') === 'ALWAYS')
                    this.taskbar.toggleNumberOverlay(true);
                else
                    this.taskbar.toggleNumberOverlay(false);
            })
        ]);
    },

    _checkHotkeysOptions: function() {
        if (this._dtpSettings.get_boolean('hot-keys'))
            this._enableExtraShortcut();
        else
            this._disableExtraShortcut();
    },

    _enableExtraShortcut: function() {
        Utils.addKeybinding('shortcut', this._dtpSettings, () => this._showOverlay(true));
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

        let hotkey_option = this._dtpSettings.get_string('hotkeys-overlay-combo');

        if (hotkey_option === 'NEVER')
            return;

        if (hotkey_option === 'TEMPORARILY' || overlayFromShortcut)
            this.taskbar.toggleNumberOverlay(true);

        this._panel.intellihide.revealAndHold(Intellihide.Hold.TEMPORARY);

        let timeout = this._dtpSettings.get_int('overlay-timeout');
        
        if (overlayFromShortcut) {
            timeout = this._dtpSettings.get_int('shortcut-timeout');
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
