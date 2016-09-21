/*
 * Taskbar: A taskbar extension for the Gnome panel.
 * Copyright (C) 2016 Zorin OS
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
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
 * This file is based on code from the Dash to Dock extension by micheleg.
 * Some code was also adapted from the upstream Gnome Shell source code.
 */


const Lang = imports.lang;


// simplify global signals and function injections handling
// abstract class
const BasicHandler = new Lang.Class({
    Name: 'Taskbar.BasicHandler',

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
            this._storage[label].push( this._create(arguments[i]) );
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
const GlobalSignalsHandler = new Lang.Class({
    Name: 'Taskbar.GlobalSignalsHandler',
    Extends: BasicHandler,

    _create: function(item) {

      let object = item[0];
      let event = item[1];
      let callback = item[2]
      let id = object.connect(event, callback);

      return [object, id];
    },

    _remove: function(item){
       item[0].disconnect(item[1]);
    }
});
