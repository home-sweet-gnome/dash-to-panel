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
const Panel = Me.imports.panel;
const Proximity = Me.imports.proximity;
const Utils = Me.imports.utils;

var DynamicTransparency = Utils.defineClass({
    Name: 'DashToPanel.DynamicTransparency',

    _init: function(dtpPanel) {
        this._dtpPanel = dtpPanel;
        this._proximityManager = dtpPanel.panelManager.proximityManager;
        this._proximityWatchId = 0;
        this._windowOverlap = false;
        this.currentBackgroundColor = 0;

        this._initialPanelStyle = dtpPanel.panel.actor.get_style();
        
        if (this._dtpPanel.geom.position == St.Side.TOP) {
            this._initialPanelCornerStyle = dtpPanel.panel._leftCorner.actor.get_style();
        }

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
        
        if (this._dtpPanel.geom.position == St.Side.TOP) {
            this._dtpPanel.panel._leftCorner.actor.set_style(this._initialPanelCornerStyle);
            this._dtpPanel.panel._rightCorner.actor.set_style(this._initialPanelCornerStyle);
        }
    },

    updateExternalStyle: function() {
        this._updateComplementaryStyles();
        this._setBackground();
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
                Me.settings,
                [
                    'changed::trans-use-custom-bg',
                    'changed::trans-bg-color'
                ],
                () => this._updateColorAndSet()
            ],
            [
                Me.settings,
                [
                    'changed::trans-use-custom-opacity',
                    'changed::trans-panel-opacity',
                    'changed::trans-bg-color',
                    'changed::trans-dynamic-anim-target',
                    'changed::trans-use-dynamic-opacity'
                ],
                () => this._updateAlphaAndSet()
            ],
            [
                Me.settings,
                [
                    'changed::trans-use-custom-gradient',
                    'changed::trans-gradient-top-color',
                    'changed::trans-gradient-bottom-color',
                    'changed::trans-gradient-top-opacity',
                    'changed::trans-gradient-bottom-opacity'
                ],
                () => this._updateGradientAndSet()
            ],
            [
                Me.settings,
                [
                    'changed::trans-dynamic-behavior',
                    'changed::trans-use-dynamic-opacity',
                    'changed::trans-dynamic-distance'
                ],
                () => this._updateProximityWatch()
            ],
            [
                Me.settings, 
                'changed::trans-dynamic-anim-time',
                () => this._updateAnimationDuration()
            ]
        );
    },

    _updateProximityWatch: function() {
        this._proximityManager.removeWatch(this._proximityWatchId);

        if (Me.settings.get_boolean('trans-use-dynamic-opacity')) {
            let isVertical = Panel.checkIfVertical();
            let threshold = Me.settings.get_int('trans-dynamic-distance');

            this._proximityWatchId = this._proximityManager.createWatch(
                this._dtpPanel.panelBox.get_parent(), 
                Proximity.Mode[Me.settings.get_string('trans-dynamic-behavior')], 
                isVertical ? threshold : 0, 
                isVertical ? 0 : threshold, 
                overlap => { 
                    this._windowOverlap = overlap;
                    this._updateAlphaAndSet();
                }
            );
        }
    },

    _updateAnimationDuration: function() {
        this.animationDuration = (Me.settings.get_int('trans-dynamic-anim-time') * 0.001) + 's;';
    },

    _updateAllAndSet: function() {
        let themeBackground = this._getThemeBackground(true);

        this._updateColor(themeBackground);
        this._updateAlpha(themeBackground);
        this._updateComplementaryStyles();
        this._updateGradient();
        this._setBackground();
        this._setGradient();
    },

    _updateColorAndSet: function() {
        this._updateColor();
        this._setBackground();
    },

    _updateAlphaAndSet: function() {
        this._updateAlpha();
        this._setBackground();
    },

    _updateGradientAndSet: function() {
        this._updateGradient();
        this._setGradient();
    },

    _updateComplementaryStyles: function() {
        let panelThemeNode = this._dtpPanel.panel.actor.get_theme_node();

        this._complementaryStyles = 'border-radius: ' + panelThemeNode.get_border_radius(0) + 'px;';
    },

    _updateColor: function(themeBackground) {
        this.backgroundColorRgb = Me.settings.get_boolean('trans-use-custom-bg') ?
                                  Me.settings.get_string('trans-bg-color') :
                                  (themeBackground || this._getThemeBackground());
    },

    _updateAlpha: function(themeBackground) {
        if (this._windowOverlap && !Main.overview.visibleTarget && Me.settings.get_boolean('trans-use-dynamic-opacity')) {
            this.alpha = Me.settings.get_double('trans-dynamic-anim-target');
        } else {
            this.alpha = Me.settings.get_boolean('trans-use-custom-opacity') ?
                         Me.settings.get_double('trans-panel-opacity') : 
                         (themeBackground || this._getThemeBackground()).alpha * 0.003921569; // 1 / 255 = 0.003921569
        }
    },

    _updateGradient: function() {
        this._gradientStyle = '';

        if (Me.settings.get_boolean('trans-use-custom-gradient')) {
            this._gradientStyle += 'background-gradient-direction: ' + (Panel.checkIfVertical() ? 'horizontal;' : 'vertical;') +
                                   'background-gradient-start: ' + Utils.getrgbaColor(Me.settings.get_string('trans-gradient-top-color'), 
                                                                                      Me.settings.get_double('trans-gradient-top-opacity')) + 
                                   'background-gradient-end: ' + Utils.getrgbaColor(Me.settings.get_string('trans-gradient-bottom-color'), 
                                                                                    Me.settings.get_double('trans-gradient-bottom-opacity'));
        }
    },

    _setBackground: function() {
        this.currentBackgroundColor = Utils.getrgbaColor(this.backgroundColorRgb, this.alpha);

        let transition = 'transition-duration:' + this.animationDuration;
        let cornerStyle = '-panel-corner-background-color: ' + this.currentBackgroundColor + transition;

        this._dtpPanel.set_style('background-color: ' + this.currentBackgroundColor + transition + this._complementaryStyles);
        
        if (this._dtpPanel.geom.position == St.Side.TOP) {
            this._dtpPanel.panel._leftCorner.actor.set_style(cornerStyle);
            this._dtpPanel.panel._rightCorner.actor.set_style(cornerStyle);
        }
    },

    _setGradient: function() {
        this._dtpPanel.panel.actor.set_style(
            'background: none; ' + 
            'border-image: none; ' + 
            'background-image: none; ' +
            this._gradientStyle +
            'transition-duration:' + this.animationDuration
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