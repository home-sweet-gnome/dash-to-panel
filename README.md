# Dash to Panel
![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/screenshot.png)

## An icon taskbar for the GNOME Shell
An icon taskbar for the Gnome Shell. This extension moves the dash into the gnome main panel so that the application launchers and system tray are combined into a single panel, similar to that found in KDE Plasma and Windows 7+. A separate dock is no longer needed for easy access to running and favorited applications.

The easiest way to install Dash-to-Panel is from [Gnome Shell Extensions](https://extensions.gnome.org/extension/1160/dash-to-panel/).

## Features

#### Live previews on hover

![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/windowpreview.png)

#### Customizable running indicators

![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/metro.png)

![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/ciliora.png)

![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/dashes.png)

![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/squares-segmented.png)

#### Launch by number

![screenshot](https://github.com/jderose9/dash-to-panel/raw/master/media/numlaunch.png)

#### ... and more!

* Set main panel position (top or bottom) and height
* Configure clock location
* Remove "Show Apps" icon from dash
* Add "Show Desktop" button to panel
* Hide Activities and App Menu buttons from panel
* Isolate running apps in workspaces
* Assign click behaviors (launch new window, cycle open windows, minimize, etc)
* Assign font & icon sizes and margins for dash icons, status icons and panel elements
* AppMenu for native Gnome apps is integrated into right-click secondary menu

## Installation from source

The extension can be installed directly from source, either for the convenience of using git or to test the latest development version. Please be aware that if you install the extension from git, Gnome will no longer notify you of future updates available from extensions.gnome.org.

Clone the desired branch with git
<pre>git clone https://github.com/jderose9/dash-to-panel.git</pre>
or download the branch from github. A simple Makefile is included. Then run
<pre>make
make install
</pre>
to install the extension in your home directory. A Shell reload is required <code>Alt+F2 r Enter</code> and the extension has to be enabled  with *gnome-tweak-tool* or with *dconf*.

## Compatibility

This extension has been tested with Gnome 3.18+.

This extension manipulates the Gnome Main Panel, aka Top Bar. So, most other extensions which operate on the top bar should be compatible.

## FAQ

How do I embed my bottom left notification drawer into the panel like a system tray? [Top Icons Plus](https://extensions.gnome.org/extension/1031/topicons)

How do I add a traditional start menu? [Gno-Menu](https://extensions.gnome.org/extension/608/gnomenu/)

How do I disable the hot corner? [No Topleft Hot Corner](https://extensions.gnome.org/extension/118/no-topleft-hot-corner)

How do I move the notifications to somewhere other than the top center? [Panel OSD](https://extensions.gnome.org/extension/708/panel-osd)

How do I add transparency to the panel? [Dynamic Panel Transparency](https://extensions.gnome.org/extension/1011/dynamic-panel-transparency/)

How do I change workspaces by scrolling the mouse wheel in the empty space? [Top Panel Workspace Scroll](https://extensions.gnome.org/extension/701/top-panel-workspace-scroll/)

How do I display Minimize & Maximize buttons? In the Tweak Tool application, turn on `Windows > Titlebar Buttons > Minimize & Maximize`.

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

Thanks to the following people for contributing via pull requests:
- @franglais125 for launching apps by number (w/ overlay)
- @robrobinbin for configuring appMenu on/off in the panel
- @frnogueira, @zeten30 for translations
