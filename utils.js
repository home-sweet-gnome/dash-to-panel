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

const Gi = imports._gi;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;

let es6Support = imports.misc.config.PACKAGE_VERSION >= '3.31.9';

var defineClass = function (classDef) {
    let parentProto = !!classDef.Extends ? classDef.Extends.prototype : null;
    let isGObject = parentProto instanceof imports.gi.GObject.Object;
    let needsSuper = es6Support && !!parentProto && !isGObject;

    if (!es6Support) {
        if (parentProto && classDef.Extends.name.indexOf('DashToPanel') < 0) {
            classDef.callParent = function() {
                let args = Array.prototype.slice.call(arguments);
                let func = args.shift();

                this.__caller__._owner.__super__.prototype[func].apply(this, args);
            };
        }

        return new imports.lang.Class(classDef);
    }

    let getParentArgs = function(args) {
        let parentArgs = [];

        (classDef.ParentConstrParams || parentArgs).forEach(p => {
            if (p.constructor === Array) {
                let param = args[p[0]];
                
                parentArgs.push(p[1] ? param[p[1]] : param);
            } else {
                parentArgs.push(p);
            }
        });

        return parentArgs;
    };
    
    let C = eval(
        '(class C ' + (needsSuper ? 'extends Object' : '') + ' { ' +
        '     constructor(...args) { ' +
                  (needsSuper ? 'super(...getParentArgs(args));' : '') +
                  (needsSuper || !parentProto ? 'this._init(...args);' : '') +
        '     }' +
        '     callParent(...args) { ' +
        '         let func = args.shift(); ' +
        '         if (!(func === \'_init\' && needsSuper))' +
        '             super[func](...args); ' +
        '     }' +    
        '})'
    );

    if (parentProto) {
        Object.setPrototypeOf(C.prototype, parentProto);
        Object.setPrototypeOf(C, classDef.Extends);
    } 
    
    Object.defineProperty(C, 'name', { value: classDef.Name });
    Object.keys(classDef)
          .filter(k => classDef.hasOwnProperty(k) && classDef[k] instanceof Function)
          .forEach(k => C.prototype[k] = classDef[k]);

    if (isGObject) { 
        C = imports.gi.GObject.registerClass(C);
    }
    
    return C;
};

// simplify global signals and function injections handling
// abstract class
var BasicHandler = defineClass({
    Name: 'DashToPanel.BasicHandler',

    _init: function(){
        this._storage = new Object();
    },

    add: function(/*unlimited 3-long array arguments*/){

        // convert arguments object to array, concatenate with generic
        let args = Array.concat('generic', Array.slice(arguments));
        // call addWithLabel with ags as if they were passed arguments
        this.addWithLabel.apply(this, args);
    },

    destroy: function() {
        for( let label in this._storage )
            this.removeWithLabel(label);
    },

    addWithLabel: function( label /* plus unlimited 3-long array arguments*/) {

        if(this._storage[label] == undefined)
            this._storage[label] = new Array();

        // skip first element of the arguments
        for( let i = 1; i < arguments.length; i++ ) {
            let item = this._storage[label];
            let handlers = this._create(arguments[i]);

            for (let j = 0, l = handlers.length; j < l; ++j) {
                item.push(handlers[j]);
            }
        }

    },

    removeWithLabel: function(label){

        if(this._storage[label]) {
            for( let i = 0; i < this._storage[label].length; i++ ) {
                this._remove(this._storage[label][i]);
            }

            delete this._storage[label];
        }
    },

    /* Virtual methods to be implemented by subclass */
    // create single element to be stored in the storage structure
    _create: function(item){
      throw new Error('no implementation of _create in ' + this);
    },

    // correctly delete single element
    _remove: function(item){
      throw new Error('no implementation of _remove in ' + this);
    }
});

// Manage global signals
var GlobalSignalsHandler = defineClass({
    Name: 'DashToPanel.GlobalSignalsHandler',
    Extends: BasicHandler,

    _create: function(item) {
        let handlers = [];

        item[1] = [].concat(item[1]);

        for (let i = 0, l = item[1].length; i < l; ++i) {
            let object = item[0];
            let event = item[1][i];
            let callback = item[2]
            let id = object.connect(event, callback);

            handlers.push([object, id]);
        }

        return handlers;
    },

    _remove: function(item){
       item[0].disconnect(item[1]);
    }
});

/**
 * Manage function injection: both instances and prototype can be overridden
 * and restored
 */
var InjectionsHandler = defineClass({
    Name: 'DashToPanel.InjectionsHandler',
    Extends: BasicHandler,

    _create: function(item) {
        let object = item[0];
        let name = item[1];
        let injectedFunction = item[2];
        let original = object[name];

        object[name] = injectedFunction;
        return [[object, name, injectedFunction, original]];
    },

    _remove: function(item) {
        let object = item[0];
        let name = item[1];
        let original = item[3];
        object[name] = original;
    }
});

/**
 * Manage timeouts: the added timeouts have their id reset on completion
 */
var TimeoutsHandler = defineClass({
    Name: 'DashToPanel.TimeoutsHandler',
    Extends: BasicHandler,

    _create: function(item) {
        let name = item[0];
        let delay = item[1];
        let timeoutHandler = item[2];

        this._remove(item);

        this[name] = Mainloop.timeout_add(delay, () => {
            this[name] = 0;
            timeoutHandler();
        });

        return [[name]];
    },

    remove: function(name) {
        this._remove([name])
    },

    _remove: function(item) {
        let name = item[0];

        if (this[name]) {
            Mainloop.source_remove(this[name]);
            this[name] = 0;
        }
    },

    getId: function(name) {
        return this[name] ? this[name] : 0;
    }
});

// This is wrapper to maintain compatibility with GNOME-Shell 3.30+ as well as
// previous versions.
var DisplayWrapper = {
    getScreen: function() {
        return global.screen || global.display;
    },

    getWorkspaceManager: function() {
        return global.screen || global.workspace_manager;
    },

    getMonitorManager: function() {
        return global.screen || Meta.MonitorManager.get();
    }
};

var hookVfunc = function(proto, symbol, func) {
    if (Gi.hook_up_vfunc_symbol) {
        //gjs > 1.53.3
        proto[Gi.hook_up_vfunc_symbol](symbol, func);
    } else {
        Gi.hook_up_vfunc(proto, symbol, func);
    }
};
