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

var SHOW_APPS_BTN = 'showAppsButton';
var ACTIVITIES_BTN = 'activitiesButton';
var TASKBAR = 'taskbar';
var DATE_MENU = 'dateMenu';
var SYSTEM_MENU = 'systemMenu';
var LEFT_BOX = 'leftBox';
var CENTER_BOX = 'centerBox';
var RIGHT_BOX = 'rightBox';
var DESKTOP_BTN = 'desktopButton';

var STACKED_TL = 'stackedTL';
var STACKED_BR = 'stackedBR';
var CENTERED = 'centered';
var CENTERED_MONITOR = 'centerMonitor';

var TOP = 'TOP';
var BOTTOM = 'BOTTOM';
var LEFT = 'LEFT';
var RIGHT = 'RIGHT';

var START = 'START';
var MIDDLE = 'MIDDLE';
var END = 'END';

var defaults = [
    { element: SHOW_APPS_BTN,   visible: true,     position: STACKED_TL },
    { element: ACTIVITIES_BTN,  visible: false,    position: STACKED_TL },
    { element: LEFT_BOX,        visible: true,     position: STACKED_TL },
    { element: TASKBAR,         visible: true,     position: STACKED_TL },
    { element: CENTER_BOX,      visible: true,     position: STACKED_BR },
    { element: RIGHT_BOX,       visible: true,     position: STACKED_BR },
    { element: DATE_MENU,       visible: true,     position: STACKED_BR },
    { element: SYSTEM_MENU,     visible: true,     position: STACKED_BR },
    { element: DESKTOP_BTN,     visible: true,     position: STACKED_BR },
];

var optionDialogFunctions = {};

optionDialogFunctions[SHOW_APPS_BTN] = '_showShowAppsButtonOptions';
optionDialogFunctions[DESKTOP_BTN] = '_showDesktopButtonOptions';

function checkIfCentered(position) {
    return position == CENTERED || position == CENTERED_MONITOR;
}