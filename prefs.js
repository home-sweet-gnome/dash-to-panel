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

const Settings = new Lang.Class({
    Name: 'TaskBar.Settings',

    _init: function() {
        this._settings = Convenience.getSettings('org.gnome.shell.extensions.dash-to-panel');

        this._rtl = (Gtk.Widget.get_default_direction() == Gtk.TextDirection.RTL);

        this._builder = new Gtk.Builder();
        this._builder.set_translation_domain(Me.metadata['gettext-domain']);
        this._builder.add_from_file(Me.path + '/Settings.ui');

        this.widget = this._builder.get_object('settings_notebook');

        // Timeout to delay the update of the settings
        this._panel_size_timeout = 0;

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
        // Position and size panel

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

        // Appearance panel

        let sizeScales = [
            {objectName: 'tray_size_scale', valueName: 'tray-size'},
            {objectName: 'leftbox_size_scale', valueName: 'leftbox-size'}
        ];
        
        for(var idx in sizeScales) {
            let size_scale = this._builder.get_object(sizeScales[idx].objectName);
            size_scale.set_range(DEFAULT_FONT_SIZES[DEFAULT_FONT_SIZES.length-1], DEFAULT_FONT_SIZES[0]);
            size_scale.set_value(this._settings.get_int(sizeScales[idx].valueName));
            DEFAULT_FONT_SIZES.slice(1, -1).forEach(function(val) {
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
            if (this._panel_size_timeout > 0)
                Mainloop.source_remove(this._panel_size_timeout);

            this._panel_size_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('tray-size', scale.get_value());
                this._panel_size_timeout = 0;
                return GLib.SOURCE_REMOVE;
            }));
        },

        leftbox_size_scale_format_value_cb: function(scale, value) {
            return value+ ' px';
        },

        leftbox_size_scale_value_changed_cb: function(scale) {
            // Avoid settings the size consinuosly
            if (this._panel_size_timeout > 0)
                Mainloop.source_remove(this._panel_size_timeout);

            this._panel_size_timeout = Mainloop.timeout_add(SCALE_UPDATE_TIMEOUT, Lang.bind(this, function() {
                this._settings.set_int('leftbox-size', scale.get_value());
                this._panel_size_timeout = 0;
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
