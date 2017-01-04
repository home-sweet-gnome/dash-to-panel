# Dash to Panel
![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/screenshot.png)

## An icon taskbar for the GNOME Shell
An icon taskbar for the Gnome Shell. This extension moves the dash into the gnome main panel (top bar) to behave as an icon-only task manager similar to that found in KDE Plasma and Windows 7+.

## Features
- Move the Application Dash from the Overview into the top bar. This allows a Win7/Plasma style de-duped favorites + launcher bar without a separate application dock.
- Running indicator includes window count and can be positioned at top or bottom of panel.
- Preview of open windows when hovering over their icons
- Set Panel position (top/bottom) and height
- Configure clock location
- Remove "Show Apps" icon from dash
- Hide Activities button from panel
- Isolate running apps in workspaces
- Assign font & icon sizes and margins for dash icons, status icons and panel elements

## Installation from source

The extension can be installed directly from source, either for the convenience of using git or to test the latest development version. Clone the desired branch with git

<pre>git clone https://github.com/jderose9/dash-to-panel.git</pre>
or download the branch from github. A simple Makefile is included. Then run
<pre>make
make install
</pre>
to install the extension in your home directory. A Shell reload is required <code>Alt+F2 r Enter</code> and the extension has to be enabled  with *gnome-tweak-tool* or with *dconf*.

**I recommend setting Top Bar > Show Applications Menu off in Gnome Tweak Tool.** This will cause the applications menu for native gnome apps (which normally appears in the top bar) to be presented in the top left of the window.

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