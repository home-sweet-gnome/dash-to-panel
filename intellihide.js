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
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const GrabHelper = imports.ui.grabHelper;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const PointerWatcher = imports.ui.pointerWatcher;
const Tweener = imports.ui.tweener;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

//timeout intervals
const CHECK_POINTER_MS = 200;
const CHECK_GRAB_MS = 400;
const POST_ANIMATE_MS = 50; 
const MIN_UPDATE_MS = 250;

//timeout names
const T1 = 'checkGrabTimeout';
const T2 = 'limitUpdateTimeout';
const T3 = 'postAnimateTimeout';

var Intellihide = new Lang.Class({
    Name: 'DashToPanel.Intellihide',

    _init: function(dtpPanel) {
        this._dtpPanel = dtpPanel;
        this._dtpSettings = dtpPanel._dtpSettings;
        this._panelBox = dtpPanel.panelBox;
        
        this._signalsHandler = new Convenience.GlobalSignalsHandler();
        this._timeoutsHandler = new Convenience.TimeoutsHandler();

        this._dtpSettings.connect('changed::intellihide', Lang.bind(this, this._changeEnabledStatus));

        if (this._dtpSettings.get_boolean('intellihide')) {
            this.enable();
        }
    },

    enable: function(reset) {
        this._enabled = true;
        this._primaryMonitor = Main.layoutManager.primaryMonitor;
        this._focusedWindowInfo = null;
        this._animationDestination = -1;
        this._pendingUpdate = false;
        this._dragging = false;
        this._currentlyHeld = false;
        this._hoveredOut = false;
        this._panelAtTop = this._dtpSettings.get_string('panel-position') === 'TOP';

        if (this._panelAtTop && this._panelBox.translation_y > 0 || 
            !this._panelAtTop && this._panelBox.translation_y < 0) {
            //the panel changed position while being hidden, so revert the hiding position
            this._panelBox.translation_y *= -1;
        }

        this._setTrackPanel(reset, true);
        this._bindGeneralSignals();

        if (this._dtpSettings.get_boolean('intellihide-hide-from-windows')) {
            this._bindWindowSignals();
            this._setFocusedWindow();
        }

        this._setRevealMechanism();
        this._queueUpdatePanelPosition();
    },

    disable: function(reset) {
        this._setTrackPanel(reset, false);
        this._disconnectFocusedWindow();

        this._signalsHandler.destroy();
        this._timeoutsHandler.destroy();

        this._removeRevealMechanism();

        this._revealPanel(!reset);
        
        this._enabled = false;
    },

    destroy: function() {
        this.disable();
    },

    revealAndHold: function() {
        if (this._enabled) {
            this._revealPanel();
            this._currentlyHeld = true;
        }
    },

    release: function() {
        if (this._enabled) {
            this._currentlyHeld = false;
            this._queueUpdatePanelPosition();
        }
    },

    _reset: function() {
        this.disable(true);
        this.enable(true);
    },

    _changeEnabledStatus: function() {
        this[this._dtpSettings.get_boolean('intellihide') ? 'enable' : 'disable']();
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
                    'changed::intellihide-hide-from-windows'
                ],
                () => this._reset()
            ],
            [
                global.display,
                'restacked',
                () => this._queueUpdatePanelPosition()
            ],
            [
                Main.layoutManager,
                'monitors-changed',
                () => this._reset()
            ],
            [
                global.display,
                'grab-op-begin',
                () => this._dragging = true
            ],
            [
                global.display,
                'grab-op-end',
                () => this._dragging = false
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

    _bindWindowSignals: function() {
        this._signalsHandler.add(
            [
                global.display,
                'notify::focus-window', 
                () => {
                    this._setFocusedWindow();
                    this._queueUpdatePanelPosition();
                }
            ],
            [
                global.window_group,
                [
                    'actor-added',
                    'actor-removed'
                ],
                () => this._queueUpdatePanelPosition()
            ],
            [
                this._dtpSettings,
                'changed::intellihide-behaviour',
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
            x1: this._primaryMonitor.x + 1,
            x2: this._primaryMonitor.x + this._primaryMonitor.width - 1 
        };

        if (this._panelAtTop) {
            opts.y1 = this._primaryMonitor.y;
            opts.y2 = this._primaryMonitor.y;
            opts.directions = Meta.BarrierDirection.POSITIVE_Y;
        } else {
            let screenBottom = this._primaryMonitor.y + this._primaryMonitor.height;

            opts.y1 = screenBottom;
            opts.y2 = screenBottom;
            opts.directions = Meta.BarrierDirection.NEGATIVE_Y;
        }

        return new Meta.Barrier(opts);
    },

    _checkMousePointer: function(x, y) {
        if (!this._panelBox.hover && !Main.overview.visible &&
            ((this._panelAtTop && y <= this._primaryMonitor.y + 1) || 
             (!this._panelAtTop && y >= this._primaryMonitor.y + this._primaryMonitor.height - 1)) &&
            (x > this._primaryMonitor.x && x < this._primaryMonitor.x + this._primaryMonitor.width)) {
            this._queueUpdatePanelPosition(true);
        }
    },

    _setFocusedWindow: function() {
        this._disconnectFocusedWindow();

        let focusedWindow = global.display.focus_window;

        if (focusedWindow) {
            let window = (focusedWindow.is_attached_dialog() ? 
                          focusedWindow.get_transient_for() : 
                          focusedWindow).get_compositor_private();
            let metaWindow = window.get_meta_window();

            if (this._checkIfHandledWindowType(metaWindow)) {
                this._focusedWindowInfo = {
                    window: window,
                    metaWindow: metaWindow,
                    id: window.connect('allocation-changed', () => this._queueUpdatePanelPosition())
                };
            }
        }
    },

    _disconnectFocusedWindow: function() {
        if (this._focusedWindowInfo) {
            this._focusedWindowInfo.window.disconnect(this._focusedWindowInfo.id);
            this._focusedWindowInfo = null;
        }
    },

    _getHandledWindows: function() {
        return global.get_window_actors()
                     .map(w => w.get_meta_window())
                     .filter(mw => this._checkIfHandledWindow(mw));
    },

    _checkIfHandledWindow: function(metaWindow) {
        return metaWindow && !metaWindow.minimized &&
               metaWindow.get_workspace().index() == global.workspace_manager.get_active_workspace_index() &&
               metaWindow.get_monitor() == Main.layoutManager.primaryIndex &&
               this._checkIfHandledWindowType(metaWindow);
    },

    _checkIfHandledWindowType: function(metaWindow) {
        let metaWindowType = metaWindow.get_window_type();

        //https://www.roojs.org/seed/gir-1.2-gtk-3.0/seed/Meta.WindowType.html
        return metaWindowType <= Meta.WindowType.SPLASHSCREEN && 
               metaWindowType != Meta.WindowType.DESKTOP;
    },

    _queueUpdatePanelPosition: function(fromRevealMechanism) {
        if (!fromRevealMechanism && this._timeoutsHandler.getId(T2) && !Main.overview.visible) {
            //unless this is a mouse interaction or entering/leaving the overview, limit the number
            //of updates, but remember to update again when the limit timeout is reached
            this._pendingUpdate = true;
        } else if (!this._currentlyHeld) {
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
        if (fromRevealMechanism) {
            //the user is trying to reveal the panel
            if (this._primaryMonitor.inFullscreen && !this._dragging) {
                return this._dtpSettings.get_boolean('intellihide-show-in-fullscreen');
            }

            return !this._dragging;
        }

        if (Main.overview.visibleTarget || this._checkIfGrab() || this._panelBox.get_hover()) {
            return true;
        }

        if (!this._dtpSettings.get_boolean('intellihide-hide-from-windows')) {
            return this._panelBox.hover;
        }

        let behaviour = this._dtpSettings.get_string('intellihide-behaviour');

        if (behaviour === 'FOCUSED_WINDOWS') {
            return !(this._focusedWindowInfo && 
                     this._checkIfHandledWindow(this._focusedWindowInfo.metaWindow) &&
                     this._checkIfWindowObstructs(this._focusedWindowInfo.metaWindow));
        } 
        
        let metaWindows = this._getHandledWindows();

        if (behaviour === 'MAXIMIZED_WINDOWS') {
            return !metaWindows.some(mw => mw.maximized_vertically && mw.maximized_horizontally);
        } else { //ALL_WINDOWS
            return !metaWindows.some(mw => this._checkIfWindowObstructs(mw));
        }
    },

    _checkIfWindowObstructs: function(metaWindow) {
        let windowRect = metaWindow.get_frame_rect();

        if (this._panelAtTop) {
            return windowRect.y <= this._primaryMonitor.y + this._panelBox.height;
        }

        let windowBottom = windowRect.y + windowRect.height;
        let panelTop = this._primaryMonitor.y + this._primaryMonitor.height - this._panelBox.height;

        return windowBottom >= panelTop;
    },

    _checkIfGrab: function() {
        if (GrabHelper._grabHelperStack.some(gh => this._panelBox.contains(gh._owner))) {
            //there currently is a grab on a child of the panel, check again soon to catch its release
            this._timeoutsHandler.add([T1, CHECK_GRAB_MS, () => this._queueUpdatePanelPosition()]);

            return true;
        }

        return false;
    },

    _adjustDynamicTransparency: function() {
        this._invokeIfExists(this._dtpPanel.panel._updateSolidStyle);
    },

    _revealPanel: function(immediate) {
        this._animatePanel(0, immediate, this._adjustDynamicTransparency);
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
