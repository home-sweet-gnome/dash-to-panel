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

import Gio from 'gi://Gio'

import * as Pos from './panelPositions.js'

const displayConfigWrapper = Gio.DBusProxy.makeProxyWrapper(
  `<node>
    <interface name="org.gnome.Mutter.DisplayConfig">
      <signal name="MonitorsChanged" />
      <method name="GetCurrentState">
        <arg name="serial" direction="out" type="u" />
        <arg name="monitors" direction="out" type="a((ssss)a(siiddada{sv})a{sv})" />
        <arg name="logical_monitors" direction="out" type="a(iiduba(ssss)a{sv})" />
        <arg name="properties" direction="out" type="a{sv}" />
      </method>
    </interface>
  </node>`,
)

// the module variables here are different in the settings dialog (gjs process)
// and in gnome-shell (gnome-shell process)
let prefsOpenedId = null
let useCache = false
let cache = {}
let monitorIdToIndex = {}
let monitorIndexToId = {}

export var displayConfigProxy = null
export var availableMonitors = []

export async function init(settings) {
  useCache = true
  prefsOpenedId = settings.connect(
    'changed::prefs-opened',
    () => (useCache = !settings.get_boolean('prefs-opened')),
  )

  await setMonitorsInfo(settings)
}

export async function disable(settings) {
  settings.disconnect(prefsOpenedId)
}

export function clearCache(setting) {
  if (setting) {
    cache[setting] = null
    return
  }

  cache = {}
}

/** Return object representing a settings value that is stored as JSON. */
export function getSettingsJson(settings, setting) {
  try {
    if (useCache && cache[setting]) return cache[setting]

    let res = JSON.parse(settings.get_string(setting))

    cache[setting] = res

    return res
  } catch (e) {
    console.log('Error parsing positions: ' + e.message)
  }
}
/** Write value object as JSON to setting in settings. */
export function setSettingsJson(settings, setting, value) {
  try {
    const json = JSON.stringify(value)
    settings.set_string(setting, json)
    cache[setting] = value
  } catch (e) {
    console.log('Error serializing setting: ' + e.message)
  }
}

// Previously, the monitor index was used as an id to persist per monitor
// settings. Since these indexes are unreliable AF, switch to use the monitor
// serial as its id while keeping it backward compatible.
function getMonitorSetting(settings, settingName, monitorIndex, fallback) {
  let monitorId = monitorIndexToId[monitorIndex]

  settings = getSettingsJson(settings, settingName)

  return (
    settings[monitorId] ||
    settings[monitorIndex] ||
    settings[availableMonitors[monitorIndex]?.id] ||
    fallback
  )
}

function setMonitorSetting(settings, settingName, monitorIndex, value) {
  let monitorId = monitorIndexToId[monitorIndex]
  let usedId = monitorId || monitorIndex

  let currentSettings = getSettingsJson(settings, settingName)

  if (monitorId) delete currentSettings[monitorIndex]

  currentSettings[usedId] = value
  setSettingsJson(settings, settingName, currentSettings)
}

/** Returns size of panel on a specific monitor, in pixels. */
export function getPanelSize(settings, monitorIndex) {
  // Pull in deprecated setting if panel-sizes does not have setting for monitor.
  return getMonitorSetting(
    settings,
    'panel-sizes',
    monitorIndex,
    settings.get_int('panel-size') || 48,
  )
}

export function setPanelSize(settings, monitorIndex, value) {
  if (!(Number.isInteger(value) && value <= 128 && value >= 16)) {
    console.log('Not setting invalid panel size: ' + value)
    return
  }

  setMonitorSetting(settings, 'panel-sizes', monitorIndex, value)
}

/**
 * Returns length of panel on a specific monitor, as a whole number percent,
 * from settings. e.g. 100, or -1 for a dynamic panel length
 */
export function getPanelLength(settings, monitorIndex) {
  return getMonitorSetting(settings, 'panel-lengths', monitorIndex, 100)
}

export function setPanelLength(settings, monitorIndex, value) {
  if (
    !(Number.isInteger(value) && ((value <= 100 && value >= 20) || value == -1))
  ) {
    console.log('Not setting invalid panel length: ' + value, new Error().stack)
    return
  }

  setMonitorSetting(settings, 'panel-lengths', monitorIndex, value)
}

/** Returns position of panel on a specific monitor. */
export function getPanelPosition(settings, monitorIndex) {
  return getMonitorSetting(
    settings,
    'panel-positions',
    monitorIndex,
    settings.get_string('panel-position') || Pos.BOTTOM,
  )
}

export function setPanelPosition(settings, monitorIndex, value) {
  if (
    !(
      value === Pos.TOP ||
      value === Pos.BOTTOM ||
      value === Pos.LEFT ||
      value === Pos.RIGHT
    )
  ) {
    console.log('Not setting invalid panel position: ' + value)
    return
  }

  setMonitorSetting(settings, 'panel-positions', monitorIndex, value)
}

