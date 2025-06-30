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

import Clutter from 'gi://Clutter'
import Cogl from 'gi://Cogl'
import GdkPixbuf from 'gi://GdkPixbuf'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Graphene from 'gi://Graphene'
import Meta from 'gi://Meta'
import Shell from 'gi://Shell'
import St from 'gi://St'
import * as Config from 'resource:///org/gnome/shell/misc/config.js'
import * as Util from 'resource:///org/gnome/shell/misc/util.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js'

const SCROLL_TIME = Util.SCROLL_TIME / (Util.SCROLL_TIME > 1 ? 1000 : 1)

// simplify global signals and function injections handling
// abstract class
export const BasicHandler = class {
  constructor() {
    this._storage = new Object()
  }

  add(/*unlimited 3-long array arguments*/) {
    // convert arguments object to array, concatenate with generic
    let args = [].concat('generic', [].slice.call(arguments))
    // call addWithLabel with ags as if they were passed arguments
    this.addWithLabel.apply(this, args)
  }

  destroy() {
    for (let label in this._storage) this.removeWithLabel(label)
  }

  addWithLabel(label /* plus unlimited 3-long array arguments*/) {
    if (this._storage[label] == undefined) this._storage[label] = new Array()

    // skip first element of the arguments
    for (let i = 1; i < arguments.length; i++) {
      let item = this._storage[label]
      let handlers = this._create(arguments[i])

      for (let j = 0, l = handlers.length; j < l; ++j) {
        item.push(handlers[j])
      }
    }
  }

  removeWithLabel(label) {
    if (this._storage[label]) {
      for (let i = 0; i < this._storage[label].length; i++) {
        this._remove(this._storage[label][i])
      }

      delete this._storage[label]
    }
  }

  hasLabel(label) {
    return !!this._storage[label]
  }

  /* Virtual methods to be implemented by subclass */
  // create single element to be stored in the storage structure
  _create() {
    throw new Error('no implementation of _create in ' + this)
  }

  // correctly delete single element
  _remove() {
    throw new Error('no implementation of _remove in ' + this)
  }
}

// Manage global signals
export const GlobalSignalsHandler = class extends BasicHandler {
  _create(item) {
    let handlers = []

    item[1] = [].concat(item[1])

    for (let i = 0, l = item[1].length; i < l; ++i) {
      let object = item[0]
      let event = item[1][i]
      let callback = item[2]
      try {
        let id = object.connect(event, callback)

        handlers.push([object, id])
      } catch (e) {
        console.log(e)
      }
    }

    return handlers
  }

  _remove(item) {
    item[0].disconnect(item[1])
  }
}

/**
 * Manage function injection: both instances and prototype can be overridden
 * and restored
 */
export const InjectionsHandler = class extends BasicHandler {
  _create(item) {
    let object = item[0]
    let name = item[1]
    let injectedFunction = item[2]
    let original = object[name]

    object[name] = injectedFunction
    return [[object, name, injectedFunction, original]]
  }

  _remove(item) {
    let object = item[0]
    let name = item[1]
    let original = item[3]
    object[name] = original
  }
}

/**
 * Manage timeouts: the added timeouts have their id reset on completion
 */
export const TimeoutsHandler = class extends BasicHandler {
  _create(item) {
    let name = item[0]
    let delay = item[1]
    let timeoutHandler = item[2]

    this._remove(item)

    this[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this[name] = 0
      timeoutHandler()

      return GLib.SOURCE_REMOVE
    })

    return [[name]]
  }

  remove(name) {
    this._remove([name])
  }

  _remove(item) {
    let name = item[0]

    if (this[name]) {
      GLib.Source.remove(this[name])
      this[name] = 0
    }
  }

  getId(name) {
    return this[name] ? this[name] : 0
  }
}

export function createBoxLayout(options) {
  if (options && 'vertical' in options) {
    let vertical = options.vertical

    delete options.vertical
    setBoxLayoutVertical(options, vertical)
  }

  return new St.BoxLayout(options)
}

export function setBoxLayoutVertical(box, vertical) {
  if (Config.PACKAGE_VERSION >= '48')
    // https://mutter.gnome.org/clutter/enum.Orientation.html
    box.orientation = vertical ? 1 : 0
  else box.vertical = vertical
}

export function getBoxLayoutVertical(box) {
  return Config.PACKAGE_VERSION >= '48' ? box.orientation == 1 : box.vertical
}

