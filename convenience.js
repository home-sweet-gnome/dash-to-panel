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

const Config = imports.misc.config;
const ExtensionUtils = imports.misc.extensionUtils;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

/**
 * initTranslations:
 * @domain: (optional): the gettext domain to use
 *
 * Initialize Gettext to load translations from extensionsdir/locale.
 * If @domain is not provided, it will be taken from metadata['gettext-domain']
 */
function initTranslations(domain) {
    let extension = ExtensionUtils.getCurrentExtension();

    domain = domain || extension.metadata['gettext-domain'];

    // Check if this extension was built with "make zip-file", and thus
    // has the locale files in a subfolder
    // otherwise assume that extension has been installed in the
    // same prefix as gnome-shell
    let localeDir = extension.dir.get_child('locale');
    if (localeDir.query_exists(null))
        Gettext.bindtextdomain(domain, localeDir.get_path());
    else
        Gettext.bindtextdomain(domain, Config.LOCALEDIR);
}

/**
 * getSettings:
 * @schema: (optional): the GSettings schema id
 *
 * Builds and return a GSettings schema for @schema, using schema files
 * in extensionsdir/schemas. If @schema is not provided, it is taken from
 * metadata['settings-schema'].
 */
function getSettings(schema) {
    let extension = ExtensionUtils.getCurrentExtension();

    schema = schema || extension.metadata['settings-schema'];

    const GioSSS = Gio.SettingsSchemaSource;

    // Check if this extension was built with "make zip-file", and thus
    // has the schema files in a subfolder
    // otherwise assume that extension has been installed in the
    // same prefix as gnome-shell (and therefore schemas are available
    // in the standard folders)
    let schemaDir = extension.dir.get_child('schemas');
    let schemaSource;
    if (schemaDir.query_exists(null))
        schemaSource = GioSSS.new_from_directory(schemaDir.get_path(),
                                                 GioSSS.get_default(),
                                                 false);
    else
        schemaSource = GioSSS.get_default();

    let schemaObj = schemaSource.lookup(schema, true);
    if (!schemaObj)
        throw new Error('Schema ' + schema + ' could not be found for extension '
                        + extension.metadata.uuid + '. Please check your installation.');

    return new Gio.Settings({
        settings_schema: schemaObj
    });
}


// simplify global signals and function injections handling
// abstract class
var BasicHandler = new Lang.Class({
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
var GlobalSignalsHandler = new Lang.Class({
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
var InjectionsHandler = new Lang.Class({
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
var TimeoutsHandler = new Lang.Class({
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