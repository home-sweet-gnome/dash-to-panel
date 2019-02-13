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
 *
 * Credits:
 * This file is based on code from the Dash to Dock extension by micheleg
 * and code from the Taskbar extension by Zorin OS
 * Some code was also adapted from the upstream Gnome Shell source code.
 */


const BoxPointer = imports.ui.boxpointer;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const PopupMenu = imports.ui.popupMenu;
const Signals = imports.signals;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;
const WindowMenu = imports.ui.windowMenu;
const Workspace = imports.ui.workspace;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Taskbar = Me.imports.taskbar;
const AppIcons = Me.imports.appIcons;
const Utils = Me.imports.utils;

let HOVER_APP_BLACKLIST = [
                           "Oracle VM VirtualBox",
                           "Virtual Machine Manager",
                           "Remmina"
                          ]

var thumbnailPreviewMenu = Utils.defineClass({
    Name: 'DashToPanel.ThumbnailPreviewMenu',
    Extends: PopupMenu.PopupMenu,
    ParentConstrParams: [[0, 'actor'], 0.5, Taskbar.getPosition()],

    _init: function(source, settings) {
        this._dtpSettings = settings;

        let side = Taskbar.getPosition();

        this.callParent('_init', source.actor, 0.5, side);

        // We want to keep the item hovered while the menu is up
        this.blockSourceEvents = false;

        this._source = source;
        this._app = this._source.app;

        this.actor.add_style_class_name('app-well-menu');
        this.actor.set_style("max-width: " + (this._source.panelWrapper.monitor.width - 22) + "px;");
        this.actor.hide();

        // Chain our visibility and lifecycle to that of the source
        this._mappedId = this._source.actor.connect('notify::mapped', Lang.bind(this, function () {
            if (!this._source.actor.mapped)
                this.close();
        }));
        this._destroyId = this._source.actor.connect('destroy', Lang.bind(this, this.destroy));

        Main.uiGroup.add_actor(this.actor);

        // Change the initialized side where required.
        this._arrowSide = side;
        this._boxPointer._arrowSide = side;
        this._boxPointer._userArrowSide = side;

        this._previewBox = new thumbnailPreviewList(this._app, source, this._dtpSettings);
        this.addMenuItem(this._previewBox);

        this._peekMode = false;
        this._peekModeEnterTimeoutId = 0;
        this._peekModeDisableTimeoutId = 0;
        this._DISABLE_PEEK_MODE_TIMEOUT = 50;
        this._peekedWindow = null;
        this._peekModeSavedWorkspaces = null;
        this._peekModeSavedOrder = null;
        this._trackOpenWindowsId = null;
        this._trackClosedWindowsIds = null;
        this._peekModeOriginalWorkspace = null;
        this._peekModeCurrentWorkspace = null;
    },

    enableWindowPreview: function() {
        // Show window previews on mouse hover
        this._enterSourceId = this._source.actor.connect('enter-event', Lang.bind(this, this._onEnter));
        this._leaveSourceId = this._source.actor.connect('leave-event', Lang.bind(this, this._onLeave));

        this._enterMenuId = this.actor.connect('enter-event', Lang.bind(this, this._onMenuEnter));
        this._leaveMenuId = this.actor.connect('leave-event', Lang.bind(this, this._onMenuLeave));
    },

    disableWindowPreview: function() {
        if (this._enterSourceId) {
            this._source.actor.disconnect(this._enterSourceId);
            this._enterSourceId = 0;
        }
        if (this._leaveSourceId) {
            this._source.actor.disconnect(this._leaveSourceId);
            this._leaveSourceId = 0;
        }

        if (this._enterMenuId) {
            this.actor.disconnect(this._enterMenuId);
            this._enterMenuId = 0;
        }
        if (this._leaveMenuId) {
            this.actor.disconnect(this._leaveMenuId);
            this._leaveMenuId = 0;
        }

        this.close();
    },

    requestCloseMenu: function() {
    	// The "~0" argument makes the animation display.
        this.close(~0);
    },

    _redisplay: function() {
        this._previewBox._shownInitially = false;
        this._previewBox._redisplay();
    },

    popup: function() {
        let windows = AppIcons.getInterestingWindows(this._app, this._dtpSettings, this._source.panelWrapper.monitor);
        if (windows.length > 0) {
            this._redisplay();
            this.open();
            this._source.emit('sync-tooltip');
        }
    },

    _onMenuEnter: function () {
        this.cancelClose();

        this.hoverOpen();
    },

    _onMenuLeave: function () {
        this.cancelOpen();
        this.cancelClose();

        this._hoverCloseTimeoutId = Mainloop.timeout_add(Taskbar.DASH_ITEM_HOVER_TIMEOUT, Lang.bind(this, this.hoverClose));
    },

    _onEnter: function () {
        this.cancelOpen();
        this.cancelClose();

        this._hoverOpenTimeoutId = Mainloop.timeout_add(this._dtpSettings.get_int('show-window-previews-timeout'), Lang.bind(this, this.hoverOpen));
    },

    _onLeave: function () {
        this.cancelOpen();
        this.cancelClose();

        // grabHelper.grab() is usually called when the menu is opened. However, there seems to be a bug in the 
        // underlying gnome-shell that causes all window contents to freeze if the grab and ungrab occur
        // in quick succession in timeouts from the Mainloop (for example, clicking the icon as the preview window is opening)
        // So, instead wait until the mouse is leaving the icon (and might be moving toward the open window) to trigger the grab
        if(this.isOpen)
            this._source.menuManagerWindowPreview._grabHelper.grab({ actor: this.actor, focus: this.sourceActor, 
                                                                    onUngrab: Lang.bind(this, this.requestCloseMenu) });

        this._hoverCloseTimeoutId = Mainloop.timeout_add(this._dtpSettings.get_int('leave-timeout'), Lang.bind(this, this.hoverClose));
    },

    cancelOpen: function () {
        if(this._hoverOpenTimeoutId) {
            Mainloop.source_remove(this._hoverOpenTimeoutId);
            this._hoverOpenTimeoutId = null;
        }
    },

    cancelClose: function () {
        if(this._hoverCloseTimeoutId) {
            Mainloop.source_remove(this._hoverCloseTimeoutId);
            this._hoverCloseTimeoutId = null;
        }
    },
	
    _appInHoverBlacklist: function (appName) {
        for (let i = 0; i < HOVER_APP_BLACKLIST.length; i++) {
            if (appName === HOVER_APP_BLACKLIST[i])
                return true;
        }
        
        return false;
    },

    hoverOpen: function () {
        this._hoverOpenTimeoutId = null;
        if (!this.isOpen && this._dtpSettings.get_boolean("show-window-previews")) {
            this.popup();          
            let focusedApp = Shell.WindowTracker.get_default().focus_app;
            if (focusedApp && this._appInHoverBlacklist(focusedApp.get_name())) {
		this.actor.grab_key_focus();
            }
        }
    },

    hoverClose: function () {
        this._hoverCloseTimeoutId = null;
        this.close(~0);
    },

    destroy: function () {
        this.cancelClose();
        this.cancelOpen();
        
        if (this._mappedId)
            this._source.actor.disconnect(this._mappedId);

        if (this._destroyId)
            this._source.actor.disconnect(this._destroyId);

        if (this._enterSourceId)
            this._source.actor.disconnect(this._enterSourceId);
        if (this._leaveSourceId)
            this._source.actor.disconnect(this._leaveSourceId);

        if (this._enterMenuId)
            this.actor.disconnect(this._enterMenuId);
        if (this._leaveMenuId)
            this.actor.disconnect(this._leaveMenuId);

        this.callParent('destroy');
    },

    close: function(animate) {
        this.cancelOpen();
        
        if (this.isOpen)
            this.emit('open-state-changed', false);
        if (this._activeMenuItem)
            this._activeMenuItem.setActive(false);

        if (this._boxPointer.actor.visible) {
            (this._boxPointer.close || this._boxPointer.hide).call(this._boxPointer, animate, Lang.bind(this, function() {
                this.emit('menu-closed', this);
            }));
        }

        if(this._peekMode)
            this._disablePeekMode();

        this.isOpen = false;
    },

    _emulateSwitchingWorkspaces: function(oldWorkspace, newWorkspace) {
        if(oldWorkspace == newWorkspace)
            return;

        oldWorkspace.list_windows().forEach(Lang.bind(this, function(window) {
            if(!window.is_on_all_workspaces() && !window.minimized) {
                let windowActor = window.get_compositor_private();
                Tweener.addTween(windowActor, {
                    opacity: 0,
                    time: Taskbar.DASH_ANIMATION_TIME,
                    transition: 'easeOutQuad',
                    onComplete: Lang.bind(this, function(windowActor) {
                        windowActor.hide();
                        windowActor.opacity = this._dtpSettings.get_int('peek-mode-opacity');
                    }),
                    onCompleteParams: [windowActor]
                });
            }
        }));
        newWorkspace.list_windows().forEach(Lang.bind(this, function(window) {
            if(!window.is_on_all_workspaces() && !window.minimized) {
                let windowActor = window.get_compositor_private();
                windowActor.show();
                windowActor.opacity = 0;
                Tweener.addTween(windowActor, {
                    opacity: this._dtpSettings.get_int('peek-mode-opacity'),
                    time: Taskbar.DASH_ANIMATION_TIME,
                    transition: 'easeOutQuad'
                });
            }
        }));

        this._peekModeCurrentWorkspace = newWorkspace;
    },

    _disablePeekMode: function() {
        if(this._peekModeDisableTimeoutId) {
            Mainloop.source_remove(this._peekModeDisableTimeoutId);
            this._peekModeDisableTimeoutId = null;
        }
        //Restore windows' old state
        if(this._peekedWindow) {
            let peekedWindowActor = this._peekedWindow.get_compositor_private();
            let originalIndex = this._peekModeSavedOrder.indexOf(peekedWindowActor);

            let locatedOnOriginalWorkspace = this._peekModeCurrentWorkspace == this._peekModeOriginalWorkspace;
            if(!locatedOnOriginalWorkspace)
                this._emulateSwitchingWorkspaces(this._peekModeCurrentWorkspace, this._peekModeOriginalWorkspace);

            if(peekedWindowActor)
                global.window_group.set_child_at_index(peekedWindowActor, originalIndex);
        }

        this._peekModeSavedWorkspaces.forEach(Lang.bind(this, function(workspace) {
            workspace.forEach(Lang.bind(this, function(pairWindowOpacity) {
                let window = pairWindowOpacity[0];
                let initialOpacity = pairWindowOpacity[1];
                let windowActor = window.get_compositor_private();
                if(window && windowActor) {
                    if(window.minimized || !window.located_on_workspace(this._peekModeOriginalWorkspace))
                        Tweener.addTween(windowActor, {
                            opacity: 0,
                            time: Taskbar.DASH_ANIMATION_TIME,
                            transition: 'easeOutQuad',
                            onComplete: Lang.bind(windowActor, function() {
                                windowActor.hide();
                                windowActor.opacity = initialOpacity;
                            })
                        });
                    else
                        Tweener.addTween(windowActor, {
                            opacity: initialOpacity,
                            time: Taskbar.DASH_ANIMATION_TIME,
                            transition: 'easeOutQuad'
                        });
                }
            }));
        }));
        this._peekModeSavedWorkspaces = null;
        this._peekedWindow = null;
        this._peekModeSavedOrder = null;
        this._peekModeCurrentWorkspace = null;
        this._peekModeOriginalWorkspace = null;

        this._trackClosedWindowsIds.forEach(function(pairWindowSignalId) {
            if(pairWindowSignalId)
                pairWindowSignalId[0].disconnect(pairWindowSignalId[1]);
        });
        this._trackClosedWindowsIds = null;

        if(this._trackOpenWindowsId) {
            global.display.disconnect(this._trackOpenWindowsId);
            this._trackOpenWindowsId = null;
        }

        this._peekMode = false;
    },

    _setPeekedWindow: function(newPeekedWindow) {
        if(this._peekedWindow == newPeekedWindow)
            return;
        
        //We don't need to bother with animating the workspace out and then in if the old peeked workspace is the same as the new one
        let needToChangeWorkspace = !newPeekedWindow.located_on_workspace(this._peekModeCurrentWorkspace) || (newPeekedWindow.is_on_all_workspaces() && this._peekModeCurrentWorkspace != this._peekModeOriginalWorkspace);
        if(needToChangeWorkspace) {
            //If the new peeked window is on every workspace, we get the original one
            //Otherwise, we get the workspace the window is exclusive to
            let newWorkspace = newPeekedWindow.get_workspace();
            this._emulateSwitchingWorkspaces(this._peekModeCurrentWorkspace, newWorkspace);
        }

        //Hide currently peeked window and show the new one
        if(this._peekedWindow) {
            let peekedWindowActor = this._peekedWindow.get_compositor_private();
            let originalIndex = this._peekModeSavedOrder.indexOf(peekedWindowActor);

            global.window_group.set_child_at_index(peekedWindowActor, originalIndex);
            if(this._peekedWindow.minimized || (needToChangeWorkspace && !this._peekedWindow.is_on_all_workspaces()))
                Tweener.addTween(peekedWindowActor, {
                    opacity: 0,
                    time: Taskbar.DASH_ANIMATION_TIME,
                    transition: 'easeOutQuad',
                    onComplete: Lang.bind(this, function(peekedWindowActor) {
                        peekedWindowActor.hide();
                        peekedWindowActor.opacity = this._dtpSettings.get_int('peek-mode-opacity');
                    }),
                    onCompleteParams: [peekedWindowActor]
                });
            else
                Tweener.addTween(peekedWindowActor, {
                    opacity: this._dtpSettings.get_int('peek-mode-opacity'),
                    time: Taskbar.DASH_ANIMATION_TIME,
                    transition: 'easeOutQuad'
                });
        }

        this._peekedWindow = newPeekedWindow;
        let peekedWindowActor = this._peekedWindow.get_compositor_private();     

        if(this._peekedWindow.minimized) {
            peekedWindowActor.opacity = 0;
            peekedWindowActor.show();
        }

        global.window_group.set_child_above_sibling(peekedWindowActor, null);
        Tweener.addTween(peekedWindowActor, {
            opacity: 255,
            time: Taskbar.DASH_ANIMATION_TIME,
            transition: 'easeOutQuad'
        });      
    },

    _enterPeekMode: function(thumbnail) {
        let workspaceManager = Utils.DisplayWrapper.getWorkspaceManager();

        this._peekMode = true;
        //Remove the enter peek mode timeout
        if(this._peekModeEnterTimeoutId) {
            Mainloop.source_remove(this._peekModeEnterTimeoutId);
            this._peekModeEnterTimeoutId = null;
        }

        //Save the visible windows in each workspace and lower their opacity
	    this._peekModeSavedWorkspaces = [];
        this._peekModeOriginalWorkspace = workspaceManager.get_active_workspace();
	    this._peekModeCurrentWorkspace = this._peekModeOriginalWorkspace;
        
        for ( let wks=0; wks<workspaceManager.n_workspaces; ++wks ) {
            // construct a list with all windows
            let metaWorkspace = workspaceManager.get_workspace_by_index(wks);
            let windows = metaWorkspace.list_windows(); 
            this._peekModeSavedWorkspaces.push([]);
            windows.forEach(Lang.bind(this, function(window) {
                let actor = window.get_compositor_private();
                let initialOpacity = actor.opacity;
                Tweener.addTween(actor, {
                    opacity: this._dtpSettings.get_int('peek-mode-opacity'),
                    time: Taskbar.DASH_ANIMATION_TIME,
                    transition: 'easeOutQuad'
                });
                this._peekModeSavedWorkspaces[wks].push([window, initialOpacity]);
            }));
        }

        //Save the order of the windows in the window group
        //From my observation first comes the Meta.BackgroundGroup
        //Then come the Meta.WindowActors in the order of stacking:
        //first come the minimized windows, then the unminimized
        //Additionaly, if you tile a window left/right with <Super + Left/Right>,
        //there might appear St.Widget of type "tile preview" that is on top of the stack
        this._peekModeSavedOrder = global.window_group.get_children().slice();

        //Track closed windows - pairs (window, signal Id), null for backgrounds
        this._trackClosedWindowsIds = this._peekModeSavedOrder.map(Lang.bind(this, function(windowActor) {
            if(!(windowActor instanceof Meta.BackgroundGroup) && !(windowActor instanceof St.Widget))
                return [windowActor.meta_window, 
                        windowActor.meta_window.connect('unmanaged', Lang.bind(this, this._peekModeWindowClosed))];
           else 
                return null;
        }));

        //Track newly opened windows
        if(this._trackOpenWindowsId)
            global.display.disconnect(this._trackOpenWindowsId);
        this._trackOpenWindowsId = global.display.connect('window-created', Lang.bind(this, this._peekModeWindowOpened));

        //Having lowered opacity of all the windows, show the peeked window
        this._setPeekedWindow(thumbnail.window);
    },

    _peekModeWindowClosed: function(window) {
        if(this._peekMode && window == this._peekedWindow)
            this._disablePeekMode();
    },

    _windowOnTop: function(window) {
        //There can be St.Widgets "tile-preview" on top of the window stack.
        //The window is on top if there are no other window actors above it (Except for St.Widgets)
        let windowStack = global.window_group.get_children();
        let newWindowIndex = windowStack.indexOf(window.get_compositor_private());
        
        for(let index = newWindowIndex + 1; index < windowStack.length; ++index) {
            if(windowStack[index] instanceof Meta.WindowActor || windowStack[index] instanceof Meta.BackgroundGroup)
                return false;
        }
        return true;
    },

    _peekModeWindowOpened: function(display, window) {
        this._disablePeekMode();
        //If this new window is placed on the top then close the preview
        if(this._windowOnTop(window))
            this.requestCloseMenu();
    }
});

