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

const Settings = new Lang.Class({
    Name: 'DashToPanel.Settings',

    _init: function() {
        this._settings = Convenience.getSettings('org.gnome.shell.extensions.dash-to-panel');

        this._rtl = (Gtk.Widget.get_default_direction() == Gtk.TextDirection.RTL);

        this._builder = new Gtk.Builder();
        this._builder.set_translation_domain(Me.metadata['gettext-domain']);
        this._builder.add_from_file(Me.path + '/Settings.ui');

        this.widget = this._builder.get_object('settings_notebook');

        // Timeout to delay the update of the settings
        this._panel_size_timeout = 0;
        this._dot_height_timeout = 0;
        this._tray_size_timeout = 0;
        this._leftbox_size_timeout = 0;
        this._appicon_margin_timeout = 0;
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

            this._builder.get_object('dot_size_spinbutton').set_value(this._settings.get_int('dot-size'));
            this._builder.get_object('dot_size_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('dot-size', widget.get_value());
            }));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('dot-color-override', this._settings.get_default_value('dot-color-override'));
                    this._settings.set_value('dot-color-unfocused-different', this._settings.get_default_value('dot-color-unfocused-different'));

                    for (let i = 1; i <= MAX_WINDOW_INDICATOR; i++) {
                        this._settings.set_value('dot-color-' + i, this._settings.get_default_value('dot-color-' + i));
                        let rgba = new Gdk.RGBA();
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

        // Behavior panel

        this._settings.bind('show-show-apps-button',
                            this._builder.get_object('show_applications_button_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
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
        this._settings.bind('show-appmenu',
                            this._builder.get_object('show_appmenu_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('show-window-previews',
                            this._builder.get_object('show_window_previews_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('show-window-previews',
                            this._builder.get_object('preview_timeout_spinbutton'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
        this._settings.bind('show-window-previews',
                            this._builder.get_object('preview_timeout_label'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._builder.get_object('preview_timeout_spinbutton').set_value(this._settings.get_int('show-window-previews-timeout'));
        this._builder.get_object('preview_timeout_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
            this._settings.set_int('show-window-previews-timeout', widget.get_value());
        }));
       
        this._settings.bind('isolate-workspaces',
                            this._builder.get_object('isolate_workspaces_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

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

            this._builder.get_object('overlay_switch').set_active(this._settings.get_boolean('hotkeys-overlay'));

            this._settings.bind('hotkey-prefix-text',
                                this._builder.get_object('hotkey_prefix_combo'),
                                'text',
                                Gio.SettingsBindFlags.DEFAULT);

            this._builder.get_object('hotkey_prefix_combo').set_active_id(this._settings.get_string('hotkey-prefix-text'));

            this._settings.bind('hotkey-prefix-text',
                                this._builder.get_object('hotkey_prefix_combo'),
                                'active-id',
                                Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('hotkeys-overlay',
                                this._builder.get_object('overlay_switch'),
                                'active',
                                Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('overlay-timeout',
                                this._builder.get_object('timeout_spinbutton'),
                                'value',
                                Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('hotkeys-overlay',
                                this._builder.get_object('timeout_spinbutton'),
                                'sensitive',
                                Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('shortcut-text',
                                this._builder.get_object('shortcut_entry'),
                                'text',
                                Gio.SettingsBindFlags.DEFAULT);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings for the relevant keys
                    let keys = ['hotkey-prefix-text', 'shortcut-text', 'hotkeys-overlay', 'overlay-timeout'];
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
        
        // About Panel

        this._builder.get_object('extension_version').set_label(Me.metadata.version.toString());
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
    widget.show_all();
    return widget;
}
