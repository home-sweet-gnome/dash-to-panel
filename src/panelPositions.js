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

export const SHOW_APPS_BTN = 'showAppsButton'
export const ACTIVITIES_BTN = 'activitiesButton'
export const TASKBAR = 'taskbar'
export const DATE_MENU = 'dateMenu'
export const SYSTEM_MENU = 'systemMenu'
export const LEFT_BOX = 'leftBox'
export const CENTER_BOX = 'centerBox'
export const RIGHT_BOX = 'rightBox'
export const DESKTOP_BTN = 'desktopButton'

export const STACKED_TL = 'stackedTL'
export const STACKED_BR = 'stackedBR'
export const CENTERED = 'centered'
export const CENTERED_MONITOR = 'centerMonitor'

export const TOP = 'TOP'
export const BOTTOM = 'BOTTOM'
export const LEFT = 'LEFT'
export const RIGHT = 'RIGHT'

export const START = 'START'
export const MIDDLE = 'MIDDLE'
export const END = 'END'

export const defaults = [
  { element: SHOW_APPS_BTN, visible: true, position: STACKED_TL },
  { element: ACTIVITIES_BTN, visible: false, position: STACKED_TL },
  { element: LEFT_BOX, visible: true, position: STACKED_TL },
  { element: TASKBAR, visible: true, position: STACKED_TL },
  { element: CENTER_BOX, visible: true, position: STACKED_BR },
  { element: RIGHT_BOX, visible: true, position: STACKED_BR },
  { element: DATE_MENU, visible: true, position: STACKED_BR },
  { element: SYSTEM_MENU, visible: true, position: STACKED_BR },
  { element: DESKTOP_BTN, visible: true, position: STACKED_BR },
]

export const anchorToPosition = {
  [START]: STACKED_TL,
  [MIDDLE]: CENTERED_MONITOR,
  [END]: STACKED_BR,
}

export const optionDialogFunctions = {}

optionDialogFunctions[SHOW_APPS_BTN] = '_showShowAppsButtonOptions'
optionDialogFunctions[DESKTOP_BTN] = '_showDesktopButtonOptions'

export function checkIfCentered(position) {
  return position == CENTERED || position == CENTERED_MONITOR
}