var thumbnailPreview = Utils.defineClass({
    Name: 'DashToPanel.ThumbnailPreview',
    Extends: PopupMenu.PopupBaseMenuItem,
    ParentConstrParams: [{ reactive: true }],

    _init: function(window, settings) {
        this._dtpSettings = settings;
        this.window = window;

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        if(!scaleFactor)
            scaleFactor = 1;

        this._thumbnailWidth = this._dtpSettings.get_int('window-preview-width')*scaleFactor;
        this._thumbnailHeight = this._dtpSettings.get_int('window-preview-height')*scaleFactor;

        this.callParent('_init', {reactive: true});

        this._workId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._onResize));

        this.preview = this.getThumbnail();

        this.actor.remove_child(this._ornamentLabel);
        this.actor._delegate = this;

        this.actor.set_style('padding: ' + this._dtpSettings.get_int('window-preview-padding') + 'px;');

        this.animatingOut = false;

        this._windowBox = new St.BoxLayout({ style_class: 'window-box',
                                             x_expand: true,
                                             vertical: true });

        this._closeButton = new St.Button({ style_class: 'window-close', accessible_name: "Close window" });
        this._closeButton.opacity = 0;
        this._closeButton.connect('clicked', Lang.bind(this, this._closeWindow));
        this._closeButton.connect('style-changed', () => this._isLeftButtons = null);

        this._previewBin = new Clutter.Actor({ width: this._thumbnailWidth, height: this._thumbnailHeight });

        if (this.preview)
            this._previewBin.add_actor(this.preview);

        this._previewBin.add_actor(this._closeButton);

        this.overlayGroup = new Clutter.Actor({ layout_manager: new Clutter.BinLayout()});
        this.overlayGroup.add_actor(this._previewBin);

        this._titleNotifyId = 0;

        this._windowBin = new St.Bin({
            child: this.overlayGroup,
            x_align: St.Align.MIDDLE,
            width: this._thumbnailWidth,
            height: this._thumbnailHeight
        });

        this._windowBox.add_child(this._windowBin);

        if (this._dtpSettings.get_boolean('window-preview-show-title')) {
            this._title = new St.Label({ text: window.title });
            this._titleBin = new St.Bin({ child: this._title,
                                        x_align: St.Align.MIDDLE,
                                        width: this._thumbnailWidth
                                      });
            this._titleBin.add_style_class_name("preview-window-title");

            this._windowBox.add_child(this._titleBin);
    
            this._titleNotifyId = this.window.connect('notify::title', Lang.bind(this, function() {
                                                        this._title.set_text(this.window.title);
                                                    }));
        }
        
        this.actor.add_child(this._windowBox);

        this.actor.connect('enter-event',
                                  Lang.bind(this, this._onEnter));
        this.actor.connect('leave-event',
                                  Lang.bind(this, this._onLeave));
        this.actor.connect('key-focus-in',
                                  Lang.bind(this, this._onEnter));
        this.actor.connect('key-focus-out',
                                  Lang.bind(this, this._onLeave));
        this.actor.connect('motion-event',
                                  Lang.bind(this, this._onMotionEvent));

        this._previewMenuPopupManager = new previewMenuPopupManager(window, this.actor);
    },

    _onEnter: function(actor, event) {
        this._repositionCloseButton();
        this._showCloseButton();

        let topMenu = this._getTopMenu();
        if(topMenu._dtpSettings.get_boolean('peek-mode')) {
            if(topMenu._peekMode) {
                if(topMenu._peekModeDisableTimeoutId) {
                    Mainloop.source_remove(topMenu._peekModeDisableTimeoutId);
                    topMenu._peekModeDisableTimeoutId = null;
                }
                //Hide the old peeked window and show the window in preview
                topMenu._setPeekedWindow(this.window);
            } else if(!this.animatingOut) {
                //Remove old timeout and set a new one
                if(topMenu._peekModeEnterTimeoutId)
                    Mainloop.source_remove(topMenu._peekModeEnterTimeoutId);
                topMenu._peekModeEnterTimeoutId = Mainloop.timeout_add(topMenu._dtpSettings.get_int('enter-peek-mode-timeout'), Lang.bind(this, function() {
                    topMenu._enterPeekMode(this);
                })); 
            }
        }

        return Clutter.EVENT_PROPAGATE;
    },

    _onLeave: function(actor, event) {
        if (!this._previewBin.has_pointer &&
            !this._closeButton.has_pointer)
            this._hideCloseButton();

        let topMenu = this._getTopMenu();
        if(topMenu._peekMode) {
            if(topMenu._peekModeDisableTimeoutId){
                Mainloop.source_remove(topMenu._peekModeDisableTimeoutId);
                topMenu._peekModeDisableTimeoutId = null;
            }
            topMenu._peekModeDisableTimeoutId = Mainloop.timeout_add(topMenu._DISABLE_PEEK_MODE_TIMEOUT, function() {
                topMenu._disablePeekMode()
            });
        }
        if(topMenu._peekModeEnterTimeoutId) {
            Mainloop.source_remove(topMenu._peekModeEnterTimeoutId);
            topMenu._peekModeEnterTimeoutId = null;
        }

        return Clutter.EVENT_PROPAGATE;
    },

    _idleToggleCloseButton: function() {
        this._idleToggleCloseId = 0;

        if (!this._previewBin.has_pointer &&
            !this._closeButton.has_pointer)
            this._hideCloseButton();

        return GLib.SOURCE_REMOVE;
    },

    _showCloseButton: function() {
        if (this._windowCanClose()) {
            this._closeButton.show();
            Tweener.addTween(this._closeButton,
                             { opacity: 255,
                               time: Workspace.CLOSE_BUTTON_FADE_TIME,
                               transition: 'easeOutQuad' });
        }
    },

    _windowCanClose: function() {
        return this.window.can_close() &&
               !this._hasAttachedDialogs();
    },

    _hasAttachedDialogs: function() {
        // count trasient windows
        let n = 0;
        this.window.foreach_transient(function() {n++;});
        return n > 0;
    },

    _hideCloseButton: function() {
        Tweener.addTween(this._closeButton,
                         { opacity: 0,
                           time: Workspace.CLOSE_BUTTON_FADE_TIME,
                           transition: 'easeInQuad' });
    },

    getThumbnail: function() {
        let thumbnail = null;
        let mutterWindow = this.window.get_compositor_private();
        if (mutterWindow) {
            thumbnail = new Clutter.Clone ({ source: mutterWindow.get_texture(), reactive: true });
            this._resizePreview(thumbnail);

            this._resizeId = mutterWindow.meta_window.connect('size-changed',
                                            Lang.bind(this, this._queueResize));
                                            
            this._destroyId = mutterWindow.connect('destroy', () => this.animateOutAndDestroy());
        }

        return thumbnail;
    },

    _queueResize: function () {
        Main.queueDeferredWork(this._workId);
    },

    _resizePreview: function(preview) {
        let [width, height] = preview.get_source().get_size();
        let scale = Math.min(this._thumbnailWidth / width, this._thumbnailHeight / height);

        preview.set_size(width * scale, height * scale);
        preview.set_position((this._thumbnailWidth - preview.width) * .5, (this._thumbnailHeight - preview.height) * .5);
    },

    _onResize: function() {
        if (!this.preview) {
            return;
        }
        
        this._resizePreview(this.preview);
    },

    _repositionCloseButton: function() {
        let isLeftButtons = Meta.prefs_get_button_layout().left_buttons.indexOf(Meta.ButtonFunction.CLOSE) >= 0;
        
        if (this._isLeftButtons !== isLeftButtons) {
            let padding = this._dtpSettings.get_int('window-preview-padding');
            let halfButton = this._closeButton.width * .5; //button is a square
            let xInset = 4;
            let buttonX;

            if (isLeftButtons) {
                buttonX = Math.max(this.preview.x - halfButton + xInset, -padding);
            } else {
                buttonX = this.preview.x + this.preview.width - halfButton - Math.max(xInset, halfButton - this.preview.x - padding);
            }

            this._closeButton.set_position(buttonX, Math.max(this.preview.y - halfButton, -padding));
            this._isLeftButtons = isLeftButtons;
        }
    },

    _closeWindow: function() {
        let topMenu = this._getTopMenu();
        if(topMenu._peekModeEnterTimeoutId) {
            Mainloop.source_remove(topMenu._peekModeEnterTimeoutId);
            topMenu._peekModeEnterTimeoutId = null;
        }
        
        this.window.delete(global.get_current_time());
    },

    show: function(animate) {
        let fullWidth = this.actor.get_width();

        this.actor.opacity = 0;
        this.actor.set_width(0);

        let time = animate ? Taskbar.DASH_ANIMATION_TIME : 0;
        Tweener.addTween(this.actor,
                         { opacity: 255,
                           width: fullWidth,
                           time: time,
                           transition: 'easeInOutQuad'
                         });
    },

    animateOutAndDestroy: function() {
        if (!this.animatingOut) {
            this.animatingOut = true;
            this._hideCloseButton();
            Tweener.addTween(this.actor,
                             {  width: 0,
                                opacity: 0,
                                time: Taskbar.DASH_ANIMATION_TIME,
                                transition: 'easeOutQuad',
                                onComplete: Lang.bind(this, function() {
                                    this.destroy();
                                })
                             });
        }
    },

    activate: function() {
        let topMenu = this._getTopMenu();

        if(topMenu._dtpSettings.get_boolean('peek-mode')) {
            if(topMenu._peekMode) {
                topMenu._disablePeekMode();
            }
            else if(topMenu._peekModeEnterTimeoutId) {
                Mainloop.source_remove(topMenu._peekModeEnterTimeoutId);
                topMenu._peekModeEnterTimeoutId = null;
            }
        }

        Main.activateWindow(this.window);

        topMenu.close(~0);
    },

    _onMotionEvent: function() {
        //If in normal mode, then set new timeout for entering peek mode after removing the old one
        let topMenu = this._getTopMenu();
        if(topMenu._dtpSettings.get_boolean('peek-mode')) {
            if(!topMenu._peekMode && !this.animatingOut) {
                if(topMenu._peekModeEnterTimeoutId)
                    Mainloop.source_remove(topMenu._peekModeEnterTimeoutId);
                topMenu._peekModeEnterTimeoutId = Mainloop.timeout_add(topMenu._dtpSettings.get_int('enter-peek-mode-timeout'), Lang.bind(this, function() {
                    topMenu._enterPeekMode(this);
                }));
            }
        }
    },

    _onButtonReleaseEvent: function(actor, event) {
        this.actor.remove_style_pseudo_class ('active');
        switch (event.get_button()) {
            case 1:
                // Left click
                this.activate(event);
                break;
            case 2:
                // Middle click
                if (this._dtpSettings.get_boolean('preview-middle-click-close')) {
                    this._closeWindow();
                }
                break;
            case 3:
                // Right click
                this.showContextMenu(event);
                break;
        }
        return Clutter.EVENT_STOP;
    },

    showContextMenu: function(event) {
        let coords = event.get_coords();
        this._previewMenuPopupManager.showWindowMenuForWindow({
            x: coords[0],
            y: coords[1],
            width: 0,
            height: 0
        });
    },

    destroy: function() {
        if (this._titleNotifyId) {
            this.window.disconnect(this._titleNotifyId);
            this._titleNotifyId = 0;
        }

        let mutterWindow = this.window.get_compositor_private();

        if (mutterWindow) {
            if(this._resizeId) {
                mutterWindow.meta_window.disconnect(this._resizeId);
            }

            if(this._destroyId) {
                mutterWindow.disconnect(this._destroyId);
            }
        }

        this.callParent('destroy');
    }
});

