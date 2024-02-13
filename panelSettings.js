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

import * as Pos from './panelPositions.js';

/** Return object representing a settings value that is stored as JSON. */
export function getSettingsJson(settings, setting) {
    try {
        return JSON.parse(settings.get_string(setting));
    } catch(e) {
        log('Error parsing positions: ' + e.message);
    }
}
/** Write value object as JSON to setting in settings. */
export function setSettingsJson(settings, setting, value) {
    try {
        const json = JSON.stringify(value);
        settings.set_string(setting, json);
    } catch(e) {
        log('Error serializing setting: ' + e.message);
    }
}

/** Returns size of panel on a specific monitor, in pixels. */
export function getPanelSize(settings, monitorIndex) {
    const sizes = getSettingsJson(settings, 'panel-sizes');
    // Pull in deprecated setting if panel-sizes does not have setting for monitor.
    const fallbackSize = settings.get_int('panel-size');
    const theDefault = 48;
    return sizes[monitorIndex] || fallbackSize || theDefault;
}

export function setPanelSize(settings, monitorIndex, value) {
    if (!(Number.isInteger(value) && value <= 128 && value >= 16)) {
        log('Not setting invalid panel size: ' + value);
        return;
    }
    let sizes = getSettingsJson(settings, 'panel-sizes');
    sizes[monitorIndex] = value;
    setSettingsJson(settings, 'panel-sizes', sizes);
}

/**
 * Returns length of panel on a specific monitor, as a whole number percent,
 * from settings. e.g. 100
 */
export function getPanelLength(settings, monitorIndex) {
    const lengths = getSettingsJson(settings, 'panel-lengths');
    const theDefault = 100;
    return lengths[monitorIndex] || theDefault;
}

export function setPanelLength(settings, monitorIndex, value) {
    if (!(Number.isInteger(value) && value <= 100 && value >= 0)) {
        log('Not setting invalid panel length: ' + value);
        return;
    }
    let lengths = getSettingsJson(settings, 'panel-lengths');
    lengths[monitorIndex] = value;
    setSettingsJson(settings, 'panel-lengths', lengths);
}

/** Returns position of panel on a specific monitor. */
export function getPanelPosition(settings, monitorIndex) {
    const positions = getSettingsJson(settings, 'panel-positions');
    const fallbackPosition = settings.get_string('panel-position');
    const theDefault = Pos.BOTTOM;
    return positions[monitorIndex] || fallbackPosition || theDefault;
}

export function setPanelPosition(settings, monitorIndex, value) {
    if (!(value === Pos.TOP || value === Pos.BOTTOM || value === Pos.LEFT
        || value === Pos.RIGHT)) {
        log('Not setting invalid panel position: ' + value);
        return;
    }
    const positions = getSettingsJson(settings, 'panel-positions');
    positions[monitorIndex] = value;
    setSettingsJson(settings, 'panel-positions', positions);
}

/** Returns anchor location of panel on a specific monitor. */
export function getPanelAnchor(settings, monitorIndex) {
    const anchors = getSettingsJson(settings, 'panel-anchors');
    const theDefault = Pos.MIDDLE;
    return anchors[monitorIndex] || theDefault;
}

export function setPanelAnchor(settings, monitorIndex, value) {
    if (!(value === Pos.START || value === Pos.MIDDLE || value === Pos.END)) {
        log('Not setting invalid panel anchor: ' + value);
        return;
    }
    const anchors = getSettingsJson(settings, 'panel-anchors');
    anchors[monitorIndex] = value;
    setSettingsJson(settings, 'panel-anchors', anchors);
}
