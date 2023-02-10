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

const Clutter = imports.gi.Clutter;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

var GrabHelper = imports.ui.grabHelper;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const PointerWatcher = imports.ui.pointerWatcher;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Panel = Me.imports.panel;
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
const T4 = 'panelBoxClipTimeout';

var SIDE_CONTROLS_ANIMATION_TIME = OverviewControls.SIDE_CONTROLS_ANIMATION_TIME / (OverviewControls.SIDE_CONTROLS_ANIMATION_TIME > 1 ? 1000 : 1);

var Hold = {
    NONE: 0,
    TEMPORARY: 1,
    PERMANENT: 2
};

var Intellihide = class {

    constructor(dtpPanel) {
        this._dtpPanel = dtpPanel;
        this._panelBox = dtpPanel.panelBox;
        this._panelManager = dtpPanel.panelManager;
        this._proximityManager = this._panelManager.proximityManager;
        this._holdStatus = Hold.NONE;
        
        this._signalsHandler = new Utils.GlobalSignalsHandler();
        this._timeoutsHandler = new Utils.TimeoutsHandler();

        this._intellihideChangedId = Me.settings.connect('changed::intellihide', () => this._changeEnabledStatus());
        this._intellihideOnlySecondaryChangedId = Me.settings.connect('changed::intellihide-only-secondary', () => this._changeEnabledStatus());

        this.enabled = false;
        this._changeEnabledStatus();
    }

    enable() {
        this.enabled = true;
        this._monitor = this._dtpPanel.monitor;
        this._animationDestination = -1;
        this._pendingUpdate = false;
        this._hoveredOut = false;
        this._windowOverlap = false;
        this._translationProp = 'translation_' + (this._dtpPanel.checkIfVertical() ? 'x' : 'y');

        this._panelBox.translation_y = 0;
        this._panelBox.translation_x = 0;

        this._setTrackPanel(true);
        this._bindGeneralSignals();

        if (Me.settings.get_boolean('intellihide-hide-from-windows')) {
            this._proximityWatchId = this._proximityManager.createWatch(
                this._panelBox.get_parent(),
                this._dtpPanel.monitor.index,
                Proximity.Mode[Me.settings.get_string('intellihide-behaviour')], 
                0, 0,
                overlap => { 
                    this._windowOverlap = overlap;
                    this._queueUpdatePanelPosition();
                }
            );
        }

        this._setRevealMechanism();
        this._queueUpdatePanelPosition();
    }

    disable(reset) {
        if (this._proximityWatchId) {
            this._proximityManager.removeWatch(this._proximityWatchId);
        }

        this._setTrackPanel(false);

        this._signalsHandler.destroy();
        this._timeoutsHandler.destroy();

        this._removeRevealMechanism();

        this._revealPanel(!reset);
        
        this.enabled = false;
    }

    destroy() {
        Me.settings.disconnect(this._intellihideChangedId);
        Me.settings.disconnect(this._intellihideOnlySecondaryChangedId);
        
        if (this.enabled) {
            this.disable();
        }
    }

    toggle() {
        this[this._holdStatus & Hold.PERMANENT ? 'release' : 'revealAndHold'](Hold.PERMANENT);
    }

    revealAndHold(holdStatus) {
        if (this.enabled && !this._holdStatus) {
            this._revealPanel();
        }
        
        this._holdStatus |= holdStatus;
    }

    release(holdStatus) {
        this._holdStatus -= holdStatus;

        if (this.enabled && !this._holdStatus) {
            this._queueUpdatePanelPosition();
        }
    }

    reset() {
        this.disable(true);
        this.enable();
    }

    _changeEnabledStatus() {
        let intellihide = Me.settings.get_boolean('intellihide');
        let onlySecondary = Me.settings.get_boolean('intellihide-only-secondary');
        let enabled = intellihide && !(this._dtpPanel.isPrimary && onlySecondary);

        if (this.enabled !== enabled) {
            this[enabled ? 'enable' : 'disable']();
        }
    }

    _bindGeneralSignals() {
        this._signalsHandler.add(
            [
                this._dtpPanel.taskbar,
                ['menu-closed', 'end-drag'],
                () => {
                    this._panelBox.sync_hover();
                    this._onHoverChanged();
                }
            ],
            [
                Me.settings, 
                [
                    'changed::intellihide-use-pressure',
                    'changed::intellihide-hide-from-windows',
                    'changed::intellihide-behaviour',
                    'changed::intellihide-pressure-threshold',
                    'changed::intellihide-pressure-time'
                ],
                () => this.reset()
            ],
            [
                this._panelBox,
                'notify::hover',
                () => this._onHoverChanged()
            ],
            [
                this._dtpPanel.taskbar.previewMenu,
                'open-state-changed',
                () => this._queueUpdatePanelPosition()
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

        if (Meta.is_wayland_compositor()) {
            this._signalsHandler.add([
                this._panelBox,
                'notify::visible', 
                () => Utils.setDisplayUnredirect(!this._panelBox.visible)
            ]);
        }
    }

    _onHoverChanged() {
        this._hoveredOut = !this._panelBox.hover;
        this._queueUpdatePanelPosition();
    }

    _setTrackPanel(enable) {
        let actorData = Utils.getTrackedActorData(this._panelBox)

        actorData.affectsStruts = !enable;
        actorData.trackFullscreen = !enable;

        this._panelBox.track_hover = enable;
        this._panelBox.reactive = enable;
        this._panelBox.visible = enable ? enable : this._panelBox.visible;
        
        Main.layoutManager._queueUpdateRegions();
    }

    _setRevealMechanism() {
        if (global.display.supports_extended_barriers() && Me.settings.get_boolean('intellihide-use-pressure')) {
            this._edgeBarrier = this._createBarrier();
            this._pressureBarrier = new Layout.PressureBarrier(
                Me.settings.get_int('intellihide-pressure-threshold'), 
                Me.settings.get_int('intellihide-pressure-time'), 
                Shell.ActionMode.NORMAL
            );
            this._pressureBarrier.addBarrier(this._edgeBarrier);
            this._signalsHandler.add([this._pressureBarrier, 'trigger', () => this._queueUpdatePanelPosition(true)]);
        } else {
            this._pointerWatch = PointerWatcher.getPointerWatcher()
                                               .addWatch(CHECK_POINTER_MS, (x, y) => this._checkMousePointer(x, y));
        }
    }

    _removeRevealMechanism() {
        if (this._pointerWatch) {
            PointerWatcher.getPointerWatcher()._removeWatch(this._pointerWatch);
        }

        if (this._pressureBarrier) {
            this._pressureBarrier.destroy();
            this._edgeBarrier.destroy();

            this._pressureBarrier = 0;
        }
    }

    _createBarrier() {
        let position = this._dtpPanel.geom.position;
        let opts = { display: global.display };

        if (this._dtpPanel.checkIfVertical()) {
            opts.y1 = this._monitor.y;
            opts.y2 = this._monitor.y + this._monitor.height;
            opts.x1 = opts.x2 = this._monitor.x;
        } else {
            opts.x1 = this._monitor.x;
            opts.x2 = this._monitor.x + this._monitor.width;
            opts.y1 = opts.y2 = this._monitor.y;
        }

        if (position == St.Side.TOP) {
            opts.directions = Meta.BarrierDirection.POSITIVE_Y;
        } else if (position == St.Side.BOTTOM) {
            opts.y1 = opts.y2 = opts.y1 + this._monitor.height;
            opts.directions = Meta.BarrierDirection.NEGATIVE_Y;
        } else if (position == St.Side.LEFT) {
            opts.directions = Meta.BarrierDirection.POSITIVE_X;
        } else {
            opts.x1 = opts.x2 = opts.x1 + this._monitor.width;
            opts.directions = Meta.BarrierDirection.NEGATIVE_X;
        }

        return new Meta.Barrier(opts);
    }

    _checkMousePointer(x, y) {
        let position = this._dtpPanel.geom.position;

        if (!this._panelBox.hover && !Main.overview.visible &&
            ((position == St.Side.TOP && y <= this._monitor.y + 1) || 
             (position == St.Side.BOTTOM && y >= this._monitor.y + this._monitor.height - 1) ||
             (position == St.Side.LEFT && x <= this._monitor.x + 1) ||
             (position == St.Side.RIGHT && x >= this._monitor.x + this._monitor.width - 1)) &&
            ((x >= this._monitor.x && x < this._monitor.x + this._monitor.width) && 
             (y >= this._monitor.y && y < this._monitor.y + this._monitor.height))) {
            this._queueUpdatePanelPosition(true);
        }
    }

    _queueUpdatePanelPosition(fromRevealMechanism) {
        if (!fromRevealMechanism && this._timeoutsHandler.getId(T2) && !Main.overview.visible) {
            //unless this is a mouse interaction or entering/leaving the overview, limit the number
            //of updates, but remember to update again when the limit timeout is reached
            this._pendingUpdate = true;
        } else if (!this._holdStatus) {
            this._checkIfShouldBeVisible(fromRevealMechanism) ? this._revealPanel() : this._hidePanel();
            this._timeoutsHandler.add([T2, MIN_UPDATE_MS, () => this._endLimitUpdate()]);
        }
    }

    _endLimitUpdate() {
        if (this._pendingUpdate) {
            this._pendingUpdate = false;
            this._queueUpdatePanelPosition();
        }
    }

    _checkIfShouldBeVisible(fromRevealMechanism) {
        if (Main.overview.visibleTarget || this._dtpPanel.taskbar.previewMenu.opened || 
            this._dtpPanel.taskbar._dragMonitor || this._panelBox.get_hover() || this._checkIfGrab()) {
            return true;
        }

        if (fromRevealMechanism) {
            let mouseBtnIsPressed = global.get_pointer()[2] & Clutter.ModifierType.BUTTON1_MASK;
            
            //the user is trying to reveal the panel
            if (this._monitor.inFullscreen && !mouseBtnIsPressed) {
                return Me.settings.get_boolean('intellihide-show-in-fullscreen');
            }

            return !mouseBtnIsPressed;
        }

        if (!Me.settings.get_boolean('intellihide-hide-from-windows')) {
            return this._panelBox.hover;
        }

        return !this._windowOverlap;
    }

    _checkIfGrab() {
        let isGrab 
        
        if (GrabHelper._grabHelperStack)
            // gnome-shell < 42
            isGrab = GrabHelper._grabHelperStack.some(gh => gh._owner == this._dtpPanel.panel)
        else if (global.stage.get_grab_actor) {
            // gnome-shell >= 42
            let grabActor = global.stage.get_grab_actor()
            let sourceActor = grabActor?._sourceActor || grabActor

            isGrab = sourceActor && 
                     (sourceActor == Main.layoutManager.dummyCursor || 
                      this._dtpPanel.statusArea.quickSettings?.menu.actor.contains(sourceActor) || 
                      this._dtpPanel.panel.contains(sourceActor))
        }

        if (isGrab)
            //there currently is a grab on a child of the panel, check again soon to catch its release
            this._timeoutsHandler.add([T1, CHECK_GRAB_MS, () => this._queueUpdatePanelPosition()]);

        return isGrab;
    }

    _revealPanel(immediate) {
        if (!this._panelBox.visible) {
            this._panelBox.visible = true;
            this._dtpPanel.taskbar._shownInitially = false;
        }

        this._animatePanel(0, immediate);
    }

    _hidePanel(immediate) {
        let position = this._dtpPanel.geom.position;
        let size = this._panelBox[position == St.Side.LEFT || position == St.Side.RIGHT ? 'width' : 'height']; 
        let coefficient = position == St.Side.TOP || position == St.Side.LEFT ? -1 : 1;

        this._animatePanel(size * coefficient, immediate);
    }

    _animatePanel(destination, immediate) {
        let animating = Utils.isAnimating(this._panelBox, this._translationProp);

        if (!((animating && destination === this._animationDestination) || 
              (!animating && destination === this._panelBox[this._translationProp]))) {
            //the panel isn't already at, or animating to the asked destination
            if (animating) {
                Utils.stopAnimations(this._panelBox);
            }

            this._animationDestination = destination;

            if (immediate) {
                this._panelBox[this._translationProp] = destination;
                this._panelBox.visible = !destination;
            } else {
                let tweenOpts = {
                    //when entering/leaving the overview, use its animation time instead of the one from the settings
                    time: Main.overview.visible ? 
                          SIDE_CONTROLS_ANIMATION_TIME :
                          Me.settings.get_int('intellihide-animation-time') * 0.001,
                    //only delay the animation when hiding the panel after the user hovered out
                    delay: destination != 0 && this._hoveredOut ? Me.settings.get_int('intellihide-close-delay') * 0.001 : 0,
                    transition: 'easeOutQuad',
                    onComplete: () => {
                        this._panelBox.visible = !destination;
                        Main.layoutManager._queueUpdateRegions();
                        this._timeoutsHandler.add([T3, POST_ANIMATE_MS, () => this._queueUpdatePanelPosition()]);
                    }
                };

                tweenOpts[this._translationProp] = destination;
                Utils.animate(this._panelBox, tweenOpts);
            }
        }

        this._hoveredOut = false;
    }
}