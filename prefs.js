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

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
const N_ = function(e) { return e };
const Update = Me.imports.update;
const Pos = Me.imports.panelPositions;

const SCALE_UPDATE_TIMEOUT = 500;
const DEFAULT_PANEL_SIZES = [ 128, 96, 64, 48, 32, 24, 16 ];
const DEFAULT_FONT_SIZES = [ 96, 64, 48, 32, 24, 16, 0 ];
const DEFAULT_MARGIN_SIZES = [ 32, 24, 16, 12, 8, 4, 0 ];
const DEFAULT_PADDING_SIZES = [ 32, 24, 16, 12, 8, 4, 0, -1 ];
const MAX_WINDOW_INDICATOR = 4;

const SCHEMA_PATH = '/org/gnome/shell/extensions/dash-to-panel/';
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

    _updateVerticalRelatedOptions: function() {
        let position = this._getPanelPosition(this._currentMonitorIndex);
        let isVertical = position == Pos.LEFT || position == Pos.RIGHT;
        let showDesktopWidthLabel = this._builder.get_object('show_showdesktop_width_label');

        showDesktopWidthLabel.set_text(isVertical ? _('Show Desktop button height (px)') : _('Show Desktop button width (px)'));

        this._displayPanelPositionsForMonitor(this._currentMonitorIndex);
    },

    _maybeDisableTopPosition: function() {
        let keepTopPanel = this._settings.get_boolean('stockgs-keep-top-panel');
        let monitorSync = this._settings.get_boolean('panel-element-positions-monitors-sync');
        let topAvailable = !keepTopPanel || (!monitorSync && this._currentMonitorIndex != this.monitors[0]);
        let topRadio = this._builder.get_object('position_top_button');

        topRadio.set_sensitive(topAvailable);
        topRadio.set_tooltip_text(!topAvailable ? _('Unavailable when gnome-shell top panel is present') : '');
    },

    _getPanelPositions: function() {
        return Pos.getSettingsPositions(this._settings, 'panel-positions');
    },

    _getPanelPosition: function(monitorIndex) {
        let panelPositionsSettings = this._getPanelPositions();
        
        return panelPositionsSettings[monitorIndex] || this._settings.get_string('panel-position');
    },

    _setPanelPosition: function(position) {
        let panelPositionsSettings = this._getPanelPositions();
        let preventTop = this._settings.get_boolean('stockgs-keep-top-panel') && position == Pos.TOP;
        let monitorSync = this._settings.get_boolean('panel-element-positions-monitors-sync');
        let monitors = monitorSync ? this.monitors : [this._currentMonitorIndex];

        monitors.forEach(m => panelPositionsSettings[m] = preventTop && this.monitors[0] == m ? Pos.BOTTOM : position);

        this._settings.set_string('panel-positions', JSON.stringify(panelPositionsSettings));
    },

    _setPositionRadios: function(position) {
        this._ignorePositionRadios = true;
        
        switch (position) {
            case Pos.BOTTOM:
                this._builder.get_object('position_bottom_button').set_active(true);
                break;
            case Pos.TOP:
                this._builder.get_object('position_top_button').set_active(true);
                break;
            case Pos.LEFT:
                this._builder.get_object('position_left_button').set_active(true);
                break;
            case Pos.RIGHT:
                this._builder.get_object('position_right_button').set_active(true);
                break;
        }

        this._ignorePositionRadios = false;
    },

    _displayPanelPositionsForMonitor: function(monitorIndex) {
        let taskbarListBox = this._builder.get_object('taskbar_display_listbox');
        
        taskbarListBox.get_children().forEach(c => c.destroy());

        let labels = {};
        let panelPosition = this._getPanelPosition(monitorIndex);
        let isVertical = panelPosition == Pos.LEFT || panelPosition == Pos.RIGHT;
        let panelElementPositionsSettings = Pos.getSettingsPositions(this._settings, 'panel-element-positions');
        let panelElementPositions = panelElementPositionsSettings[monitorIndex] || Pos.defaults;
        let updateElementsSettings = () => {
            let newPanelElementPositions = [];
            let monitorSync = this._settings.get_boolean('panel-element-positions-monitors-sync');
            let monitors = monitorSync ? this.monitors : [monitorIndex];

            taskbarListBox.get_children().forEach(c => {
                newPanelElementPositions.push({
                    element: c.id,
                    visible: c.visibleToggleBtn.get_active(),
                    position: c.positionCombo.get_active_id()
                });
            });
            
            monitors.forEach(m => panelElementPositionsSettings[m] = newPanelElementPositions);
            this._settings.set_string('panel-element-positions', JSON.stringify(panelElementPositionsSettings));
        };

        this._maybeDisableTopPosition();
        this._setPositionRadios(panelPosition);
        
        labels[Pos.SHOW_APPS_BTN] = _('Show Applications button');
        labels[Pos.ACTIVITIES_BTN] = _('Activities button');
        labels[Pos.TASKBAR] = _('Taskbar');
        labels[Pos.DATE_MENU] = _('Date menu');
        labels[Pos.SYSTEM_MENU] = _('System menu');
        labels[Pos.LEFT_BOX] = _('Left box');
        labels[Pos.CENTER_BOX] = _('Center box');
        labels[Pos.RIGHT_BOX] = _('Right box');
        labels[Pos.DESKTOP_BTN] = _('Desktop button');

        panelElementPositions.forEach(el => {
            let row = new Gtk.ListBoxRow();
            let grid = new Gtk.Grid({ margin: 2, margin_left: 12, margin_right: 12, column_spacing: 8 });
            let upDownGrid = new Gtk.Grid({ column_spacing: 2 });
            let upBtn = new Gtk.Button({ tooltip_text: _('Move up') });
            let upImg = new Gtk.Image({ icon_name: 'go-up-symbolic', pixel_size: 12 });
            let downBtn = new Gtk.Button({ tooltip_text: _('Move down') });
            let downImg = new Gtk.Image({ icon_name: 'go-down-symbolic', pixel_size: 12 });
            let visibleToggleBtn = new Gtk.ToggleButton({ label: _('Visible'), active: el.visible });
            let positionCombo = new Gtk.ComboBoxText({ tooltip_text: _('Select element position') });
            let upDownClickHandler = limit => {
                let index = row.get_index();

                if (index != limit) {
                    taskbarListBox.remove(row);
                    taskbarListBox.insert(row, index + (!limit ? -1 : 1));
                    updateElementsSettings();
                }
            };

            positionCombo.append(Pos.STACKED_TL, isVertical ? _('Stacked to top') : _('Stacked to left'));
            positionCombo.append(Pos.STACKED_BR, isVertical ? _('Stacked to bottom') :_('Stacked to right'));
            positionCombo.append(Pos.CENTERED, _('Centered'));
            positionCombo.append(Pos.CENTERED_MONITOR, _('Monitor Center'));
            positionCombo.set_active_id(el.position);

            upBtn.connect('clicked', () => upDownClickHandler(0));
            downBtn.connect('clicked', () => upDownClickHandler(panelElementPositions.length - 1));
            visibleToggleBtn.connect('toggled', () => updateElementsSettings());
            positionCombo.connect('changed', () => updateElementsSettings());

            upBtn.add(upImg);
            downBtn.add(downImg);

            upDownGrid.add(upBtn);
            upDownGrid.add(downBtn);

            grid.add(upDownGrid);
            grid.add(new Gtk.Label({ label: labels[el.element], xalign: 0, hexpand: true }));

            if (Pos.optionDialogFunctions[el.element]) {
                let cogImg = new Gtk.Image({ icon_name: 'emblem-system-symbolic' });
                let optionsBtn = new Gtk.Button({ tooltip_text: _('More options') });
                
                optionsBtn.get_style_context().add_class('circular');
                optionsBtn.add(cogImg);
                grid.add(optionsBtn);

                optionsBtn.connect('clicked', () => this[Pos.optionDialogFunctions[el.element]]());
            }

            grid.add(visibleToggleBtn);
            grid.add(positionCombo);

            row.id = el.element;
            row.visibleToggleBtn = visibleToggleBtn;
            row.positionCombo = positionCombo;

            row.add(grid);
            taskbarListBox.add(row);
        });

        taskbarListBox.show_all();
    },

    _showShowAppsButtonOptions: function() {
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
                this._settings.set_value('show-apps-override-escape', this._settings.get_default_value('show-apps-override-escape'));
                handleIconChange.call(this, null);
            } else {
                // remove the settings box so it doesn't get destroyed;
                dialog.get_content_area().remove(box);
                dialog.destroy();
            }
            return;
        }));

        dialog.show_all();
    },

    _showDesktopButtonOptions: function() {
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

                this._settings.set_value('show-showdesktop-hover', this._settings.get_default_value('show-showdesktop-hover'));

                this._settings.set_value('show-showdesktop-delay', this._settings.get_default_value('show-showdesktop-delay'));
                this._builder.get_object('show_showdesktop_delay_spinbutton').set_value(this._settings.get_int('show-showdesktop-delay'));

                this._settings.set_value('show-showdesktop-time', this._settings.get_default_value('show-showdesktop-time'));
                this._builder.get_object('show_showdesktop_time_spinbutton').set_value(this._settings.get_int('show-showdesktop-time'));
            } else {
                // remove the settings box so it doesn't get destroyed;
                dialog.get_content_area().remove(box);
                dialog.destroy();
            }
            return;
        }));

        dialog.show_all();
    },

    _bindSettings: function() {
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
            case 'LEFT':
                this._builder.get_object('dots_left_button').set_active(true);
                break;
            case 'RIGHT':
                this._builder.get_object('dots_right_button').set_active(true);
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

            this._settings.bind('dot-color-dominant',
                            this._builder.get_object('dot_color_dominant_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('dot-color-override',
                            this._builder.get_object('dot_color_override_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            // when either becomes active, turn the other off
            this._builder.get_object('dot_color_dominant_switch').connect('state-set', Lang.bind (this, function(widget) {
                if (widget.get_active()) this._settings.set_boolean('dot-color-override', false);
            }));
            this._builder.get_object('dot_color_override_switch').connect('state-set', Lang.bind (this, function(widget) {
                if (widget.get_active()) this._settings.set_boolean('dot-color-dominant', false);
            }));

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

            this._settings.bind('focus-highlight-dominant',
                    this._builder.get_object('focus_highlight_dominant_switch'),
                    'active',
                    Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('focus-highlight-dominant',
                    this._builder.get_object('focus_highlight_color_label'),
                    'sensitive',
                    Gio.SettingsBindFlags.INVERT_BOOLEAN);

            this._settings.bind('focus-highlight-dominant',
                    this._builder.get_object('focus_highlight_color_colorbutton'),
                    'sensitive',
                    Gio.SettingsBindFlags.INVERT_BOOLEAN);


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
                    this._settings.set_value('dot-color-dominant', this._settings.get_default_value('dot-color-dominant'));
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
                    this._settings.set_value('focus-highlight-dominant', this._settings.get_default_value('focus-highlight-dominant'));

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
        this.monitors = this._settings.get_value('available-monitors').deep_unpack();

        let dtpPrimaryMonitorIndex = this.monitors.indexOf(this._settings.get_int('primary-monitor'));

        if (dtpPrimaryMonitorIndex < 0) {
            dtpPrimaryMonitorIndex = 0;
        }

        this._currentMonitorIndex = this.monitors[dtpPrimaryMonitorIndex];

        this._settings.connect('changed::panel-positions', () => this._updateVerticalRelatedOptions());
        this._updateVerticalRelatedOptions();
        
        for (let i = 0; i < this.monitors.length; ++i) {
            //the primary index is the first one in the "available-monitors" setting
            let label = !i ? _('Primary monitor') : _('Monitor ') + (i + 1);

            this._builder.get_object('multimon_primary_combo').append_text(label);
            this._builder.get_object('taskbar_position_monitor_combo').append_text(label);
        }
        
        this._builder.get_object('multimon_primary_combo').set_active(dtpPrimaryMonitorIndex);
        this._builder.get_object('taskbar_position_monitor_combo').set_active(dtpPrimaryMonitorIndex);

        this._settings.bind('panel-element-positions-monitors-sync',
                            this._builder.get_object('taskbar_position_sync_button'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('panel-element-positions-monitors-sync',
                            this._builder.get_object('taskbar_position_monitor_combo'),
                            'sensitive',
                            Gio.SettingsBindFlags.INVERT_BOOLEAN);

        this._settings.connect('changed::panel-element-positions-monitors-sync', () => this._maybeDisableTopPosition());

        this._builder.get_object('multimon_primary_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_int('primary-monitor', this.monitors[widget.get_active()]);
        }));

        this._builder.get_object('taskbar_position_monitor_combo').connect('changed', Lang.bind (this, function(widget) {
            this._currentMonitorIndex = this.monitors[widget.get_active()];
            this._displayPanelPositionsForMonitor(this._currentMonitorIndex);
        }));

        //panel positions
        this._displayPanelPositionsForMonitor(this._currentMonitorIndex);

        this._settings.bind('multi-monitors',
                            this._builder.get_object('multimon_multi_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        if (this.monitors.length === 1) {
            this._builder.get_object('multimon_multi_switch').set_sensitive(false);
        }
        
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
        
        this._settings.bind('desktop-line-use-custom-color',
                            this._builder.get_object('override_show_desktop_line_color_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('desktop-line-use-custom-color',
                            this._builder.get_object('override_show_desktop_line_color_colorbutton'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
        
        rgba.parse(this._settings.get_string('desktop-line-custom-color'));
        this._builder.get_object('override_show_desktop_line_color_colorbutton').set_rgba(rgba);
        this._builder.get_object('override_show_desktop_line_color_colorbutton').connect('notify::color', Lang.bind(this, function (button) {
            let rgba = button.get_rgba();
            let css = rgba.to_string();
            this._settings.set_string('desktop-line-custom-color', css);
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

        this._builder.get_object('intellihide_enable_start_delay_spinbutton').set_value(this._settings.get_int('intellihide-enable-start-delay'));
        this._builder.get_object('intellihide_enable_start_delay_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
            this._settings.set_int('intellihide-enable-start-delay', widget.get_value());
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

                    this._settings.set_value('intellihide-enable-start-delay', this._settings.get_default_value('intellihide-enable-start-delay'));
                    this._builder.get_object('intellihide_enable_start_delay_spinbutton').set_value(this._settings.get_int('intellihide-enable-start-delay'));
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

        this._builder.get_object('show_applications_side_padding_spinbutton').set_value(this._settings.get_int('show-apps-icon-side-padding'));
        this._builder.get_object('show_applications_side_padding_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
            this._settings.set_int('show-apps-icon-side-padding', widget.get_value());
        }));

        this._settings.bind('animate-show-apps',
                            this._builder.get_object('application_button_animation_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-apps-override-escape',
                            this._builder.get_object('show_applications_esc_key_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-showdesktop-hover',
                            this._builder.get_object('show_showdesktop_hide_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-showdesktop-hover',
                            this._builder.get_object('grid_show_showdesktop_hide_options'),
                            'sensitive',
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

        this._settings.bind('show-favorites-all-monitors',
                            this._builder.get_object('multimon_multi_show_favorites_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
                            
        this._settings.bind('show-favorites',
                            this._builder.get_object('multimon_multi_show_favorites_switch'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

        this._settings.bind('show-running-apps',
                            this._builder.get_object('show_runnning_apps_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT); 

        this._setPreviewTitlePosition();

        this._builder.get_object('grid_preview_title_font_color_colorbutton').connect('notify::color', Lang.bind(this, function (button) {
            let rgba = button.get_rgba();
            let css = rgba.to_string();
            let hexString = cssHexString(css);
            this._settings.set_string('window-preview-title-font-color', hexString);
        }));

        this._builder.get_object('show_window_previews_button').connect('clicked', Lang.bind(this, function() {

            let dialog = new Gtk.Dialog({ title: _('Window preview options'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let scrolledWindow = this._builder.get_object('box_window_preview_options');

            adjustScrollableHeight(this._builder.get_object('viewport_window_preview_options'), scrolledWindow);
            
            dialog.get_content_area().add(scrolledWindow);

            this._builder.get_object('preview_timeout_spinbutton').set_value(this._settings.get_int('show-window-previews-timeout'));
            this._builder.get_object('preview_timeout_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('show-window-previews-timeout', widget.get_value());
            }));

            this._settings.bind('preview-middle-click-close',
                            this._builder.get_object('preview_middle_click_close_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('window-preview-fixed-x',
                            this._builder.get_object('preview_aspect_ratio_x_fixed_togglebutton'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('window-preview-fixed-y',
                            this._builder.get_object('preview_aspect_ratio_y_fixed_togglebutton'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            this._settings.bind('preview-use-custom-opacity',
                            this._builder.get_object('preview_custom_opacity_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('preview-use-custom-opacity',
                            this._builder.get_object('preview_custom_opacity_spinbutton'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('window-preview-use-custom-icon-size',
                            this._builder.get_object('preview_custom_icon_size_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('window-preview-use-custom-icon-size',
                            this._builder.get_object('preview_custom_icon_size_spinbutton'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

            this._builder.get_object('preview_custom_opacity_spinbutton').set_value(this._settings.get_int('preview-custom-opacity'));
            this._builder.get_object('preview_custom_opacity_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('preview-custom-opacity', widget.get_value());
            }));
                            
            this._settings.bind('peek-mode',
                            this._builder.get_object('peek_mode_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('peek-mode',
                            this._builder.get_object('grid_enter_peek_mode_timeout'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('peek-mode',
                            this._builder.get_object('grid_peek_mode_opacity'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
            
            this._settings.bind('window-preview-show-title',
                            this._builder.get_object('preview_show_title_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('window-preview-show-title',
                            this._builder.get_object('grid_preview_custom_icon_size'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('window-preview-show-title',
                            this._builder.get_object('grid_preview_title_size'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('window-preview-show-title',
                            this._builder.get_object('grid_preview_title_weight'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);
            this._settings.bind('window-preview-show-title',
                            this._builder.get_object('grid_preview_title_font_color'),
                            'sensitive',
                            Gio.SettingsBindFlags.DEFAULT);

            this._builder.get_object('enter_peek_mode_timeout_spinbutton').set_value(this._settings.get_int('enter-peek-mode-timeout'));
            this._builder.get_object('enter_peek_mode_timeout_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('enter-peek-mode-timeout', widget.get_value());
            }));

            this._builder.get_object('leave_timeout_spinbutton').set_value(this._settings.get_int('leave-timeout'));
            this._builder.get_object('leave_timeout_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('leave-timeout', widget.get_value());
            }));

            this._settings.bind('window-preview-hide-immediate-click',
                                this._builder.get_object('preview_immediate_click_button'),
                                'active',
                                Gio.SettingsBindFlags.DEFAULT);

            this._builder.get_object('animation_time_spinbutton').set_value(this._settings.get_int('window-preview-animation-time'));
            this._builder.get_object('animation_time_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-animation-time', widget.get_value());
            }));

            this._builder.get_object('peek_mode_opacity_spinbutton').set_value(this._settings.get_int('peek-mode-opacity'));
            this._builder.get_object('peek_mode_opacity_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('peek-mode-opacity', widget.get_value());
            }));

            this._builder.get_object('preview_size_spinbutton').set_value(this._settings.get_int('window-preview-size'));
            this._builder.get_object('preview_size_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-size', widget.get_value());
            }));

            this._builder.get_object('preview_aspect_ratio_x_combo').set_active_id(this._settings.get_int('window-preview-aspect-ratio-x').toString());
            this._builder.get_object('preview_aspect_ratio_x_combo').connect('changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-aspect-ratio-x', parseInt(widget.get_active_id(), 10));
            }));

            this._builder.get_object('preview_aspect_ratio_y_combo').set_active_id(this._settings.get_int('window-preview-aspect-ratio-y').toString());
            this._builder.get_object('preview_aspect_ratio_y_combo').connect('changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-aspect-ratio-y', parseInt(widget.get_active_id(), 10));
            }));

            this._builder.get_object('preview_padding_spinbutton').set_value(this._settings.get_int('window-preview-padding'));
            this._builder.get_object('preview_padding_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-padding', widget.get_value());
            }));

            this._builder.get_object('preview_title_size_spinbutton').set_value(this._settings.get_int('window-preview-title-font-size'));
            this._builder.get_object('preview_title_size_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-title-font-size', widget.get_value());
            }));
            
            this._builder.get_object('preview_custom_icon_size_spinbutton').set_value(this._settings.get_int('window-preview-custom-icon-size'));
            this._builder.get_object('preview_custom_icon_size_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('window-preview-custom-icon-size', widget.get_value());
            }));

            this._builder.get_object('grid_preview_title_weight_combo').set_active_id(this._settings.get_string('window-preview-title-font-weight'));
            this._builder.get_object('grid_preview_title_weight_combo').connect('changed', Lang.bind (this, function(widget) {
                this._settings.set_string('window-preview-title-font-weight', widget.get_active_id());
            }));

            (function() {
                let rgba = new Gdk.RGBA();
                rgba.parse(this._settings.get_string('window-preview-title-font-color'));
                this._builder.get_object('grid_preview_title_font_color_colorbutton').set_rgba(rgba);
            }).apply(this);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('show-window-previews-timeout', this._settings.get_default_value('show-window-previews-timeout'));
                    this._builder.get_object('preview_timeout_spinbutton').set_value(this._settings.get_int('show-window-previews-timeout'));

                    this._settings.set_value('leave-timeout', this._settings.get_default_value('leave-timeout'));
                    this._builder.get_object('leave_timeout_spinbutton').set_value(this._settings.get_int('leave-timeout'));

                    this._settings.set_value('window-preview-hide-immediate-click', this._settings.get_default_value('window-preview-hide-immediate-click'));

                    this._settings.set_value('window-preview-animation-time', this._settings.get_default_value('window-preview-animation-time'));
                    this._builder.get_object('animation_time_spinbutton').set_value(this._settings.get_int('window-preview-animation-time'));

                    this._settings.set_value('preview-use-custom-opacity', this._settings.get_default_value('preview-use-custom-opacity'));
                    
                    this._settings.set_value('window-preview-use-custom-icon-size', this._settings.get_default_value('window-preview-use-custom-icon-size'));

                    this._settings.set_value('preview-custom-opacity', this._settings.get_default_value('preview-custom-opacity'));
                    this._builder.get_object('preview_custom_opacity_spinbutton').set_value(this._settings.get_int('preview-custom-opacity'));

                    this._settings.set_value('window-preview-title-position', this._settings.get_default_value('window-preview-title-position'));
                    this._setPreviewTitlePosition();

                    this._settings.set_value('peek-mode', this._settings.get_default_value('peek-mode'));
                    this._settings.set_value('window-preview-show-title', this._settings.get_default_value('window-preview-show-title'));
                    this._settings.set_value('enter-peek-mode-timeout', this._settings.get_default_value('enter-peek-mode-timeout'));
                    this._builder.get_object('enter_peek_mode_timeout_spinbutton').set_value(this._settings.get_int('enter-peek-mode-timeout'));
                    this._settings.set_value('peek-mode-opacity', this._settings.get_default_value('peek-mode-opacity'));
                    this._builder.get_object('peek_mode_opacity_spinbutton').set_value(this._settings.get_int('peek-mode-opacity'));

                    this._settings.set_value('window-preview-size', this._settings.get_default_value('window-preview-size'));
                    this._builder.get_object('preview_size_spinbutton').set_value(this._settings.get_int('window-preview-size'));

                    this._settings.set_value('window-preview-fixed-x', this._settings.get_default_value('window-preview-fixed-x'));
                    this._settings.set_value('window-preview-fixed-y', this._settings.get_default_value('window-preview-fixed-y'));

                    this._settings.set_value('window-preview-aspect-ratio-x', this._settings.get_default_value('window-preview-aspect-ratio-x'));
                    this._builder.get_object('preview_aspect_ratio_x_combo').set_active_id(this._settings.get_int('window-preview-aspect-ratio-x').toString());

                    this._settings.set_value('window-preview-aspect-ratio-y', this._settings.get_default_value('window-preview-aspect-ratio-y'));
                    this._builder.get_object('preview_aspect_ratio_y_combo').set_active_id(this._settings.get_int('window-preview-aspect-ratio-y').toString());
                    
                    this._settings.set_value('window-preview-padding', this._settings.get_default_value('window-preview-padding'));
                    this._builder.get_object('preview_padding_spinbutton').set_value(this._settings.get_int('window-preview-padding'));

                    this._settings.set_value('preview-middle-click-close', this._settings.get_default_value('preview-middle-click-close'));

                    this._settings.set_value('window-preview-title-font-size', this._settings.get_default_value('window-preview-title-font-size'));
                    this._builder.get_object('preview_title_size_spinbutton').set_value(this._settings.get_int('window-preview-title-font-size'));
                    
                    this._settings.set_value('window-preview-custom-icon-size', this._settings.get_default_value('window-preview-custom-icon-size'));
                    this._builder.get_object('preview_custom_icon_size_spinbutton').set_value(this._settings.get_int('window-preview-custom-icon-size'));

                    this._settings.set_value('window-preview-title-font-weight', this._settings.get_default_value('window-preview-title-font-weight'));
                    this._builder.get_object('grid_preview_title_weight_combo').set_active_id(this._settings.get_string('window-preview-title-font-weight'));

                    this._settings.set_value('window-preview-title-font-color', this._settings.get_default_value('window-preview-title-font-color'));
                    let rgba = new Gdk.RGBA();
                    rgba.parse(this._settings.get_string('window-preview-title-font-color'));
                    this._builder.get_object('grid_preview_title_font_color_colorbutton').set_rgba(rgba);

                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(scrolledWindow);
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

        this._settings.bind('isolate-monitors',
                            this._builder.get_object('multimon_multi_isolate_monitor_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
                            
        this._settings.bind('always-show-on-primary',
                            this._builder.get_object('multimon_multi_always_show_primary_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
                            
        this._settings.bind('overview-click-to-exit',
                            this._builder.get_object('clicktoexit_switch'),
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

        this._builder.get_object('group_apps_label_font_color_minimized_colorbutton').connect('notify::color', Lang.bind(this, function (button) {
            let rgba = button.get_rgba();
            let css = rgba.to_string();
            let hexString = cssHexString(css);
            this._settings.set_string('group-apps-label-font-color-minimized', hexString);
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

            (function() {
                let rgba = new Gdk.RGBA();
                rgba.parse(this._settings.get_string('group-apps-label-font-color-minimized'));
                this._builder.get_object('group_apps_label_font_color_minimized_colorbutton').set_rgba(rgba);
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

                    this._settings.set_value('group-apps-label-font-color-minimized', this._settings.get_default_value('group-apps-label-font-color-minimized'));
                    let minimizedFontColor = new Gdk.RGBA();
                    minimizedFontColor.parse(this._settings.get_string('group-apps-label-font-color-minimized'));
                    this._builder.get_object('group_apps_label_font_color_minimized_colorbutton').set_rgba(minimizedFontColor);

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

        this._builder.get_object('scroll_panel_combo').set_active_id(this._settings.get_string('scroll-panel-action'));
        this._builder.get_object('scroll_panel_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('scroll-panel-action', widget.get_active_id());
        }));

        this._builder.get_object('scroll_icon_combo').set_active_id(this._settings.get_string('scroll-icon-action'));
        this._builder.get_object('scroll_icon_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('scroll-icon-action', widget.get_active_id());
        }));

        // Create dialog for panel scroll options
        this._builder.get_object('scroll_panel_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Customize panel scroll behavior'),
                                          transient_for: this.widget.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('scroll_panel_options_box');
            dialog.get_content_area().add(box);

            this._builder.get_object('scroll_panel_options_delay_spinbutton').set_value(this._settings.get_int('scroll-panel-delay'));
            this._builder.get_object('scroll_panel_options_delay_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('scroll-panel-delay', widget.get_value());
            }));

            this._settings.bind('scroll-panel-show-ws-popup',
                            this._builder.get_object('scroll_panel_options_show_ws_popup_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('scroll-panel-delay', this._settings.get_default_value('scroll-panel-delay'));
                    this._builder.get_object('scroll_panel_options_delay_spinbutton').set_value(this._settings.get_int('scroll-panel-delay'));

                    this._settings.set_value('scroll-panel-show-ws-popup', this._settings.get_default_value('scroll-panel-show-ws-popup'));
                } else {
                    // remove the settings box so it doesn't get destroyed;
                    dialog.get_content_area().remove(box);
                    dialog.destroy();
                }
                return;
            }));

            dialog.show_all();

        }));

        // Create dialog for icon scroll options
        this._builder.get_object('scroll_icon_options_button').connect('clicked', Lang.bind(this, function() {
            let dialog = new Gtk.Dialog({ title: _('Customize icon scroll behavior'),
                                            transient_for: this.widget.get_toplevel(),
                                            use_header_bar: true,
                                            modal: true });

            // GTK+ leaves positive values for application-defined response ids.
            // Use +1 for the reset action
            dialog.add_button(_('Reset to defaults'), 1);

            let box = this._builder.get_object('scroll_icon_options_box');
            dialog.get_content_area().add(box);

            this._builder.get_object('scroll_icon_options_delay_spinbutton').set_value(this._settings.get_int('scroll-icon-delay'));
            this._builder.get_object('scroll_icon_options_delay_spinbutton').connect('value-changed', Lang.bind (this, function(widget) {
                this._settings.set_int('scroll-icon-delay', widget.get_value());
            }));

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings
                    this._settings.set_value('scroll-icon-delay', this._settings.get_default_value('scroll-icon-delay'));
                    this._builder.get_object('scroll_icon_options_delay_spinbutton').set_value(this._settings.get_int('scroll-icon-delay'));
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

        this._builder.get_object('shortcut_num_keys_combo').set_active_id(this._settings.get_string('shortcut-num-keys'));
        this._builder.get_object('shortcut_num_keys_combo').connect('changed', Lang.bind (this, function(widget) {
            this._settings.set_string('shortcut-num-keys', widget.get_active_id());
        }));

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

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                if (id == 1) {
                    // restore default settings  
                                 
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

        this._settings.bind('stockgs-keep-top-panel',
                            this._builder.get_object('stockgs_top_panel_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);

        

        this._settings.connect('changed::stockgs-keep-top-panel', () => this._maybeDisableTopPosition());

        this._maybeDisableTopPosition();

        this._settings.bind('stockgs-panelbtn-click-only',
                            this._builder.get_object('stockgs_panelbtn_switch'),
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
        
        this._settings.bind('stockgs-force-hotcorner',
                            this._builder.get_object('stockgs_hotcorner_switch'),
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
                                        
                    let [ , , , retCode] = GLib.spawn_command_line_sync(GSET + ' -d ' + Me.uuid);
                                        
                    if (retCode == 0) {
                        GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, () => GLib.spawn_command_line_sync(GSET + ' -e ' + Me.uuid));
                    }

                    stdin.splice(settingsFile.read(null), Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET, null);
                }
            );
        });

        let updateCheckSwitch = this._builder.get_object('updates_check_switch');

        updateCheckSwitch.set_sensitive(false);

        this._builder.get_object('updates_check_now_button').connect('clicked', widget => {
            this._settings.set_boolean('force-check-update', true);
        });

//!start-update
        updateCheckSwitch.set_sensitive(true);
        this._settings.bind('check-update',
                            updateCheckSwitch,
                            'active',
                            Gio.SettingsBindFlags.DEFAULT);
//!end-update
    },

    _setPreviewTitlePosition: function() {
        switch (this._settings.get_string('window-preview-title-position')) {
            case 'BOTTOM':
                this._builder.get_object('preview_title_position_bottom_button').set_active(true);
                break;
            case 'TOP':
                this._builder.get_object('preview_title_position_top_button').set_active(true);
                break;
        }
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
        
        position_bottom_button_clicked_cb: function(button) {
            if (!this._ignorePositionRadios && button.get_active()) this._setPanelPosition(Pos.BOTTOM);
        },
		
		position_top_button_clicked_cb: function(button) {
            if (!this._ignorePositionRadios && button.get_active()) this._setPanelPosition(Pos.TOP);
        },
        
        position_left_button_clicked_cb: function(button) {
            if (!this._ignorePositionRadios && button.get_active()) this._setPanelPosition(Pos.LEFT);
        },
		
		position_right_button_clicked_cb: function(button) {
            if (!this._ignorePositionRadios && button.get_active()) this._setPanelPosition(Pos.RIGHT);
        },

        dots_bottom_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('dot-position', "BOTTOM");
        },
		
		dots_top_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('dot-position', "TOP");
        },

        dots_left_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('dot-position', "LEFT");
        },
		
		dots_right_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('dot-position', "RIGHT");
        },

        preview_title_position_bottom_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('window-preview-title-position', 'BOTTOM');
        },
		
		preview_title_position_top_button_toggled_cb: function(button) {
            if (button.get_active())
                this._settings.set_string('window-preview-title-position', 'TOP');
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
    adjustScrollableHeight(settings.viewport, widget);
    
    return widget;
}

function adjustScrollableHeight(viewport, scrollableWindow) {
    let viewportSize = viewport.size_request();
    let screenHeight = scrollableWindow.get_screen().get_height() - 120;
    
    scrollableWindow.set_size_request(viewportSize.width, viewportSize.height > screenHeight ? screenHeight : viewportSize.height);  
}
