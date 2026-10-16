import * as Config from 'resource:///org/gnome/shell/misc/config.js'

let watcher

export function getPointerWatcher() {
  if (Config.PACKAGE_VERSION < '51')
    return new Promise((resolve) => {
      if (watcher) resolve(watcher)
      else
        import('resource:///org/gnome/shell/ui/pointerWatcher.js').then(
          (pw) => {
            watcher = pw.getPointerWatcher()
            resolve(watcher)
          },
        )
    })
  else {
    return new Promise((resolve) => {
      watcher = watcher || {
        currentId: 0,
        watches: {},
        positionInvalidateId: 0,
        addWatch: function (delay, cb) {
          let cursorTracker = global.backend.get_cursor_tracker()
          let id = ++this.currentId

          if (!this.positionInvalidateId)
            this.positionInvalidateId = cursorTracker.connect(
              'position-invalidated',
              () => {
                let now = Date.now()

                Object.values(this.watches).forEach((w) => {
                  if (now > w.ts + w.delay) {
                    const [coords] = cursorTracker.get_pointer()

                    w.cb(coords.x, coords.y)
                    w.ts = now
                  }
                })
              },
            )

          this.watches[id] = { ts: Date.now(), delay, cb }

          return id
        },
        _removeWatch: function (id) {
          delete this.watches[id]

          if (!Object.keys(this.watches).length) {
            global.backend
              .get_cursor_tracker()
              .disconnect(this.positionInvalidateId)
            this.positionInvalidateId = 0
          }
        },
      }

      resolve(watcher)
    })
  }
}
