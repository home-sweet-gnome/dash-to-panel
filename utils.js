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

const GdkPixbuf = imports.gi.GdkPixbuf
const Gi = imports._gi;
const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;

var TRANSLATION_DOMAIN = imports.misc.extensionUtils.getCurrentExtension().metadata['gettext-domain'];

var defineClass = function (classDef) {
    let parentProto = classDef.Extends ? classDef.Extends.prototype : null;
    
    if (imports.misc.config.PACKAGE_VERSION < '3.31.9') {
        if (parentProto && (classDef.Extends.name || classDef.Extends.toString()).indexOf('DashToPanel.') < 0) {
            classDef.callParent = function() {
                let args = Array.prototype.slice.call(arguments);
                let func = args.shift();

                classDef.Extends.prototype[func].apply(this, args);
            };
        }

        return new imports.lang.Class(classDef);
    }

    let isGObject = parentProto instanceof GObject.Object;
    let needsSuper = parentProto && !isGObject;
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
        C = GObject.registerClass(C);
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

var addKeybinding = function(key, settings, handler, modes) {
    if (!Main.wm._allowedKeybindings[key]) {
        Main.wm.addKeybinding(
            key, 
            settings,
            Meta.KeyBindingFlags.NONE,
            modes || (Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW),
            handler
        );
    }
};

var removeKeybinding = function(key) {
    if (Main.wm._allowedKeybindings[key]) {
        Main.wm.removeKeybinding(key);
    }
};
 
/**
 *  ColorUtils is adapted from https://github.com/micheleg/dash-to-dock
 */
var ColorUtils = {
    colorLuminance: function(r, g, b, dlum) {
        // Darken or brighten color by a fraction dlum
        // Each rgb value is modified by the same fraction.
        // Return "#rrggbb" strin

        let rgbString = '#';

        rgbString += ColorUtils._decimalToHex(Math.round(Math.min(Math.max(r*(1+dlum), 0), 255)), 2);
        rgbString += ColorUtils._decimalToHex(Math.round(Math.min(Math.max(g*(1+dlum), 0), 255)), 2);
        rgbString += ColorUtils._decimalToHex(Math.round(Math.min(Math.max(b*(1+dlum), 0), 255)), 2);

        return rgbString;
    },

    _decimalToHex: function(d, padding) {
        // Convert decimal to an hexadecimal string adding the desired padding

        let hex = d.toString(16);
        while (hex.length < padding)
            hex = '0'+ hex;
        return hex;
    },

    HSVtoRGB: function(h, s, v) {
        // Convert hsv ([0-1, 0-1, 0-1]) to rgb ([0-255, 0-255, 0-255]).
        // Following algorithm in https://en.wikipedia.org/wiki/HSL_and_HSV
        // here with h = [0,1] instead of [0, 360]
        // Accept either (h,s,v) independently or  {h:h, s:s, v:v} object.
        // Return {r:r, g:g, b:b} object.

        if (arguments.length === 1) {
            s = h.s;
            v = h.v;
            h = h.h;
        }

        let r,g,b;
        let c = v*s;
        let h1 = h*6;
        let x = c*(1 - Math.abs(h1 % 2 - 1));
        let m = v - c;

        if (h1 <=1)
            r = c + m, g = x + m, b = m;
        else if (h1 <=2)
            r = x + m, g = c + m, b = m;
        else if (h1 <=3)
            r = m, g = c + m, b = x + m;
        else if (h1 <=4)
            r = m, g = x + m, b = c + m;
        else if (h1 <=5)
            r = x + m, g = m, b = c + m;
        else
            r = c + m, g = m, b = x + m;

        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    },

    RGBtoHSV: function(r, g, b) {
        // Convert rgb ([0-255, 0-255, 0-255]) to hsv ([0-1, 0-1, 0-1]).
        // Following algorithm in https://en.wikipedia.org/wiki/HSL_and_HSV
        // here with h = [0,1] instead of [0, 360]
        // Accept either (r,g,b) independently or {r:r, g:g, b:b} object.
        // Return {h:h, s:s, v:v} object.

        if (arguments.length === 1) {
            r = r.r;
            g = r.g;
            b = r.b;
        }

        let h,s,v;

        let M = Math.max(r, g, b);
        let m = Math.min(r, g, b);
        let c = M - m;

        if (c == 0)
            h = 0;
        else if (M == r)
            h = ((g-b)/c) % 6;
        else if (M == g)
            h = (b-r)/c + 2;
        else
            h = (r-g)/c + 4;

        h = h/6;
        v = M/255;
        if (M !== 0)
            s = c/M;
        else
            s = 0;

        return {h: h, s: s, v: v};
    }
};

/**
 *  DominantColorExtractor is adapted from https://github.com/micheleg/dash-to-dock
 */
let themeLoader = null;
let iconCacheMap = new Map();
const MAX_CACHED_ITEMS = 1000;
const BATCH_SIZE_TO_DELETE = 50;
const DOMINANT_COLOR_ICON_SIZE = 64;

var DominantColorExtractor = defineClass({
    Name: 'DashToPanel.DominantColorExtractor',

    _init: function(app){
        this._app = app;
    },

    /**
     * Try to get the pixel buffer for the current icon, if not fail gracefully
     */
    _getIconPixBuf: function() {
        let iconTexture = this._app.create_icon_texture(16);

        if (themeLoader === null) {
            let ifaceSettings = new Gio.Settings({ schema: "org.gnome.desktop.interface" });

            themeLoader = new Gtk.IconTheme(),
            themeLoader.set_custom_theme(ifaceSettings.get_string('icon-theme')); // Make sure the correct theme is loaded
        }

        // Unable to load the icon texture, use fallback
        if (iconTexture instanceof St.Icon === false) {
            return null;
        }

        iconTexture = iconTexture.get_gicon();

        // Unable to load the icon texture, use fallback
        if (iconTexture === null) {
            return null;
        }

        if (iconTexture instanceof Gio.FileIcon) {
            // Use GdkPixBuf to load the pixel buffer from the provided file path
            return GdkPixbuf.Pixbuf.new_from_file(iconTexture.get_file().get_path());
        }

        // Get the pixel buffer from the icon theme
        let icon_info = themeLoader.lookup_icon(iconTexture.get_names()[0], DOMINANT_COLOR_ICON_SIZE, 0);
        if (icon_info !== null)
            return icon_info.load_icon();
        else
            return null;
    },

    /**
     * The backlight color choosing algorithm was mostly ported to javascript from the
     * Unity7 C++ source of Canonicals:
     * https://bazaar.launchpad.net/~unity-team/unity/trunk/view/head:/launcher/LauncherIcon.cpp
     * so it more or less works the same way.
     */
    _getColorPalette: function() {
        if (iconCacheMap.get(this._app.get_id())) {
            // We already know the answer
            return iconCacheMap.get(this._app.get_id());
        }

        let pixBuf = this._getIconPixBuf();
        if (pixBuf == null)
            return null;

        let pixels = pixBuf.get_pixels(),
            offset = 0;

        let total  = 0,
            rTotal = 0,
            gTotal = 0,
            bTotal = 0;

        let resample_y = 1,
            resample_x = 1;

        // Resampling of large icons
        // We resample icons larger than twice the desired size, as the resampling
        // to a size s
        // DOMINANT_COLOR_ICON_SIZE < s < 2*DOMINANT_COLOR_ICON_SIZE,
        // most of the case exactly DOMINANT_COLOR_ICON_SIZE as the icon size is tipycally
        // a multiple of it.
        let width = pixBuf.get_width();
        let height = pixBuf.get_height();

        // Resample
        if (height >= 2* DOMINANT_COLOR_ICON_SIZE)
            resample_y = Math.floor(height/DOMINANT_COLOR_ICON_SIZE);

        if (width >= 2* DOMINANT_COLOR_ICON_SIZE)
            resample_x = Math.floor(width/DOMINANT_COLOR_ICON_SIZE);

        if (resample_x !==1 || resample_y !== 1)
            pixels = this._resamplePixels(pixels, resample_x, resample_y);

        // computing the limit outside the for (where it would be repeated at each iteration)
        // for performance reasons
        let limit = pixels.length;
        for (let offset = 0; offset < limit; offset+=4) {
            let r = pixels[offset],
                g = pixels[offset + 1],
                b = pixels[offset + 2],
                a = pixels[offset + 3];

            let saturation = (Math.max(r,g, b) - Math.min(r,g, b));
            let relevance  = 0.1 * 255 * 255 + 0.9 * a * saturation;

            rTotal += r * relevance;
            gTotal += g * relevance;
            bTotal += b * relevance;

            total += relevance;
        }

        total = total * 255;

        let r = rTotal / total,
            g = gTotal / total,
            b = bTotal / total;

        let hsv = ColorUtils.RGBtoHSV(r * 255, g * 255, b * 255);

        if (hsv.s > 0.15)
            hsv.s = 0.65;
        hsv.v = 0.90;

        let rgb = ColorUtils.HSVtoRGB(hsv.h, hsv.s, hsv.v);

        // Cache the result.
        let backgroundColor = {
            lighter:  ColorUtils.colorLuminance(rgb.r, rgb.g, rgb.b, 0.2),
            original: ColorUtils.colorLuminance(rgb.r, rgb.g, rgb.b, 0),
            darker:   ColorUtils.colorLuminance(rgb.r, rgb.g, rgb.b, -0.5)
        };

        if (iconCacheMap.size >= MAX_CACHED_ITEMS) {
            //delete oldest cached values (which are in order of insertions)
            let ctr=0;
            for (let key of iconCacheMap.keys()) {
                if (++ctr > BATCH_SIZE_TO_DELETE)
                    break;
                iconCacheMap.delete(key);
            }
        }

        iconCacheMap.set(this._app.get_id(), backgroundColor);

        return backgroundColor;
    },

    /**
     * Downsample large icons before scanning for the backlight color to
     * improve performance.
     *
     * @param pixBuf
     * @param pixels
     * @param resampleX
     * @param resampleY
     *
     * @return [];
     */
    _resamplePixels: function (pixels, resampleX, resampleY) {
        let resampledPixels = [];
        // computing the limit outside the for (where it would be repeated at each iteration)
        // for performance reasons
        let limit = pixels.length / (resampleX * resampleY) / 4;
        for (let i = 0; i < limit; i++) {
            let pixel = i * resampleX * resampleY;

            resampledPixels.push(pixels[pixel * 4]);
            resampledPixels.push(pixels[pixel * 4 + 1]);
            resampledPixels.push(pixels[pixel * 4 + 2]);
            resampledPixels.push(pixels[pixel * 4 + 3]);
        }

        return resampledPixels;
    }

});
