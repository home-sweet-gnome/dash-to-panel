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
 *
 * Credits:
 * This file is based on code from the Dash to Dock extension by micheleg.
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Gettext = imports.gettext.domain('dash-to-panel');
const _ = Gettext.gettext;
const N_ = function(e) { return e };

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const SCALE_UPDATE_TIMEOUT = 500;
const DEFAULT_PANEL_SIZES = [ 128, 96, 64, 48, 32, 24, 16 ];
const DEFAULT_FONT_SIZES = [ 96, 64, 48, 32, 24, 16, 0 ];
const DEFAULT_MARGIN_SIZES = [ 32, 24, 16, 12, 8, 4, 0 ];
const DEFAULT_PADDING_SIZES = [ 32, 24, 16, 12, 8, 4, 0, -1 ];
const MAX_WINDOW_INDICATOR = 4;

const SCHEMA_PATH = '/org/gnome/shell/extensions/dash-to-panel/';
const UUID = 'dash-to-panel@jderose9.github.com';
const GSET = 'gnome-shell-extension-tool';

/**
 * This function was copied from the activities-config extension
 * https://github.com/nls1729/acme-code/tree/master/activities-config
 * by Norman L. Smith.
 */
function cssHexString(css) {
    let rrggbb = '#';
    let start;
    for (let loop = 0; loop < 3; loop++) {
        let end = 0;
        let xx = '';
        for (let loop = 0; loop < 2; loop++) {
            while (true) {
                let x = css.slice(end, end + 1);
                if ((x == '(') || (x == ',') || (x == ')'))
                    break;
                end++;
            }
            if (loop == 0) {
                end++;
                start = end;
            }
        }
        xx = parseInt(css.slice(start, end)).toString(16);
        if (xx.length == 1)
            xx = '0' + xx;
        rrggbb += xx;
        css = css.slice(end);
    }
    return rrggbb;
}

function setShortcut(settings, shortcutName) {
    let shortcut_text = settings.get_string(shortcutName + '-text');
    let [key, mods] = Gtk.accelerator_parse(shortcut_text);

    if (Gtk.accelerator_valid(key, mods)) {
        let shortcut = Gtk.accelerator_name(key, mods);
        settings.set_strv(shortcutName, [shortcut]);
    }
    else {
        settings.set_strv(shortcutName, []);
    }
}

function checkHotkeyPrefix(settings) {
    settings.delay();

    let hotkeyPrefix = settings.get_string('hotkey-prefix-text');
    if (hotkeyPrefix == 'Super')
       hotkeyPrefix = '<Super>';
    else if (hotkeyPrefix == 'SuperAlt')
       hotkeyPrefix = '<Super><Alt>';
    let [, mods]       = Gtk.accelerator_parse(hotkeyPrefix);
    let [, shift_mods] = Gtk.accelerator_parse('<Shift>' + hotkeyPrefix);
    let [, ctrl_mods]  = Gtk.accelerator_parse('<Ctrl>'  + hotkeyPrefix);

    let numHotkeys = 10;
    for (let i = 1; i <= numHotkeys; i++) {
        let number = i;
        if (number == 10)
            number = 0;
        let key    = Gdk.keyval_from_name(number.toString());
        let key_kp = Gdk.keyval_from_name('KP_' + number.toString());
        if (Gtk.accelerator_valid(key, mods)) {
            let shortcut    = Gtk.accelerator_name(key, mods);
            let shortcut_kp = Gtk.accelerator_name(key_kp, mods);

            // Setup shortcut strings
            settings.set_strv('app-hotkey-'    + i, [shortcut]);
            settings.set_strv('app-hotkey-kp-' + i, [shortcut_kp]);

            // With <Shift>
            shortcut    = Gtk.accelerator_name(key, shift_mods);
            shortcut_kp = Gtk.accelerator_name(key_kp, shift_mods);
            settings.set_strv('app-shift-hotkey-'    + i, [shortcut]);
            settings.set_strv('app-shift-hotkey-kp-' + i, [shortcut_kp]);

            // With <Control>
            shortcut    = Gtk.accelerator_name(key, ctrl_mods);
            shortcut_kp = Gtk.accelerator_name(key_kp, ctrl_mods);
            settings.set_strv('app-ctrl-hotkey-'    + i, [shortcut]);
            settings.set_strv('app-ctrl-hotkey-kp-' + i, [shortcut_kp]);
        }
        else {
            // Reset default settings for the relevant keys if the
            // accelerators are invalid
            let keys = ['app-hotkey-' + i, 'app-shift-hotkey-' + i, 'app-ctrl-hotkey-' + i,  // Regular numbers
                        'app-hotkey-kp-' + i, 'app-shift-hotkey-kp-' + i, 'app-ctrl-hotkey-kp-' + i]; // Key-pad numbers
            keys.forEach(function(val) {
                settings.set_value(val, settings.get_default_value(val));
            }, this);
        }
    }

    settings.apply();
}

function mergeObjects(main, bck) {
    for (var prop in bck) {
        if (!main.hasOwnProperty(prop) && bck.hasOwnProperty(prop)) {
            main[prop] = bck[prop];
        }
    }

    return main;
};

