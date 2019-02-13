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
 * Ideas for recursing child actors and assigning inline styles
 * are based on code from the StatusAreaHorizontalSpacing extension
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

const Taskbar = Me.imports.taskbar;
const Utils = Me.imports.utils;

var dtpPanelStyle = Utils.defineClass({
    Name: 'DashToPanel.PanelStyle',

    _init: function(settings) {
        this._dtpSettings = settings;
    },

    enable : function(panel) {
        this.panel = panel;

        this._applyStyles();

        this._bindSettingsChanges();
    },

    disable: function () {
        for (let i = 0; i < this._dtpSettingsSignalIds.length; ++i) {
            this._dtpSettings.disconnect(this._dtpSettingsSignalIds[i]);
        }

        this._removeStyles();
    },

    _bindSettingsChanges: function() {
        let configKeys = [
            "tray-size",
            "leftbox-size",
            "tray-padding",
            "leftbox-padding",
            "status-icon-padding",
        ];

        this._dtpSettingsSignalIds = [];
        
        for(let i in configKeys) {
            this._dtpSettingsSignalIds.push(this._dtpSettings.connect('changed::' + configKeys[i], Lang.bind(this, function () {
                this._removeStyles();
                this._applyStyles();
            })));
        }
    },

    _applyStyles: function() {
        this._rightBoxOperations = [];
        
        let trayPadding = this._dtpSettings.get_int('tray-padding');
        if(trayPadding >= 0) {
            let trayPaddingStyleLine = '-natural-hpadding: %dpx'.format(trayPadding);
            if (trayPadding < 6) {
                trayPaddingStyleLine += '; -minimum-hpadding: %dpx'.format(trayPadding);
            }
            let operation = {};
            operation.compareFn = function (actor) {
                return (actor.has_style_class_name && actor.has_style_class_name('panel-button'));
            };
            operation.applyFn = Lang.bind(this, function (actor, operationIdx) {
                this._overrideStyle(actor, trayPaddingStyleLine, operationIdx);
            });
            this._rightBoxOperations.push(operation);
        }

        let statusIconPadding = this._dtpSettings.get_int('status-icon-padding');
        if(statusIconPadding >= 0) {
            let statusIconPaddingStyleLine = 'padding-left: %dpx; padding-right: %dpx'.format(statusIconPadding, statusIconPadding)
            let operation = {};
            operation.compareFn = function (actor) {
                return (actor.has_style_class_name && actor.has_style_class_name('system-status-icon'));
            };
            operation.applyFn = Lang.bind(this, function (actor, operationIdx) {
                this._overrideStyle(actor, statusIconPaddingStyleLine, operationIdx);
            });
            this._rightBoxOperations.push(operation);
        }

        let trayContentSize = this._dtpSettings.get_int('tray-size');
        if(trayContentSize > 0) {
            let trayIconSizeStyleLine = 'icon-size: %dpx'.format(trayContentSize)
            let operation = {};
            operation.compareFn = function (actor) {
                return (actor.constructor && actor.constructor.name == 'St_Icon');
            };
            operation.applyFn = Lang.bind(this, function (actor, operationIdx) {
                this._overrideStyle(actor, trayIconSizeStyleLine, operationIdx);
            });
            this._rightBoxOperations.push(operation);

            let trayContentSizeStyleLine = 'font-size: %dpx'.format(trayContentSize)
            operation = {};
            operation.compareFn = function (actor) {
                return (actor.constructor && actor.constructor.name == 'St_Label');
            };
            operation.applyFn = Lang.bind(this, function (actor, operationIdx) {
                this._overrideStyle(actor, trayContentSizeStyleLine, operationIdx);
            });
            this._rightBoxOperations.push(operation);

            this._overrideStyle(this.panel._rightBox, trayContentSizeStyleLine, 0);
            this._overrideStyle(this.panel._centerBox, trayContentSizeStyleLine, 0);
        }
       
        // center box has been moved next to the right box and will be treated the same
        this._centerBoxOperations = this._rightBoxOperations;

        this._leftBoxOperations = [];

        let leftboxPadding = this._dtpSettings.get_int('leftbox-padding');
        if(leftboxPadding >= 0) {
            let leftboxPaddingStyleLine = '-natural-hpadding: %dpx'.format(leftboxPadding);
            if (leftboxPadding < 6) {
                leftboxPaddingStyleLine += '; -minimum-hpadding: %dpx'.format(leftboxPadding);
            }
            let operation = {};
            operation.compareFn = function (actor) {
                return (actor.has_style_class_name && actor.has_style_class_name('panel-button'));
            };
            operation.applyFn = Lang.bind(this, function (actor, operationIdx) {
                this._overrideStyle(actor, leftboxPaddingStyleLine, operationIdx);
            });
            this._leftBoxOperations.push(operation);
        }

        let leftboxContentSize = this._dtpSettings.get_int('leftbox-size');
        if(leftboxContentSize > 0) {
            let leftboxIconSizeStyleLine = 'icon-size: %dpx'.format(leftboxContentSize)
            let operation = {};
            operation.compareFn = function (actor) {
                return (actor.constructor && actor.constructor.name == 'St_Icon');
            };
            operation.applyFn = Lang.bind(this, function (actor, operationIdx) {
                this._overrideStyle(actor, leftboxIconSizeStyleLine, operationIdx);
            });
            this._leftBoxOperations.push(operation);

            let leftboxContentSizeStyleLine = 'font-size: %dpx'.format(leftboxContentSize)
            operation = {};
            operation.compareFn = function (actor) {
                return (actor.constructor && actor.constructor.name == 'St_Label');
            };
            operation.applyFn = Lang.bind(this, function (actor, operationIdx) {
                this._overrideStyle(actor, leftboxContentSizeStyleLine, operationIdx);
            });
            this._leftBoxOperations.push(operation);

            this._overrideStyle(this.panel._leftBox, leftboxContentSizeStyleLine, 0);
        }


        /*recurse actors */
        if(this._rightBoxOperations.length) {
            let children = this.panel._rightBox.get_children();
            for(let i in children)
                this._recursiveApply(children[i], this._rightBoxOperations);
        }

        if(this._centerBoxOperations.length) {
            let children = this.panel._centerBox.get_children();
            for(let i in children)
                this._recursiveApply(children[i], this._centerBoxOperations);
        }

        if(this._leftBoxOperations.length) {
            let children = this.panel._leftBox.get_children();
            for(let i in children)
                this._recursiveApply(children[i], this._leftBoxOperations);
        }
        
        /* connect signal */
        this._rightBoxActorAddedID = this.panel._rightBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(this._rightBoxOperations.length)
                    this._recursiveApply(actor, this._rightBoxOperations);
            })
        );
        this._centerBoxActorAddedID = this.panel._centerBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(this._centerBoxOperations.length)
                    this._recursiveApply(actor, this._centerBoxOperations);
            })
        );
        this._leftBoxActorAddedID = this.panel._leftBox.connect('actor-added',
            Lang.bind(this, function (container, actor) {
                if(this._leftBoxOperations.length)
                    this._recursiveApply(actor, this._leftBoxOperations);
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

        this._restoreOriginalStyle(this.panel._rightBox);
        if(this._rightBoxOperations.length) {
            let children = this.panel._rightBox.get_children();
            for(let i in children)
                this._recursiveApply(children[i], this._rightBoxOperations, true);
        }

        this._restoreOriginalStyle(this.panel._centerBox);
        if(this._centerBoxOperations.length) {
            let children = this.panel._centerBox.get_children();
            for(let i in children)
                this._recursiveApply(children[i], this._centerBoxOperations, true);
        }

        this._restoreOriginalStyle(this.panel._leftBox);
        if(this._leftBoxOperations.length) {
            let children = this.panel._leftBox.get_children();
            for(let i in children)
                this._recursiveApply(children[i], this._leftBoxOperations, true);
        }
    },

    _recursiveApply: function(actor, operations, restore) {
        for(let i in operations) {
            let o = operations[i];
            if(o.compareFn(actor))
                if(restore)
                    o.restoreFn ? o.restoreFn(actor) : this._restoreOriginalStyle(actor);
                else
                    o.applyFn(actor, i);
        }

        if(actor.get_children) {
            let children = actor.get_children();
            for(let i in children) {
                this._recursiveApply(children[i], operations, restore);
            }
        }
    },
    
    _overrideStyle: function(actor, styleLine, operationIdx) {
        if (actor._dtp_original_inline_style === undefined) {
            actor._dtp_original_inline_style = actor.get_style();
        }

        if(actor._dtp_style_overrides === undefined) {
            actor._dtp_style_overrides = {};
        }

        actor._dtp_style_overrides[operationIdx] = styleLine;
        let newStyleLine = '';
        for(let i in actor._dtp_style_overrides)
            newStyleLine += actor._dtp_style_overrides[i] + '; ';
        actor.set_style(newStyleLine + (actor._dtp_original_inline_style || ''));
     },

    _restoreOriginalStyle: function(actor) {
        if (actor._dtp_original_inline_style !== undefined) {
            actor.set_style(actor._dtp_original_inline_style);
            delete actor._dtp_original_inline_style;
            delete actor._dtp_style_overrides;
        }
    }
    
});
