# Dash to Panel
![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/screenshot.png)

## An icon taskbar for the GNOME Shell
An icon taskbar for the Gnome Shell. This extension moves the dash into the gnome main panel so that the application launchers and system tray are combined into a single panel, similar to that found in KDE Plasma and Windows 7+. A separate dock is no longer needed for easy access to running and favorited applications.

The easiest way to install Dash-to-Panel is from [Gnome Shell Extensions](https://extensions.gnome.org/extension/1160/dash-to-panel/).

## Features
- Move the Application Dash from the Overview into the main panel (top bar)
- Set main panel position (top or bottom) and height
- Running indicator includes window count and can be positioned at top or bottom of panel
- Preview of open windows when hovering over icons of running applications
- Launch applications using numbers 0-9 as hotkeys.
- Configure clock location
- Remove "Show Apps" icon from dash
- Hide Activities and App Menu buttons from panel
- Isolate running apps in workspaces
- Assign click behaviors (launch new window, cycle open windows, minimize, etc)
- Assign font & icon sizes and margins for dash icons, status icons and panel elements


## Installation from source

The extension can be installed directly from source, either for the convenience of using git or to test the latest development version. Please be aware that if you install the extension from git, Gnome will no longer notify you of future updates available from extensions.gnome.org.

Clone the desired branch with git
<pre>git clone https://github.com/jderose9/dash-to-panel.git</pre>
or download the branch from github. A simple Makefile is included. Then run
<pre>make
make install
</pre>
to install the extension in your home directory. A Shell reload is required <code>Alt+F2 r Enter</code> and the extension has to be enabled  with *gnome-tweak-tool* or with *dconf*.

**I recommend setting Top Bar > Show Applications Menu off in Gnome Tweak Tool.** This will cause the applications menu for native gnome apps (which normally appears in the top bar) to be presented in the top left of the window. It is also recommended to turn Windows > Titlebar Buttons > Minimize & Maximize on.

## Compatibility

This extension has been tested with Gnome 3.18+.

This extension manipulates the Gnome Main Panel, aka Top Bar. So, most other extensions which operate on the top bar should be compatible.

## FAQ

How do I add transparency to the panel? [Dynamic Panel Transparency](https://extensions.gnome.org/extension/1011/dynamic-panel-transparency/)

How do I change workspaces by scrolling the mouse wheel in the empty space? [Top Panel Workspace Scroll](https://extensions.gnome.org/extension/701/top-panel-workspace-scroll/)

How do I add a traditional start menu? [Gno-Menu](https://extensions.gnome.org/extension/608/gnomenu/)

Why can't I put the panel vertically on the left or right of the display? Gnome-shell and it's numerous extensions add widgets to the panel. These widgets have been designed using padding and absolute positioning assuming a horizontal layout. At this point in time, I don't think it is possible to allow for a vertical layout and still maintain any sort of reasonable compatibility with many of the other features of Gnome.

## Bug Reporting

Bugs should be reported to the Github bug tracker [https://github.com/jderose9/dash-to-panel/issues](https://github.com/jderose9/dash-to-panel/issues).

## License
Dash to Panel Gnome Shell extension is distributed under the terms of the GNU General Public License,
version 2 or later. See the COPYING file for details.

## Credits
Much of the code in this extension comes from [Dash-to-Dock](https://micheleg.github.io/dash-to-dock/index.html).
This extension leverages the work for [ZorinOS Taskbar](https://github.com/ZorinOS/zorin-taskbar) used in [ZorinOS](https://zorinos.com/) to allow the dash from [Dash-to-Dock](https://micheleg.github.io/dash-to-dock/index.html) to be embedded in the Gnome main panel.
Code to set anchor position taken from [Thoma5/gnome-shell-extension-bottompanel](https://github.com/Thoma5/gnome-shell-extension-bottompanel).
Pattern for moving panel contents based on [Frippery Move Clock](http://frippery.org/extensions/) by R M Yorston.
Ideas for recursing child actors and assigning inline styles are based on code from the extension [StatusAreaHorizontalSpacing](https://bitbucket.org/mathematicalcoffee/status-area-horizontal-spacing-gnome-shell-extension).

Also, thanks to @robrobinbin and @franglais125 for contributing via pull requests.