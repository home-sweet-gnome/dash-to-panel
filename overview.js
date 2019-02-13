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
const Mainloop = imports.mainloop;

const Meta = imports.gi.Meta;

var dtpOverview = Utils.defineClass({
    Name: 'DashToPanel.Overview',

    _numHotkeys: 10,

    _init: function(settings) {
        this._dtpSettings = settings;
    },

    enable : function(panel) {
        this._panel = panel;
        this.taskbar = panel.taskbar;

        this._injectionsHandler = new Utils.InjectionsHandler();
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._isolation = this._optionalWorkspaceIsolation();
        this._optionalHotKeys();
        this._optionalNumberOverlay();
        this._toggleDash();
        this._stockgsKeepDashId = this._dtpSettings.connect('changed::stockgs-keep-dash', () => this._toggleDash());
    },

    disable: function () {
        this._dtpSettings.disconnect(this._stockgsKeepDashId);
        
        this._toggleDash(true);

        // reset stored icon size  to the default dash
        Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;

        // Remove key bindings
        this._disableHotKeys();
        this._disableExtraShortcut();

        this._isolation.disable.apply(this);
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

        this._signalsHandler.addWithLabel(label, [
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

            this._signalsHandler.destroy();
            this._injectionsHandler.destroy();
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

        return { disable: disable };
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

        if (appIndex < apps.length) {
            let appIcon = apps[appIndex];
            let windowCount = !appIcon.window ? appIcon._nWindows : seenApps[appIcon.app];

            if (this._dtpSettings.get_boolean('shortcut-previews') && windowCount > 1) {
                let windowIndex = 0;
                let currentWindow = appIcon.window;
                let hotkeyPrefix = this._dtpSettings.get_string('hotkey-prefix-text');
                let shortcutKeys = (hotkeyPrefix == 'Super' ? [Clutter.Meta_L] : [Clutter.Meta_L, Clutter.Alt_L]).concat([Clutter['KEY_' + (appIndex + 1)]]);
                let currentKeys = shortcutKeys.slice();
                let setFocus = windowIndex => global.stage.set_key_focus(appIcon.windowPreview._previewBox.box.get_children()[windowIndex]);
                let capturedEventId = global.stage.connect('captured-event', (actor, event) => {
                    if (event.type() == Clutter.EventType.KEY_PRESS) {
                        let pressedKey = event.get_key_symbol();

                        if (shortcutKeys.indexOf(pressedKey) >= 0 && currentKeys.indexOf(pressedKey) < 0) {
                            currentKeys.push(pressedKey);

                            if (shortcutKeys.length === currentKeys.length) {
                                windowIndex = windowIndex < windowCount - 1 ? windowIndex + 1 : 0;
                                setFocus(windowIndex);
                            }
                        } 
                    } else if (event.type() == Clutter.EventType.KEY_RELEASE) {
                        let keyIndex = currentKeys.indexOf(event.get_key_symbol());

                        if (keyIndex >= 0) {
                            currentKeys.splice(keyIndex, 1);
                        }
                    }

                    return Clutter.EVENT_PROPAGATE;
                });
                let hotkeyOpenStateChangedId = appIcon.windowPreview.connect('open-state-changed', (menu, isOpen) => {
                    if (!isOpen) {
                        global.stage.disconnect(capturedEventId);
                        appIcon.windowPreview.disconnect(hotkeyOpenStateChangedId);
                        appIcon.windowPreview._previewBox._resetPreviews();
                        appIcon.window = currentWindow;
                    }
                });

                appIcon.window = null;
                appIcon.windowPreview.popup();
                appIcon.menuManagerWindowPreview._onMenuOpenState(appIcon.windowPreview, true);
                setFocus(windowIndex);
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

        // Setup keyboard bindings for taskbar elements
        let keys = ['app-hotkey-', 'app-shift-hotkey-', 'app-ctrl-hotkey-',  // Regular numbers
                    'app-hotkey-kp-', 'app-shift-hotkey-kp-', 'app-ctrl-hotkey-kp-']; // Key-pad numbers
        keys.forEach( function(key) {
            for (let i = 0; i < this._numHotkeys; i++) {
                let appNum = i;

                if (!Main.wm._allowedKeybindings[key + (i + 1)]) {
                    Main.wm.addKeybinding(key + (i + 1), this._dtpSettings,
                                        Meta.KeyBindingFlags.NONE,
                                        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                                        Lang.bind(this, function() {
                                            this._activateApp(appNum);
                                            this._showOverlay();
                                        }));
                }
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
                if (Main.wm._allowedKeybindings[key + (i + 1)]) {
                    Main.wm.removeKeybinding(key + (i + 1));
                }
            }
        }, this);

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
        if (!Main.wm._allowedKeybindings['shortcut']) {
            Main.wm.addKeybinding('shortcut', this._dtpSettings,
                                  Meta.KeyBindingFlags.NONE,
                                  Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                                  Lang.bind(this, function() {
                                      this._showOverlay(true);
                                  }));
        }
    },

    _disableExtraShortcut: function() {
        if (Main.wm._allowedKeybindings['shortcut']) {
            Main.wm.removeKeybinding('shortcut');
        }
    },

    _showOverlay: function(overlayFromShortcut) {
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
