# Dash to Panel
![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/screenshot.png)

## An icon-only taskbar for the GNOME Shell
An icon-only taskbar for the Gnome Shell. This extension moves the dash into the gnome main panel (top bar) to behave as an icon-only task manager similar to that found in KDE Plasma and Windows 7+.

## Installation from source

The extension can be installed directly from source, either for the convenience of using git or to test the latest development version. Clone the desired branch with git

<pre>git clone https://github.com/jderose9/dash-to-panel.git</pre>
or download the branch from github. A simple Makefile is included. Then run
<pre>make
make install
</pre>
to install the extension in your home directory. A Shell reload is required <code>Alt+F2 r Enter</code> and the extension has to be enabled  with *gnome-tweak-tool* or with *dconf*.

## Features
- Embed dash-to-dock in gnome top bar
- Move main panel (top bar) to bottom of screen
- Resize main panel

## TODO
- disable built-in dash
- allow tray items to be reordered
- reorder "activities" and open apps view" buttons when both visible
- resize of tray icons and font
- resize of extension icons added to left box (gno-menu for instance) to match dash icon size
- replace activities (overview) button text with an icon
- assign middle click behavior
- assign left click behavior when multiple windows of same app is open
- allow disabling "open apps view" animation
- hide "open apps view" button
- allow moving running apps indicator to above icons
- configure icon spacing


## Bug Reporting

Bugs should be reported to the Github bug tracker [https://github.com/jderose9/dash-to-panel/issues](https://github.com/jderose9/dash-to-panel/issues).

## License
Dash to Panel Gnome Shell extension is distributed under the terms of the GNU General Public License,
version 2 or later. See the COPYING file for details.

## Credits
The bulk of the code in this extension comes from [Dash-to-Dock](https://micheleg.github.io/dash-to-dock/index.html).
This extension leverages the work for [ZorinOS Taskbar](https://github.com/ZorinOS/zorin-taskbar) used in [ZorinOS](https://zorinos.com/) to allow the dash from [Dash-to-Dock](https://micheleg.github.io/dash-to-dock/index.html) to be embedded in the Gnome main panel.