var thumbnailPreviewList = Utils.defineClass({
    Name: 'DashToPanel.ThumbnailPreviewList',
    Extends: PopupMenu.PopupMenuSection,

    _init: function(app, source, settings) {
        this._dtpSettings = settings;

        this.callParent('_init');

        this._ensurePreviewVisibilityTimeoutId = 0;

        this.actor = new St.ScrollView({ name: 'dashtopanelThumbnailScrollview',
                                               hscrollbar_policy: Gtk.PolicyType.NEVER,
                                               vscrollbar_policy: Gtk.PolicyType.NEVER,
                                               enable_mouse_scrolling: true });

        this.actor.connect('scroll-event', Lang.bind(this, this._onScrollEvent ));

        this.box.set_vertical(false);
        this.box.set_name("dashtopanelThumbnailList");
        this.actor.add_actor(this.box);
        this.actor._delegate = this;

        this._shownInitially = false;

        this.app = app;
        this._source = source;

        this._redisplayId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._redisplay));
        this._scrollbarId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._showHideScrollbar));

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._dtpSettingsSignalIds = [
            this._dtpSettings.connect('changed::window-preview-width', () => this._resetPreviews()),
            this._dtpSettings.connect('changed::window-preview-height', () => this._resetPreviews()),
            this._dtpSettings.connect('changed::window-preview-show-title', () => this._resetPreviews()),
            this._dtpSettings.connect('changed::window-preview-padding', () => this._resetPreviews())
        ];

        this._stateChangedId = this._source.window ? 0 : 
                               this.app.connect('windows-changed', Lang.bind(this, this._queueRedisplay));
    },

    _needsScrollbar: function() {
        let topMenu = this._getTopMenu();
        let [topMinWidth, topNaturalWidth] = topMenu.actor.get_preferred_width(-1);
        let topThemeNode = topMenu.actor.get_theme_node();

        let topMaxWidth = topThemeNode.get_max_width();
        return topMaxWidth >= 0 && topNaturalWidth >= topMaxWidth;
    },

    _showHideScrollbar: function() {
        let needsScrollbar = this._needsScrollbar();

        // St.ScrollView always requests space vertically for a possible horizontal
        // scrollbar if in AUTOMATIC mode. This looks bad when we *don't* need it,
        // so turn off the scrollbar when that's true. Dynamic changes in whether
        // we need it aren't handled properly.

        this.actor.hscrollbar_policy =
            needsScrollbar ? Gtk.PolicyType.AUTOMATIC : Gtk.PolicyType.NEVER;

        if (needsScrollbar)
            this.actor.add_style_pseudo_class('scrolled');
        else
            this.actor.remove_style_pseudo_class('scrolled');
    },

    _queueScrollbar: function () {
        Main.queueDeferredWork(this._scrollbarId);
    },

    _queueRedisplay: function () {
        Main.queueDeferredWork(this._redisplayId);
    },

    _onScrollEvent: function(actor, event) {
        // Event coordinates are relative to the stage but can be transformed
        // as the actor will only receive events within his bounds.
        let stage_x, stage_y, ok, event_x, event_y, actor_w, actor_h;
        [stage_x, stage_y] = event.get_coords();
        [ok, event_x, event_y] = actor.transform_stage_point(stage_x, stage_y);
        [actor_w, actor_h] = actor.get_size();

        // If the scroll event is within a 1px margin from
        // the relevant edge of the actor, let the event propagate.
        if (event_y >= actor_h - 2)
            return Clutter.EVENT_PROPAGATE;

        // reset timeout to avid conflicts with the mousehover event
        if (this._ensurePreviewVisibilityTimeoutId>0) {
            Mainloop.source_remove(this._ensurePreviewVisibilityTimeoutId);
            this._ensurePreviewVisibilityTimeoutId = 0;
        }

        // Skip to avoid double events mouse
        if (event.is_pointer_emulated())
            return Clutter.EVENT_STOP;

        let adjustment, delta;

        adjustment = this.actor.get_hscroll_bar().get_adjustment();

        let increment = adjustment.step_increment;

        switch ( event.get_scroll_direction() ) {
        case Clutter.ScrollDirection.UP:
            delta = -increment;
            break;
        case Clutter.ScrollDirection.DOWN:
            delta = +increment;
            break;
        case Clutter.ScrollDirection.SMOOTH:
            let [dx, dy] = event.get_scroll_delta();
            delta = dy*increment;
            delta += dx*increment;
            break;

        }

        adjustment.set_value(adjustment.get_value() + delta);

        return Clutter.EVENT_STOP;

    },

    _onDestroy: function() {
        for (let i = 0; i < this._dtpSettingsSignalIds.length; ++i) {
            this._dtpSettings.disconnect(this._dtpSettingsSignalIds[i]);
        }

        if (this._stateChangedId) {
            this.app.disconnect(this._stateChangedId);
            this._stateChangedId = 0;
        }
    },

    _createPreviewItem: function(window) {
        let preview = new thumbnailPreview(window, this._dtpSettings);

        preview.actor.connect('notify::hover', Lang.bind(this, function() {
            if (preview.actor.hover){
                this._ensurePreviewVisibilityTimeoutId = Mainloop.timeout_add(100, Lang.bind(this, function(){
                    Taskbar.ensureActorVisibleInScrollView(this.actor, preview.actor);
                    this._ensurePreviewVisibilityTimeoutId = 0;
                    return GLib.SOURCE_REMOVE;
                }));
            } else {
                if (this._ensurePreviewVisibilityTimeoutId>0) {
                    Mainloop.source_remove(this._ensurePreviewVisibilityTimeoutId);
                    this._ensurePreviewVisibilityTimeoutId = 0;
                }
            }
        }));

        preview.actor.connect('key-focus-in',
            Lang.bind(this, function(actor) {

                let [x_shift, y_shift] = Taskbar.ensureActorVisibleInScrollView(this.actor, actor);
        }));

        return preview;
    },

    _resetPreviews: function() {
        let previews = this._getPreviews();
        let l = previews.length;
        
        if (l > 0) {
            for (let i = 0; i < l; ++i) {
                previews[i]._delegate.animateOutAndDestroy();
            }

            this._queueRedisplay();
        }
    },

    _getPreviews: function() {
        return this.box.get_children().filter(function(actor) {
            return actor._delegate.window && 
                   actor._delegate.preview && 
                   !actor._delegate.animatingOut;
        });
    },

    _redisplay: function () {
        let windows = this._source.window ? [this._source.window] : 
                      AppIcons.getInterestingWindows(this.app, this._dtpSettings, this._source.panelWrapper.monitor).sort(this.sortWindowsCompareFunction);
        let children = this._getPreviews();
        // Apps currently in the taskbar
        let oldWin = children.map(function(actor) {
                return actor._delegate.window;
            });
        // Apps supposed to be in the taskbar
        let newWin = windows;

        let addedItems = [];
        let removedActors = [];

        let newIndex = 0;
        let oldIndex = 0;

        while (newIndex < newWin.length || oldIndex < oldWin.length) {
            // Window removed at oldIndex
            if (oldWin[oldIndex] &&
                newWin.indexOf(oldWin[oldIndex]) == -1) {
                removedActors.push(children[oldIndex]);
                oldIndex++;
                continue;
            }

            // Window added at newIndex
            if (newWin[newIndex] &&
                oldWin.indexOf(newWin[newIndex]) == -1) {
                addedItems.push({ item: this._createPreviewItem(newWin[newIndex]),
                                  pos: newIndex });
                newIndex++;
                continue;
            }

            // No change at oldIndex/newIndex
            if (oldWin[oldIndex] == newWin[newIndex]) {
                oldIndex++;
                newIndex++;
                continue;
            }

            // Window moved
            let insertHere = newWin[newIndex + 1] &&
                             newWin[newIndex + 1] == oldWin[oldIndex];
            let alreadyRemoved = removedActors.reduce(function(result, actor) {
                let removedWin = actor.window;
                return result || removedWin == newWin[newIndex];
            }, false);

            if (insertHere || alreadyRemoved) {
                addedItems.push({ item: this._createPreviewItem(newWin[newIndex]),
                                  pos: newIndex + removedActors.length });
                newIndex++;
            } else {
                removedActors.push(children[oldIndex]);
                oldIndex++;
            }
        }

        for (let i = 0; i < addedItems.length; i++)
            this.addMenuItem(addedItems[i].item,
                                            addedItems[i].pos);

        for (let i = 0; i < removedActors.length; i++) {
            let item = removedActors[i];
            item._delegate.animateOutAndDestroy();
        }

        // Skip animations on first run when adding the initial set
        // of items, to avoid all items zooming in at once

        let animate = this._shownInitially;

        if (!this._shownInitially)
            this._shownInitially = true;

        for (let i = 0; i < addedItems.length; i++) {
            addedItems[i].item.show(animate);
        }

        this._queueScrollbar();

        // Workaround for https://bugzilla.gnome.org/show_bug.cgi?id=692744
        // Without it, StBoxLayout may use a stale size cache
        this.box.queue_relayout();

        if (windows.length < 1) {
            this._getTopMenu().close(~0);
        }
    },

    isAnimatingOut: function() {
        return this.actor.get_children().reduce(function(result, actor) {
                   return result || actor.animatingOut;
               }, false);
    },

    sortWindowsCompareFunction: function(windowA, windowB) {
        return windowA.get_stable_sequence() > windowB.get_stable_sequence();
    }
});