/** Returns anchor location of panel on a specific monitor. */
export function getPanelAnchor(settings, monitorIndex) {
  return getMonitorSetting(settings, 'panel-anchors', monitorIndex, Pos.MIDDLE)
}

export function setPanelAnchor(settings, monitorIndex, value) {
  if (!(value === Pos.START || value === Pos.MIDDLE || value === Pos.END)) {
    console.log('Not setting invalid panel anchor: ' + value)
    return
  }

  setMonitorSetting(settings, 'panel-anchors', monitorIndex, value)
}

export function getPanelElementPositions(settings, monitorIndex) {
  return getMonitorSetting(
    settings,
    'panel-element-positions',
    monitorIndex,
    Pos.defaults,
  )
}

export function setPanelElementPositions(settings, monitorIndex, value) {
  setMonitorSetting(settings, 'panel-element-positions', monitorIndex, value)
}

export function getPrimaryIndex(dtpPrimaryId) {
  if (dtpPrimaryId in monitorIdToIndex) return monitorIdToIndex[dtpPrimaryId]

  if (dtpPrimaryId.match(/^\d{1,2}$/) && availableMonitors[dtpPrimaryId])
    return dtpPrimaryId

  return availableMonitors.findIndex((am) => am.primary)
}

export async function setMonitorsInfo(settings) {
  return new Promise((resolve, reject) => {
    try {
      let monitorInfos = []
      let saveMonitorState = (proxy) => {
        proxy.GetCurrentStateRemote((displayInfo, e) => {
          if (e) return reject(`Error getting display state: ${e}`)

          let gsPrimaryIndex = 0
          let ids = {}

          //https://gitlab.gnome.org/GNOME/mutter/-/blob/main/data/dbus-interfaces/org.gnome.Mutter.DisplayConfig.xml#L347
          displayInfo[2].forEach((logicalMonitor, i) => {
            let [connector, vendor, product, serial] = logicalMonitor[5][0]
            let id = i
            let primary = logicalMonitor[4]

            // if by any chance 2 monitors have the same id, use the connector string
            // instead, which should be unique but varies between x11 and wayland :(
            // worst case scenario, resort to using the dumbass index
            if (vendor && serial) id = `${vendor}-${serial}`

            if (ids[id]) id = connector && !ids[connector] ? connector : i

            if (primary) gsPrimaryIndex = i

            monitorInfos.push({
              id,
              product,
              primary,
            })

            monitorIdToIndex[id] = i
            monitorIndexToId[i] = id
            ids[id] = 1
          })

          _saveMonitors(settings, monitorInfos, gsPrimaryIndex)

          resolve()
        })
      }

      if (!displayConfigProxy)
        displayConfigProxy = new displayConfigWrapper(
          Gio.DBus.session,
          'org.gnome.Mutter.DisplayConfig',
          '/org/gnome/Mutter/DisplayConfig',
          (proxy, e) => {
            if (e) return reject(`Error creating display proxy: ${e}`)

            saveMonitorState(proxy)
          },
        )
      else saveMonitorState(displayConfigProxy)
    } catch (e) {
      reject(e)
    }
  })
}

function _saveMonitors(settings, monitorInfos, gsPrimaryIndex) {
  let keyPrimary = 'primary-monitor'
  let dtpPrimaryMonitor = settings.get_string(keyPrimary)

  // convert previously saved index to monitor id
  if (dtpPrimaryMonitor.match(/^\d{1,2}$/) && monitorInfos[dtpPrimaryMonitor])
    dtpPrimaryMonitor = monitorInfos[dtpPrimaryMonitor].id

  // default to gnome-shell primary monitor
  if (!dtpPrimaryMonitor)
    dtpPrimaryMonitor = monitorInfos[gsPrimaryIndex]?.id || 0

  settings.set_string(keyPrimary, dtpPrimaryMonitor)
  availableMonitors = Object.freeze(monitorInfos)
}

// this is for backward compatibility, to remove in a few versions
export function adjustMonitorSettings(settings) {
  let updateSettings = (settingName) => {
    let monitorSettings = getSettingsJson(settings, settingName)
    let updatedSettings = {}

    Object.keys(monitorSettings).forEach((key) => {
      let initialKey = key

      if (key.match(/^\d{1,2}$/)) key = monitorIndexToId[key] || key

      updatedSettings[key] = monitorSettings[initialKey]
    })

    setSettingsJson(settings, settingName, updatedSettings)
  }

  updateSettings('panel-sizes')
  updateSettings('panel-lengths')
  updateSettings('panel-positions')
  updateSettings('panel-anchors')
  updateSettings('panel-element-positions')
}
