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
 * This file is based on code from the Dash to Dock extension by micheleg
 * and code from the Taskbar extension by Zorin OS
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

import Clutter from 'gi://Clutter'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import GObject from 'gi://GObject'
import Graphene from 'gi://Graphene'
import Shell from 'gi://Shell'
import St from 'gi://St'

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js'
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js'
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import { EventEmitter } from 'resource:///org/gnome/shell/misc/signals.js'

import * as AppIcons from './appIcons.js'
import * as PanelManager from './panelManager.js'
import * as PanelSettings from './panelSettings.js'
import * as Pos from './panelPositions.js'
import * as Utils from './utils.js'
import * as WindowPreview from './windowPreview.js'
import { SETTINGS, tracker } from './extension.js'

const SearchController = Main.overview.searchController

export var hotkeyAppNumbers = {}

export const DASH_ANIMATION_TIME = 0.2 // Dash.DASH_ANIMATION_TIME is now private
const DASH_ITEM_HOVER_TIMEOUT = 0.3 // Dash.DASH_ITEM_HOVER_TIMEOUT is now private
export const MIN_ICON_SIZE = 4

const T1 = 'ensureAppIconVisibilityTimeout'
const T2 = 'showLabelTimeout'
const T3 = 'resetHoverTimeout'

/**
 * Extend DashItemContainer
 *
 * - set label position based on taskbar orientation
 *
 *  I can't subclass the original object because of this: https://bugzilla.gnome.org/show_bug.cgi?id=688973.
 *  thus use this ugly pattern.
 */

export function extendDashItemContainer(dashItemContainer) {
  dashItemContainer.showLabel = AppIcons.ItemShowLabel
}

const iconAnimationSettings = {
  _getDictValue(key) {
    let type = SETTINGS.get_string('animate-appicon-hover-animation-type')
    return SETTINGS.get_value(key).deep_unpack()[type] || 0
  },

  get type() {
    if (!SETTINGS.get_boolean('animate-appicon-hover')) return ''

    return SETTINGS.get_string('animate-appicon-hover-animation-type')
  },

  get convexity() {
    return Math.max(
      0,
      this._getDictValue('animate-appicon-hover-animation-convexity'),
    )
  },

  get duration() {
    return this._getDictValue('animate-appicon-hover-animation-duration')
  },

  get extent() {
    return Math.max(
      1,
      this._getDictValue('animate-appicon-hover-animation-extent'),
    )
  },

  get rotation() {
    return this._getDictValue('animate-appicon-hover-animation-rotation')
  },

  get travel() {
    return Math.max(
      -1,
      this._getDictValue('animate-appicon-hover-animation-travel'),
    )
  },

  get zoom() {
    return Math.max(
      0.5,
      this._getDictValue('animate-appicon-hover-animation-zoom'),
    )
  },
}

/* This class is a fork of the upstream DashActor class (ui.dash.js)
 *
 * Summary of changes:
 * - modified chldBox calculations for when 'show-apps-at-top' option is checked
 * - handle horizontal dash
 */
export const TaskbarActor = GObject.registerClass(
  {},
  class TaskbarActor extends St.Widget {
    _init(delegate) {
      this._delegate = delegate
      this._currentBackgroundColor = 0
      super._init({
        name: 'dashtopanelTaskbar',
        layout_manager: new Clutter.BoxLayout({
          orientation:
            Clutter.Orientation[
              delegate.dtpPanel.getOrientation().toUpperCase()
            ],
        }),
        clip_to_allocation: true,
      })
    }

    vfunc_allocate(box) {
      this.set_allocation(box)

      let panel = this._delegate.dtpPanel
      let availFixedSize = box[panel.fixedCoord.c2] - box[panel.fixedCoord.c1]
      let availVarSize = box[panel.varCoord.c2] - box[panel.varCoord.c1]
      let [dummy, scrollview, leftFade, rightFade] = this.get_children()
      let [, natSize] = this[panel.sizeFunc](availFixedSize)
      let childBox = new Clutter.ActorBox()
      let orientation = panel.getOrientation()

      dummy.allocate(childBox)

      childBox[panel.varCoord.c1] = box[panel.varCoord.c1]
      childBox[panel.varCoord.c2] = Math.min(availVarSize, natSize)
      childBox[panel.fixedCoord.c1] = box[panel.fixedCoord.c1]
      childBox[panel.fixedCoord.c2] = box[panel.fixedCoord.c2]

      scrollview.allocate(childBox)

      let [, , upper, , , pageSize] =
        scrollview[orientation[0] + 'adjustment'].get_values()
      upper = Math.floor(upper)
      scrollview._dtpFadeSize = upper > pageSize ? this._delegate.iconSize : 0

      if (
        this._currentBackgroundColor !==
        panel.dynamicTransparency.currentBackgroundColor
      ) {
        this._currentBackgroundColor =
          panel.dynamicTransparency.currentBackgroundColor
        let gradientStyle =
          'background-gradient-start: ' +
          this._currentBackgroundColor +
          'background-gradient-direction: ' +
          orientation

        leftFade.set_style(gradientStyle)
        rightFade.set_style(gradientStyle)
      }

      childBox[panel.varCoord.c2] =
        childBox[panel.varCoord.c1] + scrollview._dtpFadeSize
      leftFade.allocate(childBox)

      childBox[panel.varCoord.c1] =
        box[panel.varCoord.c2] - scrollview._dtpFadeSize
      childBox[panel.varCoord.c2] = box[panel.varCoord.c2]
      rightFade.allocate(childBox)
    }

    // We want to request the natural size of all our children
    // as our natural width, so we chain up to StWidget (which
    // then calls BoxLayout)
    vfunc_get_preferred_width(forHeight) {
      let [, natWidth] = St.Widget.prototype.vfunc_get_preferred_width.call(
        this,
        forHeight,
      )

      return [0, natWidth]
    }

    vfunc_get_preferred_height(forWidth) {
      let [, natHeight] = St.Widget.prototype.vfunc_get_preferred_height.call(
        this,
        forWidth,
      )

      return [0, natHeight]
    }
  },
)

/* This class is a fork of the upstream dash class (ui.dash.js)
 *
 * Summary of changes:
 * - disconnect global signals adding a destroy method;
 * - play animations even when not in overview mode
 * - set a maximum icon size
 * - show running and/or favorite applications
 * - emit a custom signal when an app icon is added
 * - Add scrollview
 *   Ensure actor is visible on keyfocus inside the scrollview
 * - add 128px icon size, might be useful for hidpi display
 * - Sync minimization application target position.
 */

