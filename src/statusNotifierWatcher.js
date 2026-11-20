/* SPDX-License-Identifier: GPL-2.0-or-later */

import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

export const WATCHER_NAME = 'org.kde.StatusNotifierWatcher'
export const WATCHER_PATH = '/StatusNotifierWatcher'
export const ITEM_INTERFACE = 'org.kde.StatusNotifierItem'

const WATCHER_XML = `<node><interface name="org.kde.StatusNotifierWatcher">
  <method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
  <method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
  <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
  <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
  <property name="ProtocolVersion" type="i" access="read"/>
  <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
  <signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
  <signal name="StatusNotifierHostRegistered"/>
  <signal name="StatusNotifierHostUnregistered"/>
</interface></node>`

export function call(
  bus,
  name,
  path,
  iface,
  method,
  params = null,
  cancellable = null,
  timeout = 2000,
) {
  return new Promise((resolve, reject) => {
    bus.call(
      name,
      path,
      iface,
      method,
      params,
      null,
      Gio.DBusCallFlags.NO_AUTO_START,
      timeout,
      cancellable,
      (connection, result) => {
        try {
          resolve(connection.call_finish(result).deep_unpack())
        } catch (error) {
          reject(error)
        }
      },
    )
  })
}

export async function connectSessionBus(cancellable = null) {
  const address = Gio.dbus_address_get_for_bus_sync(
    Gio.BusType.SESSION,
    cancellable,
  )
  const connection = await new Promise((resolve, reject) => {
    Gio.DBusConnection.new_for_address(
      address,
      Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
        Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
      null,
      cancellable,
      (source, result) => {
        try {
          resolve(Gio.DBusConnection.new_for_address_finish(result))
        } catch (error) {
          reject(error)
        }
      },
    )
  })
  connection.set_exit_on_close(false)
  return connection
}

export function unpackProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      value instanceof GLib.Variant ? value.deep_unpack() : value,
    ]),
  )
}

export class StatusNotifierWatcher {
  constructor({
    onAdded = () => {},
    onRemoved = () => {},
    onStateChanged = () => {},
  } = {}) {
    this.items = new Map()
    this._onAdded = onAdded
    this._onRemoved = onRemoved
    this._onStateChanged = onStateChanged
    this._epoch = 0
    this._stopped = true
    this.active = false
  }

  async start() {
    if (!this._stopped) return
    this._stopped = false
    const epoch = ++this._epoch
    this._cancellable = new Gio.Cancellable()
    const bus = await connectSessionBus(this._cancellable)
    if (this._stopped || epoch !== this._epoch) {
      bus.close(null, null)
      return
    }
    this.bus = bus
    this._ownId = Gio.bus_own_name_on_connection(
      bus,
      WATCHER_NAME,
      Gio.BusNameOwnerFlags.NONE,
      () => this._acquired(),
      () => this._lost(),
    )
  }

  _acquired() {
    if (this._stopped) return
    this._exported = Gio.DBusExportedObject.wrapJSObject(WATCHER_XML, this)
    this._exported.export(this.bus, WATCHER_PATH)
    this.active = true
    const epoch = ++this._epoch
    this._ownerSignal = this.bus.signal_subscribe(
      'org.freedesktop.DBus',
      'org.freedesktop.DBus',
      'NameOwnerChanged',
      '/org/freedesktop/DBus',
      null,
      Gio.DBusSignalFlags.NONE,
      (connection, sender, path, iface, signal, parameters) => {
        const [name, , owner] = parameters.deep_unpack()
        if (!name.startsWith(':') || owner) return
        for (const [key, item] of this.items) {
          if (item.owner === name) this._remove(key)
        }
      },
    )
    this._exported.emit_signal('StatusNotifierHostRegistered', null)
    this._onStateChanged(true)
    this._discover(epoch).catch((error) => {
      if (!this._stopped && epoch === this._epoch)
        console.error(`Native tray discovery: ${error.message}`)
    })
  }

  _lost() {
    ++this._epoch
    this.active = false
    if (this._ownerSignal) {
      this.bus.signal_unsubscribe(this._ownerSignal)
      this._ownerSignal = 0
    }
    for (const key of Array.from(this.items.keys())) this._remove(key)
    if (this._exported) {
      this._exported.unexport()
      this._exported = null
    }
    this._onStateChanged(false)
  }

