/* SPDX-License-Identifier: GPL-2.0-or-later */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import {
  appearance,
  orderedItems,
  pixmapToRgba,
  splitTrayItems,
} from '../src/statusNotifierUtils.js'
import {
  StatusNotifierWatcher,
  call,
  connectSessionBus,
  WATCHER_NAME,
  WATCHER_PATH,
} from '../src/statusNotifierWatcher.js'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(ms) {
  return new Promise((resolve) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve()
      return GLib.SOURCE_REMOVE
    }),
  )
}

async function waitFor(predicate, description) {
  const deadline = GLib.get_monotonic_time() + 5000000
  while (!predicate()) {
    if (GLib.get_monotonic_time() > deadline)
      throw new Error(`Timed out: ${description}`)
    await delay(10)
  }
}

const ITEM_XML = `<node><interface name="org.kde.StatusNotifierItem">
  <property name="Id" type="s" access="read"/>
  <property name="Title" type="s" access="read"/>
  <property name="Status" type="s" access="read"/>
  <property name="IconName" type="s" access="read"/>
</interface></node>`

async function fixture(paths = ['/StatusNotifierItem']) {
  const bus = await connectSessionBus()
  const alias = 'org.kde.StatusNotifierItem-4242-1'
  await call(
    bus,
    'org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus',
    'RequestName',
    new GLib.Variant('(su)', [alias, 4]),
  )
  const exports = paths.map((path) => {
    const object = Gio.DBusExportedObject.wrapJSObject(ITEM_XML, {
      Id: 'test-tray',
      Title: 'Test Tray',
      Status: 'Active',
      IconName: 'applications-system-symbolic',
    })
    object.export(bus, path)
    return object
  })
  return { bus, alias, owner: bus.get_unique_name(), exports }
}

async function close(bus) {
  await new Promise((resolve, reject) =>
    bus.close(null, (connection, result) => {
      try {
        connection.close_finish(result)
        resolve()
      } catch (error) {
        reject(error)
      }
    }),
  )
}

async function register(client, address) {
  return call(
    client.bus,
    WATCHER_NAME,
    WATCHER_PATH,
    WATCHER_NAME,
    'RegisterStatusNotifierItem',
    new GLib.Variant('(s)', [address]),
  )
}

const added = []
const removed = []
const watcher = new StatusNotifierWatcher({
  onAdded: (item) => added.push(item.key),
  onRemoved: (key) => removed.push(key),
})
const client = await fixture()
try {
  await watcher.start()
  await waitFor(
    () => watcher.active && watcher.items.size === 1,
    'discover existing indicator',
  )
  console.log('PASS discovery of an already running indicator')

  await Promise.all([
    register(client, client.alias),
    register(client, client.owner),
    register(client, '/StatusNotifierItem'),
  ])
  assert(
    watcher.items.size === 1 && added.length === 1,
    'Alias, owner and path duplicated one indicator',
  )
  assert(
    watcher.items.has(client.owner + '/StatusNotifierItem'),
    'Registry did not use the unique owner',
  )
  console.log(
    'PASS concurrent alias, unique-name and object-path deduplication',
  )

  const extra = Gio.DBusExportedObject.wrapJSObject(ITEM_XML, {
    Id: 'test-tray',
    Title: 'Second Item',
    Status: 'Active',
    IconName: 'applications-system-symbolic',
  })
  extra.export(client.bus, '/org/ayatana/NotificationItem/second')
  client.exports.push(extra)
  await register(client, '/org/ayatana/NotificationItem/second')
  assert(
    watcher.items.size === 2,
    'Different object paths were incorrectly merged',
  )
  console.log('PASS separate items on one connection')

  let invalidRejected = false
  try {
    await register(client, 'invalid-name')
  } catch {
    invalidRejected = true
  }
  assert(
    invalidRejected && watcher.items.size === 2,
    'Invalid registration was accepted',
  )
  console.log('PASS invalid registrations rejected')

  await close(client.bus)
  await waitFor(() => watcher.items.size === 0, 'indicator owner cleanup')
  assert(removed.length === 2, 'Removed indicators did not notify their host')
  console.log('PASS disconnected owners remove every owned item')
} finally {
  watcher.destroy()
  if (!client.bus.is_closed()) await close(client.bus)
}

