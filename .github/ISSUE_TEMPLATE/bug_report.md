---
name: Bug report
about: Let us know you are experiencing a problem
title: ''
labels: bug
assignees: ''

---

**Things to do first**
- Confirm that the problem persists when Dash-to-Panel is the only enabled extension. To do so, disable every other extension, then restart gnome-shell by running the `r` command from the prompt that appears when pressing Alt+F2 on an X.org session, or by logging out/in on a Wayland session.
- Look for Dash-to-Panel errors in your log. To do so, run the `journalctl /usr/bin/gnome-shell -f -o cat &` command and reproduce the problem.
- Search existing opened and closed issues to see if the problem has already been reported.

**Describe the bug**
A clear and concise description of what the problem is, any steps to reproduce, and what you expected to happen instead.

**Linux distribution and version**
Ubuntu 18.04, Fedora 31, Manjaro 19.02, Arch, Debian 10.3, openSUSE Leap 15.1, etc.

**GNOME Shell version**
Run `gnome-shell --version` from the command line to get this

**Dash-to-Panel version**
This can be seen in the Dash-to-Panel Settings in the About tab.

**Where was Dash-to-Panel installed from?**
The GNOME extensions website, GNOME Software store, your distribution's package manager, pre-installed with the distribution, directly from github, etc.

**Screenshots / Video captures**
If applicable, add screenshots or a link to a video capture to help explain your problem.

**Additional Info**
