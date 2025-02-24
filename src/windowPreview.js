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

import GObject from 'gi://GObject'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import Graphene from 'gi://Graphene'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import Meta from 'gi://Meta'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import St from 'gi://St'

import * as Taskbar from './taskbar.js'
import * as Utils from './utils.js'
import { SETTINGS, DESKTOPSETTINGS } from './extension.js'
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js'

//timeout intervals
const ENSURE_VISIBLE_MS = 200

//timeout names
const T1 = 'openMenuTimeout'
const T2 = 'closeMenuTimeout'
const T3 = 'peekTimeout'
const T4 = 'ensureVisibleTimeout'

const MAX_TRANSLATION = 40
const HEADER_HEIGHT = 38
const MAX_CLOSE_BUTTON_SIZE = 30
const MIN_DIMENSION = 100
const FOCUSED_COLOR_OFFSET = 24
const HEADER_COLOR_OFFSET = -12
const FADE_SIZE = 36
const PEEK_INDEX_PROP = '_dtpPeekInitialIndex'

let headerHeight = 0
let alphaBg = 0
let isLeftButtons = false
let isTopHeader = true
let isManualStyling = false
let scaleFactor = 1
let animationTime = 0
let aspectRatio = {}

export const PreviewMenu = GObject.registerClass(
  {
    Signals: { 'open-state-changed': {} },
  },
  class PreviewMenu extends St.Widget {
    _init(panel) {
      super._init({ layout_manager: new Clutter.BinLayout() })

      let geom = panel.geom
      this.panel = panel
      this.currentAppIcon = null
      this._focusedPreview = null
      this._peekedWindow = null
      this.allowCloseWindow = true
      this.peekInitialWorkspaceIndex = -1
      this.opened = false
      this.isVertical =
        geom.position == St.Side.LEFT || geom.position == St.Side.RIGHT
      this._translationProp = 'translation_' + (this.isVertical ? 'x' : 'y')
      this._translationDirection =
        geom.position == St.Side.TOP || geom.position == St.Side.LEFT ? -1 : 1
      this._translationOffset =
        Math.min(panel.geom.innerSize, MAX_TRANSLATION) *
        this._translationDirection

      this.menu = new St.Widget({
        name: 'preview-menu',
        layout_manager: new Clutter.BinLayout(),
        reactive: true,
        track_hover: true,
        x_expand: true,
        y_expand: true,
        x_align:
          Clutter.ActorAlign[geom.position != St.Side.RIGHT ? 'START' : 'END'],
        y_align:
          Clutter.ActorAlign[geom.position != St.Side.BOTTOM ? 'START' : 'END'],
      })
      this._box = Utils.createBoxLayout({ vertical: this.isVertical })
      this._scrollView = new St.ScrollView({
        name: 'dashtopanelPreviewScrollview',
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.NEVER,
        enable_mouse_scrolling: true,
        y_expand: !this.isVertical,
      })

      this._scrollView.add_child(this._box)
      this.menu.add_child(this._scrollView)
      this.add_child(this.menu)
    }

    enable() {
      this._timeoutsHandler = new Utils.TimeoutsHandler()
      this._signalsHandler = new Utils.GlobalSignalsHandler()

      Main.layoutManager.addChrome(this, { affectsInputRegion: false })
      Main.layoutManager.trackChrome(this.menu, { affectsInputRegion: true })

      this._resetHiddenState()
      this._refreshGlobals()
      this._updateClip()
      this.menu.set_position(1, 1)

      this._signalsHandler.add(
        [this.menu, 'notify::hover', () => this._onHoverChanged()],
        [this._scrollView, 'scroll-event', this._onScrollEvent.bind(this)],
        [this.panel.panelBox, 'style-changed', () => this._updateClip()],
        [
          Utils.DisplayWrapper.getScreen(),
          'in-fullscreen-changed',
          () => {
            if (
              global.display.focus_window &&
              global.display.focus_window.is_fullscreen()
            ) {
              this.close(true)
            }
          },
        ],
        [
          SETTINGS,
          [
            'changed::panel-sizes',
            'changed::panel-side-margins',
            'changed::panel-top-bottom-margins',
            'changed::panel-side-padding',
            'changed::panel-top-bottom-padding',
            'changed::window-preview-size',
            'changed::window-preview-padding',
            'changed::window-preview-show-title',
          ],
          () => {
            this._refreshGlobals()
            this._updateClip()
          },
        ],
      )
    }

    disable() {
      this._timeoutsHandler.destroy()
      this._signalsHandler.destroy()

      this.close(true)

      Main.layoutManager.untrackChrome(this.menu)
      Main.layoutManager.removeChrome(this)
    }

    requestOpen(appIcon) {
      let timeout = SETTINGS.get_int('show-window-previews-timeout')

      if (this.opened) {
        timeout = Math.min(100, timeout)
      }

      this._endOpenCloseTimeouts()
      this._timeoutsHandler.add([T1, timeout, () => this.open(appIcon)])
    }

    requestClose() {
      this._endOpenCloseTimeouts()
      this._addCloseTimeout()
    }

    open(appIcon, preventCloseWindow) {
      if (this.currentAppIcon != appIcon) {
        this.currentAppIcon = appIcon
        this.allowCloseWindow = !preventCloseWindow

        if (!this.opened) {
          this._refreshGlobals()

          this.set_height(this.clipHeight)
          this.show()

          setStyle(
            this.menu,
            'background: ' +
              Utils.getrgbaColor(
                this.panel.dynamicTransparency.backgroundColorRgb,
                alphaBg,
              ),
          )
        }

        this._mergeWindows(appIcon)
        this._updatePosition()
        this._animateOpenOrClose(true)

        this._setReactive(true)
        this._setOpenedState(true)
      }
    }

    close(immediate) {
      this._endOpenCloseTimeouts()
      this._removeFocus()
      this._endPeek()

      if (immediate) {
        Utils.stopAnimations(this.menu)
        this._resetHiddenState()
      } else {
        this._animateOpenOrClose(false, () => this._resetHiddenState())
      }

      this._setReactive(false)
      this.currentAppIcon = null
    }

    update(appIcon, windows) {
      if (this.currentAppIcon == appIcon) {
        if (windows && !windows.length) {
          this.close()
        } else {
          this._addAndRemoveWindows(windows)
          this._updatePosition()
        }
      }
    }

    updatePosition() {
      this._updatePosition()
    }

    focusNext() {
      let previews = this._box.get_children()
      let currentIndex = this._focusedPreview
        ? previews.indexOf(this._focusedPreview)
        : -1
      let nextIndex = currentIndex + 1

      nextIndex = previews[nextIndex] ? nextIndex : 0

      if (previews[nextIndex]) {
        this._removeFocus()
        previews[nextIndex].setFocus(true)
        this._focusedPreview = previews[nextIndex]
      }

      return nextIndex
    }

    activateFocused() {
      if (this.opened && this._focusedPreview) {
        this._focusedPreview.activate()
      }
    }

    requestPeek(window) {
      this._timeoutsHandler.remove(T3)

      if (SETTINGS.get_boolean('peek-mode')) {
        if (this.peekInitialWorkspaceIndex < 0) {
          this._timeoutsHandler.add([
            T3,
            SETTINGS.get_int('enter-peek-mode-timeout'),
            () => this._peek(window),
          ])
        } else {
          this._peek(window)
        }
      }
    }

    endPeekHere() {
      this._endPeek(true)
    }

    ensureVisible(preview) {
      let [, upper, pageSize] = this._getScrollAdjustmentValues()

      if (upper > pageSize) {
        this._timeoutsHandler.add([
          T4,
          ENSURE_VISIBLE_MS,
          () =>
            Utils.ensureActorVisibleInScrollView(
              this._scrollView,
              preview,
              MIN_DIMENSION,
              () => this._updateScrollFade(),
            ),
        ])
      }
    }

    getCurrentAppIcon() {
      return this.currentAppIcon
    }

    _setReactive(reactive) {
      this._box.get_children().forEach((c) => (c.reactive = reactive))
      this.menu.reactive = reactive
    }

    _setOpenedState(opened) {
      this.opened = opened
      this.emit('open-state-changed')
    }

    _resetHiddenState() {
      this.hide()
      this.set_height(0)
      this._setOpenedState(false)
      this.menu.opacity = 0
      this.menu[this._translationProp] = this._translationOffset
      this._box.get_children().forEach((c) => c.destroy())
    }

    _removeFocus() {
      if (this._focusedPreview) {
        this._focusedPreview.setFocus(false)
        this._focusedPreview = null
      }
    }

    _mergeWindows(appIcon, windows) {
      windows =
        windows ||
        (appIcon.window
          ? [appIcon.window]
          : appIcon.getAppIconInterestingWindows())
      windows.sort(Taskbar.sortWindowsCompareFunction)

      let currentPreviews = this._box.get_children()
      let l = Math.max(windows.length, currentPreviews.length)

      for (let i = 0; i < l; ++i) {
        if (currentPreviews[i] && windows[i]) {
          currentPreviews[i].assignWindow(windows[i], this.opened)
        } else if (!currentPreviews[i]) {
          this._addNewPreview(windows[i])
        } else if (!windows[i]) {
          currentPreviews[i][!this.opened ? 'destroy' : 'animateOut']()
        }
      }
    }

    _addAndRemoveWindows(windows) {
      let currentPreviews = this._box.get_children()

      windows.sort(Taskbar.sortWindowsCompareFunction)

      for (let i = 0, l = windows.length; i < l; ++i) {
        let currentIndex = Utils.findIndex(
          currentPreviews,
          (c) => c.window == windows[i],
        )

        if (currentIndex < 0) {
          this._addNewPreview(windows[i])
        } else {
          currentPreviews[currentIndex].assignWindow(windows[i])
          currentPreviews.splice(currentIndex, 1)

          if (this._peekedWindow && this._peekedWindow == windows[i]) {
            this.requestPeek(windows[i])
          }
        }
      }

      currentPreviews.forEach((c) => c.animateOut())
    }

    _addNewPreview(window) {
      let preview = new Preview(this)

      this._box.add_child(preview)
      preview.adjustOnStage()
      preview.assignWindow(window, this.opened)
    }

    _addCloseTimeout() {
      this._timeoutsHandler.add([
        T2,
        SETTINGS.get_int('leave-timeout'),
        () => this.close(),
      ])
    }

    _onHoverChanged() {
      this._endOpenCloseTimeouts()

      if (this.currentAppIcon && !this.menu.hover) {
        this._addCloseTimeout()
        this._endPeek()
      }
    }

    _onScrollEvent(actor, event) {
      if (!event.is_pointer_emulated()) {
        let vOrh = this.isVertical ? 'v' : 'h'
        let adjustment =
          this._scrollView['get_' + vOrh + 'scroll_bar']().get_adjustment()
        let increment = adjustment.step_increment
        let delta = increment

        switch (event.get_scroll_direction()) {
          case Clutter.ScrollDirection.UP:
            delta = -increment
            break
          case Clutter.ScrollDirection.SMOOTH: {
            let [dx, dy] = event.get_scroll_delta()
            delta = dy * increment
            delta += dx * increment
            break
          }
        }

        adjustment.set_value(adjustment.get_value() + delta)
        this._updateScrollFade()
      }

      return Clutter.EVENT_STOP
    }

    _endOpenCloseTimeouts() {
      this._timeoutsHandler.remove(T1)
      this._timeoutsHandler.remove(T2)
      this._timeoutsHandler.remove(T4)
    }

    _refreshGlobals() {
      isLeftButtons =
        Meta.prefs_get_button_layout().left_buttons.indexOf(
          Meta.ButtonFunction.CLOSE,
        ) >= 0
      isTopHeader =
        SETTINGS.get_string('window-preview-title-position') == 'TOP'
      isManualStyling = SETTINGS.get_boolean('window-preview-manual-styling')
      scaleFactor = Utils.getScaleFactor()
      headerHeight = SETTINGS.get_boolean('window-preview-show-title')
        ? HEADER_HEIGHT * scaleFactor
        : 0
      animationTime = SETTINGS.get_int('window-preview-animation-time') * 0.001
      aspectRatio.x = {
        size: SETTINGS.get_int('window-preview-aspect-ratio-x'),
        fixed: SETTINGS.get_boolean('window-preview-fixed-x'),
      }
      aspectRatio.y = {
        size: SETTINGS.get_int('window-preview-aspect-ratio-y'),
        fixed: SETTINGS.get_boolean('window-preview-fixed-y'),
      }

      alphaBg = SETTINGS.get_boolean('preview-use-custom-opacity')
        ? SETTINGS.get_int('preview-custom-opacity') * 0.01
        : this.panel.dynamicTransparency.alpha
    }

    _updateClip() {
      let x, y, w
      let geom = this.panel.getGeometry()
      let panelSize = geom.outerSize - geom.fixedPadding
      let panelBoxTheme = this.panel.panelBox.get_theme_node()
      let previewSize =
        (SETTINGS.get_int('window-preview-size') +
          SETTINGS.get_int('window-preview-padding') * 2) *
        scaleFactor

      if (this.isVertical) {
        w = previewSize
        this.clipHeight = this.panel.monitor.height
        y = this.panel.monitor.y
      } else {
        w = this.panel.monitor.width
        this.clipHeight = previewSize + headerHeight
        x = this.panel.monitor.x
      }

      if (geom.position == St.Side.LEFT) {
        x =
          this.panel.monitor.x +
          panelSize -
          panelBoxTheme.get_padding(St.Side.RIGHT)
      } else if (geom.position == St.Side.RIGHT) {
        x =
          this.panel.monitor.x +
          this.panel.monitor.width -
          (panelSize + previewSize) +
          panelBoxTheme.get_padding(St.Side.LEFT)
      } else if (geom.position == St.Side.TOP) {
        y = geom.y + panelSize - panelBoxTheme.get_padding(St.Side.BOTTOM)
      } else {
        //St.Side.BOTTOM
        y =
          this.panel.monitor.y +
          this.panel.monitor.height -
          (panelSize -
            panelBoxTheme.get_padding(St.Side.TOP) +
            previewSize +
            headerHeight)
      }

      Utils.setClip(this, x, y, w, this.clipHeight)
    }

    _updatePosition() {
      let sourceNode = this.currentAppIcon.get_theme_node()
      let sourceContentBox = sourceNode.get_content_box(
        this.currentAppIcon.get_allocation_box(),
      )
      let sourceAllocation = Utils.getTransformedAllocation(this.currentAppIcon)
      let [previewsWidth, previewsHeight] = this._getPreviewsSize()
      let appIconMargin = SETTINGS.get_int('appicon-margin') / scaleFactor
      let x = 0,
        y = 0

      previewsWidth = Math.min(previewsWidth, this.panel.monitor.width)
      previewsHeight = Math.min(previewsHeight, this.panel.monitor.height)
      this._updateScrollFade(
        previewsWidth < this.panel.monitor.width &&
          previewsHeight < this.panel.monitor.height,
      )

      if (this.isVertical) {
        y =
          sourceAllocation.y1 +
          appIconMargin -
          this.panel.monitor.y +
          (sourceContentBox.y2 - sourceContentBox.y1 - previewsHeight) * 0.5
        y = Math.max(y, 0)
        y = Math.min(y, this.panel.monitor.height - previewsHeight)
      } else {
        x =
          sourceAllocation.x1 +
          appIconMargin -
          this.panel.monitor.x +
          (sourceContentBox.x2 - sourceContentBox.x1 - previewsWidth) * 0.5
        x = Math.max(x, 0)
        x = Math.min(x, this.panel.monitor.width - previewsWidth)
      }

      if (!this.opened) {
        this.menu.set_position(x, y)
        this.menu.set_size(previewsWidth, previewsHeight)
      } else {
        Utils.animate(
          this.menu,
          getTweenOpts({
            x: x,
            y: y,
            width: previewsWidth,
            height: previewsHeight,
          }),
        )
      }
    }

    _updateScrollFade(remove) {
      let [value, upper, pageSize] = this._getScrollAdjustmentValues()
      let needsFade = Math.round(upper) > Math.round(pageSize)
      let fadeWidgets = this.menu
        .get_children()
        .filter((c) => c != this._scrollView)

      if (!remove && needsFade) {
        if (!fadeWidgets.length) {
          fadeWidgets.push(this._getFadeWidget())
          fadeWidgets.push(this._getFadeWidget(true))

          this.menu.add_child(fadeWidgets[0])
          this.menu.add_child(fadeWidgets[1])
        }

        fadeWidgets[0].visible = value > 0
        fadeWidgets[1].visible = value + pageSize < upper
      } else if (remove || (!needsFade && fadeWidgets.length)) {
        fadeWidgets.forEach((fw) => fw.destroy())
      }
    }

    _getScrollAdjustmentValues() {
      let [value, , upper, , , pageSize] =
        this._scrollView[
          (this.isVertical ? 'v' : 'h') + 'adjustment'
        ].get_values()

      return [value, upper, pageSize]
    }

    _getFadeWidget(end) {
      let x = 0,
        y = 0
      let startBg = Utils.getrgbaColor(
        this.panel.dynamicTransparency.backgroundColorRgb,
        Math.min(alphaBg + 0.1, 1),
      )
      let endBg = Utils.getrgbaColor(
        this.panel.dynamicTransparency.backgroundColorRgb,
        0,
      )
      let fadeStyle =
        'background-gradient-start:' +
        startBg +
        'background-gradient-end:' +
        endBg +
        'background-gradient-direction:' +
        this.panel.getOrientation()

      if (this.isVertical) {
        y = end ? this.panel.monitor.height - FADE_SIZE : 0
      } else {
        x = end ? this.panel.monitor.width - FADE_SIZE : 0
      }

      let fadeWidget = new St.Widget({
        reactive: false,
        pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
        rotation_angle_z: end ? 180 : 0,
        style: fadeStyle,
        x: x,
        y: y,
        width: this.isVertical ? this.width : FADE_SIZE,
        height: this.isVertical ? FADE_SIZE : this.height,
      })

      return fadeWidget
    }

    _getPreviewsSize() {
      let previewsWidth = 0
      let previewsHeight = 0

      this._box.get_children().forEach((c) => {
        if (!c.animatingOut) {
          let [width, height] = c.getSize()

          if (this.isVertical) {
            previewsWidth = Math.max(width, previewsWidth)
            previewsHeight += height
          } else {
            previewsWidth += width
            previewsHeight = Math.max(height, previewsHeight)
          }
        }
      })

      return [previewsWidth, previewsHeight]
    }

    _animateOpenOrClose(show, onComplete) {
      let isTranslationAnimation = this.menu[this._translationProp] != 0
      let tweenOpts = {
        opacity: show ? 255 : 0,
        transition: show ? 'easeInOutQuad' : 'easeInCubic',
        onComplete: () => {
          if (isTranslationAnimation) {
            Main.layoutManager._queueUpdateRegions()
          }

          ;(onComplete || (() => {}))()
        },
      }

      tweenOpts[this._translationProp] = show
        ? this._translationDirection
        : this._translationOffset

      Utils.animate(this.menu, getTweenOpts(tweenOpts))
    }

    _peek(window) {
      let currentWorkspace = Utils.getCurrentWorkspace()
      let isAppSpread = !Main.sessionMode.hasWorkspaces
      let windowWorkspace = isAppSpread
        ? currentWorkspace
        : window.get_workspace()
      let focusWindow = () =>
        this._focusMetaWindow(SETTINGS.get_int('peek-mode-opacity'), window)

      this._restorePeekedWindowStack()

      if (this._peekedWindow && windowWorkspace != currentWorkspace) {
        currentWorkspace
          .list_windows()
          .forEach((mw) => this.animateWindowOpacity(mw, null, 255))
      }

      this._peekedWindow = window

      if (currentWorkspace != windowWorkspace) {
        this._switchToWorkspaceImmediate(windowWorkspace.index())
        this._timeoutsHandler.add([T3, 100, focusWindow])
      } else {
        focusWindow()
      }

      if (this.peekInitialWorkspaceIndex < 0) {
        this.peekInitialWorkspaceIndex = currentWorkspace.index()
      }
    }

    _endPeek(stayHere) {
      this._timeoutsHandler.remove(T3)

      if (this._peekedWindow) {
        let immediate =
          !stayHere &&
          this.peekInitialWorkspaceIndex != Utils.getCurrentWorkspace().index()

        this._restorePeekedWindowStack()
        this._focusMetaWindow(255, this._peekedWindow, immediate, true)
        this._peekedWindow = null

        if (!stayHere) {
          this._switchToWorkspaceImmediate(this.peekInitialWorkspaceIndex)
        }

        this.peekInitialWorkspaceIndex = -1
      }
    }

    _switchToWorkspaceImmediate(workspaceIndex) {
      let workspace = Utils.getWorkspaceByIndex(workspaceIndex)
      let shouldAnimate = Main.wm._shouldAnimate

      if (
        !workspace ||
        (!workspace.list_windows().length &&
          workspaceIndex < Utils.getWorkspaceCount() - 1)
      ) {
        workspace = Utils.getCurrentWorkspace()
      }

      Main.wm._shouldAnimate = () => false
      workspace.activate(global.display.get_current_time_roundtrip())
      Main.wm._shouldAnimate = shouldAnimate
    }

    _focusMetaWindow(dimOpacity, window, immediate, ignoreFocus) {
      let isAppSpread = !Main.sessionMode.hasWorkspaces
      let windowWorkspace = isAppSpread
        ? Utils.getCurrentWorkspace()
        : window.get_workspace()
      let windows = isAppSpread
        ? Utils.getAllMetaWindows()
        : windowWorkspace.list_windows()

      windows.forEach((mw) => {
        let wa = mw.get_compositor_private()
        let isFocused = !ignoreFocus && mw == window

        if (wa) {
          if (isFocused) {
            mw[PEEK_INDEX_PROP] = wa.get_parent().get_children().indexOf(wa)
            wa.get_parent().set_child_above_sibling(wa, null)
          }

          if (isFocused && mw.minimized) {
            wa.show()
          }

          this.animateWindowOpacity(
            mw,
            wa,
            isFocused ? 255 : dimOpacity,
            immediate,
          )
        }
      })
    }

    animateWindowOpacity(metaWindow, windowActor, opacity, immediate) {
      windowActor = windowActor || metaWindow.get_compositor_private()

      if (windowActor && !metaWindow.minimized) {
        let tweenOpts = getTweenOpts({ opacity })

        if (immediate && !metaWindow.is_on_all_workspaces()) {
          tweenOpts.time = 0
        }

        Utils.animateWindowOpacity(windowActor, tweenOpts)
      }
    }

    _restorePeekedWindowStack() {
      let windowActor = this._peekedWindow
        ? this._peekedWindow.get_compositor_private()
        : null

      if (windowActor) {
        if (Object.hasOwn(this._peekedWindow, PEEK_INDEX_PROP)) {
          windowActor
            .get_parent()
            .set_child_at_index(
              windowActor,
              this._peekedWindow[PEEK_INDEX_PROP],
            )
          delete this._peekedWindow[PEEK_INDEX_PROP]
        }

        if (this._peekedWindow.minimized) {
          windowActor.hide()
        }
      }
    }
  },
)

