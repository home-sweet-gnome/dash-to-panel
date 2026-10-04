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
 * Credits:
 * This file is based on code from the Dash to Dock extension by micheleg
 * and code from the Taskbar extension by Zorin OS
 *
 * Code to re-anchor the panel was taken from Thoma5 BottomPanel:
 * https://github.com/Thoma5/gnome-shell-extension-bottompanel
 *
 * Pattern for moving clock based on Frippery Move Clock by R M Yorston
 * http://frippery.org/extensions/
 *
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import GObject from 'gi://GObject'
import Graphene from 'gi://Graphene'

import * as AppIcons from './appIcons.js'
import * as Utils from './utils.js'
import * as Taskbar from './taskbar.js'
import * as TaskbarItemContainer from './taskbar.js'
import * as Pos from './panelPositions.js'
import * as PanelSettings from './panelSettings.js'
import * as PanelStyle from './panelStyle.js'

import * as Config from 'resource:///org/gnome/shell/misc/config.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js'
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js'
import * as CtrlAltTab from 'resource:///org/gnome/shell/ui/ctrlAltTab.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import St from 'gi://St'
import Meta from 'gi://Meta'
import Pango from 'gi://Pango'
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import * as DateMenu from 'resource:///org/gnome/shell/ui/dateMenu.js'
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js'

import * as Intellihide from './intellihide.js'
import * as Transparency from './transparency.js'
import {
  SETTINGS,
  DESKTOPSETTINGS,
  PERSISTENTSTORAGE,
  tracker,
} from './extension.js'
import {
  gettext as _,
  InjectionManager,
} from 'resource:///org/gnome/shell/extensions/extension.js'

export const panelBoxes = ['_leftBox', '_centerBox', '_rightBox']

//timeout names
const T4 = 'showDesktopTimeout'
const T5 = 'trackerFocusAppTimeout'
const T6 = 'scrollPanelDelayTimeout'
const T7 = 'waitPanelBoxAllocation'

const MIN_PANEL_SIZE = 22

