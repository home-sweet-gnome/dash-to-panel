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


const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Signals = imports.signals;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;
const Workspace = imports.ui.workspace;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Taskbar = Me.imports.taskbar;
const Convenience = Me.imports.convenience;
const AppIcons = Me.imports.appIcons;

let DEFAULT_THUMBNAIL_WIDTH = 350;
let DEFAULT_THUMBNAIL_HEIGHT = 200;

const thumbnailPreviewMenu = new Lang.Class({
    Name: 'DashToPanel.ThumbnailPreviewMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(source, settings) {
        this._dtpSettings = settings;

        let side = Taskbar.getPosition();

        this.parent(source.actor, 0.5, side);

        // We want to keep the item hovered while the menu is up
        this.blockSourceEvents = false;

        this._source = source;
        this._app = this._source.app;

        this.actor.add_style_class_name('app-well-menu');
        this.actor.set_style("max-width: " + (Main.layoutManager.primaryMonitor.width - 22) + "px;");
        this.actor.hide();

        // Chain our visibility and lifecycle to that of the source
        this._mappedId = this._source.actor.connect('notify::mapped', Lang.bind(this, function () {
            if (!this._source.actor.mapped)
                this.close();
        }));
        this._destroyId = this._source.actor.connect('destroy', Lang.bind(this, this.destroy));

        Main.uiGroup.add_actor(this.actor);

        this._enterSourceId = this._source.actor.connect('enter-event', Lang.bind(this, this._onEnter));
        this._leaveSourceId = this._source.actor.connect('leave-event', Lang.bind(this, this._onLeave));

        this._enterMenuId = this.actor.connect('enter-event', Lang.bind(this, this._onMenuEnter));
        this._leaveMenuId = this.actor.connect('leave-event', Lang.bind(this, this._onMenuLeave));

        // Change the initialized side where required.
        this._arrowSide = side;
        this._boxPointer._arrowSide = side;
        this._boxPointer._userArrowSide = side;

        this._previewBox = new thumbnailPreviewList(this._app, this._dtpSettings);
        this.addMenuItem(this._previewBox);
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
        let windows = AppIcons.getInterestingWindows(this._app, this._dtpSettings);
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

    hoverOpen: function () {
        this._hoverOpenTimeoutId = null;
        if (!this.isOpen && this._dtpSettings.get_boolean("show-window-previews"))
            this.popup();
    },

    hoverClose: function () {
        this._hoverCloseTimeoutId = null;
        this.close(~0);
    },

    destroy: function () {
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

        this.parent();
    },

    close: function(animate) {
        this.cancelOpen();
        
        if (this.isOpen)
            this.emit('open-state-changed', false);
        if (this._activeMenuItem)
            this._activeMenuItem.setActive(false);

        if (this._boxPointer.actor.visible) {
            this._boxPointer.hide(animate, Lang.bind(this, function() {
                this.emit('menu-closed', this);
            }));
        }

        this.isOpen = false;
    }

});

