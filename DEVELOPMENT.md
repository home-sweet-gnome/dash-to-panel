# Development Notes

## Applying changes without logout (GNOME 46 Wayland)

On GNOME 46 Wayland, `gnome-extensions disable/enable` does **not** reload
extension JS — GNOME Shell caches ESM modules for the lifetime of the process.

**`prefs.js` changes** take effect immediately — the prefs dialog runs in a
separate process and is freshly spawned each time.

**All other JS changes** (`panel.js`, `appIcons.js`, `taskbar.js`, etc.) require
a shell restart to clear the module cache.

### Restarting the shell without logging out

Use **Looking Glass** (`Alt+F2` → type `lg` → Enter), go to the **Console** tab,
and run:

```js
Meta.restart("Restarting...", global.context)
```

This restarts the GNOME Shell process in-place. Wayland clients (apps) survive and
reconnect; the shell reloads all extension JS from disk.

> Note: `Alt+F2 → r` (the classic X11 shortcut) is **disabled** on Wayland.
> `Meta.restart()` with two arguments is required on GNOME 46+.

### Looking Glass inspector

Looking Glass also has an **Inspector** (pick-icon in the toolbar): click it, then
click any shell actor on screen to inspect its properties, style, children, and
allocation in real time. Useful for diagnosing layout/centering issues without
adding `log()` calls.

## Clutter BoxLayout: x_expand vs x_align

When a child of `St.BoxLayout` / `Clutter.BoxLayout` has `x_expand: true`, the
layout gives it a larger **slot** (natural size + extra space). However, `x_align`
controls how the child uses that slot:

- `x_align = START` / `CENTER` / `END`: actor uses only its **natural width** within
  the slot, positioned accordingly. Extra space is wasted. ClutterText inside will
  ellipsize at its natural width even though the slot is bigger.
- `x_align = FILL`: actor **fills the entire slot**. ClutterText gets the full width
  and only ellipsizes when text genuinely doesn't fit.

So for a label that should fill available horizontal space, always pair
`x_expand: true` with `x_align: Clutter.ActorAlign.FILL`. The text inside will
still render left-to-right (left-aligned) naturally.

### Evaluating JS against live shell objects

```js
// Get the DTP panel actor
Main.layoutManager.panelBox
// Inspect an actor's allocation
let a = Main.panel._leftBox; a.get_allocation_box()
```