// This is wrapper to maintain compatibility with GNOME-Shell 3.30+ as well as
// previous versions.
export const DisplayWrapper = {
  getScreen() {
    return global.screen || global.display
  },

  getWorkspaceManager() {
    return global.screen || global.workspace_manager
  },

  getMonitorManager() {
    return global.screen || global.backend.get_monitor_manager()
  },
}

let unredirectEnabled = true
export const setDisplayUnredirect = (enable) => {
  let v48 = Config.PACKAGE_VERSION >= '48'

  if (enable && !unredirectEnabled)
    v48
      ? global.compositor.enable_unredirect()
      : Meta.enable_unredirect_for_display(global.display)
  else if (!enable && unredirectEnabled)
    v48
      ? global.compositor.disable_unredirect()
      : Meta.disable_unredirect_for_display(global.display)

  unredirectEnabled = enable
}

export const getSystemMenuInfo = function () {
  return {
    name: 'quickSettings',
    constructor: Main.panel.statusArea.quickSettings.constructor,
  }
}

export function getOverviewWorkspaces() {
  let workspaces = []

  Main.overview._overview._controls._workspacesDisplay._workspacesViews.forEach(
    (wv) =>
      (workspaces = [
        ...workspaces,
        ...(wv._workspaces || []), // WorkspacesDisplay --> WorkspacesView (primary monitor)
        ...(wv._workspacesView?._workspaces || []), // WorkspacesDisplay --> SecondaryMonitorDisplay --> WorkspacesView
        ...(wv._workspacesView?._workspace // WorkspacesDisplay --> SecondaryMonitorDisplay --> ExtraWorkspaceView
          ? [wv._workspacesView?._workspace]
          : []),
      ]),
  )

  return workspaces
}

export const getCurrentWorkspace = function () {
  return DisplayWrapper.getWorkspaceManager().get_active_workspace()
}

export const getWorkspaceByIndex = function (index) {
  return DisplayWrapper.getWorkspaceManager().get_workspace_by_index(index)
}

export const getWorkspaceCount = function () {
  return DisplayWrapper.getWorkspaceManager().n_workspaces
}

export const getStageTheme = function () {
  return St.ThemeContext.get_for_stage(global.stage)
}

export const getScaleFactor = function () {
  return getStageTheme().scale_factor || 1
}

export const findIndex = function (array, predicate) {
  if (array) {
    if (Array.prototype.findIndex) {
      return array.findIndex(predicate)
    }

    for (let i = 0, l = array.length; i < l; ++i) {
      if (predicate(array[i])) {
        return i
      }
    }
  }

  return -1
}

export const find = function (array, predicate) {
  let index = findIndex(array, predicate)

  if (index > -1) {
    return array[index]
  }
}

export const mergeObjects = function (main, bck) {
  for (const prop in bck) {
    if (!Object.hasOwn(main, prop) && Object.hasOwn(bck, prop)) {
      main[prop] = bck[prop]
    }
  }

  return main
}

export const getTrackedActorData = (actor) => {
  let trackedIndex = Main.layoutManager._findActor(actor)

  if (trackedIndex >= 0) return Main.layoutManager._trackedActors[trackedIndex]
}

export const getTransformedAllocation = function (actor) {
  let extents = actor.get_transformed_extents()
  let topLeft = extents.get_top_left()
  let bottomRight = extents.get_bottom_right()

  return { x1: topLeft.x, x2: bottomRight.x, y1: topLeft.y, y2: bottomRight.y }
}

export const setClip = function (actor, x, y, width, height, offsetX, offsetY) {
  actor.set_clip(offsetX || 0, offsetY || 0, width, height)
  actor.set_position(x, y)
  actor.set_size(width, height)
}

export const addKeybinding = function (key, settings, handler, modes) {
  if (!Main.wm._allowedKeybindings[key]) {
    Main.wm.addKeybinding(
      key,
      settings,
      Meta.KeyBindingFlags.NONE,
      modes || Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      handler,
    )
  }
}

export const removeKeybinding = function (key) {
  if (Main.wm._allowedKeybindings[key]) {
    Main.wm.removeKeybinding(key)
  }
}

export const getrgbColor = function (color) {
  color =
    typeof color === 'string' ? ColorUtils.color_from_string(color)[1] : color

  return { red: color.red, green: color.green, blue: color.blue }
}

