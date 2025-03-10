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
 *
 * Some code was also adapted from the upstream Gnome Shell source code.
 */

import * as Intellihide from './intellihide.js'
import * as Utils from './utils.js'

import Clutter from 'gi://Clutter'
import Gio from 'gi://Gio'
import Shell from 'gi://Shell'
import St from 'gi://St'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as WindowManager from 'resource:///org/gnome/shell/ui/windowManager.js'
import { WindowPreview } from 'resource:///org/gnome/shell/ui/windowPreview.js'
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js'
import { SETTINGS } from './extension.js'

const GS_SWITCH_HOTKEYS_KEY = 'switch-to-application-'
const GS_OPEN_HOTKEYS_KEY = 'open-new-window-application-'

// When the dash is shown, workspace window preview bottom labels go over it (default
// gnome-shell behavior), but when the extension hides the dash, leave some space
// so those labels don't go over a bottom panel
const LABEL_MARGIN = 60

//timeout names
const T1 = 'swipeEndTimeout'
const T2 = 'numberOverlayTimeout'

export const Overview = class {
  constructor(panelManager) {
    this._injectionManager = new InjectionManager()
    this._numHotkeys = 10
    this._panelManager = panelManager
  }

  enable(primaryPanel) {
    this._panel = primaryPanel
    this.taskbar = primaryPanel.taskbar

    this._injectionsHandler = new Utils.InjectionsHandler()
    this._signalsHandler = new Utils.GlobalSignalsHandler()
    this._timeoutsHandler = new Utils.TimeoutsHandler()

    this._optionalWorkspaceIsolation()
    this._optionalHotKeys()
    this._optionalNumberOverlay()
    this._optionalClickToExit()

    this.toggleDash()
    this._adaptAlloc()

    this._signalsHandler.add([
      SETTINGS,
      ['changed::stockgs-keep-dash', 'changed::panel-sizes'],
      () => this.toggleDash(),
    ])
  }

  disable() {
    this._signalsHandler.destroy()
    this._injectionsHandler.destroy()
    this._timeoutsHandler.destroy()
    this._injectionManager.clear()

    this.toggleDash(true)

    // Remove key bindings
    this._disableHotKeys()
    this._disableExtraShortcut()
    this._disableClickToExit()
  }

  toggleDash(visible) {
    if (visible === undefined) {
      visible = SETTINGS.get_boolean('stockgs-keep-dash')
    }

    let visibilityFunc = visible ? 'show' : 'hide'
    let height = visible ? -1 : LABEL_MARGIN * Utils.getScaleFactor()
    let overviewControls = Main.overview._overview._controls

    overviewControls.dash[visibilityFunc]()
    overviewControls.dash.set_height(height)
  }

  _adaptAlloc() {
    let overviewControls = Main.overview._overview._controls

    this._injectionManager.overrideMethod(
      Object.getPrototypeOf(overviewControls),
      'vfunc_allocate',
      (originalAllocate) => (box) => {
        let focusedPanel = this._panel.panelManager.focusedMonitorPanel

        if (focusedPanel) {
          let position = focusedPanel.geom.position
          let isBottom = position == St.Side.BOTTOM

          if (focusedPanel.intellihide?.enabled) {
            // Panel intellihide is enabled (struts aren't taken into account on overview allocation),
            // dynamically modify the overview box to follow the reveal/hide animation
            let { transitioning, finalState, progress } =
              overviewControls._stateAdjustment.getStateTransitionParams()
            let size =
              focusedPanel.geom[focusedPanel.checkIfVertical() ? 'w' : 'h'] *
              (transitioning
                ? Math.abs((finalState != 0 ? 0 : 1) - progress)
                : 1)

            if (isBottom || position == St.Side.RIGHT)
              box[focusedPanel.fixedCoord.c2] -= size
            else box[focusedPanel.fixedCoord.c1] += size
          } else if (isBottom)
            // The default overview allocation takes into account external
            // struts, everywhere but the bottom where the dash is usually fixed anyway.
            // If there is a bottom panel under the dash location, give it some space here
            box.y2 -= focusedPanel.geom.outerSize
        }

        originalAllocate.call(overviewControls, box)
      },
    )
  }

  /**
   * Isolate overview to open new windows for inactive apps
   */
  _optionalWorkspaceIsolation() {
    let label = 'optionalWorkspaceIsolation'

    let enable = () => {
      this._injectionsHandler.removeWithLabel(label)

      this._injectionsHandler.addWithLabel(label, [
        Shell.App.prototype,
        'activate',
        IsolatedOverview,
      ])

      this._signalsHandler.removeWithLabel(label)

      this._signalsHandler.addWithLabel(label, [
        global.window_manager,
        'switch-workspace',
        () =>
          this._panel.panelManager.allPanels.forEach((p) =>
            p.taskbar.handleIsolatedWorkspaceSwitch(),
          ),
      ])
    }

    let disable = () => {
      this._signalsHandler.removeWithLabel(label)
      this._injectionsHandler.removeWithLabel(label)
    }

    function IsolatedOverview() {
      // These lines take care of Nautilus for icons on Desktop
      let activeWorkspace =
        Utils.DisplayWrapper.getWorkspaceManager().get_active_workspace()
      let windows = this.get_windows().filter(
        (w) => w.get_workspace().index() == activeWorkspace.index(),
      )

      if (
        windows.length > 0 &&
        (!(windows.length == 1 && windows[0].skip_taskbar) ||
          this.is_on_workspace(activeWorkspace))
      )
        return Main.activateWindow(windows[0])

      return this.open_new_window(-1)
    }

    this._signalsHandler.add([
      SETTINGS,
      'changed::isolate-workspaces',
      () => {
        this._panel.panelManager.allPanels.forEach((p) =>
          p.taskbar.resetAppIcons(),
        )

        if (SETTINGS.get_boolean('isolate-workspaces')) enable()
        else disable()
      },
    ])

    if (SETTINGS.get_boolean('isolate-workspaces')) enable()
  }

  // Hotkeys
  _activateApp(appIndex, modifiers) {
    let seenApps = {}
    let apps = []

    this.taskbar._getAppIcons().forEach((appIcon) => {
      if (!seenApps[appIcon.app] || this.taskbar.allowSplitApps) {
        apps.push(appIcon)
      }

      seenApps[appIcon.app] = (seenApps[appIcon.app] || 0) + 1
    })

    this._showOverlay()

    if (appIndex < apps.length) {
      let appIcon = apps[appIndex]
      let seenAppCount = seenApps[appIcon.app]
      let windowCount =
        appIcon.window || appIcon._hotkeysCycle
          ? seenAppCount
          : appIcon._nWindows

      if (
        SETTINGS.get_boolean('shortcut-previews') &&
        windowCount > 1 &&
        !(
          modifiers &
          ~(Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SUPER_MASK)
        )
      ) {
        //ignore the alt (MOD1_MASK) and super key (SUPER_MASK)
        if (
          this._hotkeyPreviewCycleInfo &&
          this._hotkeyPreviewCycleInfo.appIcon != appIcon
        ) {
          this._endHotkeyPreviewCycle()
        }

        if (!this._hotkeyPreviewCycleInfo) {
          this._hotkeyPreviewCycleInfo = {
            appIcon: appIcon,
            currentWindow: appIcon.window,
            keyFocusOutId: appIcon.connect('key-focus-out', () =>
              appIcon.grab_key_focus(),
            ),
            capturedEventId: global.stage.connect(
              'captured-event',
              (actor, e) => {
                if (
                  e.type() == Clutter.EventType.KEY_RELEASE &&
                  e.get_key_symbol() == (Clutter.KEY_Super_L || Clutter.Super_L)
                ) {
                  this._endHotkeyPreviewCycle(true)
                }

                return Clutter.EVENT_PROPAGATE
              },
            ),
          }

          appIcon._hotkeysCycle = appIcon.window
          appIcon.window = null
          appIcon._previewMenu.open(appIcon, true)
          appIcon.grab_key_focus()
        }

        appIcon._previewMenu.focusNext()
      } else {
        // Activate with button = 1, i.e. same as left click
        let button = 1
        this._endHotkeyPreviewCycle()
        appIcon.activate(button, modifiers, !this.taskbar.allowSplitApps)
      }
    }
  }

  _endHotkeyPreviewCycle(focusWindow) {
    if (this._hotkeyPreviewCycleInfo) {
      global.stage.disconnect(this._hotkeyPreviewCycleInfo.capturedEventId)
      this._hotkeyPreviewCycleInfo.appIcon.disconnect(
        this._hotkeyPreviewCycleInfo.keyFocusOutId,
      )

      if (focusWindow) {
        this._hotkeyPreviewCycleInfo.appIcon._previewMenu.activateFocused()
      } else this._hotkeyPreviewCycleInfo.appIcon._previewMenu.close()

      this._hotkeyPreviewCycleInfo.appIcon.window =
        this._hotkeyPreviewCycleInfo.currentWindow
      delete this._hotkeyPreviewCycleInfo.appIcon._hotkeysCycle
      this._hotkeyPreviewCycleInfo = 0
    }
  }

  _optionalHotKeys() {
    this._hotKeysEnabled = false
    if (SETTINGS.get_boolean('hot-keys')) this._enableHotKeys()

    this._signalsHandler.add([
      SETTINGS,
      'changed::hot-keys',
      () => {
        if (SETTINGS.get_boolean('hot-keys')) this._enableHotKeys()
        else this._disableHotKeys()
      },
    ])
  }

  _resetHotkeys() {
    this._disableHotKeys()
    this._enableHotKeys()
  }

  _enableHotKeys() {
    if (this._hotKeysEnabled) return

    // Setup keyboard bindings for taskbar elements
    let shortcutNumKeys = SETTINGS.get_string('shortcut-num-keys')
    let bothNumKeys = shortcutNumKeys == 'BOTH'
    let numRowKeys = shortcutNumKeys == 'NUM_ROW'
    let keys = []
    let prefixModifiers = Clutter.ModifierType.SUPER_MASK

    //3.32 introduced app hotkeys, disable them to prevent conflicts
    if (Main.wm._switchToApplication) {
      for (let i = 1; i < 10; ++i) {
        Utils.removeKeybinding(GS_SWITCH_HOTKEYS_KEY + i)

        if (bothNumKeys || numRowKeys)
          Utils.removeKeybinding(GS_OPEN_HOTKEYS_KEY + i)
      }
    }

    if (SETTINGS.get_string('hotkey-prefix-text') == 'SuperAlt')
      prefixModifiers |= Clutter.ModifierType.MOD1_MASK

    if (bothNumKeys || numRowKeys) {
      keys.push('app-hotkey-', 'app-shift-hotkey-', 'app-ctrl-hotkey-') // Regular numbers
    }

    if (bothNumKeys || shortcutNumKeys == 'NUM_KEYPAD') {
      keys.push('app-hotkey-kp-', 'app-shift-hotkey-kp-', 'app-ctrl-hotkey-kp-') // Key-pad numbers
    }

    keys.forEach(function (key) {
      let modifiers = prefixModifiers

      // for some reason, in gnome-shell >= 40 Clutter.get_current_event() is now empty
      // for keyboard events. Create here the modifiers that are needed in appicon.activate
      modifiers |=
        key.indexOf('-shift-') >= 0 ? Clutter.ModifierType.SHIFT_MASK : 0
      modifiers |=
        key.indexOf('-ctrl-') >= 0 ? Clutter.ModifierType.CONTROL_MASK : 0

      for (let i = 0; i < this._numHotkeys; i++) {
        let appNum = i

        Utils.addKeybinding(key + (i + 1), SETTINGS, () =>
          this._activateApp(appNum, modifiers),
        )
      }
    }, this)

    this._hotKeysEnabled = true

    if (SETTINGS.get_string('hotkeys-overlay-combo') === 'ALWAYS')
      this._toggleHotkeysNumberOverlay(true)
  }

  _disableHotKeys() {
    if (!this._hotKeysEnabled) return

    let shortcutNumKeys = SETTINGS.get_string('shortcut-num-keys')
    let keys = [
      'app-hotkey-',
      'app-shift-hotkey-',
      'app-ctrl-hotkey-', // Regular numbers
      'app-hotkey-kp-',
      'app-shift-hotkey-kp-',
      'app-ctrl-hotkey-kp-', // Key-pad numbers
    ]

    keys.forEach(function (key) {
      for (let i = 0; i < this._numHotkeys; i++) {
        Utils.removeKeybinding(key + (i + 1))
      }
    }, this)

    if (Main.wm._switchToApplication) {
      let gsSettings = new Gio.Settings({
        schema_id: WindowManager.SHELL_KEYBINDINGS_SCHEMA,
      })

      for (let i = 1; i < 10; ++i) {
        Utils.addKeybinding(
          GS_SWITCH_HOTKEYS_KEY + i,
          gsSettings,
          Main.wm._switchToApplication.bind(Main.wm),
        )

        if (shortcutNumKeys == 'BOTH' || shortcutNumKeys == 'NUM_ROW')
          Utils.addKeybinding(
            GS_OPEN_HOTKEYS_KEY + i,
            gsSettings,
            Main.wm._openNewApplicationWindow.bind(Main.wm),
          )
      }
    }

    this._hotKeysEnabled = false

    this._toggleHotkeysNumberOverlay(false)
  }

  _optionalNumberOverlay() {
    // Enable extra shortcut
    if (SETTINGS.get_boolean('hot-keys')) this._enableExtraShortcut()

    this._signalsHandler.add(
      [SETTINGS, 'changed::hot-keys', this._checkHotkeysOptions.bind(this)],
      [
        SETTINGS,
        [
          'changed::hotkeys-overlay-combo',
          'changed::shortcut-overlay-on-secondary',
        ],
        () => {
          if (
            SETTINGS.get_boolean('hot-keys') &&
            SETTINGS.get_string('hotkeys-overlay-combo') === 'ALWAYS'
          )
            this._toggleHotkeysNumberOverlay(true)
          else this._toggleHotkeysNumberOverlay(false, true)
        },
      ],
      [SETTINGS, 'changed::shortcut-num-keys', () => this._resetHotkeys()],
    )
  }

  _checkHotkeysOptions() {
    if (SETTINGS.get_boolean('hot-keys')) this._enableExtraShortcut()
    else this._disableExtraShortcut()
  }

  _enableExtraShortcut() {
    Utils.addKeybinding('shortcut', SETTINGS, () => this._showOverlay(true))
  }

  _disableExtraShortcut() {
    Utils.removeKeybinding('shortcut')
  }

  _showOverlay(overlayFromShortcut) {
    //wait for intellihide timeout initialization
    if (!this._panel.intellihide) {
      return
    }

    // Restart the counting if the shortcut is pressed again
    let hotkey_option = SETTINGS.get_string('hotkeys-overlay-combo')
    let temporarily = hotkey_option === 'TEMPORARILY'
    let timeout = SETTINGS.get_int(
      overlayFromShortcut ? 'shortcut-timeout' : 'overlay-timeout',
    )

    if (hotkey_option === 'NEVER' || (!timeout && temporarily)) return

    if (temporarily || overlayFromShortcut)
      this._toggleHotkeysNumberOverlay(true)

    this._panel.intellihide.revealAndHold(Intellihide.Hold.TEMPORARY)

    // Hide the overlay/dock after the timeout
    this._timeoutsHandler.add([
      T2,
      timeout,
      () => {
        if (hotkey_option != 'ALWAYS') {
          this._toggleHotkeysNumberOverlay(false)
        }

        this._panel.intellihide.release(Intellihide.Hold.TEMPORARY)
      },
    ])
  }

  _toggleHotkeysNumberOverlay(show, reset) {
    // this.taskbar is the primary taskbar
    this.taskbar.toggleHotkeysNumberOverlay(show)

    if (reset || SETTINGS.get_boolean('shortcut-overlay-on-secondary')) {
      // on secondary panels, show the overlay on icons matching the ones
      // found on the primary panel (see Taksbar.hotkeyAppNumbers)
      this._panelManager.allPanels.forEach((p) => {
        if (p.isPrimary) return

        p.taskbar.toggleHotkeysNumberOverlay(show)
      })
    }
  }

  _optionalClickToExit() {
    this._clickToExitEnabled = false
    if (SETTINGS.get_boolean('overview-click-to-exit'))
      this._enableClickToExit()

    this._signalsHandler.add([
      SETTINGS,
      'changed::overview-click-to-exit',
      () => {
        if (SETTINGS.get_boolean('overview-click-to-exit'))
          this._enableClickToExit()
        else this._disableClickToExit()
      },
    ])
  }

  _enableClickToExit() {
    if (this._clickToExitEnabled) return

    this._signalsHandler.addWithLabel('click-to-exit', [
      Main.layoutManager.overviewGroup,
      'button-release-event',
      () => {
        let [x, y] = global.get_pointer()
        let pickedActor = global.stage.get_actor_at_pos(
          Clutter.PickMode.REACTIVE,
          x,
          y,
        )

        if (pickedActor) {
          if (
            (pickedActor.has_style_class_name &&
              pickedActor.has_style_class_name('apps-scroll-view') &&
              !pickedActor.has_style_pseudo_class('first-child')) ||
            Main.overview._overview._controls._searchEntryBin.contains(
              pickedActor,
            ) ||
            pickedActor instanceof WindowPreview
          )
            return Clutter.EVENT_PROPAGATE
        }

        Main.overview.toggle()
      },
    ])

    this._clickToExitEnabled = true
  }

  _disableClickToExit() {
    if (!this._clickToExitEnabled) return

    this._signalsHandler.removeWithLabel('click-to-exit')

    this._clickToExitEnabled = false
  }

  _onSwipeBegin() {
    this._swiping = true
    return true
  }

  _onSwipeEnd() {
    this._timeoutsHandler.add([T1, 0, () => (this._swiping = false)])
    return true
  }
}