export const Taskbar = class extends EventEmitter {
  constructor(panel) {
    super()

    this.dtpPanel = panel

    // start at smallest size due to running indicator drawing area expanding but not shrinking
    this.iconSize = 16

    this._shownInitially = false

    this._signalsHandler = new Utils.GlobalSignalsHandler()
    this._timeoutsHandler = new Utils.TimeoutsHandler()

    this._labelShowing = false
    this.fullScrollView = 0

    let isVertical = panel.checkIfVertical()

    this._box = Utils.createBoxLayout({
      vertical: isVertical,
      clip_to_allocation: false,
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.START,
    })

    this._container = new TaskbarActor(this)
    this._scrollView = new St.ScrollView({
      name: 'dashtopanelScrollview',
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.NEVER,
      enable_mouse_scrolling: true,
    })

    this._scrollView.connect('leave-event', this._onLeaveEvent.bind(this))
    this._scrollView.connect('motion-event', this._onMotionEvent.bind(this))
    this._scrollView.connect('scroll-event', this._onScrollEvent.bind(this))
    this._scrollView.add_child(this._box)

    this._showAppsIconWrapper = panel.showAppsIconWrapper
    this._showAppsIconWrapper.connect(
      'menu-state-changed',
      (showAppsIconWrapper, opened) => {
        this._itemMenuStateChanged(showAppsIconWrapper, opened)
      },
    )
    // an instance of the showAppsIcon class is encapsulated in the wrapper
    this._showAppsIcon = this._showAppsIconWrapper.realShowAppsIcon
    this.showAppsButton = this._showAppsIcon.toggleButton

    if (isVertical) {
      this.showAppsButton.set_width(panel.geom.w)
    }

    this.showAppsButton.connect(
      'notify::checked',
      this._onShowAppsButtonToggled.bind(this),
    )

    this.showAppsButton.checked = SearchController._showAppsButton
      ? SearchController._showAppsButton.checked
      : false

    this._showAppsIcon.childScale = 1
    this._showAppsIcon.childOpacity = 255
    this._showAppsIcon.icon.setIconSize(this.iconSize)
    this._hookUpLabel(this._showAppsIcon, this._showAppsIconWrapper)

    this._container.add_child(new St.Widget({ width: 0, reactive: false }))
    this._container.add_child(this._scrollView)

    let orientation = panel.getOrientation()
    let fadeStyle = 'background-gradient-direction:' + orientation
    this._fadeLeft = new St.Widget({
      style_class: 'scrollview-fade',
      reactive: false,
    })
    this._fadeRight = new St.Widget({
      style_class: 'scrollview-fade',
      reactive: false,
      pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
      rotation_angle_z: 180,
    })

    this._fadeLeft.set_style(fadeStyle)
    this._fadeRight.set_style(fadeStyle)

    this._container.add_child(this._fadeLeft)
    this._container.add_child(this._fadeRight)

    this.previewMenu = new WindowPreview.PreviewMenu(panel)
    this.previewMenu.enable()

    let rtl = Clutter.get_default_text_direction() == Clutter.TextDirection.RTL
    this.actor = new St.Bin({
      child: this._container,
      y_align: Clutter.ActorAlign.START,
      x_align: rtl ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
    })

    const adjustment = this._scrollView[orientation[0] + 'adjustment']

    this._workId = Main.initializeDeferredWork(
      this._box,
      this._redisplay.bind(this),
    )

    this._settings = new Gio.Settings({ schema_id: 'org.gnome.shell' })

    this._appSystem = Shell.AppSystem.get_default()

    this.iconAnimator = new PanelManager.IconAnimator(this.dtpPanel.panel)

    this._signalsHandler.add(
      [this.dtpPanel.panel, 'notify::height', () => this._queueRedisplay()],
      [this.dtpPanel.panel, 'notify::width', () => this._queueRedisplay()],
      [
        this._appSystem,
        'installed-changed',
        () => {
          AppFavorites.getAppFavorites().reload()
          this._queueRedisplay()
        },
      ],
      [this._appSystem, 'app-state-changed', this._queueRedisplay.bind(this)],
      [
        AppFavorites.getAppFavorites(),
        'changed',
        this._queueRedisplay.bind(this),
      ],
      [
        global.window_manager,
        'switch-workspace',
        () => this._connectWorkspaceSignals(),
      ],
      [
        Utils.DisplayWrapper.getScreen(),
        ['window-entered-monitor', 'window-left-monitor'],
        () => {
          if (SETTINGS.get_boolean('isolate-monitors')) {
            this._queueRedisplay()
          }
        },
      ],
      [Main.overview, 'item-drag-begin', this._onDragBegin.bind(this)],
      [Main.overview, 'item-drag-end', this._onDragEnd.bind(this)],
      [Main.overview, 'item-drag-cancelled', this._onDragCancelled.bind(this)],
      [
        // Ensure the ShowAppsButton status is kept in sync
        SearchController._showAppsButton,
        'notify::checked',
        this._syncShowAppsButtonToggled.bind(this),
      ],
      [
        SETTINGS,
        [
          'changed::dot-size',
          'changed::show-favorites',
          'changed::show-running-apps',
          'changed::show-favorites-all-monitors',
        ],
        () => {
          setAttributes()
          this._redisplay()
        },
      ],
      [
        SETTINGS,
        'changed::group-apps',
        () => {
          setAttributes()
          this._connectWorkspaceSignals()
        },
      ],
      [
        SETTINGS,
        [
          'changed::appicon-style',
          'changed::group-apps-use-launchers',
          'changed::taskbar-locked',
        ],
        () => {
          setAttributes()
          this.resetAppIcons()
        },
      ],
      [
        adjustment,
        ['notify::upper', 'notify::pageSize'],
        () => this._onScrollSizeChange(adjustment),
      ],
    )

    let setAttributes = () => {
      this.isGroupApps = SETTINGS.get_boolean('group-apps')
      this.usingLaunchers =
        !this.isGroupApps && SETTINGS.get_boolean('group-apps-use-launchers')
      this.showFavorites =
        SETTINGS.get_boolean('show-favorites') &&
        (this.dtpPanel.isPrimary ||
          SETTINGS.get_boolean('show-favorites-all-monitors'))
      this.showRunningApps = SETTINGS.get_boolean('show-running-apps')
      this.allowSplitApps =
        this.usingLaunchers || (!this.isGroupApps && !this.showFavorites)
    }

    setAttributes()

    this._onScrollSizeChange(adjustment)
    this._connectWorkspaceSignals()
  }

  destroy() {
    if (this._waitIdleId) {
      GLib.source_remove(this._waitIdleId)
      this._waitIdleId = 0
    }

    this._timeoutsHandler.destroy()
    this.iconAnimator.destroy()

    this._signalsHandler.destroy()
    this._signalsHandler = 0

    this._container.destroy()

    this.previewMenu.disable()
    this.previewMenu.destroy()

    this._disconnectWorkspaceSignals()
  }

  _dropIconAnimations() {
    this._getTaskbarIcons().forEach((item) => {
      item.raise(0)
      item.stretch(0)
    })
  }

  _updateIconAnimations(pointerX, pointerY) {
    this._iconAnimationTimestamp = Date.now()
    let type = iconAnimationSettings.type
    let vertical = this.dtpPanel.checkIfVertical()

    if (!pointerX || !pointerY) [pointerX, pointerY] = global.get_pointer()

    this._getTaskbarIcons().forEach((item) => {
      let [x, y] = item.get_transformed_position()
      let [width, height] = item.get_transformed_size()
      let [centerX, centerY] = [x + width / 2, y + height / 2]
      let size = vertical ? height : width
      let difference = vertical ? pointerY - centerY : pointerX - centerX
      let distance = Math.abs(difference)
      let maxDistance = (iconAnimationSettings.extent / 2) * size

      if (type == 'PLANK') {
        // Make the position stable for items that are far from the pointer.
        let translation =
          distance <= maxDistance
            ? distance / (2 + (8 * distance) / maxDistance)
            : // the previous expression with distance = maxDistance
              maxDistance / 10

        if (difference > 0) translation *= -1

        item.stretch(translation)
      }

      if (distance <= maxDistance) {
        let level = (maxDistance - distance) / maxDistance
        level = Math.pow(level, iconAnimationSettings.convexity)
        item.raise(level)
      } else {
        item.raise(0)
      }
    })
  }

  _onLeaveEvent(actor) {
    let [stageX, stageY] = global.get_pointer()
    let [success, x, y] = actor.transform_stage_point(stageX, stageY)
    if (
      success &&
      !actor.allocation.contains(x, y) &&
      (iconAnimationSettings.type == 'RIPPLE' ||
        iconAnimationSettings.type == 'PLANK')
    )
      this._dropIconAnimations()

    return Clutter.EVENT_PROPAGATE
  }

  _onMotionEvent(actor_, event) {
    if (
      iconAnimationSettings.type == 'RIPPLE' ||
      iconAnimationSettings.type == 'PLANK'
    ) {
      let timestamp = Date.now()
      if (
        !this._iconAnimationTimestamp ||
        timestamp - this._iconAnimationTimestamp >=
          iconAnimationSettings.duration / 2
      ) {
        let [pointerX, pointerY] = event.get_coords()
        this._updateIconAnimations(pointerX, pointerY)
      }
    }

    this._maybeUpdateScrollviewFade()

    return Clutter.EVENT_PROPAGATE
  }

  _maybeUpdateScrollviewFade(adjustment) {
    if (this._scrollView._dtpFadeSize) {
      adjustment =
        adjustment ||
        this._scrollView[this.dtpPanel.getOrientation()[0] + 'adjustment']
      let [value, , upper, , , pageSize] = adjustment.get_values()

      this._fadeLeft.visible = value > 0
      this._fadeRight.visible = value + pageSize < upper
    }
  }

  _onScrollEvent(actor, event) {
    let orientation = this.dtpPanel.getOrientation()

    // reset timeout to avid conflicts with the mousehover event
    this._timeoutsHandler.add([T1, 0, () => (this._swiping = false)])

    // Skip to avoid double events mouse
    if (event.is_pointer_emulated()) return Clutter.EVENT_STOP

    let adjustment, delta

    adjustment = this._scrollView[orientation[0] + 'adjustment']

    let increment = adjustment.step_increment

    switch (event.get_scroll_direction()) {
      case Clutter.ScrollDirection.UP:
      case Clutter.ScrollDirection.LEFT:
        delta = -increment
        break
      case Clutter.ScrollDirection.DOWN:
      case Clutter.ScrollDirection.RIGHT:
        delta = +increment
        break
      case Clutter.ScrollDirection.SMOOTH: {
        let [dx, dy] = event.get_scroll_delta()
        delta = dy * increment
        delta += dx * increment
        break
      }
    }

    adjustment.set_value(adjustment.get_value() + delta)

    this._maybeUpdateScrollviewFade(adjustment)

    return Clutter.EVENT_STOP
  }

  _onScrollSizeChange(adjustment) {
    // Update minimization animation target position on scrollview change.
    this._updateAppIcons()
    this._maybeUpdateScrollviewFade()

    // When applications are ungrouped and there is some empty space on the horizontal taskbar,
    // force a fixed label width to prevent the icons from "wiggling" when an animation runs
    // (adding or removing an icon). When the taskbar is full, revert to a dynamic label width
    // to allow them to resize and make room for new icons.
    if (!this.dtpPanel.checkIfVertical() && !this.isGroupApps) {
      let initial = this.fullScrollView

      if (
        !this.fullScrollView &&
        Math.floor(adjustment.upper) > adjustment.page_size
      ) {
        this.fullScrollView = adjustment.page_size
      } else if (adjustment.page_size < this.fullScrollView) {
        this.fullScrollView = 0
      }

      if (initial != this.fullScrollView && !this._waitIdleId) {
        this._waitIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          this._getAppIcons().forEach((a) => a.updateTitleStyle())
          this._waitIdleId = 0

          return GLib.SOURCE_REMOVE
        })
      }
    }
  }

  _onDragBegin() {
    this._dragCancelled = false
    this._dragMonitor = {
      dragMotion: this._onDragMotion.bind(this),
    }
    DND.addDragMonitor(this._dragMonitor)

    if (this._box.get_n_children() == 0) {
      this._emptyDropTarget = new Dash.EmptyDropTargetItem()
      this._box.insert_child_at_index(this._emptyDropTarget, 0)
      this._emptyDropTarget.show(true)
    }

    this._toggleFavoriteHighlight(true)
  }

  _onDragCancelled() {
    this._dragCancelled = true

    if (this._dragInfo) {
      this._box.set_child_at_index(
        this._dragInfo[1]._dashItemContainer,
        this._dragInfo[0],
      )
    }

    this._endDrag()
  }

  _onDragEnd() {
    if (this._dragCancelled) return

    this._endDrag()
  }

  _endDrag() {
    if (
      this._dragInfo &&
      this._dragInfo[1]._dashItemContainer instanceof DragPlaceholderItem
    ) {
      this._box.remove_child(this._dragInfo[1]._dashItemContainer)
      this._dragInfo[1]._dashItemContainer.destroy()
      delete this._dragInfo[1]._dashItemContainer
    }

    this._dragInfo = null
    this._clearEmptyDropTarget()
    this._showAppsIcon.setDragApp(null)
    DND.removeDragMonitor(this._dragMonitor)

    this._dragMonitor = null
    this.emit('end-drag')

    this._toggleFavoriteHighlight()
  }

  _onDragMotion(dragEvent) {
    let app = Dash.Dash.getAppFromSource(dragEvent.source)
    if (app == null) return DND.DragMotionResult.CONTINUE

    let showAppsHovered = this._showAppsIcon.contains(dragEvent.targetActor)

    if (showAppsHovered) this._showAppsIcon.setDragApp(app)
    else this._showAppsIcon.setDragApp(null)

    return DND.DragMotionResult.CONTINUE
  }

  _toggleFavoriteHighlight(show) {
    let appFavorites = AppFavorites.getAppFavorites()
    let cssFuncName = (show ? 'add' : 'remove') + '_style_class_name'

    if (this.showFavorites)
      this._getAppIcons()
        .filter(
          (appIcon) =>
            (this.usingLaunchers && appIcon.isLauncher) ||
            (!this.usingLaunchers &&
              appFavorites.isFavorite(appIcon.app.get_id())),
        )
        .forEach((fav) => fav._container[cssFuncName]('favorite'))
  }

  handleIsolatedWorkspaceSwitch() {
    this._shownInitially = this.isGroupApps
    this._queueRedisplay()
  }

  _connectWorkspaceSignals() {
    this._disconnectWorkspaceSignals()

    this._lastWorkspace =
      Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace()

    this._workspaceWindowAddedId = this._lastWorkspace.connect(
      'window-added',
      () => this._queueRedisplay(),
    )
    this._workspaceWindowRemovedId = this._lastWorkspace.connect(
      'window-removed',
      () => this._queueRedisplay(),
    )
  }

  _disconnectWorkspaceSignals() {
    if (this._lastWorkspace) {
      this._lastWorkspace.disconnect(this._workspaceWindowAddedId)
      this._lastWorkspace.disconnect(this._workspaceWindowRemovedId)

      this._lastWorkspace = null
    }
  }

  _queueRedisplay() {
    Main.queueDeferredWork(this._workId)
  }

  _hookUpLabel(item, syncHandler) {
    item.child.connect('notify::hover', () => {
      this._syncLabel(item, syncHandler)
    })

    syncHandler.connect('sync-tooltip', () => {
      this._syncLabel(item, syncHandler)
    })
  }

  _createAppItem(app, window, isLauncher) {
    let appIcon = new AppIcons.TaskbarAppIcon(
      {
        app,
        window,
        isLauncher,
      },
      this.dtpPanel,
      {
        setSizeManually: true,
        showLabel: false,
        isDraggable: !SETTINGS.get_boolean('taskbar-locked'),
      },
      this.previewMenu,
      this.iconAnimator,
    )

    if (appIcon._draggable) {
      appIcon._draggable.connect('drag-begin', () => {
        appIcon.opacity = 0
        appIcon.isDragged = 1
        this._dropIconAnimations()
      })
      appIcon._draggable.connect('drag-end', () => {
        appIcon.opacity = 255
        delete appIcon.isDragged
        this._updateAppIcons()
      })
    }

    appIcon.connect('menu-state-changed', (appIcon, opened) => {
      this._itemMenuStateChanged(item, opened)
    })

    let item = new TaskbarItemContainer()

    item._dtpPanel = this.dtpPanel
    extendDashItemContainer(item)

    item.setChild(appIcon)
    appIcon._dashItemContainer = item

    appIcon.connect('notify::hover', () => {
      if (appIcon.hover) {
        this._timeoutsHandler.add([
          T1,
          100,
          () =>
            Utils.ensureActorVisibleInScrollView(
              this._scrollView,
              appIcon,
              this._scrollView._dtpFadeSize,
            ),
        ])

        if (!appIcon.isDragged && iconAnimationSettings.type == 'SIMPLE')
          appIcon.get_parent().raise(1)
        else if (
          !appIcon.isDragged &&
          (iconAnimationSettings.type == 'RIPPLE' ||
            iconAnimationSettings.type == 'PLANK')
        )
          this._updateIconAnimations()
      } else {
        this._timeoutsHandler.remove(T1)

        if (!appIcon.isDragged && iconAnimationSettings.type == 'SIMPLE')
          appIcon.get_parent().raise(0)
      }
    })

    appIcon.connect('clicked', (actor) => {
      Utils.ensureActorVisibleInScrollView(
        this._scrollView,
        actor,
        this._scrollView._dtpFadeSize,
      )
    })

    appIcon.connect('key-focus-in', (actor) => {
      let [x_shift, y_shift] = Utils.ensureActorVisibleInScrollView(
        this._scrollView,
        actor,
        this._scrollView._dtpFadeSize,
      )

      // This signal is triggered also by mouse click. The popup menu is opened at the original
      // coordinates. Thus correct for the shift which is going to be applied to the scrollview.
      if (appIcon._menu) {
        appIcon._menu._boxPointer.xOffset = -x_shift
        appIcon._menu._boxPointer.yOffset = -y_shift
      }
    })

    // Override default AppIcon label_actor, now the
    // accessible_name is set at DashItemContainer.setLabelText
    appIcon.label_actor = null
    item.setLabelText(app.get_name())

    appIcon.icon.setIconSize(this.iconSize)
    this._hookUpLabel(item, appIcon)

    return item
  }

  // Return an array with the "proper" appIcons currently in the taskbar
  _getAppIcons() {
    // Only consider children which are "proper" icons and which are not
    // animating out (which means they will be destroyed at the end of
    // the animation)
    return this._getTaskbarIcons().map(function (actor) {
      return actor.child._delegate
    })
  }

  _getTaskbarIcons(includeAnimated) {
    return this._box.get_children().filter(function (actor) {
      return (
        actor.child &&
        actor.child._delegate &&
        actor.child._delegate.icon &&
        (includeAnimated || !actor.animatingOut)
      )
    })
  }

  _updateAppIcons() {
    let appIcons = this._getAppIcons()

    appIcons
      .filter((icon) => icon.constructor === AppIcons.TaskbarAppIcon)
      .forEach((icon) => {
        icon.updateIcon()
      })
  }

  _itemMenuStateChanged(item, opened) {
    // When the menu closes, it calls sync_hover, which means
    // that the notify::hover handler does everything we need to.
    if (opened) {
      this._timeoutsHandler.remove(T2)

      item.hideLabel()
    } else {
      // I want to listen from outside when a menu is closed. I used to
      // add a custom signal to the appIcon, since gnome 3.8 the signal
      // calling this callback was added upstream.
      this.emit('menu-closed')

      // The icon menu grabs the events and, once it is closed, the pointer is maybe
      // no longer over the taskbar and the animations are not dropped.
      if (
        iconAnimationSettings.type == 'RIPPLE' ||
        iconAnimationSettings.type == 'PLANK'
      ) {
        this._scrollView.sync_hover()
        if (!this._scrollView.hover) this._dropIconAnimations()
      }
    }
  }

  _syncLabel(item, syncHandler) {
    let shouldShow = syncHandler
      ? syncHandler.shouldShowTooltip()
      : item.child.get_hover()

    if (shouldShow) {
      if (!this._timeoutsHandler.getId(T2)) {
        let timeout = this._labelShowing ? 0 : DASH_ITEM_HOVER_TIMEOUT

        this._timeoutsHandler.add([
          T2,
          timeout,
          () => {
            this._labelShowing = true
            item.showLabel()
          },
        ])

        this._timeoutsHandler.remove(T3)
      }
    } else {
      this._timeoutsHandler.remove(T2)

      item.hideLabel()
      if (this._labelShowing) {
        this._timeoutsHandler.add([
          T3,
          DASH_ITEM_HOVER_TIMEOUT,
          () => (this._labelShowing = false),
        ])
      }
    }
  }

  _adjustIconSize() {
    let panelSize = this.dtpPanel.geom.iconSize / Utils.getScaleFactor()
    let availSize = panelSize - SETTINGS.get_int('appicon-padding') * 2
    let minIconSize = MIN_ICON_SIZE + (panelSize % 2)

    if (availSize == this.iconSize) return

    if (availSize < minIconSize) {
      availSize = minIconSize
    }

    // For the icon size, we only consider children which are "proper"
    // icons and which are not animating out (which means they will be
    // destroyed at the end of the animation)
    let iconChildren = this._getTaskbarIcons().concat([this._showAppsIcon])
    let scale = this.iconSize / availSize

    this.iconSize = availSize

    for (let i = 0; i < iconChildren.length; i++) {
      let icon = iconChildren[i].child._delegate.icon

      // Set the new size immediately, to keep the icons' sizes
      // in sync with this.iconSize
      icon.setIconSize(this.iconSize)

      // Don't animate the icon size change when the overview
      // is transitioning, or when initially filling
      // the taskbar
      if (Main.overview.animationInProgress || !this._shownInitially) continue

      let [targetWidth, targetHeight] = icon.icon.get_size()

      // Scale the icon's texture to the previous size and
      // tween to the new size
      icon.icon.set_size(icon.icon.width * scale, icon.icon.height * scale)

      Utils.animate(icon.icon, {
        width: targetWidth,
        height: targetHeight,
        time: DASH_ANIMATION_TIME,
        transition: 'easeOutQuad',
      })
    }
  }

  sortAppsCompareFunction(appA, appB) {
    return (
      getAppStableSequence(appA, this.dtpPanel.monitor) -
      getAppStableSequence(appB, this.dtpPanel.monitor)
    )
  }

  getAppInfos() {
    //get the user's favorite apps
    let favoriteApps = this.showFavorites
      ? AppFavorites.getAppFavorites().getFavorites()
      : []

    //find the apps that should be in the taskbar: the favorites first, then add the running apps
    // When using isolation, we filter out apps that have no windows in
    // the current workspace (this check is done in AppIcons.getInterestingWindows)
    let runningApps = this.showRunningApps
      ? this._getRunningApps().sort(this.sortAppsCompareFunction.bind(this))
      : []
    let appInfos

    if (this.allowSplitApps) {
      appInfos = this._createAppInfos(favoriteApps, [], true).concat(
        this._createAppInfos(runningApps).filter(
          (appInfo) => appInfo.windows.length,
        ),
      )
    } else {
      appInfos = this._createAppInfos(
        favoriteApps.concat(
          runningApps.filter((app) => favoriteApps.indexOf(app) < 0),
        ),
      ).filter(
        (appInfo) =>
          appInfo.windows.length || favoriteApps.indexOf(appInfo.app) >= 0,
      )
    }

    return appInfos
  }

  _redisplay() {
    if (!this._signalsHandler) {
      return
    }

    //get the currently displayed appIcons
    let currentAppIcons = this._getTaskbarIcons()
    let expectedAppInfos = this.getAppInfos()

    //remove the appIcons which are not in the expected apps list
    for (let i = currentAppIcons.length - 1; i > -1; --i) {
      let appIcon = currentAppIcons[i].child._delegate
      let appIndex = Utils.findIndex(
        expectedAppInfos,
        (appInfo) =>
          appInfo.app == appIcon.app &&
          (!this.allowSplitApps ||
            this.isGroupApps ||
            appInfo.windows[0] == appIcon.window) &&
          appInfo.isLauncher == appIcon.isLauncher,
      )

      if (
        appIndex < 0 ||
        (appIcon.window &&
          (this.isGroupApps ||
            expectedAppInfos[appIndex].windows.indexOf(appIcon.window) < 0)) ||
        (!appIcon.window &&
          !appIcon.isLauncher &&
          !this.isGroupApps &&
          expectedAppInfos[appIndex].windows.length)
      ) {
        currentAppIcons[i][
          this._shownInitially ? 'animateOutAndDestroy' : 'destroy'
        ]()
        currentAppIcons.splice(i, 1)
      }
    }

    //if needed, reorder the existing appIcons and create the missing ones
    let currentPosition = 0
    for (let i = 0, l = expectedAppInfos.length; i < l; ++i) {
      let neededAppIcons =
        this.isGroupApps || !expectedAppInfos[i].windows.length
          ? [
              {
                app: expectedAppInfos[i].app,
                window: null,
                isLauncher: expectedAppInfos[i].isLauncher,
              },
            ]
          : expectedAppInfos[i].windows.map((window) => ({
              app: expectedAppInfos[i].app,
              window: window,
              isLauncher: false,
            }))

      for (let j = 0, ll = neededAppIcons.length; j < ll; ++j) {
        //check if the icon already exists
        let matchingAppIconIndex = Utils.findIndex(
          currentAppIcons,
          (appIcon) =>
            appIcon.child._delegate.app == neededAppIcons[j].app &&
            appIcon.child._delegate.window == neededAppIcons[j].window,
        )

        if (
          matchingAppIconIndex > 0 &&
          matchingAppIconIndex != currentPosition
        ) {
          //moved icon, reposition it
          this._box.remove_child(currentAppIcons[matchingAppIconIndex])
          this._box.insert_child_at_index(
            currentAppIcons[matchingAppIconIndex],
            currentPosition,
          )
        } else if (matchingAppIconIndex < 0) {
          //the icon doesn't exist yet, create a new one
          let newAppIcon = this._createAppItem(
            neededAppIcons[j].app,
            neededAppIcons[j].window,
            neededAppIcons[j].isLauncher,
          )

          this._box.insert_child_at_index(newAppIcon, currentPosition)
          currentAppIcons.splice(currentPosition, 0, newAppIcon)

          // Skip animations on first run when adding the initial set
          // of items, to avoid all items zooming in at once
          newAppIcon.show(this._shownInitially)
        }

        ++currentPosition
      }
    }

    this._adjustIconSize()

    // Workaround for https://bugzilla.gnome.org/show_bug.cgi?id=692744
    // Without it, StBoxLayout may use a stale size cache
    this._box.queue_relayout()

    // This is required for icon reordering when the scrollview is used.
    this._updateAppIcons()

    // This will update the size, and the corresponding number for each icon
    this._updateHotkeysNumberOverlay()

    this._shownInitially = true
  }

  _getRunningApps() {
    let windows = Utils.getAllMetaWindows()
    let apps = []

    for (let i = 0, l = windows.length; i < l; ++i) {
      let app = tracker.get_window_app(windows[i])

      if (app && apps.indexOf(app) < 0) {
        apps.push(app)
      }
    }

    return apps
  }

  _createAppInfos(apps, defaultWindows, defaultIsLauncher) {
    if (this.allowSplitApps && !defaultIsLauncher) {
      let separateApps = []

      if (apps.length) {
        let windows = AppIcons.getInterestingWindows(
          null,
          this.dtpPanel.monitor,
        ).sort(sortWindowsCompareFunction)

        windows.forEach((w) => {
          let windowApp = tracker.get_window_app(w)

          if (apps.indexOf(windowApp) >= 0)
            separateApps.push({
              app: windowApp,
              isLauncher: false,
              windows: [w],
            })
        })
      }

      return separateApps
    }

    return apps.map((app) => ({
      app: app,
      isLauncher: defaultIsLauncher || false,
      windows:
        defaultWindows ||
        AppIcons.getInterestingWindows(app, this.dtpPanel.monitor).sort(
          sortWindowsCompareFunction,
        ),
    }))
  }

  // Reset the displayed apps icon to mantain the correct order
  resetAppIcons(geometryChange) {
    let children = this._getTaskbarIcons(true)

    for (let i = 0; i < children.length; i++) {
      let item = children[i]
      item.destroy()
    }

    // to avoid ugly animations, just suppress them like when taskbar is first loaded.
    this._shownInitially = false
    this._redisplay()

    if (geometryChange && this.dtpPanel.checkIfVertical()) {
      this.previewMenu._updateClip()
    }
  }

  _updateHotkeysNumberOverlay() {
    let counter = 0

    if (this.dtpPanel.isPrimary) hotkeyAppNumbers = {}

    this._getAppIcons().forEach((icon) => {
      if (
        this.dtpPanel.isPrimary &&
        (!hotkeyAppNumbers[icon.app] || this.allowSplitApps)
      ) {
        hotkeyAppNumbers[icon.app] = ++counter
      }

      let label = hotkeyAppNumbers[icon.app]

      if (label <= 10) {
        icon.setHotkeysNumberOverlayLabel(label == 10 ? 0 : label)
      } else {
        // No overlay after 10
        icon.setHotkeysNumberOverlayLabel(-1)
      }
    })

    if (
      SETTINGS.get_boolean('hot-keys') &&
      SETTINGS.get_string('hotkeys-overlay-combo') === 'ALWAYS'
    )
      this.toggleHotkeysNumberOverlay(true)
  }

  toggleHotkeysNumberOverlay(activate) {
    let appIcons = this._getAppIcons()
    appIcons.forEach(function (icon) {
      icon.toggleHotkeysNumberOverlay(
        activate ? SETTINGS.get_string('hotkeys-overlay-combo') : false,
      )
    })
  }

  _clearEmptyDropTarget() {
    if (this._emptyDropTarget) {
      this._emptyDropTarget.animateOutAndDestroy()
      this._emptyDropTarget = null
    }
  }

  handleDragOver(source, actor, x, y) {
    if (source == Main.xdndHandler) return DND.DragMotionResult.CONTINUE

    // Don't allow favoriting of transient apps
    if (source.app == null || source.app.is_window_backed())
      return DND.DragMotionResult.NO_DROP

    if (!this._settings.is_writable('favorite-apps'))
      return DND.DragMotionResult.NO_DROP

    let isVertical = this.dtpPanel.checkIfVertical()

    if (!this._box.contains(source) && !source._dashItemContainer) {
      //not an appIcon of the taskbar, probably from the applications view
      source._dashItemContainer = new DragPlaceholderItem(
        source,
        this.iconSize,
        isVertical,
      )
      this._box.insert_child_above(source._dashItemContainer, null)
    }

    let sizeProp = isVertical ? 'height' : 'width'
    let posProp = isVertical ? 'y' : 'x'
    let pos = isVertical ? y : x

    let currentAppIcons = this._getAppIcons()
    let sourceIndex = currentAppIcons.indexOf(source)
    let hoveredIndex = Utils.findIndex(
      currentAppIcons,
      (appIcon) =>
        pos >= appIcon._dashItemContainer[posProp] &&
        pos <=
          appIcon._dashItemContainer[posProp] +
            appIcon._dashItemContainer[sizeProp],
    )

    if (!this._dragInfo) {
      this._dragInfo = [sourceIndex, source]
    }

    if (hoveredIndex >= 0) {
      let isLeft =
        pos <
        currentAppIcons[hoveredIndex]._dashItemContainer[posProp] +
          currentAppIcons[hoveredIndex]._dashItemContainer[sizeProp] * 0.5
      let prevIcon = currentAppIcons[hoveredIndex - 1]
      let nextIcon = currentAppIcons[hoveredIndex + 1]

      // Don't allow positioning before or after self and between icons of same app if ungrouped and showing favorites
      if (
        !(
          hoveredIndex === sourceIndex ||
          (isLeft && hoveredIndex - 1 == sourceIndex) ||
          (!this.allowSplitApps &&
            isLeft &&
            hoveredIndex - 1 >= 0 &&
            source.app != prevIcon.app &&
            prevIcon.app == currentAppIcons[hoveredIndex].app) ||
          (!isLeft && hoveredIndex + 1 == sourceIndex) ||
          (!this.allowSplitApps &&
            !isLeft &&
            hoveredIndex + 1 < currentAppIcons.length &&
            source.app != nextIcon.app &&
            nextIcon.app == currentAppIcons[hoveredIndex].app)
        )
      ) {
        this._box.set_child_at_index(source._dashItemContainer, hoveredIndex)

        // Ensure the next and previous icon are visible when moving the icon
        // (I assume there's room for both of them)
        if (hoveredIndex > 1)
          Utils.ensureActorVisibleInScrollView(
            this._scrollView,
            this._box.get_children()[hoveredIndex - 1],
            this._scrollView._dtpFadeSize,
          )
        if (hoveredIndex < this._box.get_children().length - 1)
          Utils.ensureActorVisibleInScrollView(
            this._scrollView,
            this._box.get_children()[hoveredIndex + 1],
            this._scrollView._dtpFadeSize,
          )
      }
    }

    return this._dragInfo[0] !== sourceIndex
      ? DND.DragMotionResult.MOVE_DROP
      : DND.DragMotionResult.CONTINUE
  }

  // Draggable target interface
  acceptDrop(source) {
    // Don't allow favoriting of transient apps
    if (
      !this._dragInfo ||
      !source.app ||
      source.app.is_window_backed() ||
      !this._settings.is_writable('favorite-apps')
    ) {
      return false
    }

    let appIcons = this._getAppIcons()
    let sourceIndex = appIcons.indexOf(source)
    let usingLaunchers = !this.isGroupApps && this.usingLaunchers

    // dragging the icon to its original position
    if (this._dragInfo[0] === sourceIndex) {
      return true
    }

    let appFavorites = AppFavorites.getAppFavorites()
    let sourceAppId = source.app.get_id()
    let appIsFavorite =
      this.showFavorites && appFavorites.isFavorite(sourceAppId)
    let replacingIndex =
      sourceIndex + (sourceIndex > this._dragInfo[0] ? -1 : 1)
    let favoriteIndex =
      replacingIndex >= 0
        ? appFavorites.getFavorites().indexOf(appIcons[replacingIndex].app)
        : 0
    let sameApps = this.allowSplitApps
      ? []
      : appIcons.filter((a) => a != source && a.app == source.app)
    let favoritesCount = 0
    let position = 0
    let interestingWindows = {}
    let getAppWindows = (app) => {
      if (!interestingWindows[app]) {
        interestingWindows[app] = AppIcons.getInterestingWindows(
          app,
          this.dtpPanel.monitor,
        )
      }

      let appWindows = interestingWindows[app] //prevents "reference to undefined property Symbol.toPrimitive" warning
      return appWindows
    }

    if (
      sameApps.length &&
      (!appIcons[sourceIndex - 1] ||
        appIcons[sourceIndex - 1].app !== source.app) &&
      (!appIcons[sourceIndex + 1] ||
        appIcons[sourceIndex + 1].app !== source.app)
    ) {
      appIcons.splice(appIcons.indexOf(sameApps[0]), sameApps.length)
      Array.prototype.splice.apply(
        appIcons,
        [sourceIndex + 1, 0].concat(sameApps),
      )
    }

    for (let i = 0, l = appIcons.length; i < l; ++i) {
      let windows = []

      if (!usingLaunchers || (!source.isLauncher && !appIcons[i].isLauncher)) {
        windows = appIcons[i].window
          ? [appIcons[i].window]
          : getAppWindows(appIcons[i].app)
      }

      windows.forEach((w) => (w._dtpPosition = position++))

      if (
        this.showFavorites &&
        ((usingLaunchers && appIcons[i].isLauncher) ||
          (!usingLaunchers &&
            appFavorites.isFavorite(appIcons[i].app.get_id())))
      ) {
        ++favoritesCount
      }
    }

    if (sourceIndex < favoritesCount) {
      if (appIsFavorite) {
        appFavorites.moveFavoriteToPos(sourceAppId, favoriteIndex)
      } else {
        appFavorites.addFavoriteAtPos(sourceAppId, favoriteIndex)
      }
    } else if (
      appIsFavorite &&
      this.showFavorites &&
      (!usingLaunchers || source.isLauncher)
    ) {
      appFavorites.removeFavorite(sourceAppId)
    }

    appFavorites.emit('changed')

    return true
  }

  _onShowAppsButtonToggled() {
    // Sync the status of the default appButtons. Only if the two statuses are
    // different, that means the user interacted with the extension provided
    // application button, cutomize the behaviour. Otherwise the shell has changed the
    // status (due to the _syncShowAppsButtonToggled function below) and it
    // has already performed the desired action.
    let selector = SearchController

    if (
      selector._showAppsButton &&
      selector._showAppsButton.checked !== this.showAppsButton.checked
    ) {
      // find visible view

      if (this.showAppsButton.checked) {
        if (SETTINGS.get_boolean('show-apps-override-escape')) {
          //override escape key to return to the desktop when entering the overview using the showapps button
          SearchController._onStageKeyPress = function (actor, event) {
            if (
              Main.modalCount == 1 &&
              event.get_key_symbol() === Clutter.KEY_Escape
            ) {
              this._searchActive ? this.reset() : Main.overview.hide()

              return Clutter.EVENT_STOP
            }

            return Object.getPrototypeOf(this)._onStageKeyPress.call(
              this,
              actor,
              event,
            )
          }

          let overviewHiddenId = Main.overview.connect('hidden', () => {
            Main.overview.disconnect(overviewHiddenId)
            delete SearchController._onStageKeyPress
          })
        }

        // force exiting overview if needed
        if (!Main.overview._shown) {
          this.forcedOverview = true
        }

        //temporarily use as primary the monitor on which the showapps btn was clicked, this is
        //restored by the panel when exiting the overview
        this.dtpPanel.panelManager.setFocusedMonitor(this.dtpPanel.monitor)

        // Finally show the overview
        selector._showAppsButton.checked = true
        Main.overview.show(2 /*APP_GRID*/)
      } else {
        if (this.forcedOverview) {
          // force exiting overview if needed
          Main.overview.hide()
        } else {
          selector._showAppsButton.checked = false
        }

        this.forcedOverview = false
      }
    }
  }

  _syncShowAppsButtonToggled() {
    let status = SearchController._showAppsButton.checked
    if (this.showAppsButton.checked !== status)
      this.showAppsButton.checked = status
  }

  showShowAppsButton() {
    this.showAppsButton.visible = true
    this.showAppsButton.set_width(-1)
    this.showAppsButton.set_height(-1)
  }

  popupFocusedAppSecondaryMenu() {
    let appIcons = this._getAppIcons()

    for (let i in appIcons) {
      if (appIcons[i].app == tracker.focus_app) {
        let appIcon = appIcons[i]
        if (appIcon._menu && appIcon._menu.isOpen) appIcon._menu.close()
        else appIcon.popupMenu()

        appIcon.sync_hover()
        break
      }
    }
  }
}