  async _resolveOwner(name) {
    const [owner] = await call(
      this.bus,
      'org.freedesktop.DBus',
      '/org/freedesktop/DBus',
      'org.freedesktop.DBus',
      'GetNameOwner',
      new GLib.Variant('(s)', [name]),
      this._cancellable,
    )
    return owner
  }

  async register(service, sender) {
    const epoch = this._epoch
    let name = service
    let path = '/StatusNotifierItem'
    if (service.startsWith('/')) {
      name = sender
      path = service
    } else if (service.includes('/')) {
      const slash = service.indexOf('/')
      name = service.slice(0, slash)
      path = service.slice(slash)
    }
    if (!name || !Gio.dbus_is_name(name) || !GLib.Variant.is_object_path(path))
      throw new Error('Invalid StatusNotifierItem address')
    const owner = await this._resolveOwner(name)
    const key = owner + path
    if (this.items.has(key)) return this.items.get(key)
    const [properties] = await call(
      this.bus,
      owner,
      path,
      'org.freedesktop.DBus.Properties',
      'GetAll',
      new GLib.Variant('(s)', [ITEM_INTERFACE]),
      this._cancellable,
      1000,
    )
    const values = unpackProperties(properties)
    if (typeof values.Id !== 'string')
      throw new Error('Object is not a StatusNotifierItem')
    if (this._stopped || !this.active || epoch !== this._epoch) return null
    if (this.items.has(key)) return this.items.get(key)
    const item = { key, owner, path, properties: values }
    this.items.set(key, item)
    this._exported.emit_signal(
      'StatusNotifierItemRegistered',
      new GLib.Variant('(s)', [key]),
    )
    this._notifyItems()
    this._onAdded(item)
    return item
  }

  RegisterStatusNotifierItemAsync([service], invocation) {
    this.register(service, invocation.get_sender())
      .then(() => invocation.return_value(null))
      .catch((error) =>
        invocation.return_dbus_error(
          'org.freedesktop.DBus.Error.InvalidArgs',
          error.message,
        ),
      )
  }

  RegisterStatusNotifierHostAsync([service], invocation) {
    this._resolveOwner(service)
      .then(() => invocation.return_value(null))
      .catch((error) =>
        invocation.return_dbus_error(
          'org.freedesktop.DBus.Error.InvalidArgs',
          error.message,
        ),
      )
  }

  _notifyItems() {
    this._exported?.emit_property_changed(
      'RegisteredStatusNotifierItems',
      new GLib.Variant('as', this.RegisteredStatusNotifierItems),
    )
  }

  _remove(key) {
    if (!this.items.delete(key)) return
    this._exported?.emit_signal(
      'StatusNotifierItemUnregistered',
      new GLib.Variant('(s)', [key]),
    )
    this._notifyItems()
    this._onRemoved(key)
  }

  async _discover(epoch) {
    const [names] = await call(
      this.bus,
      'org.freedesktop.DBus',
      '/org/freedesktop/DBus',
      'org.freedesktop.DBus',
      'ListNames',
      null,
      this._cancellable,
    )
    const pending = names.filter(
      (name) => name.startsWith(':') && name !== this.bus.get_unique_name(),
    )
    const worker = async () => {
      while (pending.length && !this._stopped && epoch === this._epoch) {
        const owner = pending.shift()
        await this.register(owner, owner).catch(() => {})
        try {
          const [xml] = await call(
            this.bus,
            owner,
            '/org/ayatana/NotificationItem',
            'org.freedesktop.DBus.Introspectable',
            'Introspect',
            null,
            this._cancellable,
            500,
          )
          const children = Array.from(
            xml.slice(0, 65536).matchAll(/<node\s+name=["']([^"']+)["']/g),
          ).slice(0, 64)
          for (const [, child] of children) {
            if (this._stopped || epoch !== this._epoch) return
            await this.register(
              `/org/ayatana/NotificationItem/${child}`,
              owner,
            ).catch(() => {})
          }
        } catch {
          continue
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(6, pending.length) }, worker),
    )
  }

  get RegisteredStatusNotifierItems() {
    return Array.from(this.items.keys())
  }

  get IsStatusNotifierHostRegistered() {
    return this.active
  }

  get ProtocolVersion() {
    return 0
  }

  destroy() {
    if (this._stopped) return
    this._stopped = true
    this._cancellable.cancel()
    if (this._exported)
      this._exported.emit_signal('StatusNotifierHostUnregistered', null)
    this._lost()
    if (this._ownId) {
      Gio.bus_unown_name(this._ownId)
      this._ownId = 0
    }
    this.bus?.close(null, null)
    this.bus = null
  }
}