export const Panel = GObject.registerClass(
  {},
  class Panel extends St.Widget {
    _init(panelManager, monitor, clipContainer, panelBox, isStandalone) {
      super._init({
        style_class: 'dashtopanelPanel',
        layout_manager: new Clutter.BinLayout(),
      })

      this._timeoutsHandler = new Utils.TimeoutsHandler()
      this._signalsHandler = new Utils.GlobalSignalsHandler()
      this._injectionManager = new InjectionManager()

      this.panelManager = panelManager
      this.panelStyle = new PanelStyle.PanelStyle()

      this.monitor = monitor
      this.clipContainer = clipContainer
      this.panelBox = panelBox

      // when the original gnome-shell top panel is kept, all panels are "standalone",
      // so in this case use isPrimary to get the panel on the primary dtp monitor, which
      // might be different from the system's primary monitor.
      this.isStandalone = isStandalone
      this.isPrimary =
        !isStandalone ||
        (SETTINGS.get_boolean('stockgs-keep-top-panel') &&
          monitor == panelManager.dtpPrimaryMonitor)

      this._sessionStyle = null
      this._unmappedButtons = []
      this._mainPanelClones = []
      this._cloneMenuActors = []
      this._elementGroups = []

      let systemMenuInfo = Utils.getSystemMenuInfo()

      if (isStandalone) {
        this.panel = new SecondaryPanel({ name: 'panel', reactive: true })
        this.statusArea = this.panel.statusArea = {}

        //next 3 functions are needed by other extensions to add elements to the secondary panel
        this.panel.addToStatusArea = function (role, indicator, position, box) {
          return Main.panel.addToStatusArea.call(
            this,
            role,
            indicator,
            position,
            box,
          )
        }

        this.panel._addToPanelBox = function (role, indicator, position, box) {
          Main.panel._addToPanelBox.call(this, role, indicator, position, box)
        }

        this.panel._onMenuSet = function (indicator) {
          Main.panel._onMenuSet.call(this, indicator)
        }

        this._leftBox = this.panel._leftBox = Utils.createBoxLayout({
          name: 'panelLeft',
        })
        this._centerBox = this.panel._centerBox = Utils.createBoxLayout({
          name: 'panelCenter',
        })
        this._rightBox = this.panel._rightBox = Utils.createBoxLayout({
          name: 'panelRight',
        })

        this.menuManager = this.panel.menuManager =
          new PopupMenu.PopupMenuManager(this.panel)

        this._setPanelMenu(
          systemMenuInfo.name,
          systemMenuInfo.constructor,
          this.panel,
        )
        this._setPanelMenu('dateMenu', DateMenu.DateMenuButton, this.panel)
        this._setPanelMenu(
          'activities',
          Main.panel.statusArea.activities.constructor,
          this.panel,
        )

        this.panel.add_child(this._leftBox)
        this.panel.add_child(this._centerBox)
        this.panel.add_child(this._rightBox)
      } else {
        this.panel = Main.panel
        this.statusArea = Main.panel.statusArea
        this.menuManager = Main.panel.menuManager

        this.panel._toggleMenu = (indicator) => {
          if (
            !indicator ||
            (!this.intellihide.enabled && !indicator.mapped) ||
            !indicator.reactive
          )
            return

          this.intellihide.revealAndHold(0, true)
          Object.getPrototypeOf(this.panel)._toggleMenu(indicator)
        }

        panelBoxes.forEach((p) => (this[p] = Main.panel[p]))
        ;['activities', systemMenuInfo.name, 'dateMenu'].forEach((b) => {
          let container = this.statusArea[b].container
          let parent = container.get_parent()
          let siblings = parent.get_children()
          let index = siblings.indexOf(container)

          container._dtpOriginalParent = parent
          container._dtpOriginalIndex =
            index && index == siblings.length - 1 ? -1 : index
          parent ? parent.remove_child(container) : null
          this.panel.add_child(container)
        })
      }

      this.geom = this.getGeometry()

      // Create a wrapper around the real showAppsIcon in order to add a popupMenu. Most of
      // its behavior is handled by the taskbar, but its positioning is done at the panel level
      this.showAppsIconWrapper = new AppIcons.ShowAppsIconWrapper(this)
      this.panel.add_child(this.showAppsIconWrapper.realShowAppsIcon)

      this.panel._delegate = this

      this.add_child(this.panel)

      if (
        Main.panel._onButtonPress ||
        Main.panel._tryDragWindow ||
        Main.panel._clickGesture
      ) {
        this._signalsHandler.add([
          this.panel,
          ['button-press-event', 'touch-event'],
          this._onButtonPress.bind(this),
        ])
      }

      if (Main.panel._onKeyPress) {
        this._signalsHandler.add([
          this.panel,
          'key-press-event',
          Main.panel._onKeyPress.bind(this),
        ])
      }

      Main.ctrlAltTabManager.addGroup(
        this,
        _('Top Bar') + ' ' + monitor.index,
        'focus-top-bar-symbolic',
        { sortGroup: CtrlAltTab.SortGroup.TOP },
      )
    }

    enable() {
      let { name: systemMenuName } = Utils.getSystemMenuInfo()

      if (
        this.statusArea[systemMenuName] &&
        this.statusArea[systemMenuName]._volumeOutput
      ) {
        Utils.getIndicators(
          this.statusArea[systemMenuName]._volumeOutput,
        )._dtpIgnoreScroll = 1
      }

      this._setPanelBoxStyle()
      this._maybeSetDockCss()
      this._setPanelPosition()

      if (!this.isStandalone) {
        this._injectionManager.overrideMethod(
          Object.getPrototypeOf(this.panel),
          'vfunc_allocate',
          () => (box) => this._mainPanelAllocate(box),
        )

        // remove the extra space before the clock when the message-indicator is displayed
        if (DateMenu.IndicatorPad) {
          this._injectionManager.overrideMethod(
            DateMenu.IndicatorPad.prototype,
            'vfunc_get_preferred_width',
            () => () => [0, 0],
          )
          this._injectionManager.overrideMethod(
            DateMenu.IndicatorPad.prototype,
            'vfunc_get_preferred_height',
            () => () => [0, 0],
          )
        }
      }

      if (!DateMenu.IndicatorPad && this.statusArea.dateMenu) {
        //3.36 switched to a size constraint applied on an anonymous child
        let indicatorPad = this.statusArea.dateMenu
          .get_first_child()
          .get_first_child()

        this._dateMenuIndicatorPadContraints = indicatorPad.get_constraints()
        indicatorPad.clear_constraints()
      }

      this.menuManager._oldChangeMenu = this.menuManager._changeMenu
      this.menuManager._changeMenu = (menu) => {
        if (!SETTINGS.get_boolean('stockgs-panelbtn-click-only')) {
          this.menuManager._oldChangeMenu(menu)
        }
      }

      this.dynamicTransparency = new Transparency.DynamicTransparency(this)

      this.taskbar = new Taskbar.Taskbar(this)

      this.panel.add_child(this.taskbar.actor)

      this._setShowDesktopButton(true)

      this._setAllocationMap()

      this.panel.add_style_class_name(
        'dashtopanelMainPanel ' + this.getOrientation(),
      )

      this.intellihide = new Intellihide.Intellihide(this)

      this._signalsHandler.add(
        // this is to catch changes to the theme or window scale factor
        [
          Utils.getStageTheme(),
          'changed',
          () => (this._resetGeometry(), this._setShowDesktopButtonStyle()),
        ],
        [
          this.panelBox,
          'style-changed',
          () => {
            if (this._externalStyleChangeHandled) return

            this._externalStyleChangeHandled = true

            if (
              JSON.stringify(this._relevantPanelBoxStyles) !=
              JSON.stringify(this._getRelevantPanelBoxStyles())
            )
              this._resetGeometry()

            delete this._externalStyleChangeHandled
          },
        ],
        [
          // sync hover after a popupmenu is closed
          this.taskbar,
          'menu-closed',
          () => this.panel.sync_hover(),
        ],
        [Main.overview, ['showing', 'hiding'], () => this._adjustForOverview()],
        [
          Main.overview,
          'hidden',
          () => {
            if (this.isPrimary) {
              //reset the primary monitor when exiting the overview
              this.panelManager.setFocusedMonitor(this.monitor)
            }
          },
        ],
        [
          this.statusArea.activities,
          'captured-event',
          (actor, e) => {
            if (
              e.type() == Clutter.EventType.BUTTON_PRESS ||
              e.type() == Clutter.EventType.TOUCH_BEGIN
            ) {
              //temporarily use as primary the monitor on which the activities btn was clicked
              this.panelManager.setFocusedMonitor(this.monitor)
            }
          },
        ],
        [
          this._centerBox,
          'child-added',
          () => this._onBoxActorAdded(this._centerBox),
        ],
        [
          this._rightBox,
          'child-added',
          () => this._onBoxActorAdded(this._rightBox),
        ],
        [this.panel, 'scroll-event', this._onPanelMouseScroll.bind(this)],
        [
          SETTINGS,
          'changed::clone-main-panel',
          () => this._syncMainPanelClones(),
        ],
        [Main.layoutManager, 'startup-complete', () => this._resetGeometry()],
      )

      this._bindSettingsChanges()
      this._connectMainPanelClones()

      this.panelStyle.enable(this)

      if (this.geom.vertical) {
        this._signalsHandler.add([
          this.panelBox,
          'notify::visible',
          () => {
            if (this.panelBox.visible) {
              this._refreshVerticalAlloc()
            }
          },
        ])

        if (this.statusArea.dateMenu) {
          this._formatVerticalClock()

          this._signalsHandler.add([
            this.statusArea.dateMenu._clock,
            'notify::clock',
            () => this._formatVerticalClock(),
          ])
        }
      }

      // Since we are usually visible but not usually changing, make sure
      // most repaint requests don't actually require us to repaint anything.
      // This saves significant CPU when repainting the screen.
      this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS)

      if (!Main.layoutManager._startingUp)
        this._waitResetGeomId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
          this._waitResetGeomId = 0
          this._resetGeometry()

          return GLib.SOURCE_REMOVE
        })
    }

    disable() {
      this._clearMainPanelClones()
      if (this._cloneSyncId) {
        GLib.source_remove(this._cloneSyncId)
        this._cloneSyncId = 0
      }

      this.panelStyle.disable()

      this._timeoutsHandler.destroy()
      this._signalsHandler.destroy()

      if (this._waitResetGeomId) {
        GLib.source_remove(this._waitResetGeomId)
        this._waitResetGeomId = 0
      }

      this.panel.remove_child(this.taskbar.actor)

      if (this.intellihide) {
        this.intellihide.destroy()
      }

      this.dynamicTransparency.destroy()

      this.taskbar.destroy()
      this.showAppsIconWrapper.destroy()

      this._setPanelBoxStyle(true)
      this._maybeSetDockCss(true)

      this.menuManager._changeMenu = this.menuManager._oldChangeMenu

      this._unmappedButtons.forEach((a) => this._disconnectVisibleId(a))

      if (this.statusArea.dateMenu) {
        this.statusArea.dateMenu._clockDisplay.text =
          this.statusArea.dateMenu._clock.clock
        this.statusArea.dateMenu._clockDisplay.clutter_text.set_width(-1)

        if (this._dateMenuIndicatorPadContraints) {
          let indicatorPad = this.statusArea.dateMenu
            .get_first_child()
            .get_first_child()

          this._dateMenuIndicatorPadContraints.forEach((c) =>
            indicatorPad.add_constraint(c),
          )
        }
      }

      this._setVertical(this.panel, false)
      this._setVertical(this._centerBox, false)
      this._setVertical(this._rightBox, false)

      let { name: systemMenuName } = Utils.getSystemMenuInfo()

      if (!this.isStandalone) {
        ;['vertical', 'horizontal', 'dashtopanelMainPanel'].forEach((c) =>
          this.panel.remove_style_class_name(c),
        )

        if (!Main.sessionMode.isLocked) {
          ;['activities', systemMenuName, 'dateMenu'].forEach((b) => {
            let container = this.statusArea[b].container
            let originalParent = container._dtpOriginalParent

            this.panel.remove_child(container)

            if (originalParent) {
              originalParent.visible = true

              originalParent.insert_child_at_index(
                container,
                Math.min(
                  container._dtpOriginalIndex,
                  originalParent.get_children().length - 1,
                ),
              )
            }

            delete container._dtpOriginalParent
            delete container._dtpOriginalIndex
          })
        }

        if (this.statusArea.quickSettings?.menu) {
          this.statusArea.quickSettings.menu._arrowSide = St.Side.TOP
          this.statusArea.quickSettings.menu._arrowAlignment = 0
        }

        this._setShowDesktopButton(false)

        delete this.panel._toggleMenu
        delete Utils.getIndicators(
          this.statusArea[systemMenuName]._volumeOutput,
        )._dtpIgnoreScroll

        this._injectionManager.clear()

        this.panel._delegate = this.panel
      } else {
        this._removePanelMenu('dateMenu')
        this._removePanelMenu(systemMenuName)
        this._removePanelMenu('activities')
      }

      Main.ctrlAltTabManager.removeGroup(this)
    }

    handleDragOver(source) {
      if (
        source == Main.xdndHandler &&
        Main.overview.shouldToggleByCornerOrButton()
      ) {
        this.panelManager.showFocusedAppInOverview(null, true)
        Main.overview.show()
      }

      return DND.DragMotionResult.CONTINUE
    }

    getPosition() {
      let position = PanelSettings.getPanelPosition(
        SETTINGS,
        this.monitor.index,
      )

      if (position == Pos.TOP) {
        return St.Side.TOP
      } else if (position == Pos.RIGHT) {
        return St.Side.RIGHT
      } else if (position == Pos.BOTTOM) {
        return St.Side.BOTTOM
      }

      return St.Side.LEFT
    }

    checkIfVertical() {
      return this.geom.vertical
    }

    getOrientation() {
      return this.geom.vertical ? 'vertical' : 'horizontal'
    }

    updateElementPositions() {
      let panelPositions = PanelSettings.getPanelElementPositions(
        SETTINGS,
        this.monitor.index,
      )

      this._updateGroupedElements(panelPositions)

      this.panel.hide()
      this.panel.show()
    }

    _updateGroupedElements(panelPositions) {
      let previousPosition = 0
      let previousCenteredPosition = 0
      let currentGroup = -1

      this._elementGroups = []

      panelPositions.forEach((pos) => {
        let allocationMap = this.allocationMap[pos.element]

        if (allocationMap.actor) {
          allocationMap.actor.visible = pos.visible

          if (!pos.visible) return

          // if the panel length is dynamic, get all visible
          // elements as a single group
          let currentPosition = this.geom.dynamic || pos.position
          let isCentered = Pos.checkIfCentered(currentPosition)

          if (
            currentPosition == Pos.STACKED_TL &&
            previousPosition == Pos.STACKED_BR
          ) {
            currentPosition = Pos.STACKED_BR
          }

          if (
            !previousPosition ||
            (previousPosition == Pos.STACKED_TL &&
              currentPosition != Pos.STACKED_TL) ||
            (previousPosition != Pos.STACKED_BR &&
              currentPosition == Pos.STACKED_BR) ||
            (isCentered &&
              previousPosition != currentPosition &&
              previousPosition != Pos.STACKED_BR)
          ) {
            this._elementGroups[++currentGroup] = {
              elements: [],
              index: this._elementGroups.length,
              expandableIndex: -1,
            }
            previousCenteredPosition = 0
          }

          if (pos.element == Pos.TASKBAR) {
            this._elementGroups[currentGroup].expandableIndex =
              this._elementGroups[currentGroup].elements.length
          }

          if (isCentered && !this._elementGroups[currentGroup].isCentered) {
            this._elementGroups[currentGroup].isCentered = 1
            previousCenteredPosition = currentPosition
          }

          this._elementGroups[currentGroup].position =
            previousCenteredPosition || currentPosition
          this._elementGroups[currentGroup].elements.push(allocationMap)

          allocationMap.position = currentPosition
          previousPosition = currentPosition
        }
      })
    }

    _bindSettingsChanges() {
      let isVertical = this.geom.vertical

      this._signalsHandler.add(
        [
          SETTINGS,
          [
            'changed::panel-side-margins',
            'changed::panel-top-bottom-margins',
            'changed::panel-side-padding',
            'changed::panel-top-bottom-padding',
            'changed::panel-sizes',
            'changed::group-apps',
          ],
          (settings, settingChanged) => {
            PanelSettings.clearCache(settingChanged)
            this._resetGeometry()
          },
        ],
        [
          SETTINGS,
          ['changed::appicon-margin', 'changed::appicon-padding'],
          () => this.taskbar.resetAppIcons(),
        ],
        [
          SETTINGS,
          [
            'changed::showdesktop-button-width',
            'changed::trans-use-custom-bg',
            'changed::desktop-line-use-custom-color',
            'changed::desktop-line-custom-color',
            'changed::trans-bg-color',
          ],
          () => this._setShowDesktopButtonStyle(),
        ],
        [
          DESKTOPSETTINGS,
          'changed::clock-format',
          () => {
            this._clockFormat = null

            if (isVertical) {
              this._formatVerticalClock()
            }
          },
        ],
      )

      if (isVertical) {
        this._signalsHandler.add([
          SETTINGS,
          'changed::group-apps-label-max-width',
          () => this._resetGeometry(),
        ])
      }
    }

    _setPanelMenu(propName, constr, container) {
      if (!this.statusArea[propName]) {
        this.statusArea[propName] = this._getPanelMenu(propName, constr)
        this.menuManager.addMenu(this.statusArea[propName].menu)
        container.insert_child_at_index(this.statusArea[propName].container, 0)
      }
    }

    _removePanelMenu(propName) {
      if (this.statusArea[propName]) {
        let parent = this.statusArea[propName].container.get_parent()

        if (parent) {
          parent.remove_child(this.statusArea[propName].container)
        }

        //calling this.statusArea[propName].destroy(); is buggy for now, gnome-shell never
        //destroys those panel menus...
        //since we can't destroy the menu (hence properly disconnect its signals), let's
        //store it so the next time a panel needs one of its kind, we can reuse it instead
        //of creating a new one
        let panelMenu = this.statusArea[propName]

        this.menuManager.removeMenu(panelMenu.menu)
        PERSISTENTSTORAGE[propName].push(panelMenu)
        this.statusArea[propName] = null
      }
    }

    _getPanelMenu(propName, constr) {
      PERSISTENTSTORAGE[propName] = PERSISTENTSTORAGE[propName] || []

      if (!PERSISTENTSTORAGE[propName].length) {
        PERSISTENTSTORAGE[propName].push(new constr())
      }

      return PERSISTENTSTORAGE[propName].pop()
    }

    _adjustForOverview() {
      let isFocusedMonitor = this.panelManager.checkIfFocusedMonitor(
        this.monitor,
      )
      let isOverview = !!Main.overview.visibleTarget
      let isOverviewFocusedMonitor = isOverview && isFocusedMonitor
      let isShown = !isOverview || isOverviewFocusedMonitor
      let actorData = Utils.getTrackedActorData(this.panelBox)

      // prevent the "chrome" to update the panelbox visibility while in overview
      actorData.trackFullscreen = !isOverview

      this.panelBox[isShown ? 'show' : 'hide']()
    }

    _resetGeometry() {
      this._setPanelBoxStyle()
      this.geom = this.getGeometry()
      this._maybeSetDockCss()
      this._setPanelPosition()
      this.taskbar.resetAppIcons(true)
      this.dynamicTransparency.updateExternalStyle()

      if (this.intellihide?.enabled) this.intellihide.reset()

      this._mainPanelClones.forEach((c) => c.syncLayout())

      if (this.geom.vertical) {
        this.showAppsIconWrapper.realShowAppsIcon.toggleButton.set_width(
          this.geom.innerSize,
        )
        this._refreshVerticalAlloc()
      }
    }

    getGeometry() {
      let position = this.getPosition()
      let vertical = position == St.Side.LEFT || position == St.Side.RIGHT
      let scaleFactor = Utils.getScaleFactor()
      let panelBoxTheme = this.panelBox.get_theme_node()
      let sideMargins =
        panelBoxTheme.get_padding(St.Side.LEFT) +
        panelBoxTheme.get_padding(St.Side.RIGHT)
      let topBottomMargins =
        panelBoxTheme.get_padding(St.Side.TOP) +
        panelBoxTheme.get_padding(St.Side.BOTTOM)
      let sidePadding = SETTINGS.get_int('panel-side-padding')
      let topBottomPadding = SETTINGS.get_int('panel-top-bottom-padding')
      let panelLength = PanelSettings.getPanelLength(
        SETTINGS,
        this.monitor.index,
      )
      let anchor = PanelSettings.getPanelAnchor(SETTINGS, this.monitor.index)
      let dynamic = panelLength == -1 ? Pos.anchorToPosition[anchor] : 0
      let dockMode = false
      let length = (dynamic ? 100 : panelLength) / 100
      let gsTopPanelHeight = 0
      let x = 0
      let y = 0
      let w = 0
      let h = 0
      let fixedPadding = 0
      let varPadding = 0
      let topOffset = 0
      let iconSize = 0
      let innerSize = 0
      let outerSize = 0
      let panelSize = PanelSettings.getPanelSize(SETTINGS, this.monitor.index)

      if (vertical && panelSize - sidePadding * 2 < MIN_PANEL_SIZE)
        sidePadding = (panelSize - MIN_PANEL_SIZE) * 0.5
      else if (!vertical && panelSize - topBottomPadding * 2 < MIN_PANEL_SIZE)
        topBottomPadding = (panelSize - MIN_PANEL_SIZE) * 0.5

      iconSize = innerSize = outerSize = panelSize * scaleFactor

      if (
        SETTINGS.get_boolean('stockgs-keep-top-panel') &&
        Main.layoutManager.primaryMonitor == this.monitor
      ) {
        gsTopPanelHeight = this.panelManager.gsTopPanelHeight
        topOffset = position == St.Side.TOP ? gsTopPanelHeight : 0
      }

      if (vertical) {
        if (!SETTINGS.get_boolean('group-apps')) {
          // add window title width and side padding of _dtpIconContainer when vertical
          innerSize = outerSize +=
            SETTINGS.get_int('group-apps-label-max-width') +
            (AppIcons.DEFAULT_PADDING_SIZE * 2) / scaleFactor
        }

        this.sizeFunc = 'get_preferred_height'
        this.fixedCoord = { c1: 'x1', c2: 'x2' }
        this.varCoord = { c1: 'y1', c2: 'y2' }

        w = innerSize
        h = this.monitor.height * length - topBottomMargins - gsTopPanelHeight
        dockMode = !!dynamic || topBottomMargins > 0 || h < this.monitor.height
        fixedPadding = sidePadding * scaleFactor
        varPadding = topBottomPadding * scaleFactor
        outerSize += sideMargins
      } else {
        this.sizeFunc = 'get_preferred_width'
        this.fixedCoord = { c1: 'y1', c2: 'y2' }
        this.varCoord = { c1: 'x1', c2: 'x2' }

        w = this.monitor.width * length - sideMargins
        h = innerSize
        dockMode = !!dynamic || sideMargins > 0 || w < this.monitor.width
        fixedPadding = topBottomPadding * scaleFactor
        varPadding = sidePadding * scaleFactor
        outerSize += topBottomMargins - topOffset
      }

      if (position == St.Side.TOP) {
        x = this.monitor.x
        y = this.monitor.y
      } else if (position == St.Side.LEFT) {
        x = this.monitor.x
        y = this.monitor.y + gsTopPanelHeight
      } else if (position == St.Side.RIGHT) {
        x = this.monitor.x + this.monitor.width - w - sideMargins
        y = this.monitor.y + gsTopPanelHeight
      } else {
        //BOTTOM
        x = this.monitor.x
        y = this.monitor.y + this.monitor.height - h - topBottomMargins
      }

      if (length < 1) {
        // fixed size, less than 100%, so adjust start coordinate
        if (!vertical && anchor == Pos.MIDDLE)
          x += (this.monitor.width - w - sideMargins) * 0.5
        else if (vertical && anchor == Pos.MIDDLE)
          y += (this.monitor.height - h - topBottomMargins) * 0.5
        else if (!vertical && anchor == Pos.END)
          x += this.monitor.width - w - sideMargins
        else if (vertical && anchor == Pos.END)
          y += this.monitor.height - h - topBottomMargins
      }

      innerSize -= fixedPadding * 2
      iconSize -= fixedPadding * 2

      return {
        x,
        y,
        w,
        h,
        iconSize, // selected panel thickness in settings
        innerSize, // excludes padding and margins
        outerSize, // includes padding and margins
        fixedPadding,
        varPadding,
        topOffset, // only if gnome-shell top panel is present and position is TOP
        gsTopPanelHeight, // only if gnome-shell top panel is present
        position,
        vertical,
        dynamic,
        dockMode,
      }
    }

    _setAllocationMap() {
      this.allocationMap = {}
      let setMap = (name, actor) =>
        (this.allocationMap[name] = {
          actor: actor,
          box: new Clutter.ActorBox(),
        })

      setMap(Pos.SHOW_APPS_BTN, this.showAppsIconWrapper.realShowAppsIcon)
      setMap(
        Pos.ACTIVITIES_BTN,
        this.statusArea.activities ? this.statusArea.activities.container : 0,
      )
      setMap(Pos.LEFT_BOX, this._leftBox)
      setMap(Pos.TASKBAR, this.taskbar.actor)
      setMap(Pos.CENTER_BOX, this._centerBox)
      setMap(Pos.DATE_MENU, this.statusArea.dateMenu.container)
      setMap(
        Pos.SYSTEM_MENU,
        this.statusArea[Utils.getSystemMenuInfo().name].container,
      )
      setMap(Pos.RIGHT_BOX, this._rightBox)
      setMap(Pos.DESKTOP_BTN, this._showDesktopButton)
    }

    _mainPanelAllocate(box) {
      this.panel.set_allocation(box)
    }

    vfunc_allocate(box) {
      let fixed = 0
      let centeredMonitorGroup
      let varSize = box[this.varCoord.c2] - box[this.varCoord.c1]
      let fixedSize = box[this.fixedCoord.c2] - box[this.fixedCoord.c1]
      let panelAlloc = new Clutter.ActorBox()
      let assignGroupSize = (group, update) => {
        group.size = 0
        group.tlOffset = 0
        group.brOffset = 0

        group.elements.forEach((element) => {
          if (!update) {
            element.box[this.fixedCoord.c1] =
              panelAlloc[this.fixedCoord.c1] + this.geom.fixedPadding
            element.box[this.fixedCoord.c2] =
              panelAlloc[this.fixedCoord.c2] - this.geom.fixedPadding
            element.natSize = element.actor[this.sizeFunc](-1)[1]
          }

          if (!group.isCentered || Pos.checkIfCentered(element.position)) {
            group.size += element.natSize
          } else if (element.position == Pos.STACKED_TL) {
            group.tlOffset += element.natSize
          } else {
            // Pos.STACKED_BR
            group.brOffset += element.natSize
          }
        })

        if (group.isCentered) {
          group.size += Math.max(group.tlOffset, group.brOffset) * 2
          group.tlOffset = Math.max(group.tlOffset - group.brOffset, 0)
        }
      }
      let allocateGroup = (group, tlLimit, brLimit) => {
        let startPosition = tlLimit
        let currentPosition = 0

        if (group.expandableIndex >= 0) {
          let availableSize = brLimit - tlLimit
          let expandable = group.elements[group.expandableIndex]
          let i = 0
          let l = this._elementGroups.length
          let tlSize = 0
          let brSize = 0

          if (
            centeredMonitorGroup &&
            (centeredMonitorGroup != group ||
              expandable.position != Pos.CENTERED_MONITOR)
          ) {
            if (
              centeredMonitorGroup.index < group.index ||
              (centeredMonitorGroup == group &&
                expandable.position == Pos.STACKED_TL)
            ) {
              i = centeredMonitorGroup.index
            } else {
              l = centeredMonitorGroup.index
            }
          }

          for (; i < l; ++i) {
            let refGroup = this._elementGroups[i]

            if (
              i < group.index &&
              (!refGroup.fixed || refGroup[this.varCoord.c2] > tlLimit)
            ) {
              tlSize += refGroup.size
            } else if (
              i > group.index &&
              (!refGroup.fixed || refGroup[this.varCoord.c1] < brLimit)
            ) {
              brSize += refGroup.size
            }
          }

          if (group.isCentered) {
            availableSize -= Math.max(tlSize, brSize) * 2
          } else {
            availableSize -= tlSize + brSize
          }

          if (availableSize < group.size) {
            expandable.natSize -=
              (group.size - availableSize) *
              (group.isCentered && !Pos.checkIfCentered(expandable.position)
                ? 0.5
                : 1)
            assignGroupSize(group, true)
          }
        }

        if (group.isCentered) {
          startPosition = tlLimit + (brLimit - tlLimit - group.size) * 0.5
        } else if (group.position == Pos.STACKED_BR) {
          startPosition = brLimit - group.size
        }

        currentPosition = group.tlOffset + startPosition

        group.elements.forEach((element) => {
          element.box[this.varCoord.c1] = Math.round(currentPosition)
          element.box[this.varCoord.c2] = Math.round(
            (currentPosition += element.natSize),
          )

          element.actor.allocate(element.box)
        })

        group[this.varCoord.c1] = startPosition
        group[this.varCoord.c2] = currentPosition
        group.fixed = 1
        ++fixed
      }

      panelAlloc[this.varCoord.c2] = varSize
      panelAlloc[this.fixedCoord.c2] = fixedSize

      this._elementGroups.forEach((group) => {
        group.fixed = 0

        assignGroupSize(group)

        if (group.position == Pos.CENTERED_MONITOR) {
          centeredMonitorGroup = group
        }
      })

      if (this.geom.dynamic && this._elementGroups.length == 1) {
        let dynamicGroup = this._elementGroups[0] // only one group if dynamic
        let tl = box[this.varCoord.c1]
        let br = box[this.varCoord.c2]
        let groupSize = dynamicGroup.size + this.geom.varPadding * 2

        if (this.geom.dynamic == Pos.STACKED_TL) {
          br = Math.min(br, tl + groupSize)
        } else if (this.geom.dynamic == Pos.STACKED_BR) {
          tl = Math.max(tl, br - groupSize)
        } else {
          // CENTERED_MONITOR
          let half = Math.max(0, Math.floor((br - tl - groupSize) * 0.5))

          tl += half
          br -= half
        }

        box[this.varCoord.c1] = tl
        box[this.varCoord.c2] = br

        panelAlloc[this.varCoord.c2] = Math.min(groupSize, br - tl)
      }

      this.set_allocation(box)
      this.panel.allocate(panelAlloc)

      // apply padding to panel's children, after panel allocation
      panelAlloc[this.varCoord.c1] += this.geom.varPadding
      panelAlloc[this.varCoord.c2] -= this.geom.varPadding

      if (centeredMonitorGroup) {
        allocateGroup(
          centeredMonitorGroup,
          panelAlloc[this.varCoord.c1],
          panelAlloc[this.varCoord.c2],
        )
      }

      let iterations = 0 //failsafe
      while (fixed < this._elementGroups.length && ++iterations < 10) {
        for (let i = 0, l = this._elementGroups.length; i < l; ++i) {
          let group = this._elementGroups[i]

          if (group.fixed) {
            continue
          }

          let prevGroup = this._elementGroups[i - 1]
          let nextGroup = this._elementGroups[i + 1]
          let prevLimit =
            prevGroup && prevGroup.fixed
              ? prevGroup[this.varCoord.c2]
              : centeredMonitorGroup && group.index > centeredMonitorGroup.index
                ? centeredMonitorGroup[this.varCoord.c2]
                : panelAlloc[this.varCoord.c1]
          let nextLimit =
            nextGroup && nextGroup.fixed
              ? nextGroup[this.varCoord.c1]
              : centeredMonitorGroup && group.index < centeredMonitorGroup.index
                ? centeredMonitorGroup[this.varCoord.c1]
                : panelAlloc[this.varCoord.c2]

          if (group.position == Pos.STACKED_TL) {
            allocateGroup(group, panelAlloc[this.varCoord.c1], nextLimit)
          } else if (group.position == Pos.STACKED_BR) {
            allocateGroup(group, prevLimit, panelAlloc[this.varCoord.c2])
          } else if (
            (!prevGroup || prevGroup.fixed) &&
            (!nextGroup || nextGroup.fixed)
          ) {
            // CENTERED
            allocateGroup(group, prevLimit, nextLimit)
          }
        }
      }
    }

    _setPanelBoxStyle(disable) {
      this.panelBox.set_style('')
      this.panelBox.remove_style_class_name('dashtopanel')

      if (!disable) {
        this.panelBox.add_style_class_name('dashtopanel')
        this._relevantPanelBoxStyles = this._getRelevantPanelBoxStyles()

        let topBottomMargins = SETTINGS.get_int('panel-top-bottom-margins')
        let sideMargins = SETTINGS.get_int('panel-side-margins')
        let { padding } = this._relevantPanelBoxStyles

        // add existing theme padding to dtp panel margins
        this.panelBox.set_style(
          `padding: 
              ${this.geom.topOffset + topBottomMargins + padding[St.Side.TOP]}px 
              ${sideMargins + padding[St.Side.RIGHT]}px 
              ${topBottomMargins + padding[St.Side.BOTTOM]}px 
              ${sideMargins + padding[St.Side.LEFT]}px;`,
        )
      }
    }

    _getRelevantPanelBoxStyles() {
      // Get unaffected panelbox styles that, if changed externally, would require a
      // geometry reset (e.g. other extensions css classes).
      // This is needed as dtp sets its panelbox margins using the style property, effectively
      // overriding any css classes that could be added after dtp is enabled
      let relevantStyles = { padding: {} }
      let currentStyle = this.panelBox.get_style()

      this.panelBox.set_style('')

      let panelBoxTheme = this.panelBox.get_theme_node()

      Object.values(St.Side).forEach(
        (v) => (relevantStyles.padding[v] = panelBoxTheme.get_padding(v)),
      )

      this.panelBox.set_style(currentStyle)

      return relevantStyles
    }

    _maybeSetDockCss(disable) {
      this.remove_style_class_name('dock')

      if (!disable && this.geom.dockMode) this.add_style_class_name('dock')
    }

    _setPanelPosition() {
      this.set_size(this.geom.w, this.geom.h)
      this.clipContainer.set_position(this.geom.x, this.geom.y)

      this._setVertical(this.panel, this.geom.vertical)

      // center the system menu popup relative to its panel button
      if (this.statusArea.quickSettings?.menu) {
        this.statusArea.quickSettings.menu._arrowSide = this.geom.position
        this.statusArea.quickSettings.menu._arrowAlignment = 0.5
      }

      // styles for theming
      Object.keys(St.Side).forEach((p) => {
        let cssName = 'dashtopanel' + p.charAt(0) + p.slice(1).toLowerCase()

        this.panel[
          (St.Side[p] == this.geom.position ? 'add' : 'remove') +
            '_style_class_name'
        ](cssName)
      })

      this._setPanelClip()

      Main.layoutManager._updateHotCorners()
      Main.layoutManager._updatePanelBarrier(this)
    }

    _setPanelClip() {
      this._timeoutsHandler.add([
        T7,
        0,
        () =>
          Utils.setClip(
            this.clipContainer,
            this.clipContainer.x,
            this.clipContainer.y,
            this.panelBox.width,
            this.panelBox.height,
            0,
            this.geom.topOffset,
          ),
      ])
    }

    _onButtonPress(actor, event) {
      let type = event.type()
      let isPress = type == Clutter.EventType.BUTTON_PRESS
      let button = isPress ? event.get_button() : -1
      let [stageX, stageY] = event.get_coords()

      if (
        button == 3 &&
        global.stage.get_actor_at_pos(
          Clutter.PickMode.REACTIVE,
          stageX,
          stageY,
        ) == this.panel
      ) {
        //right click on an empty part of the panel, temporarily borrow and display the showapps context menu
        Main.layoutManager.setDummyCursorGeometry(stageX, stageY, 0, 0)

        this.showAppsIconWrapper.createMenu()
        this.showAppsIconWrapper.popupMenu(Main.layoutManager.dummyCursor)

        return Clutter.EVENT_STOP
      } else {
        const targetActor = global.stage.get_event_actor(event)

        if (
          Main.modalCount > 0 ||
          targetActor != actor ||
          (!isPress && type != Clutter.EventType.TOUCH_BEGIN) ||
          (isPress && button != 1)
        ) {
          return Clutter.EVENT_PROPAGATE
        }
      }

      let params = this.geom.vertical
        ? [stageY, 'y', 'height']
        : [stageX, 'x', 'width']
      let dragWindow = this._getDraggableWindowForPosition.apply(
        this,
        params.concat(['maximized_' + this.getOrientation() + 'ly']),
      )

      if (!dragWindow) return Clutter.EVENT_PROPAGATE

      let dragOpArgs = [Meta.GrabOp.MOVING]

      if (Config.PACKAGE_VERSION < '50')
        dragOpArgs.push(event.get_device(), event.get_event_sequence())
      else
        dragOpArgs.push(
          global.stage
            .get_context()
            .get_backend()
            .get_sprite(global.stage, event),
        )

      dragWindow.begin_grab_op(
        ...dragOpArgs,
        event.get_time(),
        new Graphene.Point({ x: stageX, y: stageY }),
      )

      return Clutter.EVENT_STOP
    }

    _getDraggableWindowForPosition(
      stageCoord,
      coord,
      dimension,
      maximizedProp,
    ) {
      let workspace = Utils.getCurrentWorkspace()
      let allWindowsByStacking = global.display
        .sort_windows_by_stacking(workspace.list_windows())
        .reverse()

      return Utils.find(allWindowsByStacking, (metaWindow) => {
        let rect = metaWindow.get_frame_rect()

        return (
          metaWindow.get_monitor() == this.monitor.index &&
          metaWindow.showing_on_its_workspace() &&
          metaWindow.get_window_type() != Meta.WindowType.DESKTOP &&
          metaWindow[maximizedProp] &&
          stageCoord > rect[coord] &&
          stageCoord < rect[coord] + rect[dimension]
        )
      })
    }

    _getCloneSourcePanel() {
      let source = this.panelManager.allPanels[0]

      // only the main panel (the original gnome-shell panel) holds the extensions
      return this.isStandalone && source && !source.isStandalone ? source : null
    }

    _connectMainPanelClones() {
      try {
        let source = this._getCloneSourcePanel()

        if (source) {
          panelBoxes.forEach((b) => {
            this._signalsHandler.add([
              source[b],
              ['child-added', 'child-removed'],
              () => this._queueMainPanelClonesSync(),
            ])
          })
        }

        this._syncMainPanelClones()
      } catch (e) {
        console.error(`dash-to-panel: unable to clone the main panel: ${e}`)
      }
    }

    // the menus the pointer can switch between while one of them is open
    _getCloneMenus(source) {
      return [
        ...new Set([
          ...this.menuManager._menus,
          ...source.menuManager._menus,
          ...this._mainPanelClones.map((c) => c.menu),
        ]),
      ].filter((m) => m instanceof PopupMenu.PopupMenu)
    }

    // While a menu holds the grab, the shell only delivers pointer events to that menu,
    // so hovering another indicator has to be handled from the open menu's actor.
    _connectCloneMenuEvents(source) {
      let actors = this._getCloneMenus(source).map((m) => m.actor)

      this._cloneMenuActors
        .filter((a) => !actors.includes(a))
        .forEach((a) => a.disconnectObject(this))
      actors
        .filter((a) => !this._cloneMenuActors.includes(a))
        .forEach((a) =>
          a.connectObject(
            'captured-event',
            (actor, event) => this._onGrabbedMenuEvent(event),
            this,
          ),
        )
      this._cloneMenuActors = actors
    }

    _disconnectCloneMenuEvents() {
      this._cloneMenuActors.forEach((a) => a.disconnectObject(this))
      this._cloneMenuActors = []
    }

    // The menu managers only switch between their own menus, and can't find the menus
    // of clones, which are only anchored to their clone while open. So switch to the
    // hovered menu here in those cases, through its manager like the stock switch.
    _onGrabbedMenuEvent(event) {
      let source = this._getCloneSourcePanel()

      if (
        !source ||
        !this._mainPanelClones.length ||
        event.type() != Clutter.EventType.ENTER ||
        event.get_flags() & Clutter.EventFlags.FLAG_GRAB_NOTIFY
      ) {
        return Clutter.EVENT_PROPAGATE
      }

      try {
        let target = global.stage.get_event_actor(event)
        let clone = this._mainPanelClones.find(
          (c) => c.menu && c.actor.contains(target),
        )
        let managers = [this.menuManager, source.menuManager]
        let menu =
          clone?.menu ??
          managers
            .map((m) => m._findMenuForSource(target))
            .find((m) => m instanceof PopupMenu.PopupMenu)
        let manager = managers.find((m) => m._menus.includes(menu))
        let opened = this._getCloneMenus(source).filter(
          (m) => m.isOpen && m != menu,
        )

        if (
          !manager ||
          menu.isOpen ||
          !opened.length ||
          // the stock manager of the open menu switches to its own menus
          (!clone && opened.every((m) => manager._menus.includes(m)))
        ) {
          return Clutter.EVENT_PROPAGATE
        }

        // the manager doesn't open menus on hover when buttons only react to clicks
        let change = () => manager._changeMenu(menu)

        if (clone) this._openCloneMenu(clone, change)
        else change()

        // like the managers, close the previous menu once the new one holds the grab
        if (menu.isOpen)
          opened
            .filter((m) => m.isOpen)
            .forEach((m) => m.close(BoxPointer.PopupAnimation.FADE))
      } catch (e) {
        console.error(e)
      }

      return Clutter.EVENT_PROPAGATE
    }

    _queueMainPanelClonesSync() {
      if (this._cloneSyncId) return

      this._cloneSyncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        this._cloneSyncId = 0

        try {
          this._syncMainPanelClones()
        } catch (e) {
          console.error(`dash-to-panel: unable to clone the main panel: ${e}`)
        }

        return GLib.SOURCE_REMOVE
      })
    }

    _clearMainPanelClones() {
      let clones = this._mainPanelClones || []

      this._mainPanelClones = []
      this._disconnectCloneMenuEvents()
      clones.forEach((c) => this._destroyMainPanelClone(c))
    }

    // never throws: this runs while the extension is being disabled and the sources
    // may already have been destroyed by their extensions
    _destroyMainPanelClone(c) {
      try {
        if (c.menu?._dtpCloneAnchor?.clone == c) {
          c.menu.close()
          releaseCloneMenu(c.menu)
        }

        // the signals of the sources are connected with the clone as owner, so this
        // also disconnects them
        c.actor.destroy()
      } catch (e) {
        console.warn(`dash-to-panel: clone cleanup failed: ${e}`)
      }
    }

    // Opens the original menu of an indicator anchored to its clone, so it appears on
    // this monitor. The menu is given back to the indicator as soon as it closes.
    _openCloneMenu(c, open) {
      let menu = c.menu

      // a menu that is open on the main panel or another clone moves here
      if (menu.isOpen) menu.close()
      releaseCloneMenu(menu)

      menu._dtpCloneAnchor = {
        clone: c,
        sourceActor: menu.sourceActor,
        focusActor: menu.focusActor,
        arrowSide: menu._boxPointer._userArrowSide,
        stateId: menu.connect('open-state-changed', (m, isOpen) => {
          if (!isOpen) return releaseCloneMenu(m)

          // the menu belongs to this clone, so only the clone shows the pressed state
          c.indicator.remove_style_pseudo_class('active')
          c.actor.add_style_pseudo_class('active')
        }),
      }
      menu.sourceActor = menu.focusActor = c.actor
      menu._boxPointer._userArrowSide = this.geom.position

      open()

      // e.g. an empty menu doesn't open
      if (!menu.isOpen) releaseCloneMenu(menu)
    }

    _toggleCloneMenu(c) {
      if (c.menu.isOpen && c.menu._dtpCloneAnchor?.clone == c)
        c.menu.close(BoxPointer.PopupAnimation.FULL)
      else
        this._openCloneMenu(c, () =>
          c.menu.open(BoxPointer.PopupAnimation.FULL),
        )
    }

    _createMainPanelClone(child, box) {
      let indicator = child.child ?? child
      let isButton = indicator instanceof PanelMenu.Button
      // clone only the content of a panel button, the button itself (and so its
      // hover and active effects) is recreated here, independent for every panel
      let sources = isButton ? indicator.get_children() : [child]
      let clones = sources.map(
        (src) =>
          new Clutter.Clone({
            source: src,
            y_align: Clutter.ActorAlign.CENTER,
          }),
      )
      // not a St.BoxLayout, which a vertical panel would turn vertical
      let content = new St.Widget({ layout_manager: new Clutter.BoxLayout() })
      let actor = new MainPanelCloneButton({
        style_class: isButton ? 'panel-button' : '',
        reactive: true,
        track_hover: true,
        y_align: Clutter.ActorAlign.FILL,
      })
      let c = {
        source: child,
        indicator,
        box,
        actor,
        // indicators that only react to clicks have a dummy menu, it can't be anchored
        menu:
          indicator.menu instanceof PopupMenu.PopupMenu ? indicator.menu : null,
      }

      clones.forEach((clone) => content.add_child(clone))
      actor.add_child(content)

      // a clone is stretched to its own size, so keep it at the size of its source,
      // shrunk to fit a panel that is thinner than the main panel
      c.syncLayout = () => {
        let { innerSize, vertical } = this.geom
        // the allocations, as get_width() gives the preferred width while a
        // relayout is pending, e.g. when the button is allocated before its content
        let sizes = sources.map((src) => src.get_allocation_box().get_size())
        let width = sizes.reduce((w, [srcWidth]) => w + srcWidth, 0)
        let height = Math.max(0, ...sizes.map(([, srcHeight]) => srcHeight))
        let scale = Math.min(
          1,
          innerSize / ((vertical ? width : height) || innerSize),
        )

        sizes.forEach(([srcWidth, srcHeight], i) =>
          clones[i].set_size(
            Math.round(srcWidth * scale),
            Math.round(srcHeight * scale),
          ),
        )

        if (isButton) {
          // the shell pads buttons through its layout manager, not through css
          let buttonWidth = indicator.get_allocation_box().get_width()
          let hpadding = (Math.max(0, buttonWidth - width) / 2) * scale

          if (vertical)
            hpadding = Math.min(
              hpadding,
              Math.max(0, (innerSize - width * scale) / 2),
            )

          actor.setHPadding(Math.round(hpadding))
        }
      }

      let markStale = () => {
        c.stale = true
        this._queueMainPanelClonesSync()
      }
      let syncVisible = () => {
        actor.visible = child.visible && indicator.visible
      }

      // connected with the clone as owner, so they're disconnected when it's destroyed
      child.connectObject(
        'notify::visible',
        syncVisible,
        'destroy',
        markStale,
        actor,
      )
      sources.forEach((src) =>
        src.connectObject('notify::allocation', c.syncLayout, actor),
      )

      if (indicator != child)
        indicator.connectObject('notify::visible', syncVisible, actor)

      if (isButton)
        indicator.connectObject(
          'notify::allocation',
          c.syncLayout,
          'child-added',
          markStale,
          'child-removed',
          markStale,
          'menu-set',
          markStale,
          actor,
        )

      let onPress = () => {
        if (!c.menu) return Clutter.EVENT_PROPAGATE

        this._toggleCloneMenu(c)
        return Clutter.EVENT_STOP
      }

      actor.connect('button-press-event', onPress)
      actor.connect('touch-event', (a, event) =>
        event.type() == Clutter.EventType.TOUCH_BEGIN
          ? onPress()
          : Clutter.EVENT_PROPAGATE,
      )

      syncVisible()
      c.syncLayout()
      this[box].add_child(actor)

      return c
    }

    // Mirrors the extension indicators of the main panel (e.g. app menu, system
    // monitors), shrunk to fit this panel. Menus of the originals are opened
    // anchored to the clone, so they appear on this monitor.
    _syncMainPanelClones() {
      let source = this._getCloneSourcePanel()

      if (!source || !SETTINGS.get_boolean('clone-main-panel')) {
        this._clearMainPanelClones()
        return
      }

      let ownContainers = [
        'activities',
        'dateMenu',
        Utils.getSystemMenuInfo().name,
      ]
        .map((n) => source.statusArea[n]?.container)
        .filter((c) => c)
      let clones = []

      panelBoxes.forEach((b) => {
        let previous = null

        source[b].get_children().forEach((child) => {
          if (ownContainers.includes(child)) return

          // only rebuild what changed, so e.g. an open menu of a clone stays open
          let c =
            this._mainPanelClones.find(
              (c) => c.source == child && c.box == b && !c.stale,
            ) ?? this._createMainPanelClone(child, b)

          // keep the order of the main panel
          if (previous && c.actor.get_previous_sibling() != previous.actor)
            this[b].set_child_above_sibling(c.actor, previous.actor)

          previous = c
          clones.push(c)
        })
      })

      this._mainPanelClones
        .filter((c) => !clones.includes(c))
        .forEach((c) => this._destroyMainPanelClone(c))
      this._mainPanelClones = clones
      this._connectCloneMenuEvents(source)
    }

    _onBoxActorAdded(box) {
      if (this.geom.vertical) {
        this._setVertical(box, true)
      }
    }

    _refreshVerticalAlloc() {
      this._setVertical(this._centerBox, true)
      this._setVertical(this._rightBox, true)
      this._formatVerticalClock()
    }

    _setVertical(actor, isVertical) {
      let _set = (actor, isVertical) => {
        if (
          !actor ||
          actor instanceof Dash.DashItemContainer ||
          actor instanceof TaskbarItemContainer.TaskbarItemContainer
        ) {
          return
        }

        if (actor instanceof St.BoxLayout) {
          Utils.setBoxLayoutVertical(actor, isVertical)
        } else if (
          actor != this.statusArea.appMenu &&
          ((actor._delegate || actor) instanceof PanelMenu.ButtonBox ||
            actor == this.statusArea.quickSettings)
        ) {
          let child = actor.get_first_child()

          if (isVertical && !actor.visible && !actor._dtpVisibleId) {
            this._unmappedButtons.push(actor)
            actor._dtpVisibleId = actor.connect('notify::visible', () => {
              this._disconnectVisibleId(actor)
              this._refreshVerticalAlloc()
            })
            actor._dtpDestroyId = actor.connect('destroy', () =>
              this._disconnectVisibleId(actor),
            )
          }

          if (child) {
            let [, natWidth] = actor.get_preferred_width(-1)

            child.x_align = Clutter.ActorAlign[isVertical ? 'CENTER' : 'START']
            actor.set_width(isVertical ? this.geom.innerSize : -1)
            isVertical = isVertical && natWidth > this.geom.innerSize
            actor[(isVertical ? 'add' : 'remove') + '_style_class_name'](
              'vertical',
            )
          }
        }

        actor.get_children().forEach((c) => _set(c, isVertical))
      }

      _set(actor, false)

      if (isVertical) _set(actor, isVertical)
    }

    _disconnectVisibleId(actor) {
      actor.disconnect(actor._dtpVisibleId)
      actor.disconnect(actor._dtpDestroyId)

      delete actor._dtpVisibleId
      delete actor._dtpDestroyId

      this._unmappedButtons.splice(this._unmappedButtons.indexOf(actor), 1)
    }

    _formatVerticalClock() {
      // https://github.com/GNOME/gnome-desktop/blob/master/libgnome-desktop/gnome-wall-clock.c#L310
      if (this.statusArea.dateMenu) {
        let datetime = this.statusArea.dateMenu._clock.clock
        let datetimeParts = datetime.split(' ')
        let time = datetimeParts[1]
        let clockText = this.statusArea.dateMenu._clockDisplay.clutter_text
        let setClockText = (text, useTimeSeparator) => {
          let stacks = text instanceof Array
          let separator = `\n<span size="8192"> ${useTimeSeparator ? '‧‧' : '—'} </span>\n`

          clockText.set_text((stacks ? text.join(separator) : text).trim())
          clockText.set_use_markup(stacks)
          clockText.get_allocation_box()

          return !clockText.get_layout().is_ellipsized()
        }

        if (clockText.ellipsize == Pango.EllipsizeMode.NONE) {
          //on gnome-shell 3.36.4, the clockdisplay isn't ellipsize anymore, so set it back
          clockText.ellipsize = Pango.EllipsizeMode.END
        }

        clockText.natural_width = this.geom.innerSize

        if (!time) {
          datetimeParts = datetime.split(' ')
          time = datetimeParts.pop()
          datetimeParts = [datetimeParts.join(' '), time]
        }

        if (
          !setClockText(datetime) &&
          !setClockText(datetimeParts) &&
          !setClockText(time)
        ) {
          // https://gitlab.gnome.org/GNOME/gnome-desktop/-/merge_requests/176
          let timeSeparator = time.indexOf('∶') > 0 ? '∶' : ':'
          let timeParts = time.split(timeSeparator)

          if (!this._clockFormat) {
            this._clockFormat = DESKTOPSETTINGS.get_string('clock-format')
          }

          if (this._clockFormat == '12h') {
            timeParts.push.apply(timeParts, timeParts.pop().split(' '))
          }

          setClockText(timeParts, true)
        }
      }
    }

    _setShowDesktopButton(add) {
      if (add) {
        if (this._showDesktopButton) return

        this._showDesktopButton = new St.Bin({
          style_class: this.geom.vertical
            ? 'showdesktop-button-vertical'
            : 'showdesktop-button',
          reactive: true,
          can_focus: true,
          // x_fill: true,
          // y_fill: true,
          track_hover: true,
        })

        this._setShowDesktopButtonStyle()

        this._showDesktopButton.connect('touch-event', (actor, event) => {
          if (event.type() == Clutter.EventType.TOUCH_BEGIN) {
            this._onShowDesktopButtonPress()
          }
        })
        this._showDesktopButton.connect('button-press-event', () =>
          this._onShowDesktopButtonPress(),
        )
        this._showDesktopButton.connect('enter-event', () => {
          this._showDesktopButton.add_style_class_name(
            this._getBackgroundBrightness()
              ? 'showdesktop-button-light-hovered'
              : 'showdesktop-button-dark-hovered',
          )

          if (SETTINGS.get_boolean('show-showdesktop-hover')) {
            this._timeoutsHandler.add([
              T4,
              SETTINGS.get_int('show-showdesktop-delay'),
              () => {
                this._hiddenDesktopWorkspace =
                  Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace()
                this._toggleWorkspaceWindows(true, this._hiddenDesktopWorkspace)
              },
            ])
          }
        })

        this._showDesktopButton.connect('leave-event', () => {
          this._showDesktopButton.remove_style_class_name(
            this._getBackgroundBrightness()
              ? 'showdesktop-button-light-hovered'
              : 'showdesktop-button-dark-hovered',
          )

          if (SETTINGS.get_boolean('show-showdesktop-hover')) {
            if (this._timeoutsHandler.getId(T4)) {
              this._timeoutsHandler.remove(T4)
            } else if (this._hiddenDesktopWorkspace) {
              this._toggleWorkspaceWindows(false, this._hiddenDesktopWorkspace)
            }
          }
        })

        this.panel.add_child(this._showDesktopButton)
      } else {
        if (!this._showDesktopButton) return

        this.panel.remove_child(this._showDesktopButton)
        this._showDesktopButton.destroy()
        this._showDesktopButton = null
      }
    }

    _getDefaultLineColor(isBrightOverride) {
      return (typeof isBrightOverride === 'undefined' &&
        this._getBackgroundBrightness()) ||
        isBrightOverride
        ? 'rgba(55, 55, 55, .2)'
        : 'rgba(200, 200, 200, .2)'
    }

    _setShowDesktopButtonStyle() {
      let rgb = this._getDefaultLineColor()

      let isLineCustom = SETTINGS.get_boolean('desktop-line-use-custom-color')
      rgb = isLineCustom
        ? SETTINGS.get_string('desktop-line-custom-color')
        : rgb

      if (this._showDesktopButton) {
        let buttonSize = SETTINGS.get_int('showdesktop-button-width') + 'px;'
        let isVertical = this.geom.vertical

        let sytle = 'border: 0 solid ' + rgb + ';'
        sytle += isVertical
          ? 'border-top-width:1px;height:' + buttonSize
          : 'border-left-width:1px;width:' + buttonSize

        this._showDesktopButton.set_style(sytle)
        this._showDesktopButton[(isVertical ? 'x' : 'y') + '_expand'] = true
      }
    }

    // _getBackgroundBrightness: return true if panel has a bright background color
    _getBackgroundBrightness() {
      return Utils.checkIfColorIsBright(
        this.dynamicTransparency.backgroundColorRgb,
      )
    }

    _toggleWorkspaceWindows(hide, workspace) {
      let time = SETTINGS.get_int('show-showdesktop-time') * 0.001

      workspace.list_windows().forEach((w) => {
        if (!w.minimized && !w.customJS_ding) {
          let tweenOpts = {
            opacity: hide ? 0 : 255,
            time: time,
            transition: 'easeOutQuad',
          }

          Utils.animateWindowOpacity(w.get_compositor_private(), tweenOpts)
        }
      })
    }

    _onShowDesktopButtonPress() {
      let label = 'trackerFocusApp'

      this._signalsHandler.removeWithLabel(label)
      this._timeoutsHandler.remove(T5)

      if (this._restoreWindowList && this._restoreWindowList.length) {
        this._timeoutsHandler.remove(T4)

        let current_workspace =
          Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace()
        let windows = current_workspace.list_windows()
        this._restoreWindowList.forEach(function (w) {
          if (windows.indexOf(w) > -1) Main.activateWindow(w)
        })
        this._restoreWindowList = null
      } else {
        let current_workspace =
          Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace()
        let windows = current_workspace.list_windows().filter(function (w) {
          return w.showing_on_its_workspace() && !w.skip_taskbar
        })
        windows = global.display.sort_windows_by_stacking(windows)

        windows.forEach(function (w) {
          w.minimize()
        })

        this._restoreWindowList = windows

        this._timeoutsHandler.add([
          T5,
          20,
          () =>
            this._signalsHandler.addWithLabel(label, [
              tracker,
              'notify::focus-app',
              () => (this._restoreWindowList = null),
            ]),
        ])
      }

      Main.overview.hide()
    }

    _onPanelMouseScroll(actor, event) {
      let scrollAction = SETTINGS.get_string('scroll-panel-action')
      let direction = Utils.getMouseScrollDirection(event)

      const targetActor = global.stage.get_event_actor(event)

      if (
        !this._checkIfIgnoredScrollSource(targetActor) &&
        !this._timeoutsHandler.getId(T6)
      ) {
        if (direction && scrollAction === 'SWITCH_WORKSPACE') {
          let args = [global.display, 0]

          //adjust for horizontal workspaces
          if (Utils.DisplayWrapper.getWorkspaceManager().layout_rows === 1) {
            direction = direction == 'up' ? 'left' : 'right'
          }

          //gnome-shell >= 48 needs a third "event" param
          if (Config.PACKAGE_VERSION >= '48') args.push(event)

          let showWsPopup = SETTINGS.get_boolean('scroll-panel-show-ws-popup')
          showWsPopup
            ? 0
            : (Main.wm._workspaceSwitcherPopup = { display: () => {} })

          Main.wm._showWorkspaceSwitcher.call(Main.wm, ...args, {
            get_name: () => 'switch---' + direction,
          })
          showWsPopup ? 0 : (Main.wm._workspaceSwitcherPopup = null)
        } else if (direction && scrollAction === 'CYCLE_WINDOWS') {
          let windows = this.taskbar
            .getAppInfos()
            .reduce((ws, appInfo) => ws.concat(appInfo.windows), [])

          Utils.activateSiblingWindow(windows, direction)
        } else if (
          scrollAction === 'CHANGE_VOLUME' &&
          !event.is_pointer_emulated()
        ) {
          let proto = Volume.OutputIndicator.prototype
          let func =
            proto._handleScrollEvent ||
            proto.vfunc_scroll_event ||
            proto._onScrollEvent
          let indicator =
            Main.panel.statusArea[Utils.getSystemMenuInfo().name]._volumeOutput

          if (indicator.quickSettingsItems)
            // new quick settings menu in gnome-shell > 42
            func(indicator.quickSettingsItems[0], event)
          else func.call(indicator, 0, event)
        } else {
          return
        }

        const scrollDelay = SETTINGS.get_int('scroll-panel-delay')

        if (scrollDelay) {
          this._timeoutsHandler.add([T6, scrollDelay, () => {}])
        }
      }
    }

    _checkIfIgnoredScrollSource(source) {
      let ignoredConstr = ['WorkspaceIndicator']

      return (
        source.get_parent()._dtpIgnoreScroll ||
        ignoredConstr.indexOf(source.constructor.name) >= 0
      )
    }
  },
)

