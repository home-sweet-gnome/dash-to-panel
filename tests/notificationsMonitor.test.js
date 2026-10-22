import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// Shell resources require a running compositor; execute the real monitor with
// only its Shell signal sources and D-Bus transport replaced.
const source = readFileSync(
  new URL('../src/notificationsMonitor.js', import.meta.url),
  'utf8',
)
  .replace(/^import .*$/gm, '')
  .replace(
    'export const NotificationsMonitor',
    'globalThis.NotificationsMonitor',
  )

function setup(t) {
  const tracker = new EventEmitter()
  const tray = new EventEmitter()
  const sources = []
  tray.getSources = () => sources
  const subscriptions = new Map()
  let nextId = 1
  class SignalsHandler {
    handlers = new Map()
    add(...entries) {
      this.addWithLabel('generic', ...entries)
    }
    addWithLabel(label, ...entries) {
      this.handlers.set(label, [
        ...(this.handlers.get(label) || []),
        ...entries,
      ])
      entries.forEach(([object, signal, callback]) =>
        object.on(signal, callback),
      )
    }
    removeWithLabel(label) {
      for (const [object, signal, callback] of this.handlers.get(label) || [])
        object.off(signal, callback)
      this.handlers.delete(label)
    }
    destroy() {
      for (const label of this.handlers.keys()) this.removeWithLabel(label)
    }
  }
  const context = vm.createContext({
    Gio: {
      DBusSignalFlags: { NONE: 0 },
      BusNameOwnerFlags: { ALLOW_REPLACEMENT: 1 },
      DBus: {
        session: {
          signal_subscribe(...args) {
            const id = nextId++
            subscriptions.set(id, args)
            return id
          },
          signal_unsubscribe: (id) => subscriptions.delete(id),
          own_name: () => 1,
          unown_name() {},
        },
      },
    },
    Main: { messageTray: tray },
    MessageTray: {
      NotificationApplicationPolicy: class {},
      Urgency: { NORMAL: 1 },
    },
    EventEmitter,
    tracker,
    Utils: { GlobalSignalsHandler: SignalsHandler },
  })
  vm.runInContext(source, context)
  const monitor = new context.NotificationsMonitor()
  t.after(() => monitor.destroy())
  function signal(iface, member, sender, values) {
    for (const args of subscriptions.values())
      if (args[1] === iface && args[2] === member)
        args[6](null, sender, '/', iface, member, { deep_unpack: () => values })
  }
  function update(app, properties, sender = ':1.42') {
    signal('com.canonical.Unity.LauncherEntry', 'Update', sender, [
      `application://${app.id}`,
      Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          { unpack: () => value },
        ]),
      ),
    ])
  }
  return {
    monitor,
    update,
    focus(app) {
      tracker.focus_app = app
      tracker.emit('notify::focus-app', tracker)
    },
    publish(app, count, visible = true, sender = ':1.42') {
      update(app, { count, 'count-visible': visible }, sender)
    },
    disconnect(sender) {
      signal(
        'org.freedesktop.DBus',
        'NameOwnerChanged',
        'org.freedesktop.DBus',
        [sender, sender, ''],
      )
    },
    addSource(app, count) {
      const source = Object.assign(new EventEmitter(), {
        _appId: app.id,
        count,
        notifications: [],
      })
      sources.push(source)
      tray.emit('source-added', tray, source)
      return source
    },
    removeSource(source) {
      sources.splice(sources.indexOf(source), 1)
      tray.emit('source-removed', tray, source)
    },
  }
}

const app = { id: 'org.example.Messenger.desktop' }

test('focusing a window preserves the application unread count', (t) => {
  const h = setup(t)
  h.publish(app, 4)
  h.addSource(app, 2)
  h.focus(app)
  assert.equal(h.monitor.getState(app).total, 4)
  h.publish(app, 3)
  assert.equal(h.monitor.getState(app).total, 3)
  h.focus(null)
  assert.equal(h.monitor.getState(app).total, 3)
})

test('an explicit zero or hidden application counter beats stale notifications', (t) => {
  const h = setup(t)
  h.addSource(app, 6)
  h.publish(app, 0)
  assert.equal(h.monitor.getState(app).total, 0)
  h.publish(app, 4, false)
  assert.equal(h.monitor.getState(app).total, 0)
  h.publish(app, 2)
  assert.equal(h.monitor.getState(app).total, 2)
})

test('tray-only applications still clear notifications on focus', (t) => {
  const h = setup(t)
  h.addSource(app, 3)
  assert.equal(h.monitor.getState(app).total, 3)
  h.focus(app)
  assert.equal(h.monitor.getState(app).total, 0)
})

test('removing the last notification source clears its cached count', (t) => {
  const h = setup(t)
  const source = h.addSource(app, 5)
  h.removeSource(source)
  assert.equal(h.monitor.getState(app).total, 0)
})

test('removing one source keeps the remaining source live', (t) => {
  const h = setup(t)
  const first = h.addSource(app, 2)
  const second = h.addSource(app, 4)
  h.removeSource(second)
  assert.equal(h.monitor.getState(app).total, 2)
  first.count = 1
  first.emit('notify::count', first)
  assert.equal(h.monitor.getState(app).total, 1)
})

for (const [canonical, alias] of [
  ['org.example.Messenger.desktop', 'org.example.Messenger'],
  ['org.gnome.Evolution.desktop', 'org.gnome.evolution-alarm-notify'],
]) {
  test(`source removal preserves a live alias of ${canonical}`, (t) => {
    const h = setup(t)
    const app = { id: canonical }
    const remaining = h.addSource({ id: alias }, 2)
    const removed = h.addSource(app, 4)
    h.removeSource(removed)
    assert.equal(h.monitor.getState(app).total, 2)
    remaining.count = 1
    remaining.emit('notify::count', remaining)
    assert.equal(h.monitor.getState(app).total, 1)
  })
}

test('publisher exit clears its badge without clearing a newer publisher', (t) => {
  const h = setup(t)
  h.publish(app, 7, true, ':1.42')
  h.publish(app, 3, true, ':1.43')
  h.update(app, { progress: 0.5, 'progress-visible': true }, ':1.42')
  h.disconnect(':1.42')
  assert.equal(h.monitor.getState(app).total, 3)
  h.disconnect(':1.43')
  assert.equal(h.monitor.getState(app).total, 0)
  h.addSource(app, 2)
  assert.equal(h.monitor.getState(app).total, 2)
})