var previewMenuPopup = Utils.defineClass({
    Name: 'previewMenuPopup',
    Extends: WindowMenu.WindowMenu,
    ParentConstrParams: [[0], [1]],

    _init: function(window, sourceActor) {
        this.callParent('_init', window, sourceActor);

        let side = Taskbar.getPosition();
        this._arrowSide = side;
        this._boxPointer._arrowSide = side;
        this._boxPointer._userArrowSide = side;
    }

    // Otherwise, just let the parent do its thing?
});

var previewMenuPopupManager = Utils.defineClass({
    Name: 'previewMenuPopupManagerTest',
    
    _init: function(window, source) {
        this._manager = new PopupMenu.PopupMenuManager({ actor: Main.layoutManager.dummyCursor });

        this._sourceActor = new St.Widget({ reactive: true, visible: false });
        this._sourceActor.connect('button-press-event', Lang.bind(this,
            function() {
                this._manager.activeMenu.toggle();
            }));
        Main.uiGroup.add_actor(this._sourceActor);

        this.window = window;
    },

    showWindowMenuForWindow: function(rect) {
        let menu = new previewMenuPopup(this.window, this._sourceActor);
        let window = this.window;

        this._manager.addMenu(menu);

        menu.connect('activate', function() {
            window.check_alive(global.get_current_time());
        });
        let destroyId = window.connect('unmanaged',
            function() {
                menu.close();
            });

        this._sourceActor.set_size(Math.max(1, rect.width), Math.max(1, rect.height));
        this._sourceActor.set_position(rect.x, rect.y);

        this._sourceActor.show();

        menu.open(BoxPointer.PopupAnimation.NONE);
        menu.actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
        menu.connect('open-state-changed', Lang.bind(this, function(menu_, isOpen) {
            if (isOpen)
                return;

            this._sourceActor.hide();
            menu.destroy();
            window.disconnect(destroyId);
        }));
    }
});
