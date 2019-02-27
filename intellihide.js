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

const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const GrabHelper = imports.ui.grabHelper;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const PointerWatcher = imports.ui.pointerWatcher;
const Tweener = imports.ui.tweener;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Proximity = Me.imports.proximity;
const Utils = Me.imports.utils;

//timeout intervals
const CHECK_POINTER_MS = 200;
const CHECK_GRAB_MS = 400;
const POST_ANIMATE_MS = 50; 
const MIN_UPDATE_MS = 250;

//timeout names
const T1 = 'checkGrabTimeout';
const T2 = 'limitUpdateTimeout';
const T3 = 'postAnimateTimeout';

var Hold = {
    NONE: 0,
    TEMPORARY: 1,
    PERMANENT: 2
};

var Intellihide = Utils.defineClass({
    Name: 'DashToPanel.Intellihide',

    _init: function(dtpPanel) {
        this._dtpPanel = dtpPanel;
        this._dtpSettings = dtpPanel._dtpSettings;
        this._panelBox = dtpPanel.panelBox;
        this._panelManager = dtpPanel.panelManager;
        this._proximityManager = this._panelManager.proximityManager;
        this._holdStatus = Hold.NONE;
        
        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._timeoutsHandler = new Utils.TimeoutsHandler();

        this._intellihideChangedId = this._dtpSettings.connect('changed::intellihide', () => this._changeEnabledStatus());
        this._intellihideOnlySecondaryChangedId = this._dtpSettings.connect('changed::intellihide-only-secondary', () => this._changeEnabledStatus());

        this._enabled = false;
        this._changeEnabledStatus();
    },

    enable: function(reset) {
        this._enabled = true;
        this._monitor = this._dtpPanel.monitor;
        this._animationDestination = -1;
        this._pendingUpdate = false;
        this._hoveredOut = false;
        this._windowOverlap = false;
        this._panelAtTop = this._dtpSettings.get_string('panel-position') === 'TOP';

        if (this._panelAtTop && this._panelBox.translation_y > 0 || 
            !this._panelAtTop && this._panelBox.translation_y < 0) {
            //the panel changed position while being hidden, so revert the hiding position
            this._panelBox.translation_y *= -1;
        }

        this._setTrackPanel(reset, true);
        this._bindGeneralSignals();

        if (this._dtpSettings.get_boolean('intellihide-hide-from-windows')) {
            this._proximityWatchId = this._proximityManager.createWatch(
                this._panelBox, 
                Proximity.Mode[this._dtpSettings.get_string('intellihide-behaviour')], 
                0, 0,
                overlap => { 
                    this._windowOverlap = overlap;
                    this._queueUpdatePanelPosition();
                }
            );
        }

        this._setRevealMechanism();
        this._queueUpdatePanelPosition();
    },

    disable: function(reset) {
        if (this._proximityWatchId) {
            this._proximityManager.removeWatch(this._proximityWatchId);
        }

        this._setTrackPanel(reset, false);

        this._signalsHandler.destroy();
        this._timeoutsHandler.destroy();

        this._removeRevealMechanism();

        this._revealPanel(!reset);
        
        this._enabled = false;
    },

    destroy: function() {
        this._dtpSettings.disconnect(this._intellihideChangedId);
        this._dtpSettings.disconnect(this._intellihideOnlySecondaryChangedId);
        this.disable();
    },

    toggle: function() {
        this[this._holdStatus & Hold.PERMANENT ? 'release' : 'revealAndHold'](Hold.PERMANENT);
    },

    revealAndHold: function(holdStatus) {
        if (this._enabled && !this._holdStatus) {
            this._revealPanel();
        }
        
        this._holdStatus |= holdStatus;
    },

    release: function(holdStatus) {
        this._holdStatus -= holdStatus;

        if (this._enabled && !this._holdStatus) {
            this._queueUpdatePanelPosition();
        }
    },

    _reset: function() {
        this.disable(true);
        this.enable(true);
    },

    _changeEnabledStatus: function() {
        let intellihide = this._dtpSettings.get_boolean('intellihide');
        let onlySecondary = this._dtpSettings.get_boolean('intellihide-only-secondary');
        let enabled = intellihide && (this._dtpPanel.isSecondary || !onlySecondary);

        if (this._enabled !== enabled) {
            this[enabled ? 'enable' : 'disable']();
        }
    },

    _bindGeneralSignals: function() {
        this._signalsHandler.add(
            [
                this._dtpPanel.taskbar,
                'menu-closed',
                () => this._panelBox.sync_hover()
            ],
            [
                this._dtpSettings, 
                [
                    'changed::panel-position',
                    'changed::panel-size',
                    'changed::intellihide-use-pressure',
                    'changed::intellihide-hide-from-windows',
                    'changed::intellihide-behaviour'
                ],
                () => this._reset()
            ],
            [
                Main.layoutManager,
                'monitors-changed',
                () => this._reset()
            ],
            [
                this._panelBox,
                'notify::hover',
                () => {
                    this._hoveredOut = !this._panelBox.hover;
                    this._queueUpdatePanelPosition();
                }
            ],
            [
                Main.overview,
                [
                    'showing',
                    'hiding'
                ],
                () => this._queueUpdatePanelPosition()
            ]
        );
    },

    _setTrackPanel: function(reset, enable) {
        if (!reset) {
            Main.layoutManager._untrackActor(this._panelBox);
            Main.layoutManager._trackActor(this._panelBox, { affectsStruts: !enable, trackFullscreen: !enable });
    
            this._panelBox.track_hover = enable;
            this._panelBox.reactive = enable;
            this._panelBox.visible = enable ? enable : this._panelBox.visible;
        }
    },

    _setRevealMechanism: function() {
        if (global.display.supports_extended_barriers() && this._dtpSettings.get_boolean('intellihide-use-pressure')) {
            this._edgeBarrier = this._createBarrier();
            this._pressureBarrier = new Layout.PressureBarrier(
                this._dtpSettings.get_int('intellihide-pressure-threshold'), 
                this._dtpSettings.get_int('intellihide-pressure-time'), 
                Shell.ActionMode.NORMAL
            );
            this._pressureBarrier.addBarrier(this._edgeBarrier);
            this._signalsHandler.add([this._pressureBarrier, 'trigger', () => this._queueUpdatePanelPosition(true)]);
        } else {
            this._pointerWatch = PointerWatcher.getPointerWatcher()
                                               .addWatch(CHECK_POINTER_MS, (x, y) => this._checkMousePointer(x, y));
        }
    },

    _removeRevealMechanism: function() {
        if (this._pointerWatch) {
            PointerWatcher.getPointerWatcher()._removeWatch(this._pointerWatch);
        }

        if (this._pressureBarrier) {
            this._pressureBarrier.destroy();
            this._edgeBarrier.destroy();
        }
    },

    _createBarrier: function() {
        let opts = { 
            display: global.display,
            x1: this._monitor.x + 1,
            x2: this._monitor.x + this._monitor.width - 1 
        };

        if (this._panelAtTop) {
            opts.y1 = this._monitor.y;
            opts.y2 = this._monitor.y;
            opts.directions = Meta.BarrierDirection.POSITIVE_Y;
        } else {
            let screenBottom = this._monitor.y + this._monitor.height;

            opts.y1 = screenBottom;
            opts.y2 = screenBottom;
            opts.directions = Meta.BarrierDirection.NEGATIVE_Y;
        }

        return new Meta.Barrier(opts);
    },

    _checkMousePointer: function(x, y) {
        if (!this._panelBox.hover && !Main.overview.visible &&
            ((this._panelAtTop && y <= this._monitor.y + 1) || 
             (!this._panelAtTop && y >= this._monitor.y + this._monitor.height - 1)) &&
            (x > this._monitor.x && x < this._monitor.x + this._monitor.width)) {
            this._queueUpdatePanelPosition(true);
        }
    },

    _queueUpdatePanelPosition: function(fromRevealMechanism) {
        if (!fromRevealMechanism && this._timeoutsHandler.getId(T2) && !Main.overview.visible) {
            //unless this is a mouse interaction or entering/leaving the overview, limit the number
            //of updates, but remember to update again when the limit timeout is reached
            this._pendingUpdate = true;
        } else if (!this._holdStatus) {
            this._checkIfShouldBeVisible(fromRevealMechanism) ? this._revealPanel() : this._hidePanel();
            this._timeoutsHandler.add([T2, MIN_UPDATE_MS, () => this._endLimitUpdate()]);
        }
    },

    _endLimitUpdate: function() {
        if (this._pendingUpdate) {
            this._pendingUpdate = false;
            this._queueUpdatePanelPosition();
        }
    },

    _checkIfShouldBeVisible: function(fromRevealMechanism) {
        if (Main.overview.visibleTarget || this._checkIfGrab() || this._panelBox.get_hover()) {
            return true;
        }

        if (fromRevealMechanism) {
            let mouseBtnIsPressed = global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK;
            
            //the user is trying to reveal the panel
            if (this._monitor.inFullscreen && !mouseBtnIsPressed) {
                return this._dtpSettings.get_boolean('intellihide-show-in-fullscreen');
            }

            return !mouseBtnIsPressed;
        }

        if (!this._dtpSettings.get_boolean('intellihide-hide-from-windows')) {
            return this._panelBox.hover;
        }

        return !this._windowOverlap;
    },

    _checkIfGrab: function() {
        if (GrabHelper._grabHelperStack.some(gh => this._panelBox.contains(gh._owner))) {
            //there currently is a grab on a child of the panel, check again soon to catch its release
            this._timeoutsHandler.add([T1, CHECK_GRAB_MS, () => this._queueUpdatePanelPosition()]);

            return true;
        }

        return false;
    },

    _revealPanel: function(immediate) {
        this._animatePanel(0, immediate);
    },

    _hidePanel: function(immediate) {
        this._animatePanel(this._panelBox.height * (this._panelAtTop ? -1 : 1), immediate);
    },

    _animatePanel: function(destination, immediate, onComplete) {
        let animating = Tweener.isTweening(this._panelBox);

        if (!((animating && destination === this._animationDestination) || 
              (!animating && destination === this._panelBox.translation_y))) {
            //the panel isn't already at, or animating to the asked destination
            if (animating) {
                Tweener.removeTweens(this._panelBox);
            }

            this._animationDestination = destination;
    
            if (immediate) {
                this._panelBox.translation_y = destination;
                this._invokeIfExists(onComplete);
            } else {
                Tweener.addTween(this._panelBox, {
                    translation_y: destination,
                    //when entering/leaving the overview, use its animation time instead of the one from the settings
                    time: Main.overview.visible ? 
                          OverviewControls.SIDE_CONTROLS_ANIMATION_TIME :
                          this._dtpSettings.get_int('intellihide-animation-time') * 0.001,
                    //only delay the animation when hiding the panel after the user hovered out
                    delay: destination != 0 && this._hoveredOut ? this._dtpSettings.get_int('intellihide-close-delay') * 0.001 : 0,
                    transition: 'easeOutQuad',
                    onComplete: () => {
                        this._invokeIfExists(onComplete);
                        Main.layoutManager._queueUpdateRegions();
                        this._timeoutsHandler.add([T3, POST_ANIMATE_MS, () => this._queueUpdatePanelPosition()]);
                    }
                });
            }
        }

        this._hoveredOut = false;
    },

    _invokeIfExists: function(func) {
        func ? func.call(this) : null;
    }
});