export const getrgbaColor = function (color, alpha, offset) {
  if (alpha <= 0) {
    return 'transparent; '
  }

  let rgb = getrgbColor(color)

  if (offset) {
    ;['red', 'green', 'blue'].forEach((k) => {
      rgb[k] = Math.min(255, Math.max(0, rgb[k] + offset))

      if (rgb[k] == color[k]) {
        rgb[k] = Math.min(255, Math.max(0, rgb[k] - offset))
      }
    })
  }

  return (
    'rgba(' +
    rgb.red +
    ',' +
    rgb.green +
    ',' +
    rgb.blue +
    ',' +
    Math.floor(alpha * 100) * 0.01 +
    '); '
  )
}

export const checkIfColorIsBright = function (color) {
  let rgb = getrgbColor(color)
  let brightness = 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue

  return brightness > 128
}

export const getMouseScrollDirection = function (event) {
  let direction

  switch (event.get_scroll_direction()) {
    case Clutter.ScrollDirection.UP:
    case Clutter.ScrollDirection.LEFT:
      direction = 'up'
      break
    case Clutter.ScrollDirection.DOWN:
    case Clutter.ScrollDirection.RIGHT:
      direction = 'down'
      break
  }

  return direction
}

export function getAllMetaWindows() {
  return global.get_window_actors().map((w) => w.meta_window)
}

export const checkIfWindowHasTransient = function (window) {
  let hasTransient

  window.foreach_transient(() => (hasTransient = true))

  return hasTransient
}

export const activateSiblingWindow = function (
  windows,
  direction,
  startWindow,
) {
  let windowIndex = windows.indexOf(global.display.focus_window)
  let nextWindowIndex =
    windowIndex < 0
      ? startWindow
        ? windows.indexOf(startWindow)
        : 0
      : windowIndex + (direction == 'up' ? -1 : 1)

  if (nextWindowIndex == windows.length) {
    nextWindowIndex = 0
  } else if (nextWindowIndex < 0) {
    nextWindowIndex = windows.length - 1
  }

  if (windowIndex != nextWindowIndex) {
    Main.activateWindow(windows[nextWindowIndex])
  }
}

export const animateWindowOpacity = function (window, tweenOpts) {
  //there currently is a mutter bug with the windowactor opacity, starting with 3.34
  //https://gitlab.gnome.org/GNOME/mutter/issues/836

  //since 3.36, a workaround is to use the windowactor's child for the fade animation
  //this leaves a "shadow" on the desktop, so the windowactor needs to be hidden
  //when the animation is complete
  let visible = tweenOpts.opacity > 0
  let windowActor = window
  let initialOpacity = window.opacity

  window = windowActor.get_first_child() || windowActor

  if (!windowActor.visible && visible) {
    window.opacity = 0
    windowActor.visible = visible
    tweenOpts.opacity = Math.min(initialOpacity, tweenOpts.opacity)
  }

  if (!visible) {
    tweenOpts.onComplete = () => {
      windowActor.visible = visible
      window.opacity = initialOpacity
    }
  }

  animate(window, tweenOpts)
}

export const animate = function (actor, options) {
  //the original animations used Tweener instead of Clutter animations, so we
  //use "time" and "delay" properties defined in seconds, as opposed to Clutter
  //animations "duration" and "delay" which are defined in milliseconds
  if (options.delay) {
    options.delay = options.delay * 1000
  }

  options.duration = options.time * 1000
  delete options.time

  if (options.transition) {
    //map Tweener easing equations to Clutter animation modes
    options.mode =
      {
        easeInCubic: Clutter.AnimationMode.EASE_IN_CUBIC,
        easeInOutCubic: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
        easeInOutQuad: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        easeOutQuad: Clutter.AnimationMode.EASE_OUT_QUAD,
      }[options.transition] || Clutter.AnimationMode.LINEAR

    delete options.transition
  }

  let params = [options]

  if ('value' in options && actor instanceof St.Adjustment) {
    params.unshift(options.value)
    delete options.value
  }

  actor.ease.apply(actor, params)
}

export const stopAnimations = function (actor) {
  actor.remove_all_transitions()
}

export const getIndicators = function (delegate) {
  if (delegate instanceof St.BoxLayout) {
    return delegate
  }

  return delegate.indicators
}

export const getPoint = function (coords) {
  return new Graphene.Point(coords)
}

