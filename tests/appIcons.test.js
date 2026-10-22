import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// GObject actors require a compositor. Run the unmodified window/count methods
// against their label and visibility boundary, without copying their logic.
const source = readFileSync(
  new URL('../src/appIcons.js', import.meta.url),
  'utf8',
)
const methods = [
  '_updateWindows',
  '_handleNotifications',
  '_maybeUpdateNumberOverlay',
]
  .map(
    (name) =>
      source.match(
        new RegExp(`^    ${name}\\([^)]*\\) \\{[\\s\\S]*?^    \\}`, 'm'),
      )[0],
  )
  .join(',\n')
const behavior = vm.runInNewContext(`({${methods}})`, {
  SETTINGS: { get_boolean: () => true },
  Hold: { NOTIFY: 1 },
  MAX_INDICATORS: 4,
})

function icon(
  appIcons = [],
  intellihide = {
    held: false,
    revealAndHold() {
      this.held = true
    },
    release() {
      this.held = false
    },
  },
) {
  let windows = [{}]
  let state = { total: 4, urgent: false }
  const label = {
    text: '',
    get_text() {
      return this.text
    },
    set_text(text) {
      this.text = text
    },
    add_style_class_name() {},
    remove_style_class_name() {},
  }
  const bin = {
    visible: false,
    show() {
      this.visible = true
    },
    hide() {
      this.visible = false
    },
  }
  const appIcon = Object.assign(
    {
      app: { id: 'org.example.Messenger.desktop' },
      window: null,
      _numberOverlayBin: bin,
      _numberOverlayLabel: label,
      _previewMenu: { update() {} },
      _numberHotkeysOverlayLabel: -1,
      getAppIconInterestingWindows: () => windows,
      add_style_class_name() {},
      remove_style_class_name() {},
      _updateNumberOverlay() {},
      icon: { _iconBin: {} },
      iconAnimator: { addAnimation() {}, removeAnimation() {} },
      dtpPanel: {
        panelManager: { notificationsMonitor: { getState: () => state } },
        taskbar: { _getAppIcons: () => appIcons },
        intellihide,
      },
    },
    behavior,
  )
  appIcons.push(appIcon)
  return {
    appIcon,
    label,
    bin,
    intellihide,
    windows(value) {
      windows = value
      appIcon._updateWindows()
    },
    state(value) {
      state = value
      appIcon._handleNotifications()
    },
  }
}

test('closing the last window hides its badge and reopening restores the count', () => {
  const h = icon()
  h.appIcon._nWindows = 1
  h.appIcon._handleNotifications()
  assert.equal(h.label.text, '4')
  assert.equal(h.bin.visible, true)
  h.windows([])
  assert.equal(h.bin.visible, false)
  h.windows([{}])
  assert.equal(h.bin.visible, true)
  assert.equal(h.label.text, '4')
})

test('an absent monitor state cannot leave a previous badge visible', () => {
  const h = icon()
  h.appIcon._nWindows = 1
  h.appIcon._handleNotifications()
  h.state(undefined)
  assert.equal(h.bin.visible, false)
})

test('an unrelated icon cannot release another icon notification hold', () => {
  const appIcons = []
  const first = icon(appIcons)
  const second = icon(appIcons, first.intellihide)
  second.state(undefined)
  first.windows([{}])
  assert.equal(first.intellihide.held, true)
  second.windows([{}])
  assert.equal(first.intellihide.held, true)
  first.windows([])
  assert.equal(first.intellihide.held, false)
})
