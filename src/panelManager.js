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

import * as Overview from './overview.js'
import * as Panel from './panel.js'
import * as PanelSettings from './panelSettings.js'
import * as Proximity from './proximity.js'
import * as Utils from './utils.js'
import * as DesktopIconsIntegration from './desktopIconsIntegration.js'
import { DTP_EXTENSION, SETTINGS, tracker } from './extension.js'

import GLib from 'gi://GLib'
import GObject from 'gi://GObject'
import Clutter from 'gi://Clutter'
import Meta from 'gi://Meta'
import Shell from 'gi://Shell'
import St from 'gi://St'

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js'
import * as LookingGlass from 'resource:///org/gnome/shell/ui/lookingGlass.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { NotificationsMonitor } from './notificationsMonitor.js'
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js'
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js'
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js'
import {
  SecondaryMonitorDisplay,
  WorkspacesView,
} from 'resource:///org/gnome/shell/ui/workspacesView.js'

export const PanelManager = class {
  constructor() {
    this.overview = new Overview.Overview(this)
    this._injectionManager = new InjectionManager()
  }

  enable(reset) {
    let dtpPrimaryIndex = PanelSettings.getPrimaryIndex(
      SETTINGS.get_string('primary-monitor'),
    )

    this.allPanels = []
    this.dtpPrimaryMonitor =
      Main.layoutManager.monitors[dtpPrimaryIndex] ||
      Main.layoutManager.primaryMonitor
    this.proximityManager = new Proximity.ProximityManager()

    if (this.dtpPrimaryMonitor) {
      this.primaryPanel = this._createPanel(
        this.dtpPrimaryMonitor,
        SETTINGS.get_boolean('stockgs-keep-top-panel'),
      )
      this.allPanels.push(this.primaryPanel)
      this.overview.enable(this.primaryPanel)

      this.setFocusedMonitor(this.dtpPrimaryMonitor)
    }

    if (SETTINGS.get_boolean('multi-monitors')) {
      Main.layoutManager.monitors
        .filter((m) => m != this.dtpPrimaryMonitor)
        .forEach((m) => {
          this.allPanels.push(this._createPanel(m, true))
        })
    }

    global.dashToPanel.panels = this.allPanels
    global.dashToPanel.emit('panels-created')

    this._setDesktopIconsMargins()

    this._updatePanelElementPositions()

    if (reset) return

    this.notificationsMonitor = new NotificationsMonitor()

    this._desktopIconsUsableArea =
      new DesktopIconsIntegration.DesktopIconsUsableAreaClass()

    this._oldUpdatePanelBarrier = Main.layoutManager._updatePanelBarrier
    Main.layoutManager._updatePanelBarrier = (panel) => {
      let panelUpdates = panel ? [panel] : this.allPanels

      panelUpdates.forEach((p) =>
        newUpdatePanelBarrier.call(Main.layoutManager, p),
      )
    }
    Main.layoutManager._updatePanelBarrier()

    this._oldUpdateHotCorners = Main.layoutManager._updateHotCorners
    Main.layoutManager._updateHotCorners = newUpdateHotCorners.bind(
      Main.layoutManager,
    )
    Main.layoutManager._updateHotCorners()

    Main.layoutManager.findIndexForActor = (actor) =>
      '_dtpIndex' in actor
        ? actor._dtpIndex
        : Layout.LayoutManager.prototype.findIndexForActor.call(
            Main.layoutManager,
            actor,
          )

    this._forceHotCornerId = SETTINGS.connect(
      'changed::stockgs-force-hotcorner',
      () => Main.layoutManager._updateHotCorners(),
    )

    if (Main.layoutManager._interfaceSettings) {
      this._enableHotCornersId = Main.layoutManager._interfaceSettings.connect(
        'changed::enable-hot-corners',
        () => Main.layoutManager._updateHotCorners(),
      )
    }

    this._oldUpdateWorkspacesViews =
      Main.overview._overview._controls._workspacesDisplay._updateWorkspacesViews
    Main.overview._overview._controls._workspacesDisplay._updateWorkspacesViews =
      this._newUpdateWorkspacesViews.bind(
        Main.overview._overview._controls._workspacesDisplay,
      )

    this._oldSetPrimaryWorkspaceVisible =
      Main.overview._overview._controls._workspacesDisplay.setPrimaryWorkspaceVisible
    Main.overview._overview._controls._workspacesDisplay.setPrimaryWorkspaceVisible =
      this._newSetPrimaryWorkspaceVisible.bind(
        Main.overview._overview._controls._workspacesDisplay,
      )

    let panelManager = this
    this._injectionManager.overrideMethod(
      BoxPointer.BoxPointer.prototype,
      'vfunc_get_preferred_height',
      () =>
        function (forWidth) {
          let alloc = { min_size: 0, natural_size: 0 }

          ;[alloc.min_size, alloc.natural_size] =
            this.vfunc_get_preferred_height(forWidth)

          return panelManager._getBoxPointerPreferredHeight(this, alloc)
        },
    )

    this._injectionManager.overrideMethod(
      Object.getPrototypeOf(
        // WorkspaceDot in activities button
        Main.panel.statusArea.activities.get_first_child().get_first_child(),
      ),
      'vfunc_get_preferred_width',
      (get_preferred_width) =>
        function (forHeight) {
          return Utils.getBoxLayoutVertical(this.get_parent())
            ? [0, forHeight]
            : get_preferred_width.call(this, forHeight)
        },
    )

    LookingGlass.LookingGlass.prototype._oldResize =
      LookingGlass.LookingGlass.prototype._resize
    LookingGlass.LookingGlass.prototype._resize = _newLookingGlassResize

    LookingGlass.LookingGlass.prototype._oldOpen =
      LookingGlass.LookingGlass.prototype.open
    LookingGlass.LookingGlass.prototype.open = _newLookingGlassOpen

    Main.messageTray._bannerBin.ease = (params) => {
      if (params.y === 0) {
        let panelOnPrimary = this.allPanels.find(
          (p) => p.monitor == Main.layoutManager.primaryMonitor,
        )

        if (
          panelOnPrimary &&
          panelOnPrimary.intellihide?.enabled &&
          panelOnPrimary.geom.position == St.Side.TOP &&
          panelOnPrimary.panelBox.visible
        )
          params.y += panelOnPrimary.geom.outerSize
      }

      Object.getPrototypeOf(Main.messageTray._bannerBin).ease.call(
        Main.messageTray._bannerBin,
        params,
      )
    }

    this._signalsHandler = new Utils.GlobalSignalsHandler()

    //listen settings
    this._signalsHandler.add(
      [
        SETTINGS,
        'changed::global-border-radius',
        () => DTP_EXTENSION.resetGlobalStyles(),
      ],
      [
        SETTINGS,
        [
          'changed::primary-monitor',
          'changed::multi-monitors',
          'changed::isolate-monitors',
          'changed::panel-positions',
          'changed::panel-lengths',
          'changed::panel-anchors',
          'changed::stockgs-keep-top-panel',
        ],
        (settings, settingChanged) => {
          PanelSettings.clearCache(settingChanged)
          this._reset()
        },
      ],
      [
        SETTINGS,
        'changed::panel-element-positions',
        () => {
          PanelSettings.clearCache('panel-element-positions')
          this._updatePanelElementPositions()
        },
      ],
      [
        SETTINGS,
        'changed::intellihide-key-toggle-text',
        () => this._setKeyBindings(true),
      ],
      [
        SETTINGS,
        'changed::panel-sizes',
        () => {
          GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._setDesktopIconsMargins()
            return GLib.SOURCE_REMOVE
          })
        },
      ],
      [
        Utils.DisplayWrapper.getMonitorManager(),
        'monitors-changed',
        async () => {
          if (Main.layoutManager.primaryMonitor) {
            await PanelSettings.setMonitorsInfo(SETTINGS)
            this._reset()
          }
        },
      ],
    )

    Panel.panelBoxes.forEach((c) =>
      this._signalsHandler.add([
        Main.panel[c],
        'child-added',
        (parent, child) => {
          this.primaryPanel &&
            child instanceof St.Bin &&
            this._adjustPanelMenuButton(
              this._getPanelMenuButton(child.get_first_child()),
              this.primaryPanel.monitor,
              this.primaryPanel.getPosition(),
            )
        },
      ]),
    )

    this._setKeyBindings(true)

    // keep GS overview.js from blowing away custom panel styles
    if (!SETTINGS.get_boolean('stockgs-keep-top-panel'))
      Object.defineProperty(Main.panel, 'style', {
        configurable: true,
        set() {},
      })
  }

  disable(reset) {
    this.primaryPanel && this.overview.disable()
    this.proximityManager.destroy()

    this.allPanels.forEach((p) => {
      p.taskbar.iconAnimator.pause()

      this._findPanelMenuButtons(p.panelBox).forEach((pmb) => {
        if (pmb.menu._boxPointer._dtpGetPreferredHeightId) {
          pmb.menu._boxPointer._container.disconnect(
            pmb.menu._boxPointer._dtpGetPreferredHeightId,
          )
        }

        pmb.menu._boxPointer.sourceActor = pmb.menu._boxPointer._dtpSourceActor
        delete pmb.menu._boxPointer._dtpSourceActor
        pmb.menu._boxPointer._userArrowSide = St.Side.TOP
      })

      this._removePanelBarriers(p)

      p.disable()

      let clipContainer = p.panelBox.get_parent()

      Main.layoutManager._untrackActor(p.panelBox)
      Main.layoutManager.removeChrome(clipContainer)

      if (p.isStandalone) {
        p.panelBox.destroy()
      } else {
        p.panelBox.remove_child(p)
        p.remove_child(p.panel)
        p.panelBox.add_child(p.panel)

        p.panelBox.set_position(clipContainer.x, clipContainer.y)

        clipContainer.remove_child(p.panelBox)
        Main.layoutManager.addChrome(p.panelBox, {
          affectsStruts: true,
          trackFullscreen: true,
        })
      }
    })

    if (Main.layoutManager.primaryMonitor) {
      Main.layoutManager.panelBox.set_position(
        Main.layoutManager.primaryMonitor.x,
        Main.layoutManager.primaryMonitor.y,
      )
      Main.layoutManager.panelBox.set_size(
        Main.layoutManager.primaryMonitor.width,
        -1,
      )
    }

    if (reset) return

    this._injectionManager.clear()

    this._setKeyBindings(false)

    this.notificationsMonitor.destroy()

    this._signalsHandler.destroy()

    Main.layoutManager._updateHotCorners = this._oldUpdateHotCorners
    Main.layoutManager._updateHotCorners()

    delete Main.layoutManager.findIndexForActor

    SETTINGS.disconnect(this._forceHotCornerId)

    if (this._enableHotCornersId) {
      Main.layoutManager._interfaceSettings.disconnect(this._enableHotCornersId)
    }

    Main.layoutManager._updatePanelBarrier = this._oldUpdatePanelBarrier
    Main.layoutManager._updatePanelBarrier()

    Main.overview._overview._controls._workspacesDisplay._updateWorkspacesViews =
      this._oldUpdateWorkspacesViews
    Main.overview._overview._controls._workspacesDisplay.setPrimaryWorkspaceVisible =
      this._oldSetPrimaryWorkspaceVisible

    LookingGlass.LookingGlass.prototype._resize =
      LookingGlass.LookingGlass.prototype._oldResize
    delete LookingGlass.LookingGlass.prototype._oldResize

    LookingGlass.LookingGlass.prototype.open =
      LookingGlass.LookingGlass.prototype._oldOpen
    delete LookingGlass.LookingGlass.prototype._oldOpen

    delete Main.messageTray._bannerBin.ease

    delete Main.panel.style
    this._desktopIconsUsableArea.destroy()
    this._desktopIconsUsableArea = null
  }

  _setDesktopIconsMargins() {
    this._desktopIconsUsableArea?.resetMargins()
    this.allPanels.forEach((p) => {
      switch (p.geom.position) {
        case St.Side.TOP:
          this._desktopIconsUsableArea?.setMargins(
            p.monitor.index,
            p.geom.outerSize,
            0,
            0,
            0,
          )
          break
        case St.Side.BOTTOM:
          this._desktopIconsUsableArea?.setMargins(
            p.monitor.index,
            0,
            p.geom.outerSize,
            0,
            0,
          )
          break
        case St.Side.LEFT:
          this._desktopIconsUsableArea?.setMargins(
            p.monitor.index,
            0,
            0,
            p.geom.outerSize,
            0,
          )
          break
        case St.Side.RIGHT:
          this._desktopIconsUsableArea?.setMargins(
            p.monitor.index,
            0,
            0,
            0,
            p.geom.outerSize,
          )
          break
      }
    })
  }

  setFocusedMonitor(monitor) {
    this.focusedMonitorPanel = this.allPanels.find((p) => p.monitor == monitor)

    if (!this.checkIfFocusedMonitor(monitor)) {
      Main.overview._overview.clear_constraints()
      Main.overview._overview.add_constraint(
        new Layout.MonitorConstraint({ index: monitor.index }),
      )

      Main.overview._overview._controls._workspacesDisplay._primaryIndex =
        monitor.index

      // https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/2395
      // The overview allocation used to calculate its workarea based on the monitor where the overview
      // was displayed, but it got changed back to always use the primary monitor. So now, temporarily assign
      // the primary monitor to dtp focused monitor while recalculating the overview workarea
      Main.layoutManager.primaryMonitor = monitor
      Main.overview._overview._controls.layout_manager._updateWorkAreaBox()
      Main.layoutManager.primaryMonitor =
        Main.layoutManager.monitors[Main.layoutManager.primaryIndex]
    }
  }

  showFocusedAppInOverview(app, keepOverviewOpen) {
    if (app == this.focusedApp) {
      if (!keepOverviewOpen && Main.overview._shown) Main.overview.hide()

      return
    }

    let isolateWorkspaces = SETTINGS.get_boolean('isolate-workspaces')
    let isolateMonitors = SETTINGS.get_boolean('isolate-monitors')

    this.focusedApp = app

    if (!this._signalsHandler.hasLabel('overview-spread')) {
      let hasWorkspaces = Main.sessionMode.hasWorkspaces
      let maybeDisableWorkspacesClick = () => {
        if (!isolateWorkspaces)
          Utils.getOverviewWorkspaces().forEach(
            (w) => (w._container.get_actions()[0].enabled = false),
          )
      }
      let isIncludedWindow = (metaWindow) =>
        !this.focusedApp ||
        tracker.get_window_app(metaWindow) == this.focusedApp

      Main.sessionMode.hasWorkspaces = isolateWorkspaces
      maybeDisableWorkspacesClick()

      Workspace.prototype._oldIsMyWindow = Workspace.prototype._isMyWindow
      Workspace.prototype._isMyWindow = function (metaWindow) {
        if (!metaWindow) return false

        return (
          isIncludedWindow(metaWindow) &&
          (this.metaWorkspace === null ||
            (!isolateWorkspaces && this.metaWorkspace.active) ||
            (isolateWorkspaces &&
              metaWindow.located_on_workspace(this.metaWorkspace))) &&
          (!isolateMonitors || metaWindow.get_monitor() === this.monitorIndex)
        )
      }

      this.focusedWorkspace = !isolateWorkspaces
        ? Utils.getCurrentWorkspace()
        : null

      this._signalsHandler.addWithLabel(
        'overview-spread',
        [Main.overview, 'showing', maybeDisableWorkspacesClick],
        [
          Main.overview,
          'hidden',
          () => {
            Utils.getCurrentWorkspace()
              .list_windows()
              .forEach((w) => {
                if (
                  !w.minimized &&
                  !w.customJS_ding &&
                  global.display.focus_window != w &&
                  tracker.get_window_app(w) != this.focusedApp
                ) {
                  let window = w.get_compositor_private()

                  ;(window.get_first_child() || window).opacity = 0

                  Utils.animateWindowOpacity(window, {
                    opacity: 255,
                    time: 0.25,
                    transition: 'easeOutQuad',
                  })
                }
              })

            this.focusedApp = null
            this.focusedWorkspace = null
            this._signalsHandler.removeWithLabel('overview-spread')

            Main.sessionMode.hasWorkspaces = hasWorkspaces

            Workspace.prototype._isMyWindow = Workspace.prototype._oldIsMyWindow
            delete Workspace.prototype._oldIsMyWindow
          },
        ],
      )
    }

    if (Main.overview._shown) {
      Utils.getOverviewWorkspaces().forEach((w) => {
        let metaWindows = []
        let metaWorkspace =
          w.metaWorkspace ||
          Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace()

        w._container.layout_manager._windows.forEach((info, preview) =>
          preview.destroy(),
        )

        if (this.focusedWorkspace && this.focusedWorkspace == metaWorkspace)
          metaWindows = Utils.getAllMetaWindows()
        else if (!this.focusedWorkspace)
          metaWindows = metaWorkspace.list_windows()

        metaWindows.forEach((mw) => w._doAddWindow(mw))
      })
    } else Main.overview.show()
  }

  _newSetPrimaryWorkspaceVisible(visible) {
    if (this._primaryVisible === visible) return

    this._primaryVisible = visible

    const primaryIndex =
      Main.overview._overview._controls._workspacesDisplay._primaryIndex
    const primaryWorkspace = this._workspacesViews[primaryIndex]
    if (primaryWorkspace) primaryWorkspace.visible = visible
  }

  _newUpdateWorkspacesViews() {
    for (let i = 0; i < this._workspacesViews.length; i++)
      this._workspacesViews[i].destroy()

    this._workspacesViews = []
    let monitors = Main.layoutManager.monitors
    for (let i = 0; i < monitors.length; i++) {
      let view
      if (i === this._primaryIndex) {
        view = new WorkspacesView(
          i,
          this._controls,
          this._scrollAdjustment,
          this._fitModeAdjustment,
          this._overviewAdjustment,
        )

        view.visible = this._primaryVisible
        this.bind_property(
          'opacity',
          view,
          'opacity',
          GObject.BindingFlags.SYNC_CREATE,
        )
        this.add_child(view)
      } else {
        // No idea why atm, but we need the import at the top of this file and to use the
        // full imports ns here, otherwise SecondaryMonitorDisplay can't be used ¯\_(ツ)_/¯
        view = new SecondaryMonitorDisplay(
          i,
          this._controls,
          this._scrollAdjustment,
          this._fitModeAdjustment,
          this._overviewAdjustment,
        )
        Main.layoutManager.overviewGroup.add_child(view)
      }

      this._workspacesViews.push(view)
    }
  }

  checkIfFocusedMonitor(monitor) {
    return (
      Main.overview._overview._controls._workspacesDisplay._primaryIndex ==
      monitor.index
    )
  }

  _createPanel(monitor, isStandalone) {
    let panelBox
    let panel
    let clipContainer = new Clutter.Actor()

    if (isStandalone) {
      panelBox = new Utils.createBoxLayout({ name: 'panelBox' })
    } else {
      panelBox = Main.layoutManager.panelBox
      Main.layoutManager._untrackActor(panelBox)
      panelBox.remove_child(Main.panel)
      Main.layoutManager.removeChrome(panelBox)
    }

    Main.layoutManager.addChrome(clipContainer, { affectsInputRegion: false })
    clipContainer.add_child(panelBox)
    Main.layoutManager.trackChrome(panelBox, {
      trackFullscreen: true,
      affectsStruts: true,
      affectsInputRegion: true,
    })

    panel = new Panel.Panel(this, monitor, panelBox, isStandalone)
    panelBox.add_child(panel)
    panel.enable()

    panelBox._dtpIndex = monitor.index
    panelBox.set_position(0, 0)

    if (panel.checkIfVertical) panelBox.set_width(-1)

    this._findPanelMenuButtons(panelBox).forEach((pmb) =>
      this._adjustPanelMenuButton(pmb, monitor, panel.getPosition()),
    )

    panel.taskbar.iconAnimator.start()

    return panel
  }

  _reset() {
    this.disable(true)
    this.allPanels = []
    this.enable(true)
  }

  _updatePanelElementPositions() {
    this.allPanels.forEach((p) => p.updateElementPositions())
  }

  _adjustPanelMenuButton(button, monitor, arrowSide) {
    if (button) {
      button.menu._boxPointer._dtpSourceActor =
        button.menu._boxPointer.sourceActor
      button.menu._boxPointer.sourceActor = button
      button.menu._boxPointer._userArrowSide = arrowSide
      button.menu._boxPointer._dtpInPanel = 1

      if (!button.menu._boxPointer.vfunc_get_preferred_height) {
        button.menu._boxPointer._dtpGetPreferredHeightId =
          button.menu._boxPointer._container.connect(
            'get-preferred-height',
            (actor, forWidth, alloc) => {
              this._getBoxPointerPreferredHeight(
                button.menu._boxPointer,
                alloc,
                monitor,
              )
            },
          )
      }
    }
  }

  _getBoxPointerPreferredHeight(boxPointer, alloc, monitor) {
    if (
      boxPointer._dtpInPanel &&
      boxPointer.sourceActor &&
      SETTINGS.get_boolean('intellihide')
    ) {
      monitor =
        monitor ||
        Main.layoutManager.findMonitorForActor(boxPointer.sourceActor)
      let panel = Utils.find(
        global.dashToPanel.panels,
        (p) => p.monitor == monitor,
      )
      let excess = alloc.natural_size + panel.outerSize + 10 - monitor.height // 10 is arbitrary

      if (excess > 0) {
        alloc.natural_size -= excess
      }
    }

    return [alloc.min_size, alloc.natural_size]
  }

  _findPanelMenuButtons(container) {
    let panelMenuButtons = []
    let panelMenuButton

    let find = (parent) =>
      parent.get_children().forEach((c) => {
        if ((panelMenuButton = this._getPanelMenuButton(c))) {
          panelMenuButtons.push(panelMenuButton)
        }

        find(c)
      })

    find(container)

    return panelMenuButtons
  }

  _removePanelBarriers(panel) {
    if (panel.isStandalone && panel._rightPanelBarrier) {
      panel._rightPanelBarrier.destroy()
    }

    if (panel._leftPanelBarrier) {
      panel._leftPanelBarrier.destroy()
      delete panel._leftPanelBarrier
    }
  }

  _getPanelMenuButton(obj) {
    return obj instanceof PanelMenu.Button && obj.menu?._boxPointer ? obj : 0
  }

  _setKeyBindings(enable) {
    let keys = {
      'intellihide-key-toggle': () =>
        this.allPanels.forEach((p) => p.intellihide.toggle()),
    }

    Object.keys(keys).forEach((k) => {
      Utils.removeKeybinding(k)

      if (enable) {
        Utils.addKeybinding(k, SETTINGS, keys[k], Shell.ActionMode.NORMAL)
      }
    })
  }
}