const Settings = new Lang.Class({
    Name: 'DashToPanel.Settings',

    _init: function() {
        this._settings = Convenience.getSettings('org.gnome.shell.extensions.dash-to-panel');

        this._rtl = (Gtk.Widget.get_default_direction() == Gtk.TextDirection.RTL);

        this._builder = new Gtk.Builder();
        this._builder.set_translation_domain(Me.metadata['gettext-domain']);
        this._builder.add_from_file(Me.path + '/Settings.ui');

        this.notebook = this._builder.get_object('settings_notebook');
        this.viewport = new Gtk.Viewport();
        this.viewport.add(this.notebook);
        this.widget = new Gtk.ScrolledWindow();
        this.widget.add(this.viewport);
        

        // Timeout to delay the update of the settings
        this._panel_size_timeout = 0;
        this._dot_height_timeout = 0;
        this._tray_size_timeout = 0;
        this._leftbox_size_timeout = 0;
        this._appicon_margin_timeout = 0;
        this._appicon_padding_timeout = 0;
        this._opacity_timeout = 0;
        this._tray_padding_timeout = 0;
        this._statusicon_padding_timeout = 0;
        this._leftbox_padding_timeout = 0;

        this._bindSettings();

        this._builder.connect_signals_full(Lang.bind(this, this._connector));
    },

    /**
     * Connect signals
     */
    _connector: function(builder, object, signal, handler) {
        object.connect(signal, Lang.bind(this, this._SignalHandler[handler]));
    },

    _bindSettings: function() {
        // Position and style panel

        // Position option
        let position = this._settings.get_string('panel-position');

        switch (position) {
            case 'BOTTOM':
                this._builder.get_object('position_bottom_button').set_active(true);
                break;
            case 'TOP':
                this._builder.get_object('position_top_button').set_active(true);
                break;

        }

        this._builder.get_object('location_clock_combo').set_active_id(this._settings.get_string('location-clock'));
        this._builder.get_object('location_clock_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('location-clock', widget.get_active_id());
        }));
        this._builder.get_object('taskbar_position_combo').set_active_id(this._settings.get_string('taskbar-position'));
        this._builder.get_object('taskbar_position_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('taskbar-position', widget.get_active_id());
        }));

        // size options
        let panel_size_scale = this._builder.get_object('panel_size_scale');
        panel_size_scale.set_range(DEFAULT_PANEL_SIZES[DEFAULT_PANEL_SIZES.length-1], DEFAULT_PANEL_SIZES[0]);
        panel_size_scale.set_value(this._settings.get_int('panel-size'));
        DEFAULT_PANEL_SIZES.slice(1, -1).forEach(function(val) {
             panel_size_scale.add_mark(val, Gtk.PositionType.TOP, val.toString());
        });

        // Corrent for rtl languages
        if (this._rtl) {
            // Flip value position: this is not done automatically
            panel_size_scale.set_value_pos(Gtk.PositionType.LEFT);
            // I suppose due to a bug, having a more than one mark and one above a value of 100
            // makes the rendering of the marks wrong in rtl. This doesn't happen setting the scale as not flippable
            // and then manually inverting it
            panel_size_scale.set_flippable(false);
            panel_size_scale.set_inverted(true);
        }

        // Dots Position option
        let dotPosition = this._settings.get_string('dot-position');

        switch (dotPosition) {
            case 'BOTTOM':
                this._builder.get_object('dots_bottom_button').set_active(true);
                break;
            case 'TOP':
                this._builder.get_object('dots_top_button').set_active(true);
                break;

        }

        this._builder.get_object('dot_style_focused_combo').set_active_id(this._settings.get_string('dot-style-focused'));
        this._builder.get_object('dot_style_focused_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('dot-style-focused', widget.get_active_id());
        }));

        this._builder.get_object('dot_style_unfocused_combo').set_active_id(this._settings.get_string('dot-style-unfocused'));
        this._builder.get_object('dot_style_unfocused_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('dot-style-unfocused', widget.get_active_id());
        }));

        for (let i = 1; i <= MAX_WINDOW_INDICATOR; i++) {
            let idx = i;
            this._builder.get_object('dot_color_' + idx + '_colorbutton').connect('notify::color', Lang.bind(this, function(button) {
                let rgba = button.get_rgba();
                let css = rgba.to_string();
                let hexString = cssHexString(css);
                this._settings.set_string('dot-color-' + idx, hexString);
            }));

            this._builder.get_object('dot_color_unfocused_' + idx + '_colorbutton').connect('notify::color', Lang.bind(this, function(button) {
                let rgba = button.get_rgba();
                let css = rgba.to_string();
                let hexString = cssHexString(css);
                this._settings.set_string('dot-color-unfocused-' + idx, hexString);
            }));
        }

        this._builder.get_object('dot_color_apply_all_button').connect('clicked', Lang.bind(this, function() {
            for (let i = 2; i <= MAX_WINDOW_INDICATOR; i++) {
                this._settings.set_value('dot-color-' + i, this._settings.get_value('dot-color-1'));
                let rgba = new Gdk.RGBA();
                rgba.parse(this._settings.get_string('dot-color-' + i));
                this._builder.get_object('dot_color_' + i + '_colorbutton').set_rgba(rgba);
            }
        }));

        this._builder.get_object('dot_color_unfocused_apply_all_button').connect('clicked', Lang.bind(this, function() {
            for (let i = 2; i <= MAX_WINDOW_INDICATOR; i++) {
                this._settings.set_value('dot-color-unfocused-' + i, this._settings.get_value('dot-color-unfocused-1'));
                let rgba = new Gdk.RGBA();
                rgba.parse(this._settings.get_string('dot-color-unfocused-' + i));
                this._builder.get_object('dot_color_unfocused_' + i + '_colorbutton').set_rgba(rgba);
            }
        }));

        this._builder.get_object('focus_highlight_color_colorbutton').connect('notify::color', Lang.bind(this, function(button) {
            let rgba = button.get_rgba();
            let css = rgba.to_string();
            let hexString = cssHexString(css);
            this._settings.set_string('focus-highlight-color', hexString);
        }));

        this._builder.get_object('dot_style_options_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Running Indicator Options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_dots_options');
            dialog.get_content_area().add(box);

            this._settings.bind('dot-color-override',
                            this._builder.get_object('dot_color_override_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('dot-color-unfocused-different',
                            this._builder.get_object('dot_color_unfocused_different_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('dot-color-override',
                                this._builder.get_object('grid_dot_color'),
                                'sensitive',
                                Gio.SettingsBindFlags.DEFAULT);
            
            this._settings.bind('dot-color-override',
                                this._builder.get_object('dot_color_unfocused_box'),
                                'sensitive',
                                Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('dot-color-unfocused-different',
                                this._builder.get_object('grid_dot_color_unfocused'),
                                'sensitive',
                                Gio.SettingsBindFlags.DEFAULT);
            
            for (let i = 1; i <= MAX_WINDOW_INDICATOR; i++) {
                let rgba = new Gdk.RGBA();
                rgba.parse(this._settings.get_string('dot-color-' + i));
                this._builder.get_object('dot_color_' + i + '_colorbutton').set_rgba(rgba);

                rgba = new Gdk.RGBA();
                rgba.parse(this._settings.get_string('dot-color-unfocused-' + i));
                this._builder.get_object('dot_color_unfocused_' + i + '_colorbutton').set_rgba(rgba);
            }

            this._settings.bind('focus-highlight',
                    this._builder.get_object('focus_highlight_switch'),
                    'active',
                    Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('focus-highlight',
                    this._builder.get_object('grid_focus_highlight_options'),
                    'sensitive',
                    Gio.SettingsBindFlags.DEFAULT);

            (function() {
                let rgba = new Gdk.RGBA();
                rgba.parse(this._settings.get_string('focus-highlight-color'));
                this._builder.get_object('focus_highlight_color_colorbutton').set_rgba(rgba);
            }).apply(this);

            this._builder.get_object('focus_highlight_opacity_spinbutton').set_value(this._settings.get_int('focus-highlight-opacity'));
            this._builder.get_object('focus_highlight_opacity_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('focus-highlight-opacity', widget.get_value());
            }));

            this._builder.get_object('dot_size_spinbutton').set_value(this._settings.get_int('dot-size'));
            this._builder.get_object('dot_size_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('dot-size', widget.get_value());
            }));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('dot-color-override', this._settings.get_default_value('dot-color-override'));
                    this._settings.set_value('dot-color-unfocused-different', this._settings.get_default_value('dot-color-unfocused-different'));

                    this._settings.set_value('focus-highlight-color', this._settings.get_default_value('focus-highlight-color'));
                    let rgba = new Gdk.RGBA();
                    rgba.parse(this._settings.get_string('focus-highlight-color'));
                    this._builder.get_object('focus_highlight_color_colorbutton').set_rgba(rgba);

                    this._settings.set_value('focus-highlight-opacity', this._settings.get_default_value('focus-highlight-opacity'));
                    this._builder.get_object('focus_highlight_opacity_spinbutton').set_value(this._settings.get_int('focus-highlight-opacity'));

                    for (let i = 1; i <= MAX_WINDOW_INDICATOR; i++) {
                        this._settings.set_value('dot-color-' + i, this._settings.get_default_value('dot-color-' + i));
                        rgba = new Gdk.RGBA();
                        rgba.parse(this._settings.get_string('dot-color-' + i));
                        this._builder.get_object('dot_color_' + i + '_colorbutton').set_rgba(rgba);

                        this._settings.set_value('dot-color-unfocused-' + i, this._settings.get_default_value('dot-color-unfocused-' + i));
                        rgba = new Gdk.RGBA();
                        rgba.parse(this._settings.get_string('dot-color-unfocused-' + i));
                        this._builder.get_object('dot_color_unfocused_' + i + '_colorbutton').set_rgba(rgba);
                    }

                    this._settings.set_value('dot-size', this._settings.get_default_value('dot-size'));
                    this._builder.get_object('dot_size_spinbutton').set_value(this._settings.get_int('dot-size'));
                   
                    this._settings.set_value('focus-highlight', this._settings.get_default_value('focus-highlight'));

                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));

        //multi-monitor
        let monitors = [-1];

        this._builder.get_object('multimon_primary_combo').append_text(_('Default (Primary monitor)'));

        for (let i = 0, monitorNum = Gdk.Screen.get_default().get_n_monitors(); i < monitorNum; ++i) {
            this._builder.get_object('multimon_primary_combo').append_text(_('Monitor ') + (i+1));
            monitors.push(i);
        }

        this._builder.get_object('multimon_primary_combo').set_active(monitors.indexOf(this._settings.get_int('primary-monitor')));
        this._builder.get_object('multimon_primary_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_int('primary-monitor', monitors[widget.get_active()]);
        }));

        this._settings.bind('multi-monitors',
                            this._builder.get_object('multimon_multi_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('multi-monitors',
                            this._builder.get_object('multimon_multi_options_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('isolate-monitors',
                            this._builder.get_object('multimon_multi_isolate_monitor_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-clock-all-monitors',
                            this._builder.get_object('multimon_multi_show_clock_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT); 

        this._settings.bind('show-status-menu-all-monitors',
                            this._builder.get_object('multimon_multi_show_status_menu_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT); 

        this._settings.bind('show-favorites-all-monitors',
                            this._builder.get_object('multimon_multi_show_favorites_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT); 

        if (monitors.length === 1) {
            this._builder.get_object('multimon_listbox').set_sensitive(false);
            this._builder.get_object('multimon_multi_switch').set_active(false);
        }
        
        this._builder.get_object('multimon_multi_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Multi-monitors options'),
                                            transient_for: this.widget.get_toplevel(),
                                            use_header_bar: true,
                                            modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_multimon_multi_options');
            dialog.get_content_area().add(box);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('isolate-monitors', this._settings.get_default_value('isolate-monitors'));
                    this._settings.set_value('show-favorites-all-monitors', this._settings.get_default_value('show-favorites-all-monitors'));
                    this._settings.set_value('show-clock-all-monitors', this._settings.get_default_value('show-clock-all-monitors'));
                    this._settings.set_value('show-status-menu-all-monitors', this._settings.get_default_value('show-status-menu-all-monitors'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();
        }));

        //dynamic opacity
        this._settings.bind('trans-use-custom-bg',
                            this._builder.get_object('trans_bg_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('trans-use-custom-bg',
                            this._builder.get_object('trans_bg_color_colorbutton'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        let rgba = new Gdk.RGBA();
        rgba.parse(this._settings.get_string('trans-bg-color'));
        this._builder.get_object('trans_bg_color_colorbutton').set_rgba(rgba);

        this._builder.get_object('trans_bg_color_colorbutton').connect('notify::color', Lang.bind(this, function (button) {
            let rgba = button.get_rgba();
            let css = rgba.to_string();
            let hexString = cssHexString(css);
            this._settings.set_string('trans-bg-color', hexString);
        }));

        this._settings.bind('trans-use-custom-opacity',
                            this._builder.get_object('trans_opacity_override_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('trans-use-custom-opacity',
                            this._builder.get_object('trans_opacity_box'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('trans_opacity_override_switch').connect('notify::active', (widget) => {
            if (!widget.get_active())
                this._builder.get_object('trans_dyn_switch').set_active(false);
        });

        this._builder.get_object('trans_opacity_spinbutton').set_value(this._settings.get_double('trans-panel-opacity') * 100);
        this._builder.get_object('trans_opacity_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_double('trans-panel-opacity', widget.get_value() * 0.01);
        }));

        this._settings.bind('trans-use-dynamic-opacity',
                            this._builder.get_object('trans_dyn_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('trans-use-dynamic-opacity',
                            this._builder.get_object('trans_dyn_options_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('trans-dynamic-behavior',
                            this._builder.get_object('trans_options_window_type_combo'),
                            'active-id',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('trans-use-custom-gradient',
                            this._builder.get_object('trans_gradient_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('trans-use-custom-gradient',
                            this._builder.get_object('trans_gradient_box'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        rgba.parse(this._settings.get_string('trans-gradient-top-color'));
        this._builder.get_object('trans_gradient_color1_colorbutton').set_rgba(rgba);

        this._builder.get_object('trans_gradient_color1_colorbutton').connect('notify::color', Lang.bind(this, function (button) {
            let rgba = button.get_rgba();
            let css = rgba.to_string();
            let hexString = cssHexString(css);
            this._settings.set_string('trans-gradient-top-color', hexString);
        }));

        this._builder.get_object('trans_gradient_color1_spinbutton').set_value(this._settings.get_double('trans-gradient-top-opacity') * 100);
        this._builder.get_object('trans_gradient_color1_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_double('trans-gradient-top-opacity', widget.get_value() * 0.01);
        }));

        rgba.parse(this._settings.get_string('trans-gradient-bottom-color'));
        this._builder.get_object('trans_gradient_color2_colorbutton').set_rgba(rgba);

        this._builder.get_object('trans_gradient_color2_colorbutton').connect('notify::color', Lang.bind(this, function (button) {
            let rgba = button.get_rgba();
            let css = rgba.to_string();
            let hexString = cssHexString(css);
            this._settings.set_string('trans-gradient-bottom-color', hexString);
        }));

        this._builder.get_object('trans_gradient_color2_spinbutton').set_value(this._settings.get_double('trans-gradient-bottom-opacity') * 100);
        this._builder.get_object('trans_gradient_color2_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_double('trans-gradient-bottom-opacity', widget.get_value() * 0.01);
        }));

        this._builder.get_object('trans_options_distance_spinbutton').set_value(this._settings.get_int('trans-dynamic-distance'));
        this._builder.get_object('trans_options_distance_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_int('trans-dynamic-distance', widget.get_value());
        }));
        
        this._builder.get_object('trans_options_min_opacity_spinbutton').set_value(this._settings.get_double('trans-dynamic-anim-target') * 100);
        this._builder.get_object('trans_options_min_opacity_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_double('trans-dynamic-anim-target', widget.get_value() * 0.01);
        }));

        this._builder.get_object('trans_options_anim_time_spinbutton').set_value(this._settings.get_int('trans-dynamic-anim-time'));
        this._builder.get_object('trans_options_anim_time_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_int('trans-dynamic-anim-time', widget.get_value());
        }));

        this._builder.get_object('trans_dyn_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Dynamic opacity options'),
                                            transient_for: this.widget.get_toplevel(),
                                            use_header_bar: true,
                                            modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_dynamic_opacity_options');
            dialog.get_content_area().add(box);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('trans-dynamic-behavior', this._settings.get_default_value('trans-dynamic-behavior'));

                    this._settings.set_value('trans-dynamic-distance', this._settings.get_default_value('trans-dynamic-distance'));
                    this._builder.get_object('trans_options_distance_spinbutton').set_value(this._settings.get_int('trans-dynamic-distance'));

                    this._settings.set_value('trans-dynamic-anim-target', this._settings.get_default_value('trans-dynamic-anim-target'));
                    this._builder.get_object('trans_options_min_opacity_spinbutton').set_value(this._settings.get_double('trans-dynamic-anim-target') * 100);

                    this._settings.set_value('trans-dynamic-anim-time', this._settings.get_default_value('trans-dynamic-anim-time'));
                    this._builder.get_object('trans_options_anim_time_spinbutton').set_value(this._settings.get_int('trans-dynamic-anim-time'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));


        this._settings.bind('intellihide',
                            this._builder.get_object('intellihide_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide',
                            this._builder.get_object('intellihide_options_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-hide-from-windows',
                            this._builder.get_object('intellihide_window_hide_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-hide-from-windows',
                            this._builder.get_object('intellihide_behaviour_options'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-behaviour',
                            this._builder.get_object('intellihide_behaviour_combo'),
                            'active-id',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-use-pressure',
                            this._builder.get_object('intellihide_use_pressure_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT); 

        this._settings.bind('intellihide-use-pressure',
                            this._builder.get_object('intellihide_use_pressure_options'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-show-in-fullscreen',
                            this._builder.get_object('intellihide_show_in_fullscreen_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('intellihide-only-secondary',
                            this._builder.get_object('intellihide_only_secondary_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('multi-monitors',
                            this._builder.get_object('grid_intellihide_only_secondary'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('multimon_multi_switch').connect('notify::active', (widget) => {
            if (!widget.get_active())
                this._builder.get_object('intellihide_only_secondary_switch').set_active(false);
        });

        this._builder.get_object('intellihide_pressure_threshold_spinbutton').set_value(this._settings.get_int('intellihide-pressure-threshold'));
        this._builder.get_object('intellihide_pressure_threshold_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_int('intellihide-pressure-threshold', widget.get_value());
        }));

        this._builder.get_object('intellihide_pressure_time_spinbutton').set_value(this._settings.get_int('intellihide-pressure-time'));
        this._builder.get_object('intellihide_pressure_time_spinbutton').connect('value-changed', Lang.bind(this, function (widget) {
            this._settings.set_int('intellihide-pressure-time', widget.get_value());
        }));

        this._settings.bind('intellihide-key-toggle-text',
                             this._builder.get_object('intellihide_toggle_entry'),
                             'text',
                             Gio.SettingsBindFlags.DEFAULT);
        this._settings.connect('changed::intellihide-key-toggle-text', () => setShortcut(this._settings, 'intellihide-key-toggle'));

        this._builder.get_object('intellihide_animation_time_spinbutton').set_value(this._settings.get_int('intellihide-animation-time'));
        this._builder.get_object('intellihide_animation_time_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
            this._settings.set_int('intellihide-animation-time', widget.get_value());
        }));

        this._builder.get_object('intellihide_close_delay_spinbutton').set_value(this._settings.get_int('intellihide-close-delay'));
        this._builder.get_object('intellihide_close_delay_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
            this._settings.set_int('intellihide-close-delay', widget.get_value());
        }));

        this._builder.get_object('intellihide_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Intellihide options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_intellihide_options');
            dialog.get_content_area().add(box);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('intellihide-hide-from-windows', this._settings.get_default_value('intellihide-hide-from-windows'));
                    this._settings.set_value('intellihide-behaviour', this._settings.get_default_value('intellihide-behaviour'));
                    this._settings.set_value('intellihide-use-pressure', this._settings.get_default_value('intellihide-use-pressure'));
                    this._settings.set_value('intellihide-show-in-fullscreen', this._settings.get_default_value('intellihide-show-in-fullscreen'));
                    this._settings.set_value('intellihide-only-secondary', this._settings.get_default_value('intellihide-only-secondary'));

                    this._settings.set_value('intellihide-pressure-threshold', this._settings.get_default_value('intellihide-pressure-threshold'));
                    this._builder.get_object('intellihide_pressure_threshold_spinbutton').set_value(this._settings.get_int('intellihide-pressure-threshold'));
                    
                    this._settings.set_value('intellihide-pressure-time', this._settings.get_default_value('intellihide-pressure-time'));
                    this._builder.get_object('intellihide_pressure_time_spinbutton').set_value(this._settings.get_int('intellihide-pressure-time'));

                    this._settings.set_value('intellihide-key-toggle-text', this._settings.get_default_value('intellihide-key-toggle-text'));

                    this._settings.set_value('intellihide-animation-time', this._settings.get_default_value('intellihide-animation-time'));
                    this._builder.get_object('intellihide_animation_time_spinbutton').set_value(this._settings.get_int('intellihide-animation-time'));

                    this._settings.set_value('intellihide-close-delay', this._settings.get_default_value('intellihide-close-delay'));
                    this._builder.get_object('intellihide_close_delay_spinbutton').set_value(this._settings.get_int('intellihide-close-delay'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));

        // Behavior panel

        this._settings.bind('show-show-apps-button',
                            this._builder.get_object('show_applications_button_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-show-apps-button',
                            this._builder.get_object('show_application_options_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
        
        this._builder.get_object('show_applications_side_padding_spinbutton').set_value(this._settings.get_int('show-apps-icon-side-padding'));
        this._builder.get_object('show_applications_side_padding_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
            this._settings.set_int('show-apps-icon-side-padding', widget.get_value());
        }));

        this._builder.get_object('show_application_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Show Applications options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('show_applications_options');
            dialog.get_content_area().add(box);

            let fileChooser = this._builder.get_object('show_applications_icon_file_filebutton');
            let fileImage = this._builder.get_object('show_applications_current_icon_image');
            let fileFilter = new Gtk.FileFilter();
            let handleIconChange = function(newIconPath) {
                if (newIconPath && GLib.file_test(newIconPath, GLib.FileTest.EXISTS)) {
                    let file = Gio.File.new_for_path(newIconPath)
                    let pixbuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale(file.read(null), 32, 32, true, null);

                    fileImage.set_from_pixbuf(pixbuf);
                    fileChooser.set_filename(newIconPath);
                } else {
                    newIconPath = '';
                    fileImage.set_from_icon_name('view-app-grid-symbolic', 32);
                    fileChooser.unselect_all();
                    fileChooser.set_current_folder(GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES));
                }

                this._settings.set_string('show-apps-icon-file', newIconPath || '');
            };
            
            fileFilter.add_pixbuf_formats();
            fileChooser.filter = fileFilter;

            fileChooser.connect('file-set', widget => handleIconChange.call(this, widget.get_filename()));
            handleIconChange.call(this, this._settings.get_string('show-apps-icon-file'));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('show-apps-icon-side-padding', this._settings.get_default_value('show-apps-icon-side-padding'));
                    this._builder.get_object('show_applications_side_padding_spinbutton').set_value(this._settings.get_int('show-apps-icon-side-padding'));
                    handleIconChange.call(this, null);
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();
        }));

        this._settings.bind('animate-show-apps',
                            this._builder.get_object('application_button_animation_button'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('show-show-apps-button',
                            this._builder.get_object('application_button_animation_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('show-activities-button',
                            this._builder.get_object('show_activities_button_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('show-showdesktop-button',
                            this._builder.get_object('show_showdesktop_button_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('show-showdesktop-button',
                            this._builder.get_object('show_showdesktop_options_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-showdesktop-hover',
                            this._builder.get_object('show_showdesktop_hide_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-showdesktop-hover',
                            this._builder.get_object('grid_show_showdesktop_hide_options'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('show_showdesktop_options_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Show Desktop options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_show_showdesktop_options');
            dialog.get_content_area().add(box);

            this._builder.get_object('show_showdesktop_width_spinbutton').set_value(this._settings.get_int('showdesktop-button-width'));
            this._builder.get_object('show_showdesktop_width_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('showdesktop-button-width', widget.get_value());
            }));

            this._builder.get_object('show_showdesktop_delay_spinbutton').set_value(this._settings.get_int('show-showdesktop-delay'));
            this._builder.get_object('show_showdesktop_delay_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('show-showdesktop-delay', widget.get_value());
            }));

            this._builder.get_object('show_showdesktop_time_spinbutton').set_value(this._settings.get_int('show-showdesktop-time'));
            this._builder.get_object('show_showdesktop_time_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('show-showdesktop-time', widget.get_value());
            }));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('showdesktop-button-width', this._settings.get_default_value('showdesktop-button-width'));
                    this._builder.get_object('show_showdesktop_width_spinbutton').set_value(this._settings.get_int('showdesktop-button-width'));
                    this._builder.get_object('show_showdesktop_delay_spinbutton').set_value(this._settings.get_int('show-showdesktop-delay'));
                    this._builder.get_object('show_showdesktop_time_spinbutton').set_value(this._settings.get_int('show-showdesktop-time'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();
        }));

        this._settings.bind('show-appmenu',
                            this._builder.get_object('show_appmenu_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-window-previews',
                            this._builder.get_object('show_window_previews_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-window-previews',
                            this._builder.get_object('show_window_previews_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-tooltip',
                            this._builder.get_object('show_tooltip_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-favorites',
                            this._builder.get_object('show_favorite_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('show_window_previews_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Window preview options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_window_preview_options');
            dialog.get_content_area().add(box);

            this._builder.get_object('preview_timeout_spinbutton').set_value(this._settings.get_int('show-window-previews-timeout'));
            this._builder.get_object('preview_timeout_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('show-window-previews-timeout', widget.get_value());
            }));

            this._settings.bind('peek-mode',
                            this._builder.get_object('peek_mode_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('window-preview-show-title',
                            this._builder.get_object('preview_show_title_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('peek-mode',
                            this._builder.get_object('listboxrow_enter_peek_mode_timeout'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('peek-mode',
                            this._builder.get_object('listboxrow_peek_mode_opacity'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('preview-middle-click-close',
                            this._builder.get_object('preview_middle_click_close_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            this._builder.get_object('enter_peek_mode_timeout_spinbutton').set_value(this._settings.get_int('enter-peek-mode-timeout'));

            this._builder.get_object('enter_peek_mode_timeout_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('enter-peek-mode-timeout', widget.get_value());
            }));

            this._builder.get_object('peek_mode_opacity_spinbutton').set_value(this._settings.get_int('peek-mode-opacity'));

            this._builder.get_object('peek_mode_opacity_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('peek-mode-opacity', widget.get_value());
            }));

            this._builder.get_object('preview_width_spinbutton').set_value(this._settings.get_int('window-preview-width'));
            this._builder.get_object('preview_width_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-width', widget.get_value());
            }));

            this._builder.get_object('preview_height_spinbutton').set_value(this._settings.get_int('window-preview-height'));
            this._builder.get_object('preview_height_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-height', widget.get_value());
            }));

            this._builder.get_object('preview_padding_spinbutton').set_value(this._settings.get_int('window-preview-padding'));
            this._builder.get_object('preview_padding_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-padding', widget.get_value());
            }));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('show-window-previews-timeout', this._settings.get_default_value('show-window-previews-timeout'));
                    this._builder.get_object('preview_timeout_spinbutton').set_value(this._settings.get_int('show-window-previews-timeout'));

                    this._settings.set_value('peek-mode', this._settings.get_default_value('peek-mode'));
                    this._settings.set_value('window-preview-show-title', this._settings.get_default_value('window-preview-show-title'));
                    this._settings.set_value('enter-peek-mode-timeout', this._settings.get_default_value('enter-peek-mode-timeout'));
                    this._builder.get_object('enter_peek_mode_timeout_spinbutton').set_value(this._settings.get_int('enter-peek-mode-timeout'));
                    this._settings.set_value('peek-mode-opacity', this._settings.get_default_value('peek-mode-opacity'));
                    this._builder.get_object('peek_mode_opacity_spinbutton').set_value(this._settings.get_int('peek-mode-opacity'));

                    this._settings.set_value('window-preview-width', this._settings.get_default_value('window-preview-width'));
                    this._builder.get_object('preview_width_spinbutton').set_value(this._settings.get_int('window-preview-width'));
                    
                    this._settings.set_value('window-preview-height', this._settings.get_default_value('window-preview-height'));
                    this._builder.get_object('preview_height_spinbutton').set_value(this._settings.get_int('window-preview-height'));

                    this._settings.set_value('window-preview-padding', this._settings.get_default_value('window-preview-padding'));
                    this._builder.get_object('preview_padding_spinbutton').set_value(this._settings.get_int('window-preview-padding'));

                    this._settings.set_value('preview-middle-click-close', this._settings.get_default_value('preview-middle-click-close'));

                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));
       
        this._settings.bind('isolate-workspaces',
                            this._builder.get_object('isolate_workspaces_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('group-apps',
                            this._builder.get_object('group_apps_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        this._settings.bind('group-apps',
                            this._builder.get_object('show_group_apps_options_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        this._builder.get_object('group_apps_label_font_color_colorbutton').connect('notify::color', Lang.bind(this, function (button) {
            let rgba = button.get_rgba();
            let css = rgba.to_string();
            let hexString = cssHexString(css);
            this._settings.set_string('group-apps-label-font-color', hexString);
        }));

        this._settings.bind('group-apps-use-fixed-width',
                            this._builder.get_object('group_apps_use_fixed_width_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('group-apps-underline-unfocused',
                            this._builder.get_object('group_apps_underline_unfocused_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('group-apps-use-launchers',
                            this._builder.get_object('group_apps_use_launchers_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);    

        this._builder.get_object('show_group_apps_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Ungrouped application options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_group_apps_options');
            dialog.get_content_area().add(box);

            this._builder.get_object('group_apps_label_font_size_spinbutton').set_value(this._settings.get_int('group-apps-label-font-size'));
            this._builder.get_object('group_apps_label_font_size_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('group-apps-label-font-size', widget.get_value());
            }));

            this._builder.get_object('group_apps_label_font_weight_combo').set_active_id(this._settings.get_string('group-apps-label-font-weight'));
            this._builder.get_object('group_apps_label_font_weight_combo').connect('changed', Lang.bind (this, function(widget) {
                this._settings.set_string('group-apps-label-font-weight', widget.get_active_id());
            }));

            (function() {
                let rgba = new Gdk.RGBA();
                rgba.parse(this._settings.get_string('group-apps-label-font-color'));
                this._builder.get_object('group_apps_label_font_color_colorbutton').set_rgba(rgba);
            }).apply(this);

            this._builder.get_object('group_apps_label_max_width_spinbutton').set_value(this._settings.get_int('group-apps-label-max-width'));
            this._builder.get_object('group_apps_label_max_width_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('group-apps-label-max-width', widget.get_value());
            }));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('group-apps-label-font-size', this._settings.get_default_value('group-apps-label-font-size'));
                    this._builder.get_object('group_apps_label_font_size_spinbutton').set_value(this._settings.get_int('group-apps-label-font-size'));

                    this._settings.set_value('group-apps-label-font-weight', this._settings.get_default_value('group-apps-label-font-weight'));
                    this._builder.get_object('group_apps_label_font_weight_combo').set_active_id(this._settings.get_string('group-apps-label-font-weight'));

                    this._settings.set_value('group-apps-label-font-color', this._settings.get_default_value('group-apps-label-font-color'));
                    let rgba = new Gdk.RGBA();
                    rgba.parse(this._settings.get_string('group-apps-label-font-color'));
                    this._builder.get_object('group_apps_label_font_color_colorbutton').set_rgba(rgba);

                    this._settings.set_value('group-apps-label-max-width', this._settings.get_default_value('group-apps-label-max-width'));
                    this._builder.get_object('group_apps_label_max_width_spinbutton').set_value(this._settings.get_int('group-apps-label-max-width'));

                    this._settings.set_value('group-apps-use-fixed-width', this._settings.get_default_value('group-apps-use-fixed-width'));
                    this._settings.set_value('group-apps-underline-unfocused', this._settings.get_default_value('group-apps-underline-unfocused'));
                    this._settings.set_value('group-apps-use-launchers', this._settings.get_default_value('group-apps-use-launchers'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));    

        this._builder.get_object('click_action_combo').set_active_id(this._settings.get_string('click-action'));
        this._builder.get_object('click_action_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('click-action', widget.get_active_id());
        }));

        this._builder.get_object('shift_click_action_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('shift-click-action', widget.get_active_id());
        }));

        this._builder.get_object('middle_click_action_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('middle-click-action', widget.get_active_id());
        }));
        this._builder.get_object('shift_middle_click_action_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('shift-middle-click-action', widget.get_active_id());
        }));

        // Create dialog for middle-click options
        this._builder.get_object('middle_click_options_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Customize middle-click behavior'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_middle_click_options');
            dialog.get_content_area().add(box);

            this._builder.get_object('shift_click_action_combo').set_active_id(this._settings.get_string('shift-click-action'));

            this._builder.get_object('middle_click_action_combo').set_active_id(this._settings.get_string('middle-click-action'));

            this._builder.get_object('shift_middle_click_action_combo').set_active_id(this._settings.get_string('shift-middle-click-action'));

            this._settings.bind('shift-click-action',
                                this._builder.get_object('shift_click_action_combo'),
                                'active-id',
                                Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('middle-click-action',
                                this._builder.get_object('middle_click_action_combo'),
                                'active-id',
                                Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('shift-middle-click-action',
                                this._builder.get_object('shift_middle_click_action_combo'),
                                'active-id',
                                Gio.SettingsBindFlags.DEFAULT);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings for the relevant keys
                    let keys = ['shift-click-action', 'middle-click-action', 'shift-middle-click-action'];
                    keys.forEach(function(val) {
                        this._settings.set_value(val, this._settings.get_default_value(val));
                    }, this);
                    this._builder.get_object('shift_click_action_combo').set_active_id(this._settings.get_string('shift-click-action'));
                    this._builder.get_object('middle_click_action_combo').set_active_id(this._settings.get_string('middle-click-action'));
                    this._builder.get_object('shift_middle_click_action_combo').set_active_id(this._settings.get_string('shift-middle-click-action'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));

        this._settings.bind('hot-keys',
                            this._builder.get_object('hot_keys_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('hot-keys',
                            this._builder.get_object('overlay_button'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('overlay_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('hotkeys-overlay-combo', widget.get_active_id());
        }));

        this._settings.bind('shortcut-previews',
                            this._builder.get_object('shortcut_preview_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

       this._settings.connect('changed::hotkey-prefix-text', Lang.bind(this, function() {checkHotkeyPrefix(this._settings);}));

        this._builder.get_object('hotkey_prefix_combo').set_active_id(this._settings.get_string('hotkey-prefix-text'));

        this._settings.bind('hotkey-prefix-text',
                            this._builder.get_object('hotkey_prefix_combo'),
                            'active-id',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('overlay_combo').set_active_id(this._settings.get_string('hotkeys-overlay-combo'));

        this._settings.bind('hotkeys-overlay-combo',
                            this._builder.get_object('overlay_combo'),
                            'active-id',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('overlay-timeout',
                            this._builder.get_object('timeout_spinbutton'),
                            'value',
                            Gio.SettingsBindFlags.DEFAULT);
        if (this._settings.get_string('hotkeys-overlay-combo') !== 'TEMPORARILY') {
            this._builder.get_object('timeout_spinbutton').set_sensitive(false);
        }

        this._settings.connect('changed::hotkeys-overlay-combo', Lang.bind(this, function() {
            if (this._settings.get_string('hotkeys-overlay-combo') !== 'TEMPORARILY')
                this._builder.get_object('timeout_spinbutton').set_sensitive(false);
            else
                this._builder.get_object('timeout_spinbutton').set_sensitive(true);
        }));

        this._settings.bind('shortcut-text',
                            this._builder.get_object('shortcut_entry'),
                            'text',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.connect('changed::shortcut-text', Lang.bind(this, function() {setShortcut(this._settings, 'shortcut');}));

        // Create dialog for number overlay options
        this._builder.get_object('overlay_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Advanced hotkeys options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_overlay_shortcut');
            dialog.get_content_area().add(box);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings for the relevant keys
                    let keys = ['hotkey-prefix-text', 'shortcut-text', 'hotkeys-overlay-combo', 'overlay-timeout', 'shortcut-previews'];
                    keys.forEach(function(val) {
                        this._settings.set_value(val, this._settings.get_default_value(val));
                    }, this);
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));
        
        // setup dialog for secondary menu options
        this._builder.get_object('secondarymenu_options_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Secondary Menu Options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_secondarymenu_options');
            dialog.get_content_area().add(box);

            this._settings.bind('secondarymenu-contains-appmenu',
                    this._builder.get_object('secondarymenu_appmenu_switch'),
                    'active',
                    Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('secondarymenu-contains-showdetails',
                    this._builder.get_object('secondarymenu_showdetails_switch'),
                    'active',
                    Gio.SettingsBindFlags.DEFAULT);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('secondarymenu-contains-appmenu', this._settings.get_default_value('secondarymenu-contains-appmenu'));
                    this._settings.set_value('secondarymenu-contains-showdetails', this._settings.get_default_value('secondarymenu-contains-showdetails'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));

        // setup dialog for advanced options
        this._builder.get_object('button_advanced_options').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Advanced Options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('box_advanced_options');
            dialog.get_content_area().add(box);

            this._builder.get_object('leave_timeout_spinbutton').set_value(this._settings.get_int('leave-timeout'));

            this._builder.get_object('leave_timeout_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('leave-timeout', widget.get_value());
            }));
            
            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings  
                    this._settings.set_value('leave-timeout', this._settings.get_default_value('leave-timeout'));
                    this._builder.get_object('leave_timeout_spinbutton').set_value(this._settings.get_int('leave-timeout'));                
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));

        // Fine-tune panel

        let sizeScales = [
            {objectName: 'tray_size_scale', valueName: 'tray-size', range: DEFAULT_FONT_SIZES },
            {objectName: 'leftbox_size_scale', valueName: 'leftbox-size', range: DEFAULT_FONT_SIZES },
            {objectName: 'appicon_margin_scale', valueName: 'appicon-margin', range: DEFAULT_MARGIN_SIZES },
            {objectName: 'appicon_padding_scale', valueName: 'appicon-padding', range: DEFAULT_MARGIN_SIZES },
            {objectName: 'tray_padding_scale', valueName: 'tray-padding', range: DEFAULT_PADDING_SIZES },
            {objectName: 'leftbox_padding_scale', valueName: 'leftbox-padding', range: DEFAULT_PADDING_SIZES },
            {objectName: 'statusicon_padding_scale', valueName: 'status-icon-padding', range: DEFAULT_PADDING_SIZES }
        ];
        
        for(var idx in sizeScales) {
            let size_scale = this._builder.get_object(sizeScales[idx].objectName);
            let range = sizeScales[idx].range;
            size_scale.set_range(range[range.length-1], range[0]);
            size_scale.set_value(this._settings.get_int(sizeScales[idx].valueName));
            range.slice(1, -1).forEach(function(val) {
                size_scale.add_mark(val, Gtk.PositionType.TOP, val.toString());
            });

            // Corrent for rtl languages
            if (this._rtl) {
                // Flip value position: this is not done automatically
                size_scale.set_value_pos(Gtk.PositionType.LEFT);
                // I suppose due to a bug, having a more than one mark and one above a value of 100
                // makes the rendering of the marks wrong in rtl. This doesn't happen setting the scale as not flippable
                // and then manually inverting it
                size_scale.set_flippable(false);
                size_scale.set_inverted(true);
            }
        }

        this._settings.bind('animate-app-switch',
                    this._builder.get_object('animate_app_switch_switch'),
                    'active',
                    Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('animate-window-launch',
                    this._builder.get_object('animate_window_launch_switch'),
                    'active',
                    Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('stockgs-keep-dash',
                            this._builder.get_object('stockgs_dash_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('stockgs-panelbtn-click-only',
                            this._builder.get_object('stockgs_panelbtn_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        
        // About Panel

        this._builder.get_object('extension_version').set_label(Me.metadata.version.toString() + (Me.metadata.commit ? ' (' + Me.metadata.commit + ')' : ''));

        this._builder.get_object('importexport_export_button').connect('clicked', widget => {
            this._showFileChooser(
                _('Export settings'),
                { action: Gtk.FileChooserAction.SAVE,
                  do_overwrite_confirmation: true },
                Gtk.STOCK_SAVE,
                filename => {
                    let file = Gio.file_new_for_path(filename);
                    let raw = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
                    let out = Gio.BufferedOutputStream.new_sized(raw, 4096);

                    out.write_all(GLib.spawn_command_line_sync('dconf dump ' + SCHEMA_PATH)[1], null);
                    out.close(null);
                }
            );
        });

        this._builder.get_object('importexport_import_button').connect('clicked', widget => {
            this._showFileChooser(
                _('Import settings'),
                { action: Gtk.FileChooserAction.OPEN },
                Gtk.STOCK_OPEN,
                filename => {
                    let settingsFile = Gio.File.new_for_path(filename);
                    let [ , pid, stdin, stdout, stderr] = 
                        GLib.spawn_async_with_pipes(
                            null,
                            ['dconf', 'load', SCHEMA_PATH],
                            null,
                            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                            null
                        );
        
                    stdin = new Gio.UnixOutputStream({ fd: stdin, close_fd: true });
                    GLib.close(stdout);
                    GLib.close(stderr);
                                        
                    let [ , , , retCode] = GLib.spawn_command_line_sync(GSET + ' -d ' + UUID);
                                        
                    if (retCode == 0) {
                        GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => GLib.spawn_command_line_sync(GSET + ' -e ' + UUID));
                    }

                    stdin.splice(settingsFile.read(null), Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET, null);
                }
            );
        });
    },

    _showFileChooser: function(title, params, acceptBtn, acceptHandler) {
        let dialog = new Gtk.FileChooserDialog(mergeObjects({ title: title, transient_for: this.widget.get_toplevel() }, params));

        dialog.add_button(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL);
        dialog.add_button(acceptBtn, Gtk.ResponseType.ACCEPT);

        if (dialog.run() == Gtk.ResponseType.ACCEPT) {
            try {
                acceptHandler(dialog.get_filename());
            } catch(e) {
                log('error from dash-to-panel filechooser: ' + e);
            }
        }

        dialog.destroy();
    },

    /**
     * Object containing all signals defined in the glade file
     */
    _SignalHandler: {
        
        position_bottom_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('panel-position', "BOTTOM");
        },
		
		position_top_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('panel-position', "TOP");
        },        

        dots_bottom_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('dot-position', "BOTTOM");
        },
		
		dots_top_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('dot-position', "TOP");
        },

        panel_size_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        panel_size_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._panel_size_timeout > 0)
                Mainloop.source_remove(this._panel_size_timeout);

            this._panel_size_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('panel-size', scale.get_value());
                this._panel_size_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        },

        tray_size_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        tray_size_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._tray_size_timeout > 0)
                Mainloop.source_remove(this._tray_size_timeout);

            this._tray_size_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('tray-size', scale.get_value());
                this._tray_size_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        },

        leftbox_size_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        leftbox_size_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._leftbox_size_timeout > 0)
                Mainloop.source_remove(this._leftbox_size_timeout);

            this._leftbox_size_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('leftbox-size', scale.get_value());
                this._leftbox_size_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        },

        appicon_margin_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        appicon_margin_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._appicon_margin_timeout > 0)
                Mainloop.source_remove(this._appicon_margin_timeout);

            this._appicon_margin_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('appicon-margin', scale.get_value());
                this._appicon_margin_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        },

        appicon_padding_scale_format_value_cb: function(scale, value) {
            return value + ' px';
        },

        appicon_padding_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._appicon_padding_timeout > 0)
                Mainloop.source_remove(this._appicon_padding_timeout);

            this._appicon_padding_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('appicon-padding', scale.get_value());
                this._appicon_padding_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        },

        tray_padding_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        tray_padding_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._tray_padding_timeout > 0)
                Mainloop.source_remove(this._tray_padding_timeout);

            this._tray_padding_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('tray-padding', scale.get_value());
                this._tray_padding_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        },

        statusicon_padding_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        statusicon_padding_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._statusicon_padding_timeout > 0)
                Mainloop.source_remove(this._statusicon_padding_timeout);

            this._statusicon_padding_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('status-icon-padding', scale.get_value());
                this._statusicon_padding_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        },

        leftbox_padding_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        leftbox_padding_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._leftbox_padding_timeout > 0)
                Mainloop.source_remove(this._leftbox_padding_timeout);

            this._leftbox_padding_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('leftbox-padding', scale.get_value());
                this._leftbox_padding_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        }
    }
});

function init() {
    Convenience.initTranslations();
}

function buildPrefsWidget() {
    let settings = new Settings();
    let widget = settings.widget;

    // I'd like the scrolled window to default to a size large enough to show all without scrolling, if it fits on the screen
    // But, it doesn't seem possible, so I'm setting a minimum size if there seems to be enough screen real estate
    widget.show_all();
    let viewportSize = settings.viewport.size_request();
    let screenHeight = widget.get_screen().get_height() - 120;
    
    widget.set_size_request(viewportSize.width, viewportSize.height > screenHeight ? screenHeight : viewportSize.height);   
    
    return widget;
}