const thumbnailPreview = new Lang.Class({
    Name: 'DashToPanel.ThumbnailPreview',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(window) {
        this.window = window;

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        if(!scaleFactor)
            scaleFactor = 1;
        
        this._thumbnailWidth = DEFAULT_THUMBNAIL_WIDTH*scaleFactor;
        this._thumbnailHeight = DEFAULT_THUMBNAIL_HEIGHT*scaleFactor;

        this.parent({reactive: true});
        this._workId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._onResize));
        this._closeButtonId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._repositionCloseButton));
        this.scale = 0;

        this.preview = this.getThumbnail();

        this.actor.remove_child(this._ornamentLabel);
        this.actor._delegate = this;

        this.animatingOut = false;

        this._windowBox = new St.BoxLayout({ style_class: 'window-box',
                                             x_expand: true,
                                             vertical: true });

        this._previewBin = new St.Bin();
        this._previewBin.set_size(this._thumbnailWidth, this._thumbnailHeight);

        this._closeButton = new St.Button({ style_class: 'window-close',
                                            accessible_name: "Close window" });
        this._closeButton.opacity = 0;
        this._closeButton.connect('clicked', Lang.bind(this, this._closeWindow));

        this.overlayGroup = new Clutter.Actor({layout_manager: new Clutter.BinLayout()});
        this.overlayGroup.add_actor(this._previewBin);
        this.overlayGroup.add_actor(this._closeButton);

        this._title = new St.Label({ text: window.title });
        this._titleBin = new St.Bin({ child: this._title,
                                    x_align: St.Align.MIDDLE,
                                    width: this._thumbnailWidth
                                  });
        this._titleBin.add_style_class_name("preview-window-title");

        this.window.connect('notify::title', Lang.bind(this, function() {
                            this._title.set_text(this.window.title);
                            }));

        this._windowBin = new St.Bin({ child: this.overlayGroup,
                                    x_align: St.Align.MIDDLE,
                                    width: this._thumbnailWidth,
                                    height: this._thumbnailHeight
                                  });

        this._windowBox.add_child(this._windowBin);

        if (this.preview)
            this._previewBin.set_child(this.preview);
        this._windowBox.add_child(this._titleBin);
        this.actor.add_child(this._windowBox);
        this._queueRepositionCloseButton();

        this.actor.connect('enter-event',
                                  Lang.bind(this, this._onEnter));
        this.actor.connect('leave-event',
                                  Lang.bind(this, this._onLeave));
        this.actor.connect('key-focus-in',
                                  Lang.bind(this, this._onEnter));
        this.actor.connect('key-focus-out',
                                  Lang.bind(this, this._onLeave));
    },

    _onEnter: function() {
        this._showCloseButton();
        return Clutter.EVENT_PROPAGATE;
    },

    _onLeave: function() {
        if (!this._previewBin.has_pointer &&
            !this._closeButton.has_pointer)
            this._hideCloseButton();

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
            let windowTexture = mutterWindow.get_texture();
            let [width, height] = windowTexture.get_size();
            this.scale = Math.min(1.0, this._thumbnailWidth / width, this._thumbnailHeight / height);
            thumbnail = new Clutter.Clone ({ source: windowTexture,
                                             reactive: true,
                                             width: width * this.scale,
                                             height: height * this.scale });
            this._resizeId = mutterWindow.meta_window.connect('size-changed',
                                            Lang.bind(this, this._queueResize));
            this._destroyId = mutterWindow.connect('destroy', Lang.bind(this, function() {
                                                   thumbnail.destroy();
                                                   this._destroyId = 0;
                                                   this.animateOutAndDestroy();
                                                  }));
        }

        return thumbnail;
    },

    _queueResize: function () {
        Main.queueDeferredWork(this._workId);
    },

    _onResize: function() {
        let [width, height] = this.preview.get_source().get_size();
        this.scale = Math.min(1.0, this._thumbnailWidth / width, this._thumbnailHeight / height);
        this.preview.set_size(width * this.scale, height * this.scale);

        this._queueRepositionCloseButton();
    },

    _queueRepositionCloseButton: function () {
        Main.queueDeferredWork(this._closeButtonId);
    },

    _repositionCloseButton: function() {
        let rect = this.window.get_compositor_private().meta_window.get_frame_rect();
        let cloneWidth = Math.floor(rect.width) * this.scale;
        let cloneHeight = Math.floor(rect.height) * this.scale;

        let cloneX = (this._thumbnailWidth - cloneWidth) / 2 ;
        let cloneY = (this._thumbnailHeight - cloneHeight) / 2;

        let buttonX;
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL) {
            buttonX = cloneX - (this._closeButton.width / 2);
            buttonX = Math.max(buttonX, 0);
        } else {
            buttonX = cloneX + (cloneWidth - (this._closeButton.width / 2));
            buttonX = Math.min(buttonX, this._thumbnailWidth - this._closeButton.width);
        }

        let buttonY = cloneY - (this._closeButton.height / 2);
        buttonY = Math.max(buttonY, 0);

        this._closeButton.set_position(Math.floor(buttonX), Math.floor(buttonY));
    },

    _closeWindow: function() {
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
        this.animatingOut = true;
        this._hideCloseButton();
        Tweener.addTween(this.actor,
                         { width: 0,
                           opacity: 0,
                           time: Taskbar.DASH_ANIMATION_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this, function() {
                               this.destroy();
                           })
                         });
    },

    activate: function() {
        Main.activateWindow(this.window);
        this._getTopMenu().close(~0);
    }
});

const thumbnailPreviewList = new Lang.Class({
    Name: 'DashToPanel.ThumbnailPreviewList',
    Extends: PopupMenu.PopupMenuSection,

    _init: function(app, settings) {
        this._dtpSettings = settings;

  	    this.parent();

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

        this._redisplayId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._redisplay));
        this._scrollbarId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._showHideScrollbar));

        if (this._stateChangedId > 0) {
            this.app.disconnect(this._stateChangedId);
            this._stateChangedId = 0;
        }

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this._stateChangedId = this.app.connect('windows-changed',
                                                Lang.bind(this,
                                                          this._queueRedisplay));
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
        this.app.disconnect(this._stateChangedId);
        this._stateChangedId = 0;
    },

    _createPreviewItem: function(window) {
        let preview = new thumbnailPreview(window);


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

    _redisplay: function () {
        let windows = AppIcons.getInterestingWindows(this.app, this._dtpSettings).sort(this.sortWindowsCompareFunction);
        let children = this.box.get_children().filter(function(actor) {
                return actor._delegate.window && actor._delegate.preview;
            });
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
            // No change at oldIndex/newIndex
            if (oldWin[oldIndex] == newWin[newIndex]) {
                oldIndex++;
                newIndex++;
                continue;
            }

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