export const notify = function (
  title,
  body,
  sourceIconName,
  notificationIcon,
  action,
  isTransient,
) {
  let source = MessageTray.getSystemSource()
  let notification = new MessageTray.Notification({
    source,
    title,
    body,
    isTransient: isTransient || false,
    gicon: notificationIcon || null,
  })

  if (sourceIconName) source.iconName = sourceIconName

  if (action) {
    if (!(action instanceof Array)) {
      action = [action]
    }

    action.forEach((a) => notification.addAction(a.text, a.func))
  }

  source.addNotification(notification)
}

/*
 * This is a copy of the same function in utils.js, but also adjust horizontal scrolling
 * and perform few further cheks on the current value to avoid changing the values when
 * it would be clamp to the current one in any case.
 * Return the amount of shift applied
 */
export const ensureActorVisibleInScrollView = function (
  scrollView,
  actor,
  fadeSize,
  onComplete,
) {
  const vadjustment = scrollView.vadjustment
  const hadjustment = scrollView.hadjustment
  let [vvalue, , vupper, , , vpageSize] = vadjustment.get_values()
  let [hvalue, , hupper, , , hpageSize] = hadjustment.get_values()

  let [hvalue0, vvalue0] = [hvalue, vvalue]

  let voffset = fadeSize
  let hoffset = fadeSize

  let box = actor.get_allocation_box()
  let y1 = box.y1,
    y2 = box.y2,
    x1 = box.x1,
    x2 = box.x2

  let parent = actor.get_parent()
  while (parent != scrollView) {
    if (!parent) throw new Error('actor not in scroll view')

    let box = parent.get_allocation_box()
    y1 += box.y1
    y2 += box.y1
    x1 += box.x1
    x2 += box.x1
    parent = parent.get_parent()
  }

  if (y1 < vvalue + voffset) vvalue = Math.max(0, y1 - voffset)
  else if (vvalue < vupper - vpageSize && y2 > vvalue + vpageSize - voffset)
    vvalue = Math.min(vupper - vpageSize, y2 + voffset - vpageSize)

  if (x1 < hvalue + hoffset) hvalue = Math.max(0, x1 - hoffset)
  else if (hvalue < hupper - hpageSize && x2 > hvalue + hpageSize - hoffset)
    hvalue = Math.min(hupper - hpageSize, x2 + hoffset - hpageSize)

  let tweenOpts = {
    time: SCROLL_TIME,
    onComplete: onComplete || (() => {}),
    transition: 'easeOutQuad',
  }

  if (vvalue !== vvalue0) {
    animate(vadjustment, mergeObjects(tweenOpts, { value: vvalue }))
  }

  if (hvalue !== hvalue0) {
    animate(hadjustment, mergeObjects(tweenOpts, { value: hvalue }))
  }

  return [hvalue - hvalue0, vvalue - vvalue0]
}

/**
 *  ColorUtils is adapted from https://github.com/micheleg/dash-to-dock
 */
let colorNs = Clutter.Color ? Clutter : Cogl