export const Preview = GObject.registerClass(
  {},
  class Preview extends St.Widget {
    _init(previewMenu) {
      super._init({
        style_class: 'preview-container',
        reactive: true,
        track_hover: true,
        layout_manager: new Clutter.BinLayout(),
      })

      this.window = null
      this._waitWindowId = 0
      this._needsCloseButton = true
      this.cloneWidth = this.cloneHeight = 0
      this._previewMenu = previewMenu
      this._padding = SETTINGS.get_int('window-preview-padding') * scaleFactor
      this._previewDimensions = this._getPreviewDimensions()
      this.animatingOut = false

      let box = new St.Widget({
        layout_manager: new Clutter.BoxLayout({
          orientation: Clutter.Orientation.VERTICAL,
        }),
        y_expand: true,
      })
      let [previewBinWidth, previewBinHeight] = this._getBinSize()
      let closeButton = new St.Button({
        style_class: 'window-close',
        accessible_name: 'Close window',
      })

      closeButton.add_child(new St.Icon({ icon_name: 'window-close-symbolic' }))

      this._closeButtonBin = new St.Widget({
        style_class: 'preview-close-btn-container',
        layout_manager: new Clutter.BinLayout(),
        opacity: 0,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign[isLeftButtons ? 'START' : 'END'],
        y_align: Clutter.ActorAlign[isTopHeader ? 'START' : 'END'],
      })

      this._closeButtonBin.add_child(closeButton)

      this._previewBin = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
        style: 'padding: ' + this._padding / scaleFactor + 'px;',
      })

      this._previewBin.set_size(previewBinWidth, previewBinHeight)

      box.add_child(this._previewBin)

      if (headerHeight) {
        let headerBox = new St.Widget({
          style_class: 'preview-header-box',
          layout_manager: new Clutter.BoxLayout(),
          x_expand: true,
          y_align: Clutter.ActorAlign[isTopHeader ? 'START' : 'END'],
        })

        setStyle(headerBox, this._getBackgroundColor(HEADER_COLOR_OFFSET, 1))
        this._workspaceIndicator = new St.Label({
          y_align: Clutter.ActorAlign.CENTER,
        })
        this._windowTitle = new St.Label({
          y_align: Clutter.ActorAlign.CENTER,
          x_expand: true,
        })

        this._iconBin = new St.Widget({
          layout_manager: new Clutter.BinLayout(),
        })
        this._iconBin.set_size(headerHeight, headerHeight)

        headerBox.add_child(this._iconBin)
        headerBox.insert_child_at_index(
          this._workspaceIndicator,
          isLeftButtons ? 0 : 1,
        )
        headerBox.insert_child_at_index(
          this._windowTitle,
          isLeftButtons ? 1 : 2,
        )

        box.insert_child_at_index(headerBox, isTopHeader ? 0 : 1)
      }

      this.add_child(box)
      this.add_child(this._closeButtonBin)

      closeButton.connect('clicked', () => this._onCloseBtnClick())
      this.connect('notify::hover', () => this._onHoverChanged())
      this.connect('button-release-event', (actor, e) =>
        this._onButtonReleaseEvent(e),
      )
      this.connect('destroy', () => this._onDestroy())
    }

    adjustOnStage() {
      let closeButton = this._closeButtonBin.get_first_child()
      let closeButtonHeight = closeButton.height
      let maxCloseButtonSize = MAX_CLOSE_BUTTON_SIZE * scaleFactor
      let closeButtonBorderRadius = ''

      if (closeButtonHeight > maxCloseButtonSize) {
        closeButtonHeight = maxCloseButtonSize
        closeButton.set_size(closeButtonHeight, closeButtonHeight)
      }

      if (!headerHeight) {
        closeButtonBorderRadius = 'border-radius: '

        if (isTopHeader) {
          closeButtonBorderRadius += isLeftButtons ? '0 0 4px 0;' : '0 0 0 4px;'
        } else {
          closeButtonBorderRadius += isLeftButtons ? '0 4px 0 0;' : '4px 0 0 0;'
        }
      }

      setStyle(
        this._closeButtonBin,
        'padding: ' +
          (headerHeight
            ? Math.round(
                ((headerHeight - closeButtonHeight) * 0.5) / scaleFactor,
              )
            : 4) +
          'px;' +
          this._getBackgroundColor(
            HEADER_COLOR_OFFSET,
            headerHeight ? 1 : 0.6,
          ) +
          closeButtonBorderRadius,
      )
    }

    assignWindow(window, animateSize) {
      if (this.window != window) {
        let _assignWindowClone = () => {
          if (window.get_compositor_private()) {
            let cloneBin = this._getWindowCloneBin(window)

            this._resizeClone(cloneBin, window)
            this._addClone(cloneBin, animateSize)
            this._previewMenu.updatePosition()
          } else if (!this._waitWindowId) {
            this._waitWindowId = GLib.idle_add(
              GLib.PRIORITY_DEFAULT_IDLE,
              () => {
                this._waitWindowId = 0

                if (this._previewMenu.opened) {
                  _assignWindowClone()
                }

                return GLib.SOURCE_REMOVE
              },
            )
          }
        }

        _assignWindowClone()
      }

      this._cancelAnimateOut()
      this._removeWindowSignals()
      this.window = window
      this._needsCloseButton =
        this._previewMenu.allowCloseWindow &&
        window.can_close() &&
        !Utils.checkIfWindowHasTransient(window)
      this._updateHeader()
    }

    animateOut() {
      if (!this.animatingOut) {
        let tweenOpts = getTweenOpts({
          opacity: 0,
          width: 0,
          height: 0,
          onComplete: () => this.destroy(),
        })

        this.animatingOut = true

        Utils.stopAnimations(this)
        Utils.animate(this, tweenOpts)
      }
    }

    getSize() {
      let [binWidth, binHeight] = this._getBinSize()

      binWidth = Math.max(binWidth, this.cloneWidth + this._padding * 2)
      binHeight =
        Math.max(binHeight, this.cloneHeight + this._padding * 2) + headerHeight

      return [binWidth, binHeight]
    }

    setFocus(focused) {
      this._hideOrShowCloseButton(!focused)
      setStyle(
        this,
        this._getBackgroundColor(FOCUSED_COLOR_OFFSET, focused ? '-' : 0),
      )

      if (focused) {
        this._previewMenu.ensureVisible(this)
        this._previewMenu.requestPeek(this.window)
      }
    }

    activate() {
      this._previewMenu.endPeekHere()
      this._previewMenu.close()
      Main.activateWindow(this.window)
    }

    _onDestroy() {
      if (this._waitWindowId) {
        GLib.source_remove(this._waitWindowId)
        this._waitWindowId = 0
      }

      this._removeWindowSignals()
    }

    _onHoverChanged() {
      this.setFocus(this.hover)
    }

    _onCloseBtnClick() {
      this._hideOrShowCloseButton(true)
      this.reactive = false

      if (!SETTINGS.get_boolean('group-apps')) {
        this._previewMenu.close()
      } else {
        this._previewMenu.endPeekHere()
      }

      this.window.delete(global.get_current_time())
    }

    _onButtonReleaseEvent(e) {
      switch (e.get_button()) {
        case 1: // Left click
          this.activate()
          break
        case 2: // Middle click
          if (SETTINGS.get_boolean('preview-middle-click-close')) {
            this._onCloseBtnClick()
          }
          break
        case 3: // Right click
          this._showContextMenu(e)
          break
      }

      return Clutter.EVENT_STOP
    }

    _cancelAnimateOut() {
      if (this.animatingOut) {
        this.animatingOut = false

        Utils.stopAnimations(this)
        Utils.animate(
          this,
          getTweenOpts({
            opacity: 255,
            width: this.cloneWidth,
            height: this.cloneHeight,
          }),
        )
      }
    }

    _showContextMenu(e) {
      let coords = e.get_coords()
      let currentWorkspace =
        this._previewMenu.peekInitialWorkspaceIndex < 0
          ? Utils.getCurrentWorkspace()
          : Utils.getWorkspaceByIndex(
              this._previewMenu.peekInitialWorkspaceIndex,
            )

      Main.wm._showWindowMenu(null, this.window, Meta.WindowMenuType.WM, {
        x: coords[0],
        y: coords[1],
        width: 0,
        height: 0,
      })

      let menu = Main.wm._windowMenuManager._manager._menus[0]

      menu.connect('open-state-changed', () =>
        this._previewMenu.menu.sync_hover(),
      )
      this._previewMenu.menu.sync_hover()

      if (this.window.get_workspace() != currentWorkspace) {
        let menuItem = new PopupMenu.PopupMenuItem(
          _('Move to current Workspace') +
            ' [' +
            (currentWorkspace.index() + 1) +
            ']',
        )
        let menuItems = menu.box.get_children()
        let insertIndex = Utils.findIndex(
          menuItems,
          (c) => c._delegate instanceof PopupMenu.PopupSeparatorMenuItem,
        )

        insertIndex = insertIndex >= 0 ? insertIndex : menuItems.length - 1
        menu.addMenuItem(menuItem, insertIndex)
        menuItem.connect('activate', () =>
          this.window.change_workspace(currentWorkspace),
        )
      }
    }

    _removeWindowSignals() {
      if (this._titleWindowChangeId) {
        this.window.disconnect(this._titleWindowChangeId)
        this._titleWindowChangeId = 0
      }
    }

    _updateHeader() {
      if (headerHeight) {
        let iconTextureSize = SETTINGS.get_boolean(
          'window-preview-use-custom-icon-size',
        )
          ? SETTINGS.get_int('window-preview-custom-icon-size')
          : (headerHeight / scaleFactor) * 0.6
        let icon = this._previewMenu
          .getCurrentAppIcon()
          .app.create_icon_texture(iconTextureSize)
        let workspaceIndex = ''
        let workspaceStyle = null
        let fontScale = DESKTOPSETTINGS.get_double('text-scaling-factor')
        let commonTitleStyles =
          'color: ' +
          SETTINGS.get_string('window-preview-title-font-color') +
          ';' +
          'font-size: ' +
          SETTINGS.get_int('window-preview-title-font-size') * fontScale +
          'px;' +
          'font-weight: ' +
          SETTINGS.get_string('window-preview-title-font-weight') +
          ';'

        this._iconBin.destroy_all_children()
        this._iconBin.add_child(icon)

        if (!SETTINGS.get_boolean('isolate-workspaces')) {
          workspaceIndex = (this.window.get_workspace().index() + 1).toString()
          workspaceStyle =
            'margin: 0 4px 0 ' +
            (isLeftButtons
              ? Math.round((headerHeight - icon.width) * 0.5) + 'px'
              : '0') +
            '; padding: 0 4px;' +
            'border: 2px solid ' +
            this._getRgbaColor(FOCUSED_COLOR_OFFSET, 0.8) +
            'border-radius: 2px;' +
            commonTitleStyles
        }

        this._workspaceIndicator.text = workspaceIndex
        setStyle(this._workspaceIndicator, workspaceStyle)

        this._titleWindowChangeId = this.window.connect('notify::title', () =>
          this._updateWindowTitle(),
        )
        setStyle(
          this._windowTitle,
          'max-width: 0px; padding-right: 4px;' + commonTitleStyles,
        )
        this._updateWindowTitle()
      }
    }

    _updateWindowTitle() {
      this._windowTitle.text = this.window.title
    }

    _hideOrShowCloseButton(hide) {
      if (this._needsCloseButton) {
        Utils.animate(
          this._closeButtonBin,
          getTweenOpts({ opacity: hide ? 0 : 255 }),
        )
      }
    }

    _getBackgroundColor(offset, alpha) {
      return (
        'background-color: ' +
        this._getRgbaColor(offset, alpha) +
        'transition-duration:' +
        this._previewMenu.panel.dynamicTransparency.animationDuration
      )
    }

    _getRgbaColor(offset, alpha) {
      alpha = Math.abs(alpha)

      if (isNaN(alpha)) {
        alpha = alphaBg
      }

      return Utils.getrgbaColor(
        this._previewMenu.panel.dynamicTransparency.backgroundColorRgb,
        alpha,
        offset,
      )
    }

    _addClone(newCloneBin, animateSize) {
      let currentClones = this._previewBin.get_children()
      let newCloneOpts = getTweenOpts({ opacity: 255 })

      this._previewBin.add_child(newCloneBin)

      if (currentClones.length) {
        let currentCloneBin = currentClones.pop()
        let currentCloneOpts = getTweenOpts({
          opacity: 0,
          onComplete: () => currentCloneBin.destroy(),
        })

        if (newCloneBin.width > currentCloneBin.width) {
          newCloneOpts.width = newCloneBin.width
          newCloneBin.width = currentCloneBin.width
        } else {
          currentCloneOpts.width = newCloneBin.width
        }

        if (newCloneBin.height > currentCloneBin.height) {
          newCloneOpts.height = newCloneBin.height
          newCloneBin.height = currentCloneBin.height
        } else {
          currentCloneOpts.height = newCloneBin.height
        }

        currentClones.forEach((c) => c.destroy())
        Utils.animate(currentCloneBin, currentCloneOpts)
      } else if (animateSize) {
        newCloneBin.width = 0
        newCloneBin.height = 0
        newCloneOpts.width = this.cloneWidth
        newCloneOpts.height = this.cloneHeight
      }

      Utils.animate(newCloneBin, newCloneOpts)
    }

    _getWindowCloneBin(window) {
      let frameRect = window.get_frame_rect()
      let bufferRect = window.get_buffer_rect()
      let clone = new Clutter.Clone({ source: window.get_compositor_private() })
      let cloneBin = new St.Widget({
        opacity: 0,
        layout_manager:
          frameRect.width != bufferRect.width ||
          frameRect.height != bufferRect.height
            ? new WindowCloneLayout(frameRect, bufferRect)
            : new Clutter.BinLayout(),
      })

      cloneBin.add_child(clone)

      return cloneBin
    }

    _getBinSize() {
      let [fixedWidth, fixedHeight] = this._previewDimensions

      return [
        aspectRatio.x.fixed ? fixedWidth + this._padding * 2 : -1,
        aspectRatio.y.fixed ? fixedHeight + this._padding * 2 : -1,
      ]
    }

    _resizeClone(cloneBin, window) {
      let frameRect =
        cloneBin.layout_manager.frameRect || window.get_frame_rect()
      let [fixedWidth, fixedHeight] = this._previewDimensions
      let ratio = Math.min(
        fixedWidth / frameRect.width,
        fixedHeight / frameRect.height,
        1,
      )
      let cloneWidth = frameRect.width * ratio
      let cloneHeight = frameRect.height * ratio

      let clonePaddingTB =
        cloneHeight < MIN_DIMENSION ? MIN_DIMENSION - cloneHeight : 0
      let clonePaddingLR =
        cloneWidth < MIN_DIMENSION ? MIN_DIMENSION - cloneWidth : 0
      let clonePaddingTop = clonePaddingTB * 0.5
      let clonePaddingLeft = clonePaddingLR * 0.5

      this.cloneWidth = cloneWidth + clonePaddingLR * scaleFactor
      this.cloneHeight = cloneHeight + clonePaddingTB * scaleFactor

      cloneBin.set_style(
        'padding: ' + clonePaddingTop + 'px ' + clonePaddingLeft + 'px;',
      )
      cloneBin.layout_manager.ratio = ratio
      cloneBin.layout_manager.padding = [
        clonePaddingLeft * scaleFactor,
        clonePaddingTop * scaleFactor,
      ]

      cloneBin.get_first_child().set_size(cloneWidth, cloneHeight)
    }

    _getPreviewDimensions() {
      let size = SETTINGS.get_int('window-preview-size') * scaleFactor
      let w, h

      if (this._previewMenu.isVertical) {
        w = size
        h = (w * aspectRatio.y.size) / aspectRatio.x.size
      } else {
        h = size
        w = (h * aspectRatio.x.size) / aspectRatio.y.size
      }

      return [w, h]
    }
  },
)

export const WindowCloneLayout = GObject.registerClass(
  {},
  class WindowCloneLayout extends Clutter.BinLayout {
    _init(frameRect, bufferRect) {
      super._init()

      //the buffer_rect contains the transparent padding that must be removed
      this.frameRect = frameRect
      this.bufferRect = bufferRect
    }

    vfunc_allocate(actor, box) {
      let [width, height] = box.get_size()

      box.set_origin(
        (this.bufferRect.x - this.frameRect.x) * this.ratio + this.padding[0],
        (this.bufferRect.y - this.frameRect.y) * this.ratio + this.padding[1],
      )

      box.set_size(
        width + (this.bufferRect.width - this.frameRect.width) * this.ratio,
        height + (this.bufferRect.height - this.frameRect.height) * this.ratio,
      )

      actor.get_first_child().allocate(box)
    }
  },
)

export function setStyle(actor, style) {
  if (!isManualStyling) {
    actor.set_style(style)
  }
}

export function getTweenOpts(opts) {
  let defaults = {
    time: animationTime,
    transition: 'easeInOutQuad',
  }

  return Utils.mergeObjects(opts || {}, defaults)
}
