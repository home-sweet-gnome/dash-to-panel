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
const Convenience = Me.imports.convenience;
const Lang = imports.lang;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Mainloop = imports.mainloop;

const Meta = imports.gi.Meta;

const dtpOverview = new Lang.Class({
    Name: 'DashToPanel.Overview',

    _numHotkeys: 10,

    _init: function(settings) {
        this._dtpSettings = settings;
    },

    enable : function(taskbar) {
        this.taskbar = taskbar;

        this._injectionsHandler = new Convenience.InjectionsHandler();
        this._signalsHandler = new Convenience.GlobalSignalsHandler();

        // Hide usual Dash
        Main.overview._controls.dash.actor.hide();

        // Also set dash width to 1, so it's almost not taken into account by code
        // calculaing the reserved space in the overview. The reason to keep it at 1 is
        // to allow its visibility change to trigger an allocaion of the appGrid which
        // in turn is triggergin the appsIcon spring animation, required when no other
        // actors has this effect, i.e in horizontal mode and without the workspaceThumnails
        // 1 static workspace only)
        Main.overview._controls.dash.actor.set_width(1);

        this._optionalWorkspaceIsolation();
        this._optionalHotKeys();
        this._optionalNumberOverlay();
        this._bindSettingsChanges();
    },

    disable: function () {
        Main.overview._controls.dash.actor.show();
        Main.overview._controls.dash.actor.set_width(-1); //reset default dash size
        // This force the recalculation of the icon size
        Main.overview._controls.dash._maxHeight = -1;

        // reset stored icon size  to the default dash
        Main.overview.dashIconSize = Main.overview._controls.dash.iconSize;

        // Remove key bindings
        this._disableHotKeys();
        this._disableExtraShortcut();
    },

    _bindSettingsChanges: function() {
    },

    /**
     * Isolate overview to open new windows for inactive apps
     */
    _optionalWorkspaceIsolation: function() {

        let label = 'optionalWorkspaceIsolation';

        this._dtpSettings.connect('changed::isolate-workspaces', Lang.bind(this, function() {
            this.taskbar.resetAppIcons();
            if (this._dtpSettings.get_boolean('isolate-workspaces'))
                Lang.bind(this, enable)();
            else
                Lang.bind(this, disable)();
        }));

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
                global.screen,
                'restacked',
                Lang.bind(this.taskbar, this.taskbar._queueRedisplay)
            ]);
            this._signalsHandler.addWithLabel(label, [
                global.window_manager,
                'switch-workspace',
                Lang.bind(this.taskbar, this.taskbar._queueRedisplay)
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
                return w.get_workspace().index() == global.screen.get_active_workspace_index();
            });
            if (windows.length == 1)
                if (windows[0].skip_taskbar)
                    return this.open_new_window(-1);

            if (this.is_on_workspace(global.screen.get_active_workspace()))
                return Main.activateWindow(windows[0]);
            return this.open_new_window(-1);
        }
    },

    // Hotkeys
    _activateApp: function(appIndex) {
        let children = this.taskbar._box.get_children().filter(function(actor) {
                return actor.child &&
                       actor.child._delegate &&
                       actor.child._delegate.app;
        });

        // Apps currently in the taskbar
        let apps = children.map(function(actor) {
                return actor.child._delegate;
            });

        // Activate with button = 1, i.e. same as left click
        let button = 1;
        if (appIndex < apps.length)
            apps[appIndex].activate(button);
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
        ],[
            this._dtpSettings,
            'changed::hotkey-prefix-text',
            Lang.bind(this, this._checkHotkeyPrefix)
        ]);
    },

    _checkHotkeyPrefix: function() {
        let hotkeyPrefix = this._dtpSettings.get_string('hotkey-prefix-text');
        if (hotkeyPrefix == 'Super')
           hotkeyPrefix = '<Super>';
        else if (hotkeyPrefix == 'SuperAlt')
           hotkeyPrefix = '<Super><Alt>';
        let [, mods]       = Gtk.accelerator_parse(hotkeyPrefix);
        let [, shift_mods] = Gtk.accelerator_parse('<Shift>' + hotkeyPrefix);
        let [, ctrl_mods]  = Gtk.accelerator_parse('<Ctrl>'  + hotkeyPrefix);

        for (let i = 1; i <= this._numHotkeys; i++) {
            let number = i;
            if (number == 10)
                number = 0;
            let key    = Gdk.keyval_from_name(number.toString());
            let key_kp = Gdk.keyval_from_name('KP_' + number.toString());
            if (Gtk.accelerator_valid(key, mods)) {
                let shortcut    = Gtk.accelerator_name(key, mods);
                let shortcut_kp = Gtk.accelerator_name(key_kp, mods);

                // Setup shortcut strings
                this._dtpSettings.set_strv('app-hotkey-'    + i, [shortcut]);
                this._dtpSettings.set_strv('app-hotkey-kp-' + i, [shortcut_kp]);

                // With <Shift>
                shortcut    = Gtk.accelerator_name(key, shift_mods);
                shortcut_kp = Gtk.accelerator_name(key_kp, shift_mods);
                this._dtpSettings.set_strv('app-shift-hotkey-'    + i, [shortcut]);
                this._dtpSettings.set_strv('app-shift-hotkey-kp-' + i, [shortcut_kp]);

                // With <Control>
                shortcut    = Gtk.accelerator_name(key, ctrl_mods);
                shortcut_kp = Gtk.accelerator_name(key_kp, ctrl_mods);
                this._dtpSettings.set_strv('app-ctrl-hotkey-'    + i, [shortcut]);
                this._dtpSettings.set_strv('app-ctrl-hotkey-kp-' + i, [shortcut_kp]);
            }
            else {
                // Reset default settings for the relevant keys if the
                // accelerators are invalid
                let keys = ['app-hotkey-' + i, 'app-shift-hotkey-' + i, 'app-ctrl-hotkey-' + i,  // Regular numbers
                            'app-hotkey-kp-' + i, 'app-shift-hotkey-kp-' + i, 'app-ctrl-hotkey-kp-' + i]; // Key-pad numbers
                keys.forEach(function(val) {
                    this._dtpSettings.set_value(val, this._dtpSettings.get_default_value(val));
                }, this);
            }
        }
    },

    _enableHotKeys: function() {
        if (this._hotKeysEnabled)
            return;

        this._checkHotkeyPrefix();

        // Setup keyboard bindings for taskbar elements
        let keys = ['app-hotkey-', 'app-shift-hotkey-', 'app-ctrl-hotkey-',  // Regular numbers
                    'app-hotkey-kp-', 'app-shift-hotkey-kp-', 'app-ctrl-hotkey-kp-']; // Key-pad numbers
        keys.forEach( function(key) {
            for (let i = 0; i < this._numHotkeys; i++) {
                let appNum = i;
                Main.wm.addKeybinding(key + (i + 1), this._dtpSettings,
                                      Meta.KeyBindingFlags.NONE,
                                      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                                      Lang.bind(this, function() {
                                          this._activateApp(appNum);
                                          this._showOverlay();
                                      }));
            }
        }, this);

        this._hotKeysEnabled = true;
    },

    _disableHotKeys: function() {
        if (!this._hotKeysEnabled)
            return;

        let keys = ['app-hotkey-', 'app-shift-hotkey-', 'app-ctrl-hotkey-',  // Regular numbers
                    'app-hotkey-kp-', 'app-shift-hotkey-kp-', 'app-ctrl-hotkey-kp-']; // Key-pad numbers
        keys.forEach( function(key) {
            for (let i = 0; i < this._numHotkeys; i++)
                Main.wm.removeKeybinding(key + (i + 1));
        }, this);

        this._hotKeysEnabled = false;
    },

    _optionalNumberOverlay: function() {
        this._shortcutIsSet = false;
        // Enable extra shortcut
        if (this._dtpSettings.get_boolean('hot-keys'))
            this._enableExtraShortcut();

        this._signalsHandler.add([
            this._dtpSettings,
            'changed::hot-keys',
            Lang.bind(this, this._checkHotkeysOptions)
        ], [
            this._dtpSettings,
            'changed::hotkeys-overlay',
            Lang.bind(this, this._checkHotkeysOptions)
        ], [
            this._dtpSettings,
            'changed::shortcut-text',
            Lang.bind(this, this._checkHotkeysOptions)
        ]);
    },

    _checkHotkeysOptions: function() {
        if (this._dtpSettings.get_boolean('hot-keys'))
            this._enableExtraShortcut();
        else
            this._disableExtraShortcut();
    },

    _enableExtraShortcut: function() {
        let shortcut_is_valid = this._setShortcut();

        if (shortcut_is_valid && !this._shortcutIsSet) {
            Main.wm.addKeybinding('shortcut', this._dtpSettings,
                                  Meta.KeyBindingFlags.NONE,
                                  Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                                  Lang.bind(this, function() {
                                      this._overlayFromShortcut = true;
                                      this._showOverlay();
                                  }));
            this._shortcutIsSet = true;
        }
    },

    _setShortcut: function() {
        let shortcut_text = this._dtpSettings.get_string('shortcut-text');
        let [key, mods] = Gtk.accelerator_parse(shortcut_text);

        if (Gtk.accelerator_valid(key, mods)) {
            let shortcut = Gtk.accelerator_name(key, mods);
            this._dtpSettings.set_strv('shortcut', [shortcut]);
            return true;
        }
        else {
            this._dtpSettings.set_strv('shortcut', []);
            return false;
        }
    },

    _disableExtraShortcut: function() {
        if (this._shortcutIsSet) {
            Main.wm.removeKeybinding('shortcut');
            this._shortcutIsSet = false;
        }
    },

    _showOverlay: function() {
        if (this._dtpSettings.get_boolean('hotkeys-overlay') || this._overlayFromShortcut)
            this.taskbar.toggleNumberOverlay(true);

        // Restart the counting if the shortcut is pressed again
        if (this._numberOverlayTimeoutId) {
            Mainloop.source_remove(this._numberOverlayTimeoutId);
            this._numberOverlayTimeoutId = 0;
        }

        let timeout = this._dtpSettings.get_int('overlay-timeout');
        if (this._overlayFromShortcut) {
            timeout = this._dtpSettings.get_int('shortcut-timeout');
            this._overlayFromShortcut = false;
        }

        // Hide the overlay/dock after the timeout
        this._numberOverlayTimeoutId = Mainloop.timeout_add(timeout, Lang.bind(this, function() {
                this._numberOverlayTimeoutId = 0;
                this.taskbar.toggleNumberOverlay(false);
        }));
    }
});