export const ColorUtils = {
  color_from_string: colorNs.color_from_string,
  Color: colorNs.Color,

  colorLuminance(r, g, b, dlum) {
    // Darken or brighten color by a fraction dlum
    // Each rgb value is modified by the same fraction.
    // Return "#rrggbb" strin

    let rgbString = '#'

    rgbString += ColorUtils._decimalToHex(
      Math.round(Math.min(Math.max(r * (1 + dlum), 0), 255)),
      2,
    )
    rgbString += ColorUtils._decimalToHex(
      Math.round(Math.min(Math.max(g * (1 + dlum), 0), 255)),
      2,
    )
    rgbString += ColorUtils._decimalToHex(
      Math.round(Math.min(Math.max(b * (1 + dlum), 0), 255)),
      2,
    )

    return rgbString
  },

  _decimalToHex(d, padding) {
    // Convert decimal to an hexadecimal string adding the desired padding

    let hex = d.toString(16)
    while (hex.length < padding) hex = '0' + hex
    return hex
  },

  HSVtoRGB(h, s, v) {
    // Convert hsv ([0-1, 0-1, 0-1]) to rgb ([0-255, 0-255, 0-255]).
    // Following algorithm in https://en.wikipedia.org/wiki/HSL_and_HSV
    // here with h = [0,1] instead of [0, 360]
    // Accept either (h,s,v) independently or  {h:h, s:s, v:v} object.
    // Return {r:r, g:g, b:b} object.

    if (arguments.length === 1) {
      s = h.s
      v = h.v
      h = h.h
    }

    let r, g, b
    let c = v * s
    let h1 = h * 6
    let x = c * (1 - Math.abs((h1 % 2) - 1))
    let m = v - c

    if (h1 <= 1) (r = c + m), (g = x + m), (b = m)
    else if (h1 <= 2) (r = x + m), (g = c + m), (b = m)
    else if (h1 <= 3) (r = m), (g = c + m), (b = x + m)
    else if (h1 <= 4) (r = m), (g = x + m), (b = c + m)
    else if (h1 <= 5) (r = x + m), (g = m), (b = c + m)
    else (r = c + m), (g = m), (b = x + m)

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
    }
  },

  RGBtoHSV(r, g, b) {
    // Convert rgb ([0-255, 0-255, 0-255]) to hsv ([0-1, 0-1, 0-1]).
    // Following algorithm in https://en.wikipedia.org/wiki/HSL_and_HSV
    // here with h = [0,1] instead of [0, 360]
    // Accept either (r,g,b) independently or {r:r, g:g, b:b} object.
    // Return {h:h, s:s, v:v} object.

    if (arguments.length === 1) {
      r = r.r
      g = r.g
      b = r.b
    }

    let h, s, v

    let M = Math.max(r, g, b)
    let m = Math.min(r, g, b)
    let c = M - m

    if (c == 0) h = 0
    else if (M == r) h = ((g - b) / c) % 6
    else if (M == g) h = (b - r) / c + 2
    else h = (r - g) / c + 4

    h = h / 6
    v = M / 255
    if (M !== 0) s = c / M
    else s = 0

    return { h: h, s: s, v: v }
  },
}

/**
 *  DominantColorExtractor is adapted from https://github.com/micheleg/dash-to-dock
 */
let themeLoader = null
let iconCacheMap = new Map()
const MAX_CACHED_ITEMS = 1000
const BATCH_SIZE_TO_DELETE = 50
const DOMINANT_COLOR_ICON_SIZE = 64