// This class drives long-running icon animations, to keep them running in sync
// with each other.
export const IconAnimator = class {
  constructor(actor) {
    this._count = 0
    this._started = false
    this._animations = {
      dance: [],
    }
    this._timeline = new Clutter.Timeline({
      duration: 3000,
      repeat_count: -1,
    })

    /* Just use the construction property when no need to support 3.36 */
    if (this._timeline.set_actor) this._timeline.set_actor(actor)

    this._timeline.connect('new-frame', () => {
      const progress = this._timeline.get_progress()
      const danceRotation =
        progress < 1 / 6 ? 15 * Math.sin(progress * 24 * Math.PI) : 0
      const dancers = this._animations.dance
      for (let i = 0, iMax = dancers.length; i < iMax; i++) {
        dancers[i].target.rotation_angle_z = danceRotation
      }
    })
  }

  destroy() {
    this._timeline.stop()
    this._timeline = null
    for (let name in this._animations) {
      const pairs = this._animations[name]
      for (let i = 0, iMax = pairs.length; i < iMax; i++) {
        const pair = pairs[i]
        pair.target.disconnect(pair.targetDestroyId)
      }
    }
    this._animations = null
  }

  pause() {
    if (this._started && this._count > 0) {
      this._timeline.stop()
    }
    this._started = false
  }

  start() {
    if (!this._started && this._count > 0) {
      this._timeline.start()
    }
    this._started = true
  }

  addAnimation(target, name) {
    // before adding a new animation, remove previous one to only have one running
    let animationNames = Object.keys(this._animations)

    for (let i = 0; i < animationNames.length; ++i) {
      let n = animationNames[i]
      let currentAnimationPair = this._animations[n].find(
        (p) => p.target == target,
      )

      if (currentAnimationPair) {
        if (n == name) return // already have this animation running, nothing else to do

        this.removeAnimation(currentAnimationPair.target, n)
      }
    }

    const targetDestroyId = target.connect('destroy', () =>
      this.removeAnimation(target, name),
    )
    this._animations[name].push({
      target: target,
      targetDestroyId: targetDestroyId,
    })
    if (this._started && this._count === 0) {
      this._timeline.start()
    }
    this._count++
  }

  removeAnimation(target, name) {
    const pairs = this._animations[name]
    for (let i = 0, iMax = pairs.length; i < iMax; i++) {
      const pair = pairs[i]
      if (pair.target === target) {
        target.disconnect(pair.targetDestroyId)
        pairs.splice(i, 1)
        this._count--
        if (this._started && this._count === 0) {
          this._timeline.stop()
        }

        if (name == 'dance') target.rotation_angle_z = 0

        return
      }
    }
  }
}

