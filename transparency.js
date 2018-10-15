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
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

const Clutter = imports.gi.Clutter;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Lang = imports.lang;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Proximity = Me.imports.proximity;
const Utils = Me.imports.utils;

var DynamicTransparency = new Lang.Class({
    Name: 'DashToPanel.DynamicTransparency',

    _init: function(dtpPanel) {
        this._dtpPanel = dtpPanel;
        this._dtpSettings = dtpPanel._dtpSettings;
        this._proximityManager = dtpPanel.panelManager.proximityManager;
        this._proximityWatchId = 0;
        this._initialPanelStyle = dtpPanel.panel.actor.get_style();
        this._windowOverlap = false;

        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._bindSignals();

        this._updateAnimationDuration();
        this._updateAllAndSet();
        this._updateProximityWatch();
    },

    destroy: function() {
        this._signalsHandler.destroy();
        this._proximityManager.removeWatch(this._proximityWatchId);
        this._dtpPanel.panel.actor.set_style(this._initialPanelStyle);
    },

    _bindSignals: function() {
        this._signalsHandler.add(
            [
                St.ThemeContext.get_for_stage(global.stage),
                'changed',
                () => this._updateAllAndSet()
            ],
            [
                Main.overview,
                [
                    'showing',
                    'hiding'
                ],
                () => this._updateAlphaAndSet()
            ],
            [
                this._dtpSettings,
                [
                    'changed::trans-use-custom-bg',
                    'changed::trans-bg-color'
                ],
                () => this._updateColorAndSet()
            ],
            [
                this._dtpSettings,
                [
                    'changed::trans-use-custom-opacity',
                    'changed::trans-panel-opacity',
                    'changed::trans-bg-color',
                    'changed::trans-dynamic-anim-target',
                    'changed::trans-use-dynamic-opacity',
                ],
                () => this._updateAlphaAndSet()
            ],
            [
                this._dtpSettings,
                [
                    'changed::trans-dynamic-behavior',
                    'changed::trans-use-dynamic-opacity',
                    'changed::trans-dynamic-distance'
                ],
                () => this._updateProximityWatch()
            ],
            [
                this._dtpSettings, 
                'changed::trans-dynamic-anim-time',
                () => this._updateAnimationDuration()
            ]
        );
    },

    _updateProximityWatch: function() {
        this._proximityManager.removeWatch(this._proximityWatchId);

        if (this._dtpSettings.get_boolean('trans-use-dynamic-opacity')) {
            this._proximityWatchId = this._proximityManager.createWatch(
                this._dtpPanel.panelBox, 
                Proximity.Mode[this._dtpSettings.get_string('trans-dynamic-behavior')], 
                0, this._dtpSettings.get_int('trans-dynamic-distance'), 
                overlap => { 
                    this._windowOverlap = overlap;
                    this._updateAlphaAndSet();
                }
            );
        }
    },

    _updateAnimationDuration: function() {
        this._animationDuration = this._dtpSettings.get_int('trans-dynamic-anim-time') * 0.001;
    },

    _updateAllAndSet: function() {
        let themeBackground = this._getThemeBackground(true);

        this._updateColor(themeBackground);
        this._updateAlpha(themeBackground);
        this._setBackground();
    },

    _updateColorAndSet: function() {
        this._updateColor();
        this._setBackground();
    },

    _updateAlphaAndSet: function() {
        this._updateAlpha();
        this._setBackground();
    },

    _updateColor: function(themeBackground) {
        this._backgroundColor = this._dtpSettings.get_boolean('trans-use-custom-bg') ?
                                Clutter.color_from_string(this._dtpSettings.get_string('trans-bg-color'))[1] :
                                (themeBackground || this._getThemeBackground());
    },

    _updateAlpha: function(themeBackground) {
        if (this._windowOverlap && !Main.overview.visibleTarget && this._dtpSettings.get_boolean('trans-use-dynamic-opacity')) {
            this._alpha = this._dtpSettings.get_double('trans-dynamic-anim-target');
        } else {
            this._alpha = this._dtpSettings.get_boolean('trans-use-custom-opacity') ?
                          this._dtpSettings.get_double('trans-panel-opacity') : 
                          (themeBackground || this._getThemeBackground()).alpha * 0.003921569; // 1 / 255 = 0.003921569
        }
    },

    _setBackground: function() {
        this._dtpPanel.panel.actor.set_style(
            'background-color: rgba(' + 
            this._backgroundColor.red + ',' +
            this._backgroundColor.green + ',' +
            this._backgroundColor.blue + ',' +
            this._alpha + '); ' +
            'border-image: none; background-image: none; ' +
            'transition-duration:' + this._animationDuration + 's'
        );
    },

    _getThemeBackground: function(reload) {
        if (reload || !this._themeBackground) {
            let fakePanel = new St.Bin({ name: 'panel' });
            Main.uiGroup.add_child(fakePanel);
            let fakeTheme = fakePanel.get_theme_node()
            this._themeBackground = this._getBackgroundImageColor(fakeTheme) || fakeTheme.get_background_color();
            Main.uiGroup.remove_child(fakePanel);
        }

        return this._themeBackground;
    },

    _getBackgroundImageColor: function(theme) {
        let bg = null;

        try {
            let imageFile = theme.get_background_image() || theme.get_border_image().get_file();

            if (imageFile) {
                let imageBuf = GdkPixbuf.Pixbuf.new_from_file(imageFile.get_path());
                let pixels = imageBuf.get_pixels();

                bg = { red: pixels[0], green: pixels[1], blue: pixels[2], alpha: pixels[3] };
            }
        } catch (error) {}

        return bg;
    }
});