export const DominantColorExtractor = class {
  constructor(app) {
    this._app = app
  }

  /**
   * Try to get the pixel buffer for the current icon, if not fail gracefully
   */
  _getIconPixBuf() {
    let iconTexture = this._app.create_icon_texture(16)

    if (themeLoader === null) {
      themeLoader = new St.IconTheme()
    }

    // Unable to load the icon texture, use fallback
    if (iconTexture instanceof St.Icon === false) {
      return null
    }

    iconTexture = iconTexture.get_gicon()

    // Unable to load the icon texture, use fallback
    if (iconTexture === null) {
      return null
    }

    if (iconTexture instanceof Gio.FileIcon) {
      // Use GdkPixBuf to load the pixel buffer from the provided file path
      return GdkPixbuf.Pixbuf.new_from_file(iconTexture.get_file().get_path())
    }

    // Get the pixel buffer from the icon theme
    if (iconTexture instanceof Gio.ThemedIcon) {
      let icon_info = themeLoader.lookup_icon(
        iconTexture.get_names()[0],
        DOMINANT_COLOR_ICON_SIZE,
        0,
      )

      if (icon_info !== null) {
        return icon_info.load_icon()
      }
    }

    return null
  }

  /**
   * The backlight color choosing algorithm was mostly ported to javascript from the
   * Unity7 C++ source of Canonicals:
   * https://bazaar.launchpad.net/~unity-team/unity/trunk/view/head:/launcher/LauncherIcon.cpp
   * so it more or less works the same way.
   */
  _getColorPalette() {
    if (iconCacheMap.get(this._app.get_id())) {
      // We already know the answer
      return iconCacheMap.get(this._app.get_id())
    }

    let pixBuf = this._getIconPixBuf()
    if (pixBuf == null) return null

    let pixels = pixBuf.get_pixels()

    let total = 0,
      rTotal = 0,
      gTotal = 0,
      bTotal = 0

    let resample_y = 1,
      resample_x = 1

    // Resampling of large icons
    // We resample icons larger than twice the desired size, as the resampling
    // to a size s
    // DOMINANT_COLOR_ICON_SIZE < s < 2*DOMINANT_COLOR_ICON_SIZE,
    // most of the case exactly DOMINANT_COLOR_ICON_SIZE as the icon size is tipycally
    // a multiple of it.
    let width = pixBuf.get_width()
    let height = pixBuf.get_height()

    // Resample
    if (height >= 2 * DOMINANT_COLOR_ICON_SIZE)
      resample_y = Math.floor(height / DOMINANT_COLOR_ICON_SIZE)

    if (width >= 2 * DOMINANT_COLOR_ICON_SIZE)
      resample_x = Math.floor(width / DOMINANT_COLOR_ICON_SIZE)

    if (resample_x !== 1 || resample_y !== 1)
      pixels = this._resamplePixels(pixels, resample_x, resample_y)

    // computing the limit outside the for (where it would be repeated at each iteration)
    // for performance reasons
    let limit = pixels.length
    for (let offset = 0; offset < limit; offset += 4) {
      let r = pixels[offset],
        g = pixels[offset + 1],
        b = pixels[offset + 2],
        a = pixels[offset + 3]

      let saturation = Math.max(r, g, b) - Math.min(r, g, b)
      let relevance = 0.1 * 255 * 255 + 0.9 * a * saturation

      rTotal += r * relevance
      gTotal += g * relevance
      bTotal += b * relevance

      total += relevance
    }

    total = total * 255

    let r = rTotal / total,
      g = gTotal / total,
      b = bTotal / total

    let hsv = ColorUtils.RGBtoHSV(r * 255, g * 255, b * 255)

    if (hsv.s > 0.15) hsv.s = 0.65
    hsv.v = 0.9

    let rgb = ColorUtils.HSVtoRGB(hsv.h, hsv.s, hsv.v)

    // Cache the result.
    let backgroundColor = {
      lighter: ColorUtils.colorLuminance(rgb.r, rgb.g, rgb.b, 0.2),
      original: ColorUtils.colorLuminance(rgb.r, rgb.g, rgb.b, 0),
      darker: ColorUtils.colorLuminance(rgb.r, rgb.g, rgb.b, -0.5),
    }

    if (iconCacheMap.size >= MAX_CACHED_ITEMS) {
      //delete oldest cached values (which are in order of insertions)
      let ctr = 0
      for (let key of iconCacheMap.keys()) {
        if (++ctr > BATCH_SIZE_TO_DELETE) break
        iconCacheMap.delete(key)
      }
    }

    iconCacheMap.set(this._app.get_id(), backgroundColor)

    return backgroundColor
  }

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
  _resamplePixels(pixels, resampleX, resampleY) {
    let resampledPixels = []
    // computing the limit outside the for (where it would be repeated at each iteration)
    // for performance reasons
    let limit = pixels.length / (resampleX * resampleY) / 4
    for (let i = 0; i < limit; i++) {
      let pixel = i * resampleX * resampleY

      resampledPixels.push(pixels[pixel * 4])
      resampledPixels.push(pixels[pixel * 4 + 1])
      resampledPixels.push(pixels[pixel * 4 + 2])
      resampledPixels.push(pixels[pixel * 4 + 3])
    }

    return resampledPixels
  }
}

export const drawRoundedLine = function (
  cr,
  x,
  y,
  width,
  height,
  isRoundLeft,
  isRoundRight,
  stroke,
  fill,
) {
  if (height > width) {
    y += Math.floor((height - width) / 2.0)
    height = width
  }

  height = 2.0 * Math.floor(height / 2.0)

  const leftRadius = isRoundLeft ? height / 2.0 : 0.0
  const rightRadius = isRoundRight ? height / 2.0 : 0.0

  cr.moveTo(x + width - rightRadius, y)
  cr.lineTo(x + leftRadius, y)
  if (isRoundLeft)
    cr.arcNegative(
      x + leftRadius,
      y + leftRadius,
      leftRadius,
      -Math.PI / 2,
      Math.PI / 2,
    )
  else cr.lineTo(x, y + height)
  cr.lineTo(x + width - rightRadius, y + height)
  if (isRoundRight)
    cr.arcNegative(
      x + width - rightRadius,
      y + rightRadius,
      rightRadius,
      Math.PI / 2,
      -Math.PI / 2,
    )
  else cr.lineTo(x + width, y)
  cr.closePath()

  if (fill != null) {
    cr.setSource(fill)
    cr.fillPreserve()
  }
  if (stroke != null) cr.setSource(stroke)
  cr.stroke()
}