export const TaskbarItemContainer = GObject.registerClass(
  {},
  class TaskbarItemContainer extends Dash.DashItemContainer {
    _init() {
      super._init()
      this.x_expand = this.y_expand = false
    }

    vfunc_allocate(box) {
      if (this.child == null) return

      this.set_allocation(box)

      let availWidth = box.x2 - box.x1
      let availHeight = box.y2 - box.y1
      let [, , natChildWidth, natChildHeight] = this.child.get_preferred_size()
      let [childScaleX, childScaleY] = this.child.get_scale()

      let childWidth = Math.min(natChildWidth * childScaleX, availWidth)
      let childHeight = Math.min(natChildHeight * childScaleY, availHeight)
      let childBox = new Clutter.ActorBox()

      childBox.x1 = (availWidth - childWidth) / 2
      childBox.y1 = (availHeight - childHeight) / 2
      childBox.x2 = childBox.x1 + childWidth
      childBox.y2 = childBox.y1 + childHeight

      this.child.allocate(childBox)
    }

    // In case appIcon is removed from the taskbar while it is hovered,
    // restore opacity before dashItemContainer.animateOutAndDestroy does the destroy animation.
    animateOutAndDestroy() {
      if (this._raisedClone) {
        this._raisedClone.source.opacity = 255
        this._raisedClone.destroy()
      }

      super.animateOutAndDestroy()
    }

    // For ItemShowLabel
    _getIconAnimationOffset() {
      if (!SETTINGS.get_boolean('animate-appicon-hover')) return 0

      let travel = iconAnimationSettings.travel
      let zoom = iconAnimationSettings.zoom
      return (
        this._dtpPanel.geom.innerSize * Math.max(0, travel + (zoom - 1) / 2)
      )
    }

    _updateCloneContainerPosition(cloneContainer) {
      let [stageX, stageY] = this.get_transformed_position()

      cloneContainer.set_position(
        stageX - this._dtpPanel.panelBox.translation_x - this.translation_x,
        stageY - this._dtpPanel.panelBox.translation_y - this.translation_y,
      )
    }

    _createRaisedClone() {
      let [width, height] = this.get_transformed_size()

      // "clone" of this child (appIcon actor)
      let cloneButton = this.child._delegate.getCloneButton()

      // "clone" of this (taskbarItemContainer)
      let cloneContainer = new St.Bin({
        child: cloneButton,
        width: width,
        height: height,
        reactive: false,
      })

      this._updateCloneContainerPosition(cloneContainer)

      // For the stretch animation
      let boundProperty = this._dtpPanel.checkIfVertical()
        ? 'translation_y'
        : 'translation_x'
      this.bind_property(
        boundProperty,
        cloneContainer,
        boundProperty,
        GObject.BindingFlags.SYNC_CREATE,
      )

      // The clone follows its source when the taskbar is scrolled.
      let taskbarScrollView = this.get_parent().get_parent()
      let adjustment = this._dtpPanel.checkIfVertical()
        ? taskbarScrollView.get_vadjustment()
        : taskbarScrollView.get_hadjustment()
      let adjustmentChangedId = adjustment.connect('notify::value', () =>
        this._updateCloneContainerPosition(cloneContainer),
      )

      // Update clone position when an item is added to / removed from the taskbar.
      let taskbarBox = this.get_parent()
      let taskbarBoxAllocationChangedId = taskbarBox.connect(
        'notify::allocation',
        () => this._updateCloneContainerPosition(cloneContainer),
      )

      // The clone itself
      this._raisedClone = cloneButton.child
      this._raisedClone.connect('destroy', () => {
        adjustment.disconnect(adjustmentChangedId)
        taskbarBox.disconnect(taskbarBoxAllocationChangedId)
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          cloneContainer.destroy()
          return GLib.SOURCE_REMOVE
        })
        delete this._raisedClone
      })

      this._raisedClone.source.opacity = 0
      Main.uiGroup.add_child(cloneContainer)
    }

    // Animate the clone.
    // AppIcon actors cannot go outside the taskbar so the animation is done with a clone.
    // If level is zero, the clone is dropped and destroyed.
    raise(level) {
      if (this._raisedClone) Utils.stopAnimations(this._raisedClone)
      else if (level) this._createRaisedClone()
      else return

      let panelPosition = this._dtpPanel.getPosition()
      let panelElementPositions = PanelSettings.getPanelElementPositions(
        SETTINGS,
        this._dtpPanel.monitor.index,
      )
      let taskbarPosition = panelElementPositions.filter(
        (pos) => pos.element == 'taskbar',
      )[0].position

      let vertical =
        panelPosition == St.Side.LEFT || panelPosition == St.Side.RIGHT
      let translationDirection =
        panelPosition == St.Side.TOP || panelPosition == St.Side.LEFT ? 1 : -1
      let rotationDirection
      if (panelPosition == St.Side.LEFT || taskbarPosition == Pos.STACKED_TL)
        rotationDirection = -1
      else if (
        panelPosition == St.Side.RIGHT ||
        taskbarPosition == Pos.STACKED_BR
      )
        rotationDirection = 1
      else {
        let items = this.get_parent().get_children()
        let index = items.indexOf(this)
        rotationDirection =
          (index - (items.length - 1) / 2) / ((items.length - 1) / 2)
      }

      let duration = iconAnimationSettings.duration / 1000
      let rotation = iconAnimationSettings.rotation
      let travel = iconAnimationSettings.travel
      let zoom = iconAnimationSettings.zoom

      // level is about 1 for the icon that is hovered, less for others.
      // time depends on the translation to do.
      let [width, height] = this._raisedClone.source.get_transformed_size()
      let translationMax =
        (vertical ? width : height) * (travel + (zoom - 1) / 2)
      let translationEnd = translationMax * level
      let translationDone = vertical
        ? this._raisedClone.translation_x
        : this._raisedClone.translation_y
      let translationTodo =
        Math.sign(travel) * Math.abs(translationEnd - translationDone)
      let scale = 1 + (zoom - 1) * level
      let rotationAngleZ = rotationDirection * rotation * level
      let time = Math.abs((duration * translationTodo) / translationMax)

      let options = {
        scale_x: scale,
        scale_y: scale,
        rotation_angle_z: rotationAngleZ,
        time: time,
        transition: 'easeOutQuad',
        onComplete: () => {
          if (!level) {
            this._raisedClone.source.opacity = 255
            this._raisedClone.destroy()
            delete this._raisedClone
          }
        },
      }
      options[vertical ? 'translation_x' : 'translation_y'] =
        translationDirection * translationEnd

      Utils.animate(this._raisedClone, options)
    }

    // Animate this and cloneContainer, since cloneContainer translation is bound to this.
    stretch(translation) {
      let duration = iconAnimationSettings.duration / 1000
      let zoom = iconAnimationSettings.zoom
      let animatedProperty = this._dtpPanel.checkIfVertical()
        ? 'translation_y'
        : 'translation_x'
      let isShowing = this.opacity != 255 || this.child.opacity != 255

      if (isShowing) {
        // Do no stop the animation initiated in DashItemContainer.show.
        this[animatedProperty] = zoom * translation
      } else {
        let options = {
          time: duration,
          transition: 'easeOutQuad',
        }
        options[animatedProperty] = zoom * translation

        Utils.stopAnimations(this)
        Utils.animate(this, options)
      }
    }
  },
)

const DragPlaceholderItem = GObject.registerClass(
  {},
  class DragPlaceholderItem extends St.Widget {
    _init(appIcon, iconSize, isVertical) {
      super._init({
        style: AppIcons.getIconContainerStyle(isVertical),
        layout_manager: new Clutter.BinLayout(),
      })

      this.child = { _delegate: appIcon }

      this._clone = new Clutter.Clone({
        source: appIcon.icon._iconBin,
        width: iconSize,
        height: iconSize,
      })

      this.add_child(this._clone)
    }

    destroy() {
      this._clone.destroy()
      super.destroy()
    }
  },
)

export function getAppStableSequence(app, monitor) {
  let windows = AppIcons.getInterestingWindows(app, monitor)

  return windows.reduce((prevWindow, window) => {
    return Math.min(prevWindow, getWindowStableSequence(window))
  }, Infinity)
}

export function sortWindowsCompareFunction(windowA, windowB) {
  return getWindowStableSequence(windowA) - getWindowStableSequence(windowB)
}

export function getWindowStableSequence(window) {
  return '_dtpPosition' in window
    ? window._dtpPosition
    : window.get_stable_sequence()
}
