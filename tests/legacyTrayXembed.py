import ctypes
import json
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import GLib, Gtk


def emit(event, **values):
    print(json.dumps({"event": event, **values}), flush=True)


x11 = ctypes.CDLL("libX11.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XGetSelectionOwner.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XGetSelectionOwner.restype = ctypes.c_ulong
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("An X11 or XWayland display is required")
atom = x11.XInternAtom(display, b"_NET_SYSTEM_TRAY_S0", False)
owner = x11.XGetSelectionOwner(display, atom)
x11.XCloseDisplay(display)
emit("ready", owner=owner)

icon = Gtk.StatusIcon.new_from_icon_name("dialog-information")
icon.set_title("DTP legacy tray test")
icon.set_tooltip_text("Experimental Wine/Proton compatibility test")
icon.connect("activate", lambda *_: emit("activate"))
icon.connect("popup-menu", lambda *_: emit("menu"))
icon.set_visible(True)


def geometry():
    valid, _, rectangle, _ = icon.get_geometry()
    if valid:
        emit("geometry", embedded=icon.is_embedded(), x=rectangle.x, y=rectangle.y,
             width=rectangle.width, height=rectangle.height)
    return True


def finish(*_):
    icon.set_visible(False)
    Gtk.main_quit()
    return False


def receive(fd, condition):
    os.read(fd, 4096)
    return finish()


GLib.timeout_add(200, geometry)
GLib.timeout_add_seconds(20, finish)
GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP, receive)
Gtk.main()