const competitor = await connectSessionBus()
await call(
  competitor,
  'org.freedesktop.DBus',
  '/org/freedesktop/DBus',
  'org.freedesktop.DBus',
  'RequestName',
  new GLib.Variant('(su)', [WATCHER_NAME, 4]),
)
const waiting = new StatusNotifierWatcher()
try {
  await waiting.start()
  await delay(100)
  const [owner] = await call(
    competitor,
    'org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus',
    'GetNameOwner',
    new GLib.Variant('(s)', [WATCHER_NAME]),
  )
  assert(
    !waiting.active && owner === competitor.get_unique_name(),
    'Native tray displaced another watcher',
  )
  await close(competitor)
  await waitFor(() => waiting.active, 'handover from competing watcher')
  console.log('PASS standby and handover without replacing another watcher')

  const late = await fixture()
  const pending = waiting.register(late.alias, late.owner).catch(() => null)
  waiting.destroy()
  await pending
  assert(
    waiting.items.size === 0 && !waiting.active,
    'Shutdown allowed a late registration',
  )
  await close(late.bus)
  console.log('PASS shutdown cancels outstanding registration')
} finally {
  waiting.destroy()
  if (!competitor.is_closed()) await close(competitor)
}

const ayatana = await fixture(['/org/ayatana/NotificationItem/custom'])
const custom = new StatusNotifierWatcher()
try {
  await custom.start()
  await waitFor(() => custom.items.size === 1, 'discover Ayatana indicator')
  assert(
    custom.items.has(ayatana.owner + '/org/ayatana/NotificationItem/custom'),
    'Ayatana path was not discovered',
  )
  console.log('PASS discovery of Ayatana custom object paths')
} finally {
  custom.destroy()
  await close(ayatana.bus)
}

const pixels = pixmapToRgba([[1, 1, new Uint8Array([128, 10, 20, 30])]], 16)
assert(
  pixels && Array.from(pixels.bytes).join(',') === '10,20,30,128',
  'ARGB network byte order conversion failed',
)
assert(
  pixmapToRgba([[1, 1, [1, 2]], [4096, 4096, []], null], 16) === null,
  'Malformed icon data was accepted',
)
console.log('PASS pixmap color conversion and malformed-data bounds')

const customAppearance = appearance(
  {
    hidden: true,
    icon: '/tmp/icon.png',
    brightness: 9,
    contrast: -9,
    tint: '#00aaff',
  },
  true,
)
assert(
  customAppearance.hidden &&
    customAppearance.symbolic &&
    customAppearance.brightness === 1 &&
    customAppearance.contrast === -1 &&
    customAppearance.tint === '#00aaff',
  'Per-app configuration was not normalized',
)
assert(
  appearance(null).icon === '' && appearance({ tint: 'invalid' }).tint === '',
  'Invalid per-app settings were accepted',
)
console.log('PASS per-app customization defaults and bounds')

const ordered = orderedItems(
  [
    { properties: { Id: 'one' } },
    { properties: { Id: 'two' } },
    { properties: { Id: 'one' } },
  ],
  ['two', 'one'],
)
assert(
  ordered.map((item) => item.properties.Id).join(',') === 'two,one,one',
  'Per-app order dropped or misplaced indicators',
)
console.log('PASS per-app order preserves multiple indicators')

const layoutItems = Array.from({ length: 6 }, (_, index) => ({
  key: `:1.${index}/StatusNotifierItem`,
  properties: { Id: `app-${index}`, Status: 'Active' },
}))
const preferredOrder = ['app-5', 'app-4', 'app-3', 'app-2', 'app-1', 'app-0']
const four = splitTrayItems(layoutItems, preferredOrder, {}, 4, true)
assert(
  four.inline.map((item) => item.properties.Id).join(',') ===
    'app-5,app-4,app-3,app-2' && four.overflow.length === 2,
  'Inline count did not respect configured order',
)
console.log('PASS overflow count and preferred application order')

layoutItems[3].properties.Status = 'Passive'
const filtered = splitTrayItems(
  layoutItems,
  preferredOrder,
  { 'app-5': { hidden: true } },
  2,
  true,
)
assert(
  filtered.inline.map((item) => item.properties.Id).join(',') ===
    'app-4,app-2' && filtered.overflow.length === 2,
  'Hidden or passive items consumed visible slots',
)
console.log('PASS hidden and passive items do not consume visible slots')

const collapsed = splitTrayItems(layoutItems, preferredOrder, {}, 0, true)
const expanded = splitTrayItems(layoutItems, preferredOrder, {}, 0, false)
assert(
  collapsed.inline.length === 0 &&
    collapsed.overflow.length === 5 &&
    expanded.inline.length === 5 &&
    expanded.overflow.length === 0,
  'Zero limit or disabled overflow lost items',
)
console.log(
  'PASS zero limit and disabled overflow preserve every eligible icon',
)

const larger = splitTrayItems(layoutItems, preferredOrder, {}, 32, true)
assert(
  larger.inline.length === 5 && larger.overflow.length === 0,
  'A large visible limit created empty overflow items',
)
console.log('PASS visible limit above icon count needs no popup')
