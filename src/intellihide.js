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

import Clutter from 'gi://Clutter'
import Meta from 'gi://Meta'
import Mtk from 'gi://Mtk'
import Shell from 'gi://Shell'
import St from 'gi://St'

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js'
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js'

import * as Proximity from './proximity.js'
import * as Utils from './utils.js'
import { SETTINGS, NOTIFICATIONSSETTINGS } from './extension.js'

//timeout intervals
const CHECK_POINTER_MS = 200
const CHECK_GRAB_MS = 400
const POST_ANIMATE_MS = 50
const MIN_UPDATE_MS = 250

//timeout names
const T1 = 'checkGrabTimeout'
const T2 = 'limitUpdateTimeout'
const T3 = 'postAnimateTimeout'
const T4 = 'enableStartTimeout'

const SIDE_CONTROLS_ANIMATION_TIME =
  OverviewControls.SIDE_CONTROLS_ANIMATION_TIME /
  (OverviewControls.SIDE_CONTROLS_ANIMATION_TIME > 1 ? 1000 : 1)

export const Hold = {
  NONE: 0,
  TEMPORARY: 1,
  PERMANENT: 2,
  NOTIFY: 4,
}

export const Intellihide = class {
  constructor(dtpPanel) {
    this._dtpPanel = dtpPanel
    this._panelBox = dtpPanel.panelBox
    this._panelManager = dtpPanel.panelManager
    this._proximityManager = this._panelManager.proximityManager
    this._holdStatus = Hold.NONE

    this._signalsHandler = new Utils.GlobalSignalsHandler()
    this._timeoutsHandler = new Utils.TimeoutsHandler()

    this._intellihideChangedId = SETTINGS.connect('changed::intellihide', () =>
      this._changeEnabledStatus(),
    )
    this._intellihideOnlySecondaryChangedId = SETTINGS.connect(
      'changed::intellihide-only-secondary',
      () => this._changeEnabledStatus(),
    )

    this.enabled = false
  }

  init() {
    this._changeEnabledStatus()
  }

  enable() {
    this.enabled = true
    this._monitor = this._dtpPanel.monitor
    this._animationDestination = -1
    this._pendingUpdate = false
    this._hover = false
    this._hoveredOut = false
    this._windowOverlap = false
    this._translationProp =
      'translation_' + (this._dtpPanel.geom.vertical ? 'x' : 'y')

    this._panelBox.translation_y = 0
    this._panelBox.translation_x = 0

    this._setTrackPanel(true)
    this._bindGeneralSignals()

    if (this._hidesFromWindows()) {
      let watched = SETTINGS.get_boolean('intellihide-hide-from-windows')
        ? this._panelBox.get_parent()
        : new Mtk.Rectangle({
            x: this._monitor.x,
            y: this._monitor.y,
            width: this._monitor.width,
            height: this._monitor.height,
          })

      this._proximityWatchId = this._proximityManager.createWatch(
        watched,
        this._dtpPanel.monitor.index,
        Proximity.Mode[SETTINGS.get_string('intellihide-behaviour')],
        0,
        0,
        (overlap) => {
          this._windowOverlap = overlap
          this._queueUpdatePanelPosition()
        },
      )
    }

    if (SETTINGS.get_boolean('intellihide-use-pointer'))
      this._setRevealMechanism()

    let lastState = SETTINGS.get_int('intellihide-persisted-state')

    if (lastState > -1) {
      this._holdStatus = lastState

      if (lastState == Hold.NONE && Main.layoutManager._startingUp)
        this._signalsHandler.add([
          this._panelBox,
          'notify::mapped',
          () => this._hidePanel(true),
        ])
      else this._queueUpdatePanelPosition()
    } else
      // -1 means that the option to persist hold isn't activated, so normal start
      this._timeoutsHandler.add([
        T4,
        SETTINGS.get_int('intellihide-enable-start-delay'),
        () => this._queueUpdatePanelPosition(),
      ])
  }

  disable(reset) {
    this.enabled = false
    this._hover = false

    if (this._proximityWatchId) {
      this._proximityManager.removeWatch(this._proximityWatchId)
    }

    this._setTrackPanel(false)
    this._removeRevealMechanism()

    this._revealPanel(!reset)

    this._signalsHandler.destroy()
    this._timeoutsHandler.destroy()
  }

  destroy() {
    SETTINGS.disconnect(this._intellihideChangedId)
    SETTINGS.disconnect(this._intellihideOnlySecondaryChangedId)

    if (this.enabled) {
      this.disable()
    }
  }

  toggle() {
    this[this._holdStatus & Hold.PERMANENT ? 'release' : 'revealAndHold'](
      Hold.PERMANENT,
    )
  }

  revealAndHold(holdStatus, immediate) {
    if (
      !this.enabled ||
      (holdStatus == Hold.NOTIFY &&
        (!SETTINGS.get_boolean('intellihide-show-on-notification') ||
          !NOTIFICATIONSSETTINGS.get_boolean('show-banners')))
    )
      return

    if (!this._holdStatus) this._revealPanel(immediate)

    this._holdStatus |= holdStatus

    this._maybePersistHoldStatus()
  }

  release(holdStatus) {
    if (!this.enabled) return

    if (this._holdStatus & holdStatus) this._holdStatus -= holdStatus

    if (!this._holdStatus) {
      this._maybePersistHoldStatus()
      this._queueUpdatePanelPosition()
    }
  }

  reset() {
    this.disable(true)
    this.enable()
  }

  _hidesFromWindows() {
    return (
      SETTINGS.get_boolean('intellihide-hide-from-windows') ||
      SETTINGS.get_boolean('intellihide-hide-from-monitor-windows')
    )
  }

  _changeEnabledStatus() {
    let intellihide = SETTINGS.get_boolean('intellihide')
    let onlySecondary = SETTINGS.get_boolean('intellihide-only-secondary')
    let enabled = intellihide && !(this._dtpPanel.isPrimary && onlySecondary)

    if (this.enabled !== enabled) {
      this[enabled ? 'enable' : 'disable']()
    }
  }

  _maybePersistHoldStatus() {
    if (SETTINGS.get_int('intellihide-persisted-state') > -1)
      SETTINGS.set_int(
        'intellihide-persisted-state',
        this._holdStatus & Hold.PERMANENT ? Hold.PERMANENT : Hold.NONE,
      )
  }

  _bindGeneralSignals() {
    this._signalsHandler.add(
      [
        this._dtpPanel.taskbar,
        ['menu-closed', 'end-drag'],
        () => this._queueUpdatePanelPosition(),
      ],
      [
        SETTINGS,
        [
          'changed::intellihide-use-pointer',
          'changed::intellihide-use-pressure',
          'changed::intellihide-hide-from-windows',
          'changed::intellihide-hide-from-monitor-windows',
          'changed::intellihide-behaviour',
          'changed::intellihide-pressure-threshold',
          'changed::intellihide-pressure-time',
        ],
        () => this.reset(),
      ],
      [
        this._dtpPanel.taskbar.previewMenu,
        'open-state-changed',
        () => this._queueUpdatePanelPosition(),
      ],
      [
        Main.overview,
        ['showing', 'hiding'],
        () => this._queueUpdatePanelPosition(),
      ],
    )

    if (Meta.is_wayland_compositor()) {
      this._signalsHandler.add([
        this._panelBox,
        'notify::visible',
        () => Utils.setDisplayUnredirect(!this._panelBox.visible),
      ])
    }
  }

  _setTrackPanel(enable) {
    let actorData = Utils.getTrackedActorData(this._panelBox)

    actorData.affectsStruts = !enable
    actorData.trackFullscreen = !enable

    this._panelBox.visible = enable ? enable : this._panelBox.visible

    Main.layoutManager._queueUpdateRegions()
  }

  _setRevealMechanism() {
    let barriers = Meta.BackendCapabilities.BARRIERS

    if (
      (global.backend.capabilities & barriers) === barriers &&
      SETTINGS.get_boolean('intellihide-use-pressure')
    ) {
      this._edgeBarrier = this._createBarrier()
      this._pressureBarrier = new Layout.PressureBarrier(
        SETTINGS.get_int('intellihide-pressure-threshold'),
        SETTINGS.get_int('intellihide-pressure-time'),
        Shell.ActionMode.NORMAL,
      )
      this._pressureBarrier.addBarrier(this._edgeBarrier)
      this._signalsHandler.add([
        this._pressureBarrier,
        'trigger',
        () => {
          let [x, y] = global.get_pointer()

          if (this._pointerIn(x, y, 1, 'intellihide-use-pointer-limit-size'))
            this._queueUpdatePanelPosition(true)
          else this._pressureBarrier._isTriggered = false
        },
      ])
    }

    this._pointerWatch = PointerWatcher.getPointerWatcher().addWatch(
      CHECK_POINTER_MS,
      (x, y) => this._checkMousePointer(x, y),
    )
  }

  _removeRevealMechanism() {
    if (this._pointerWatch) {
      PointerWatcher.getPointerWatcher()._removeWatch(this._pointerWatch)
      this._pointerWatch = 0
    }

    if (this._pressureBarrier) {
      this._pressureBarrier.destroy()
      this._edgeBarrier.destroy()

      this._pressureBarrier = 0
    }
  }

  _createBarrier() {
    let position = this._dtpPanel.geom.position
    let opts = { backend: global.backend }

    if (this._dtpPanel.geom.vertical) {
      opts.y1 = this._monitor.y
      opts.y2 = this._monitor.y + this._monitor.height
      opts.x1 = opts.x2 = this._monitor.x
    } else {
      opts.x1 = this._monitor.x
      opts.x2 = this._monitor.x + this._monitor.width
      opts.y1 = opts.y2 = this._monitor.y
    }

    if (position == St.Side.TOP) {
      opts.directions = Meta.BarrierDirection.POSITIVE_Y
    } else if (position == St.Side.BOTTOM) {
      opts.y1 = opts.y2 = opts.y1 + this._monitor.height
      opts.directions = Meta.BarrierDirection.NEGATIVE_Y
    } else if (position == St.Side.LEFT) {
      opts.directions = Meta.BarrierDirection.POSITIVE_X
    } else {
      opts.x1 = opts.x2 = opts.x1 + this._monitor.width
      opts.directions = Meta.BarrierDirection.NEGATIVE_X
    }

    return new Meta.Barrier(opts)
  }

  _checkMousePointer(x, y) {
    if (
      !this._pressureBarrier &&
      !this._hover &&
      !Main.overview.visible &&
      this._pointerIn(x, y, 1, 'intellihide-use-pointer-limit-size')
    ) {
      this._hover = true
      this._queueUpdatePanelPosition(true)
    } else if (this._panelBox.visible) {
      let keepRevealedOnHover = SETTINGS.get_boolean(
        'intellihide-revealed-hover',
      )
      let fixedOffset = keepRevealedOnHover
        ? this._dtpPanel.geom.outerSize + this._dtpPanel.geom.topOffset
        : 1
      let hover = this._pointerIn(
        x,
        y,
        fixedOffset,
        'intellihide-revealed-hover-limit-size',
      )

      if (hover == this._hover) return

      this._hoveredOut = !hover
      this._hover = hover
      this._queueUpdatePanelPosition()
    }
  }

  _pointerIn(x, y, fixedOffset, limitSizeSetting) {
    let geom = this._dtpPanel.geom
    let position = geom.position
    let varCoordX1 = this._monitor.x
    let varCoordY1 = this._monitor.y + geom.gsTopPanelHeight // if vertical, ignore the original GS panel if present
    let varOffset = {}

    if (geom.dockMode && SETTINGS.get_boolean(limitSizeSetting)) {
      let alloc = this._dtpPanel.allocation

      if (!geom.dynamic) {
        // when fixed, use the panel clipcontainer which is positioned
        // relative to the stage itself
        varCoordX1 = geom.x
        varCoordY1 = geom.y
        varOffset[this._dtpPanel.varCoord.c2] =
          alloc[this._dtpPanel.varCoord.c2] - alloc[this._dtpPanel.varCoord.c1]
      } else {
        // when dynamic, the panel clipcontainer spans the whole monitor edge
        // and the panel is positioned relatively to the clipcontainer
        varOffset[this._dtpPanel.varCoord.c1] =
          alloc[this._dtpPanel.varCoord.c1]
        varOffset[this._dtpPanel.varCoord.c2] =
          alloc[this._dtpPanel.varCoord.c2]
      }
    }

    return (
      ((position == St.Side.TOP && y <= this._monitor.y + fixedOffset) ||
        (position == St.Side.BOTTOM &&
          y >= this._monitor.y + this._monitor.height - fixedOffset) ||
        (position == St.Side.LEFT && x <= this._monitor.x + fixedOffset) ||
        (position == St.Side.RIGHT &&
          x >= this._monitor.x + this._monitor.width - fixedOffset)) &&
      x >= varCoordX1 + (varOffset.x1 || 0) &&
      x < varCoordX1 + (varOffset.x2 || this._monitor.width) &&
      y >= varCoordY1 + (varOffset.y1 || 0) &&
      y < varCoordY1 + (varOffset.y2 || this._monitor.height)
    )
  }

  _queueUpdatePanelPosition(fromRevealMechanism) {
    if (
      !fromRevealMechanism &&
      this._timeoutsHandler.getId(T2) &&
      !Main.overview.visible
    ) {
      //unless this is a mouse interaction or entering/leaving the overview, limit the number
      //of updates, but remember to update again when the limit timeout is reached
      this._pendingUpdate = true
    } else if (!this._holdStatus) {
      this._checkIfShouldBeVisible(fromRevealMechanism)
        ? this._revealPanel()
        : this._hidePanel()
      this._timeoutsHandler.add([
        T2,
        MIN_UPDATE_MS,
        () => this._endLimitUpdate(),
      ])
    }
  }

  _endLimitUpdate() {
    if (this._pendingUpdate) {
      this._pendingUpdate = false
      this._queueUpdatePanelPosition()
    }
  }

  _checkIfShouldBeVisible(fromRevealMechanism) {
    if (
      Main.overview.visibleTarget ||
      this._dtpPanel.taskbar.previewMenu.opened ||
      this._dtpPanel.taskbar._dragMonitor ||
      this._hover ||
      (this._dtpPanel.geom.position == St.Side.TOP &&
        Main.layoutManager.panelBox.get_hover()) ||
      this._checkIfGrab()
    ) {
      return true
    }

    if (fromRevealMechanism) {
      let mouseBtnIsPressed =
        global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK

      //the user is trying to reveal the panel
      if (this._monitor.inFullscreen && !mouseBtnIsPressed) {
        return SETTINGS.get_boolean('intellihide-show-in-fullscreen')
      }

      return !mouseBtnIsPressed
    }

    if (!this._hidesFromWindows()) {
      return this._hover
    }

    return !this._windowOverlap
  }

  _checkIfGrab() {
    let grabActor = global.stage.get_grab_actor()
    let sourceActor = grabActor?._sourceActor || grabActor
    let isGrab =
      sourceActor &&
      (sourceActor == Main.layoutManager.dummyCursor ||
        this._dtpPanel.statusArea.quickSettings?.menu.actor.contains(
          sourceActor,
        ) ||
        this._dtpPanel.panel.contains(sourceActor))

    if (isGrab)
      //there currently is a grab on a child of the panel, check again soon to catch its release
      this._timeoutsHandler.add([
        T1,
        CHECK_GRAB_MS,
        () => this._queueUpdatePanelPosition(),
      ])

    return isGrab
  }

  _revealPanel(immediate) {
    if (!this._panelBox.visible) {
      this._panelBox.visible = true
      this._dtpPanel.taskbar._shownInitially = false
    }

    this._animatePanel(
      0,
      immediate,
      () => (this._dtpPanel.taskbar._shownInitially = true),
    )
  }

  _hidePanel(immediate) {
    let position = this._dtpPanel.geom.position
    let size = this._panelBox[this._dtpPanel.geom.vertical ? 'width' : 'height']
    let coefficient =
      position == St.Side.TOP || position == St.Side.LEFT ? -1 : 1

    this._animatePanel(size * coefficient, immediate)
  }

  _animatePanel(destination, immediate, onComplete) {
    if (destination === this._animationDestination) return

    Utils.stopAnimations(this._panelBox)
    this._animationDestination = destination

    let update = () =>
      this._timeoutsHandler.add([
        T3,
        POST_ANIMATE_MS,
        () => {
          Main.layoutManager._queueUpdateRegions()
          this._queueUpdatePanelPosition()
        },
      ])

    if (immediate) {
      this._panelBox[this._translationProp] = destination
      this._panelBox.visible = !destination
      update()
    } else if (destination !== this._panelBox[this._translationProp]) {
      let delay = 0

      if (destination != 0 && this._hoveredOut)
        delay = SETTINGS.get_int('intellihide-close-delay') * 0.001
      else if (destination == 0)
        delay = SETTINGS.get_int('intellihide-reveal-delay') * 0.001

      let tweenOpts = {
        //when entering/leaving the overview, use its animation time instead of the one from the settings
        time: Main.overview.visible
          ? SIDE_CONTROLS_ANIMATION_TIME
          : SETTINGS.get_int('intellihide-animation-time') * 0.001,
        //only delay the animation when hiding the panel after the user hovered out
        delay,
        transition: 'easeOutQuad',
        onComplete: () => {
          this._panelBox.visible = !destination
          onComplete ? onComplete() : null
          update()
        },
      }

      tweenOpts[this._translationProp] = destination
      Utils.animate(this._panelBox, tweenOpts)
    }

    this._hoveredOut = false
  }
}