export const SecondaryPanel = GObject.registerClass(
  {},
  class SecondaryPanel extends St.Widget {
    _init(params) {
      super._init(params)
    }

    vfunc_allocate(box) {
      this.set_allocation(box)
    }
  },
)

// Button holding the clone of a main panel indicator. Like the panel buttons of the
// shell, it pads its content through its layout. The content keeps its size and is
// centered, so it can't be squeezed (and distorted) by a panel that is too small.
export const MainPanelCloneButton = GObject.registerClass(
  {},
  class MainPanelCloneButton extends St.Widget {
    _init(params) {
      super._init(params)

      // the clone shows the indicator as already styled on the main panel
      this._dtpIgnoreStyleOverrides = true
      this._hpadding = 0
    }

    setHPadding(hpadding) {
      if (hpadding == this._hpadding) return

      this._hpadding = hpadding
      this.queue_relayout()
    }

    vfunc_get_preferred_width() {
      let [min, nat] = this.get_first_child()?.get_preferred_width(-1) ?? [0, 0]

      return [min + 2 * this._hpadding, nat + 2 * this._hpadding]
    }

    vfunc_get_preferred_height() {
      return this.get_first_child()?.get_preferred_height(-1) ?? [0, 0]
    }

    vfunc_allocate(box) {
      this.set_allocation(box)

      let child = this.get_first_child()

      if (!child) return

      let [, , width, height] = child.get_preferred_size()
      let x = Math.round((box.get_width() - width) / 2)
      let y = Math.round((box.get_height() - height) / 2)

      child.allocate(
        new Clutter.ActorBox({ x1: x, y1: y, x2: x + width, y2: y + height }),
      )
    }
  },
)

// gives a menu that was anchored to the clone of its indicator back to the indicator
function releaseCloneMenu(menu) {
  let anchor = menu._dtpCloneAnchor

  if (!anchor) return

  delete menu._dtpCloneAnchor
  menu.disconnect(anchor.stateId)
  menu.sourceActor = anchor.sourceActor
  menu.focusActor = anchor.focusActor
  menu._boxPointer._userArrowSide = anchor.arrowSide
  anchor.clone.actor.remove_style_pseudo_class('active')
}