function newUpdateHotCorners() {
  // destroy old hot corners
  this.hotCorners.forEach(function (corner) {
    if (corner) corner.destroy()
  })
  this.hotCorners = []

  //global.settings is ubuntu specific setting to disable the hot corner (Tweak tool > Top Bar > Activities Overview Hot Corner)
  //this._interfaceSettings is for the setting to disable the hot corner introduced in gnome-shell 3.34
  if (
    (global.settings.list_keys().indexOf('enable-hot-corners') >= 0 &&
      !global.settings.get_boolean('enable-hot-corners')) ||
    (this._interfaceSettings &&
      !this._interfaceSettings.get_boolean('enable-hot-corners'))
  ) {
    this.emit('hot-corners-changed')
    return
  }

  // build new hot corners
  for (let i = 0; i < this.monitors.length; i++) {
    let panel = Utils.find(
      global.dashToPanel.panels,
      (p) => p.monitor.index == i,
    )
    let panelPosition = panel ? panel.getPosition() : St.Side.BOTTOM
    let panelTopLeft =
      panelPosition == St.Side.TOP || panelPosition == St.Side.LEFT
    let monitor = this.monitors[i]
    let cornerX = this._rtl ? monitor.x + monitor.width : monitor.x
    let cornerY = monitor.y

    let haveTopLeftCorner = true

    // If the panel is on the bottom, unless this is explicitly forced, don't add a topleft
    // hot corner unless it is actually a top left panel. Otherwise, it stops the mouse
    // as you are dragging across. In the future, maybe we will automatically move the
    // hotcorner to the bottom when the panel is positioned at the bottom
    if (
      i != this.primaryIndex ||
      (!panelTopLeft && !SETTINGS.get_boolean('stockgs-force-hotcorner'))
    ) {
      // Check if we have a top left (right for RTL) corner.
      // I.e. if there is no monitor directly above or to the left(right)
      let besideX = this._rtl ? monitor.x + 1 : cornerX - 1
      let besideY = cornerY
      let aboveX = cornerX
      let aboveY = cornerY - 1

      for (let j = 0; j < this.monitors.length; j++) {
        if (i == j) continue
        let otherMonitor = this.monitors[j]
        if (
          besideX >= otherMonitor.x &&
          besideX < otherMonitor.x + otherMonitor.width &&
          besideY >= otherMonitor.y &&
          besideY < otherMonitor.y + otherMonitor.height
        ) {
          haveTopLeftCorner = false
          break
        }
        if (
          aboveX >= otherMonitor.x &&
          aboveX < otherMonitor.x + otherMonitor.width &&
          aboveY >= otherMonitor.y &&
          aboveY < otherMonitor.y + otherMonitor.height
        ) {
          haveTopLeftCorner = false
          break
        }
      }
    }

    if (haveTopLeftCorner) {
      let corner = new Layout.HotCorner(this, monitor, cornerX, cornerY)

      corner.setBarrierSize = (size) =>
        Object.getPrototypeOf(corner).setBarrierSize.call(
          corner,
          Math.min(size, 32),
        )
      corner.setBarrierSize(panel ? panel.geom.innerSize : 32)
      this.hotCorners.push(corner)
    } else {
      this.hotCorners.push(null)
    }
  }

  this.emit('hot-corners-changed')
}

