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

import GdkPixbuf from 'gi://GdkPixbuf'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import St from 'gi://St'

import * as Proximity from './proximity.js'
import * as Utils from './utils.js'
import { SETTINGS } from './extension.js'

export const DynamicTransparency = class {
  constructor(dtpPanel) {
    this._dtpPanel = dtpPanel
    this._proximityManager = dtpPanel.panelManager.proximityManager
    this._proximityWatchId = 0
    this.currentBackgroundColor = 0

    this._initialPanelStyle = dtpPanel.panel.get_style()

    this._signalsHandler = new Utils.GlobalSignalsHandler()
    this._bindSignals()

    this._updateAnimationDuration()
    this._updateAllAndSet()
    this._updateProximityWatch()
  }

  destroy() {
    this._signalsHandler.destroy()
    this._proximityManager.removeWatch(this._proximityWatchId)

    this._dtpPanel.panel.set_style(this._initialPanelStyle)
  }

  updateExternalStyle() {
    this._setBackground()
  }

  _bindSignals() {
    this._signalsHandler.add(
      [Utils.getStageTheme(), 'changed', () => this._updateAllAndSet()],
      [Main.overview, ['showing', 'hiding'], () => this._updateAlphaAndSet()],
      [
        SETTINGS,
        ['changed::trans-use-custom-bg', 'changed::trans-bg-color'],
        () => this._updateColorAndSet(),
      ],
      [
        SETTINGS,
        [
          'changed::trans-use-custom-opacity',
          'changed::trans-panel-opacity',
          'changed::trans-bg-color',
          'changed::trans-dynamic-anim-target',
          'changed::trans-use-dynamic-opacity',
        ],
        () => this._updateAlphaAndSet(),
      ],
      [
        SETTINGS,
        [
          'changed::trans-use-custom-gradient',
          'changed::trans-gradient-top-color',
          'changed::trans-gradient-bottom-color',
          'changed::trans-gradient-top-opacity',
          'changed::trans-gradient-bottom-opacity',
        ],
        () => this._updateGradientAndSet(),
      ],
      [
        SETTINGS,
        [
          'changed::trans-dynamic-behavior',
          'changed::trans-use-dynamic-opacity',
          'changed::trans-dynamic-distance',
        ],
        () => this._updateProximityWatch(),
      ],
      [
        SETTINGS,
        'changed::trans-dynamic-anim-time',
        () => this._updateAnimationDuration(),
      ],
    )
  }

  _updateProximityWatch() {
    this._proximityManager.removeWatch(this._proximityWatchId)

    if (SETTINGS.get_boolean('trans-use-dynamic-opacity')) {
      let isVertical = this._dtpPanel.checkIfVertical()
      let threshold = SETTINGS.get_int('trans-dynamic-distance')

      this._windowOverlap = false
      this._updateAlphaAndSet()

      this._proximityWatchId = this._proximityManager.createWatch(
        this._dtpPanel.panelBox.get_parent(),
        this._dtpPanel.monitor.index,
        Proximity.Mode[SETTINGS.get_string('trans-dynamic-behavior')],
        isVertical ? threshold : 0,
        isVertical ? 0 : threshold,
        (overlap) => {
          this._windowOverlap = overlap
          this._updateAlphaAndSet()
        },
      )
    }
  }

  _updateAnimationDuration() {
    this.animationDuration =
      SETTINGS.get_int('trans-dynamic-anim-time') * 0.001 + 's;'
  }

  _updateAllAndSet() {
    let themeBackground = this._getThemeBackground(true)

    this._updateColor(themeBackground)
    this._updateAlpha(themeBackground)
    this._updateGradient()
    this._setBackground()
    this._setGradient()
  }

  _updateColorAndSet() {
    this._updateColor()
    this._setBackground()
  }

  _updateAlphaAndSet() {
    this._updateAlpha()
    this._setBackground()
  }

  _updateGradientAndSet() {
    this._updateGradient()
    this._setGradient()
  }

  _updateColor(themeBackground) {
    this.backgroundColorRgb = SETTINGS.get_boolean('trans-use-custom-bg')
      ? SETTINGS.get_string('trans-bg-color')
      : themeBackground || this._getThemeBackground()
  }

  _updateAlpha(themeBackground) {
    if (
      this._windowOverlap &&
      !Main.overview.visibleTarget &&
      SETTINGS.get_boolean('trans-use-dynamic-opacity')
    ) {
      this.alpha = SETTINGS.get_double('trans-dynamic-anim-target')
    } else {
      this.alpha = SETTINGS.get_boolean('trans-use-custom-opacity')
        ? SETTINGS.get_double('trans-panel-opacity')
        : (themeBackground || this._getThemeBackground()).alpha * 0.003921569 // 1 / 255 = 0.003921569
    }
  }

  _updateGradient() {
    this._gradientStyle = ''

    if (SETTINGS.get_boolean('trans-use-custom-gradient')) {
      this._gradientStyle +=
        'background-gradient-direction: ' +
        (this._dtpPanel.checkIfVertical() ? 'horizontal;' : 'vertical;') +
        'background-gradient-start: ' +
        Utils.getrgbaColor(
          SETTINGS.get_string('trans-gradient-top-color'),
          SETTINGS.get_double('trans-gradient-top-opacity'),
        ) +
        'background-gradient-end: ' +
        Utils.getrgbaColor(
          SETTINGS.get_string('trans-gradient-bottom-color'),
          SETTINGS.get_double('trans-gradient-bottom-opacity'),
        )
    }
  }

  _setBackground() {
    this.currentBackgroundColor = Utils.getrgbaColor(
      this.backgroundColorRgb,
      this.alpha,
    )

    let transition = 'transition-duration:' + this.animationDuration

    this._dtpPanel.set_style(
      'background-color: ' + this.currentBackgroundColor + transition,
    )
  }

  _setGradient() {
    this._dtpPanel.panel.set_style(
      'background: none; ' +
        'border-image: none; ' +
        'background-image: none; ' +
        this._gradientStyle +
        'transition-duration:' +
        this.animationDuration,
    )
  }

  _getThemeBackground(reload) {
    if (reload || !this._themeBackground) {
      let fakePanel = new St.Bin({ name: 'panel' })
      Main.uiGroup.add_child(fakePanel)
      let fakeTheme = fakePanel.get_theme_node()
      this._themeBackground =
        this._getBackgroundImageColor(fakeTheme) ||
        fakeTheme.get_background_color()
      Main.uiGroup.remove_child(fakePanel)
    }

    return this._themeBackground
  }

  _getBackgroundImageColor(theme) {
    let bg = null

    try {
      let imageFile =
        theme.get_background_image() || theme.get_border_image()?.get_file()

      if (imageFile) {
        let imageBuf = GdkPixbuf.Pixbuf.new_from_file(imageFile.get_path())
        let pixels = imageBuf.get_pixels()

        bg = {
          red: pixels[0],
          green: pixels[1],
          blue: pixels[2],
          alpha: pixels[3],
        }
      }
    } catch (error) {
      console.log(error)
    }

    return bg
  }
}
