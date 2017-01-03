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
 * The code for recursing child actors and assigning inline styles
 * is based on code from the StatusAreaHorizontalSpacing extension
 * https://bitbucket.org/mathematicalcoffee/status-area-horizontal-spacing-gnome-shell-extension
 * mathematical.coffee@gmail.com
 */

const Me = imports.misc.extensionUtils.getCurrentExtension();
const ExtensionUtils = imports.misc.extensionUtils;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const TaskBar = Me.imports.taskbar;

const taskbarPanelStyle = new Lang.Class({
    Name: 'TaskBar.PanelStyle',

    _init: function(settings) {
        this._dtpSettings = settings;
    },

    enable : function(panel) {
        this.panel = panel;

        this._applyStyles();

        //this._bindSettingsChanges();
    },

    disable: function () {
        this._removeStyles();
    },

    _bindSettingsChanges: function() {
        /* whenever the settings get changed, re-layout everything. */
        [
            "leftbox-padding",
            "tray-padding",
            "status-icon-padding"
        ].forEach(function(configName) {
            settings.connect('changed::' + configName, Lang.bind(this, function () {
                this._removeStyles();
                this._applyStyles();
            }));
        });
    },

    _applyStyles: function() {
        let trayPadding = -1; //this._dtpSettings.get_int('tray-padding');
        let setTrayPadding = null;
        if(trayPadding >= 0) {
            let trayPaddingStyleLine = '-natural-hpadding: %dpx'.format(trayPadding);
            if (trayPadding < 6) {
                trayPaddingStyleLine += '; -minimum-hpadding: %dpx'.format(trayPadding);
            }
            let trayPaddingChildren = this.panel._rightBox.get_children()
                .concat(this.panel._centerBox.get_children());
            setTrayPadding = Lang.bind(this, function (actor) {
                this._overrideStyle(actor, trayPaddingStyleLine, function (actor) {
                    return (actor.has_style_class_name && actor.has_style_class_name('panel-button'));
                }, 2);
            });
            for (let i = 0; i < trayPaddingChildren.length; ++i)
                setTrayPadding(trayPaddingChildren[i]);
        }

        let leftboxPadding = -1; //this._dtpSettings.get_int('leftbox-padding');
        let setLeftboxPadding = null;
        if(leftboxPadding >= 0) {
            let leftboxPaddingStyleLine = '-natural-hpadding: %dpx'.format(leftboxPadding);
            let leftboxPaddingChildren = this.panel._leftBox.get_children()
            setLeftboxPadding = Lang.bind(this, function (actor) {
                this._overrideStyle(actor, leftboxPaddingStyleLine, function (actor) {
                    return (actor.has_style_class_name && actor.has_style_class_name('panel-button'));
                }, 2);
            });
            for (let i = 0; i < leftboxPaddingChildren.length; ++i)
                setLeftboxPadding(leftboxPaddingChildren[i]);
        }
        
        let statusIconPadding = -1; //this._dtpSettings.get_int('status-icon-padding');
        let setStatusIconPadding = null;
        if(statusIconPadding >= 0) {
            let statusIconPaddingStyleLine = 'padding-left: %dpx; padding-right: %dpx'.format(statusIconPadding, statusIconPadding)
            let statusIconPaddingChildren = this.panel.statusArea.aggregateMenu._indicators.get_children();
            setStatusIconPadding = Lang.bind(this, function (actor) {
                this._overrideStyle(actor, statusIconPaddingStyleLine, function (actor) {
                        return (actor.has_style_class_name && actor.has_style_class_name('system-status-icon'));
                    }, 2);
            });
            for (let i = 0; i < statusIconPaddingChildren.length; ++i)
                setStatusIconPadding(statusIconPaddingChildren[i]);
        }
       
        /* connect signal */
        this._rightBoxActorAddedID = this.panel._rightBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(setTrayPadding)
                    setTrayPadding(actor);
            })
        );
        this._centerBoxActorAddedID = this.panel._centerBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(setTrayPadding)
                    setTrayPadding(actor);
            })
        );
        this._leftBoxActorAddedID = this.panel._leftBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(setLeftboxPadding)
                    setLeftboxPadding(actor);
            })
        );
    },

    _removeStyles: function() {
        /* disconnect signal */
        if (this._rightBoxActorAddedID) 
            this.panel._rightBox.disconnect(this._rightBoxActorAddedID);
        if (this._centerBoxActorAddedID) 
            this.panel._centerBox.disconnect(this._centerBoxActorAddedID);
        if (this._leftBoxActorAddedID) 
            this.panel._leftBox.disconnect(this._leftBoxActorAddedID);

        let children = this.panel._rightBox.get_children()
            .concat(this.panel._centerBox.get_children());

        if(children)
            for (let i = 0; i < children.length; ++i)
                this._restoreOriginalStyle(children[i], function (actor) {
                    return (actor.has_style_class_name && actor.has_style_class_name('panel-button'));
                }, 2);

        children = this.panel.statusArea.aggregateMenu._indicators.get_children();

        if(children)
            for (let i = 0; i < children.length; ++i)
                this._restoreOriginalStyle(children[i], function (actor) {
                    return (actor.has_style_class_name && actor.has_style_class_name('system-status-icon'));
                }, 2);
    },

    _overrideStyle: function(actor, styleLine, compareFn, maxSearchDepth, recurseCount) {
        if(!recurseCount)
            recurseCount = 1;

        if(!compareFn(actor)) {
            if(actor.get_children) {
                let children = actor.get_children();
                for(let idx in children)
                    this._overrideStyle(children[idx], styleLine, compareFn, maxSearchDepth, recurseCount+1);
            }
            return;
        }

        if (actor._original_inline_style_ === undefined) {
            actor._original_inline_style_ = actor.get_style();
        }

        actor.set_style(styleLine + '; ' + (actor._original_inline_style_ || ''));
        actor._dtp_line_style = styleLine;
 
        /* listen for the style being set externally so we can re-apply our style */
        // TODO: somehow throttle the number of calls to this - add a timeout with
        // a flag?
        if (!actor._dtpPanelStyleSignalID) {
            actor._dtpPanelStyleSignalID =
                actor.connect('style-changed', Lang.bind(this, function () {
                    let currStyle = actor.get_style();
                    if (currStyle && !currStyle.match(actor._dtp_line_style)) {
                        // re-save the style (if it has in fact changed)
                        actor._original_inline_style_ = currStyle;
                        // have to do this or else the overrideStyle call will trigger
                        // another call of this, firing an endless series of these signals.
                        // TODO: a ._style_pending which prevents it rather than disconnect/connect?
                        actor.disconnect(actor._dtpPanelStyleSignalID);
                        delete actor._dtpPanelStyleSignalID;
                        this._overrideStyle(actor, styleLine, compareFn, maxSearchDepth);
                    }
                }));
        }
    },

    // see the note in overrideStyle about us having to recurse down to the first
    // child of `actor` in order to find the container with style class name
    // 'panel-button' (applying our style to the parent container won't work).
    _restoreOriginalStyle: function(actor, compareFn, maxSearchDepth, recurseCount) {
         if(!compareFn(actor)) {
            
            let children = actor.get_children();

            if(children)
                for(let idx in children)
                    this._restoreOriginalStyle(children[idx], compareFn, maxSearchDepth, recurseCount+1);
            return;
         }

        if (actor._dtpPanelStyleSignalID) {
            actor.disconnect(actor._dtpPanelStyleSignalID);
            delete actor._dtpPanelStyleSignalID;
        }
        if (actor._original_inline_style_ !== undefined) {
            actor.set_style(actor._original_inline_style_);
            delete actor._original_inline_style_;
            delete actor._dtp_line_style;
        }
    }
    
});