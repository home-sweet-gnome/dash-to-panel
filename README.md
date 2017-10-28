 ![](https://github.com/LinxGem33/Neon/blob/master/artwork/dash-to-panel-wide-banner5.png?raw=true)
##
![](https://github.com/LinxGem33/Neon/blob/master/artwork/dtp-main-p2.png?raw=true)

## 
### Introduction

Dash to Panel is an icon taskbar for Gnome Shell. This extension moves the dash into the gnome main panel so that the application launchers and system tray are combined into a single panel, similar to that found in KDE Plasma and Windows 7+. A separate dock is no longer needed for easy access to running and favorited applications.
##
### Dash to Panel features

Some of dash to panel’s features include customizable indicators and launcher style number overlays, so if you’re a fan of the Unity launcher style number overlays that can be used to launch apps you may want to take advantage another feature are live previews on hover illustrated below, if you want to access more features and configure dash to panel the way you want then just click on the options button via gnome tweak tool.

##

|Live Previews on Hover|
|-----|
|![screenshot](https://github.com/LinxGem33/Neon/blob/master/artwork/previews.gif?raw=true)|
|Dash to Panel v9 adds a couple of new features, including a Window Peek mode lets you hover over a task bar preview to see a full-size preview of that app’s window. Helpful for finding a specific app window|

|Customizable running indicators|ALT Indicators|
|:-----:|-----|
|![](https://github.com/LinxGem33/Neon/blob/master/artwork/indicators.png?raw=true)|![](https://github.com/LinxGem33/Neon/blob/master/artwork/indicators4.png?raw=true)|

|Launch by Number|
|:-----:|
|![](https://github.com/LinxGem33/Neon/blob/master/artwork/indicators-num.png.png?raw=true)|
|Dash to panel Has the ability to customize the running indicators to access this feature just open up dash to panel’s settings from gnome tweak tool. So if you’re a fan of the Unity launcher style number overlays that can be used to launch apps you may want to take advantage of the new setting, as the number overlays can now be set to show all the time.|

##
### Contribute & volunteer

Currently dash to panel has enhancements that are not assigned to anyone and are of high priority, if you feel that you have the ability and could contribute to any of the open enhancements please click on the reference number to get more information about the specific enhancement you want to work on, you will see a table below with all the current open issues tagged as enhancements and high priority.
##
|Assigned|Unassigned|
|:-----:|:-----:|
|![](https://github.com/LinxGem33/Neon/blob/master/artwork/done.svg.png?raw=true)|![](https://github.com/LinxGem33/Neon/blob/master/artwork/planned.svg.png?raw=true)|

|Current high priority enhancements that are not assigned to anyone |Issue ref:|Assigned|Contributor|
|:-----|:-----:|:-----:|:-----:|
|Ungroup Applications on TaskBar Panel?|[#208](https://github.com/jderose9/dash-to-panel/issues/208)|![](https://github.com/LinxGem33/Neon/blob/master/artwork/planned.svg.png?raw=true)||
| Add option to show window titles in tasks buttons |[#115](https://github.com/jderose9/dash-to-panel/issues/115)| ![](https://github.com/LinxGem33/Neon/blob/master/artwork/planned.svg.png?raw=true)||
| Launcher icons disappear (issue reocurrence with v7) |[#92](https://github.com/jderose9/dash-to-panel/issues/92)| ![](https://github.com/LinxGem33/Neon/blob/master/artwork/planned.svg.png?raw=true)||
| Add Intellihide behavior to panel |[#41](https://github.com/jderose9/dash-to-panel/issues/41)|![](https://github.com/LinxGem33/Neon/blob/master/artwork/planned.svg.png?raw=true)||
| Option to Move Panel to Left or Right |[#3](https://github.com/jderose9/dash-to-panel/issues/3)|![](https://github.com/LinxGem33/Neon/blob/master/artwork/planned.svg.png?raw=true)||

##
### Installation

The easiest way to install Dash-to-Panel is from [Gnome Shell Extensions](https://extensions.gnome.org/extension/1160/dash-to-panel/).

## 
### Installation from source

The extension can be installed directly from source, either for the convenience of using git or to test the latest development version. Please be aware that if you install the extension from git, Gnome will no longer notify you of future updates available from extensions.gnome.org.

Clone the desired branch with git
<pre>git clone https://github.com/jderose9/dash-to-panel.git</pre>
or download the branch from github. A simple Makefile is included. Then run
<pre>make
make install
</pre>
to install the extension in your home directory. A Shell reload is required <code>Alt+F2 r Enter</code> and the extension has to be enabled  with *gnome-tweak-tool* or with *dconf*.

## 
### Compatibility

This extension has been tested with Gnome 3.18+.

This extension manipulates the Gnome Main Panel, aka Top Bar. So, most other extensions which operate on the top bar should be compatible.

## 
### FAQ

How do I embed my bottom left notification drawer into the panel like a system tray? [Top Icons Plus](https://extensions.gnome.org/extension/1031/topicons)

How do I add a traditional start menu? [Arc Menu](https://extensions.gnome.org/extension/1228/arc-menu/) or [Gno-Menu](https://extensions.gnome.org/extension/608/gnomenu/)

How do I disable the hot corner? [No Topleft Hot Corner](https://extensions.gnome.org/extension/118/no-topleft-hot-corner)

How do I move the notifications to somewhere other than the top center? [Panel OSD](https://extensions.gnome.org/extension/708/panel-osd)

How do I add transparency to the panel? [Dynamic Panel Transparency](https://extensions.gnome.org/extension/1011/dynamic-panel-transparency/)

How do I change workspaces by scrolling the mouse wheel in the empty space? [Top Panel Workspace Scroll](https://extensions.gnome.org/extension/701/top-panel-workspace-scroll/)

How do I display Minimize & Maximize buttons? In the Tweak Tool application, turn on `Windows > Titlebar Buttons > Minimize & Maximize`.

Why can't I put the panel vertically on the left or right of the display? Gnome-shell and it's numerous extensions add widgets to the panel. These widgets have been designed using padding and absolute positioning assuming a horizontal layout. At this point in time, I don't think it is possible to allow for a vertical layout and still maintain any sort of reasonable compatibility with many of the other features of Gnome.

## 
### Themes
While this extension works well with most popular Gnome Shell themes, the following themes are known to have explicitly added custom styles for this extension:
- [Ciliora Tertia](https://github.com/zagortenay333/ciliora-tertia-shell) / [Ciliora Secunda](https://github.com/zagortenay333/ciliora-secunda-shell)
- [Plano](https://github.com/lassekongo83/plano-theme)

## 
### Bug Reporting

Bugs should be reported on the [Github bug tracker](https://github.com/jderose9/dash-to-panel/issues).

## 
### License & Terms ![](https://github.com/LinxGem33/IP-Finder/blob/master/screens/Copyleft-16.png?raw=true)

Dash to Panel is available under the terms of the GPL-v2 or later license See [`COPYING`](https://github.com/jderose9/dash-to-panel/blob/master/COPYING) for details.

## 
### Credits

Much of the code in this extension comes from [Dash-to-Dock](https://micheleg.github.io/dash-to-dock/index.html).

Additional credits: This extension leverages the work for [ZorinOS Taskbar](https://github.com/ZorinOS/zorin-taskbar) used in [ZorinOS](https://zorinos.com/) to allow the dash from [Dash-to-Dock](https://micheleg.github.io/dash-to-dock/index.html) to be embedded in the Gnome main panel.
Code to set anchor position taken from [Thoma5/gnome-shell-extension-bottompanel](https://github.com/Thoma5/gnome-shell-extension-bottompanel).
Pattern for moving panel contents based on [Frippery Move Clock](http://frippery.org/extensions/) by R M Yorston.
Ideas for recursing child actors and assigning inline styles are based on code from the extension [StatusAreaHorizontalSpacing](https://bitbucket.org/mathematicalcoffee/status-area-horizontal-spacing-gnome-shell-extension).
##

#### Thanks to the following people for contributing via pull requests:

- @franglais125 for launching apps by number (w/ overlay), bug fixes, and issue support
- @dziku1337 for peek mode in window previews
- @robrobinbin for configuring appMenu on/off in the panel
- @MartinPL for toggling favorites on/off in panel
- @jackwickham for thumbnail middle and right click actions

#### Bug Fixes: 
@imrvelj, @Teslator, @bil-elmoussaoui, @brandon-schumann, @sw9, @rockon999 , @lexruee, @3v1n0

#### Translations: 
@frnogueira (pt_BR), @zeten30 (cs_CZ), @franglais125 (es), @LaurentTreguier / @SolarLiner (fr), @elsieholmes (uk), @hosiet (zh\_CN), @jonnius (de), @urbalazs (hu), @crayxt (kk), @pkomur (pl), @AlexGluck (ru)
##
 ![](https://img.shields.io/badge/Language-JavaScript-yellow.svg) ![](https://img.shields.io/badge/Licence-GPL--2.0-blue.svg)