function newUpdatePanelBarrier(panel) {
  let barriers = {
    _rightPanelBarrier: [panel.isStandalone ? panel : this],
    _leftPanelBarrier: [panel],
  }

  Object.keys(barriers).forEach((k) => {
    let obj = barriers[k][0]

    if (obj[k]) {
      obj[k].destroy()
      obj[k] = null
    }
  })

  if (!this.primaryMonitor || !panel.panelBox.height) {
    return
  }

  let barrierSize = Math.min(10, panel.panelBox.height)
  let fixed1 = panel.monitor.y
  let fixed2 = panel.monitor.y + barrierSize

  if (panel.checkIfVertical()) {
    barriers._rightPanelBarrier.push(
      panel.monitor.y + panel.monitor.height,
      Meta.BarrierDirection.NEGATIVE_Y,
    )
    barriers._leftPanelBarrier.push(
      panel.monitor.y,
      Meta.BarrierDirection.POSITIVE_Y,
    )
  } else {
    barriers._rightPanelBarrier.push(
      panel.monitor.x + panel.monitor.width,
      Meta.BarrierDirection.NEGATIVE_X,
    )
    barriers._leftPanelBarrier.push(
      panel.monitor.x,
      Meta.BarrierDirection.POSITIVE_X,
    )
  }

  switch (panel.getPosition()) {
    //values are initialized as St.Side.TOP
    case St.Side.BOTTOM:
      fixed1 = panel.monitor.y + panel.monitor.height - barrierSize
      fixed2 = panel.monitor.y + panel.monitor.height
      break
    case St.Side.LEFT:
      fixed1 = panel.monitor.x + barrierSize
      fixed2 = panel.monitor.x
      break
    case St.Side.RIGHT:
      fixed1 = panel.monitor.x + panel.monitor.width - barrierSize
      fixed2 = panel.monitor.x + panel.monitor.width
      break
  }

  //remove left barrier if it overlaps one of the hotcorners
  for (let k in this.hotCorners) {
    let hc = this.hotCorners[k]

    if (
      hc &&
      hc._monitor == panel.monitor &&
      (fixed1 == hc._x || fixed2 == hc._x || fixed1 == hc._y || fixed2 == hc._y)
    ) {
      delete barriers._leftPanelBarrier
      break
    }
  }

  Object.keys(barriers).forEach((k) => {
    let barrierOptions = {
      backend: global.backend,
      directions: barriers[k][2],
    }

    barrierOptions[panel.varCoord.c1] = barrierOptions[panel.varCoord.c2] =
      barriers[k][1]
    barrierOptions[panel.fixedCoord.c1] = fixed1
    barrierOptions[panel.fixedCoord.c2] = fixed2

    barriers[k][0][k] = new Meta.Barrier(barrierOptions)
  })
}

function _newLookingGlassResize() {
  let primaryMonitorPanel = Utils.find(
    global.dashToPanel.panels,
    (p) => p.monitor == Main.layoutManager.primaryMonitor,
  )
  let topOffset =
    primaryMonitorPanel.getPosition() == St.Side.TOP
      ? primaryMonitorPanel.geom.outerSize +
        (SETTINGS.get_boolean('stockgs-keep-top-panel')
          ? Main.layoutManager.panelBox.height
          : 0) +
        8
      : 32

  this._oldResize()

  this._hiddenY = Main.layoutManager.primaryMonitor.y + topOffset - this.height
  this._targetY = this._hiddenY + this.height
  this.y = this._hiddenY

  this._objInspector.set_position(
    this.x + Math.floor(this.width * 0.1),
    this._targetY + Math.floor(this.height * 0.1),
  )
}

function _newLookingGlassOpen() {
  if (this._open) return

  this._resize()
  this._oldOpen()
}
