/*
 * This file is part of the Dash-To-Panel extension for Gnome 3
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 *
 * Credits:
 * This file is based on code from the Dash to Dock extension by micheleg
 */

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Gio = imports.gi.Gio;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Signals = imports.signals;
const Utils = Me.imports.utils;


var ProgressManager = class {

    constructor() {
        this._entriesByDBusName = {};

        this._launcher_entry_dbus_signal_id =
            Gio.DBus.session.signal_subscribe(null, // sender
                'com.canonical.Unity.LauncherEntry', // iface
                null, // member
                null, // path
                null, // arg0
                Gio.DBusSignalFlags.NONE,
                this._onEntrySignalReceived.bind(this));

        this._dbus_name_owner_changed_signal_id =
            Gio.DBus.session.signal_subscribe('org.freedesktop.DBus',  // sender
                'org.freedesktop.DBus',  // interface
                'NameOwnerChanged',      // member
                '/org/freedesktop/DBus', // path
                null,                    // arg0
                Gio.DBusSignalFlags.NONE,
                this._onDBusNameOwnerChanged.bind(this));

        this._acquireUnityDBus();
    }

    destroy() {
        if (this._launcher_entry_dbus_signal_id) {
            Gio.DBus.session.signal_unsubscribe(this._launcher_entry_dbus_signal_id);
        }

        if (this._dbus_name_owner_changed_signal_id) {
            Gio.DBus.session.signal_unsubscribe(this._dbus_name_owner_changed_signal_id);
        }

        this._releaseUnityDBus();
    }

    size() {
        return Object.keys(this._entriesByDBusName).length;
    }

    lookupByDBusName(dbusName) {
        return this._entriesByDBusName.hasOwnProperty(dbusName) ? this._entriesByDBusName[dbusName] : null;
    }

    lookupById(appId) {
        let ret = [];
        for (let dbusName in this._entriesByDBusName) {
            let entry = this._entriesByDBusName[dbusName];
            if (entry && entry.appId() == appId) {
                ret.push(entry);
            }
        }

        return ret;
    }

    addEntry(entry) {
        let existingEntry = this.lookupByDBusName(entry.dbusName());
        if (existingEntry) {
            existingEntry.update(entry);
        } else {
            this._entriesByDBusName[entry.dbusName()] = entry;
            this.emit('progress-entry-added', entry);
        }
    }

    removeEntry(entry) {
        delete this._entriesByDBusName[entry.dbusName()]
        this.emit('progress-entry-removed', entry);
    }

    _acquireUnityDBus() {
        if (!this._unity_bus_id) {
            Gio.DBus.session.own_name('com.canonical.Unity',
                Gio.BusNameOwnerFlags.ALLOW_REPLACEMENT, null, null);
        }
    }

    _releaseUnityDBus() {
        if (this._unity_bus_id) {
            Gio.DBus.session.unown_name(this._unity_bus_id);
            this._unity_bus_id = 0;
        }
    }

    _onEntrySignalReceived(connection, sender_name, object_path,
        interface_name, signal_name, parameters, user_data) {
        if (!parameters || !signal_name)
            return;

        if (signal_name == 'Update') {
            if (!sender_name) {
                return;
            }

            this._handleUpdateRequest(sender_name, parameters);
        }
    }

    _onDBusNameOwnerChanged(connection, sender_name, object_path,
        interface_name, signal_name, parameters, user_data) {
        if (!parameters || !this.size())
            return;

        let [name, before, after] = parameters.deep_unpack();

        if (!after) {
            if (this._entriesByDBusName.hasOwnProperty(before)) {
                this.removeEntry(this._entriesByDBusName[before]);
            }
        }
    }

    _handleUpdateRequest(senderName, parameters) {
        if (!senderName || !parameters) {
            return;
        }

        let [appUri, properties] = parameters.deep_unpack();
        let appId = appUri.replace(/(^\w+:|^)\/\//, '');
        let entry = this.lookupByDBusName(senderName);

        if (entry) {
            entry.setDBusName(senderName);
            entry.update(properties);
        } else {
            let entry = new AppProgress(senderName, appId, properties);
            this.addEntry(entry);
        }
    }
};
Signals.addSignalMethods(ProgressManager.prototype);

class AppProgress {

    constructor(dbusName, appId, properties) {
        this._dbusName = dbusName;
        this._appId = appId;
        this._count = 0;
        this._countVisible = false;
        this._progress = 0.0;
        this._progressVisible = false;
        this._urgent = false;
        this.update(properties);
    }

    appId() {
        return this._appId;
    }

    dbusName() {
        return this._dbusName;
    }

    count() {
        return this._count;
    }

    setCount(count) {
        if (this._count != count) {
            this._count = count;
            this.emit('count-changed', this._count);
        }
    }

    countVisible() {
        return this._countVisible;
    }

    setCountVisible(countVisible) {
        if (this._countVisible != countVisible) {
            this._countVisible = countVisible;
            this.emit('count-visible-changed', this._countVisible);
        }
    }

    progress() {
        return this._progress;
    }

    setProgress(progress) {
        if (this._progress != progress) {
            this._progress = progress;
            this.emit('progress-changed', this._progress);
        }
    }

    progressVisible() {
        return this._progressVisible;
    }

    setProgressVisible(progressVisible) {
        if (this._progressVisible != progressVisible) {
            this._progressVisible = progressVisible;
            this.emit('progress-visible-changed', this._progressVisible);
        }
    }

    urgent() {
        return this._urgent;
    }

    setUrgent(urgent) {
        if (this._urgent != urgent) {
            this._urgent = urgent;
            this.emit('urgent-changed', this._urgent);
        }
    }

    setDBusName(dbusName) {
        if (this._dbusName != dbusName) {
            let oldName = this._dbusName;
            this._dbusName = dbusName;
            this.emit('dbus-name-changed', oldName);
        }
    }

    update(other) {
        if (other instanceof AppProgress) {
            this.setDBusName(other.dbusName())
            this.setCount(other.count());
            this.setCountVisible(other.countVisible());
            this.setProgress(other.progress());
            this.setProgressVisible(other.progressVisible())
            this.setUrgent(other.urgent());
        } else {
            for (let property in other) {
                if (other.hasOwnProperty(property)) {
                    if (property == 'count') {
                        this.setCount(other[property].get_int64());
                    } else if (property == 'count-visible') {
                        this.setCountVisible(Me.settings.get_boolean('progress-show-count') && other[property].get_boolean());
                    } else if (property == 'progress') {
                        this.setProgress(other[property].get_double());
                    } else if (property == 'progress-visible') {
                        this.setProgressVisible(Me.settings.get_boolean('progress-show-bar') && other[property].get_boolean());
                    } else if (property == 'urgent') {
                        this.setUrgent(other[property].get_boolean());
                    } else {
                        // Not implemented yet
                    }
                }
            }
        }
    }
};
Signals.addSignalMethods(AppProgress.prototype);


var ProgressIndicator = class {

    constructor(source, progressManager) {
        this._source = source;
        this._progressManager = progressManager;
        this._signalsHandler = new Utils.GlobalSignalsHandler();

        this._sourceDestroyId = this._source.connect('destroy', () => {
            this._signalsHandler.destroy();
        });          

        this._notificationBadgeLabel = new St.Label({ style_class: 'badge' });
        this._notificationBadgeBin = new St.Bin({
            child: this._notificationBadgeLabel, y: 2, x: 2
        });
        this._notificationBadgeLabel.add_style_class_name('notification-badge');
        this._notificationBadgeCount = 0;
        this._notificationBadgeBin.hide();

        this._source._dtpIconContainer.add_child(this._notificationBadgeBin);
        this._source._dtpIconContainer.connect('notify::allocation', this.updateNotificationBadge.bind(this));

        this._progressManagerEntries = [];
        this._progressManager.lookupById(this._source.app.id).forEach(
            (entry) => {
                this.insertEntry(entry);
            }
        );

        this._signalsHandler.add([
            this._progressManager,
            'progress-entry-added',
            this._onEntryAdded.bind(this)
        ], [
            this._progressManager,
            'progress-entry-removed',
            this._onEntryRemoved.bind(this)
        ]);
    }

    destroy() {
        this._source.disconnect(this._sourceDestroyId);
        this._signalsHandler.destroy();
    }

    _onEntryAdded(appProgress, entry) {
        if (!entry || !entry.appId())
            return;
        if (this._source && this._source.app && this._source.app.id == entry.appId()) {
            this.insertEntry(entry);
        }
    }

    _onEntryRemoved(appProgress, entry) {
        if (!entry || !entry.appId())
            return;

        if (this._source && this._source.app && this._source.app.id == entry.appId()) {
            this.removeEntry(entry);
        }
    }

    updateNotificationBadge() {
        this._source.updateNumberOverlay(this._notificationBadgeBin);
        this._notificationBadgeLabel.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
    }

    _notificationBadgeCountToText(count) {
        if (count <= 9999) {
            return count.toString();
        } else if (count < 1e5) {
            let thousands = count / 1e3;
            return thousands.toFixed(1).toString() + "k";
        } else if (count < 1e6) {
            let thousands = count / 1e3;
            return thousands.toFixed(0).toString() + "k";
        } else if (count < 1e8) {
            let millions = count / 1e6;
            return millions.toFixed(1).toString() + "M";
        } else if (count < 1e9) {
            let millions = count / 1e6;
            return millions.toFixed(0).toString() + "M";
        } else {
            let billions = count / 1e9;
            return billions.toFixed(1).toString() + "B";
        }
    }

    setNotificationBadge(count) {
        this._notificationBadgeCount = count;
        let text = this._notificationBadgeCountToText(count);
        this._notificationBadgeLabel.set_text(text);
    }

    toggleNotificationBadge(activate) {
        if (activate && this._notificationBadgeCount > 0) {
            this.updateNotificationBadge();
            this._notificationBadgeBin.show();
        }
        else
            this._notificationBadgeBin.hide();
    }

    _showProgressOverlay() {
        if (this._progressOverlayArea) {
            this._updateProgressOverlay();
            return;
        }

        this._progressOverlayArea = new St.DrawingArea({x_expand: true, y_expand: true});
        this._progressOverlayArea.add_style_class_name('progress-bar');
        this._progressOverlayArea.connect('repaint', () => {
            this._drawProgressOverlay(this._progressOverlayArea);
        });

        this._source._iconContainer.add_child(this._progressOverlayArea);
        let node = this._progressOverlayArea.get_theme_node();

        let [hasColor, color] = node.lookup_color('-progress-bar-background', false);
        if (hasColor)
            this._progressbar_background = color
        else
            this._progressbar_background = new Clutter.Color({red: 204, green: 204, blue: 204, alpha: 255});

        [hasColor, color] = node.lookup_color('-progress-bar-border', false);
        if (hasColor)
            this._progressbar_border = color;
        else
            this._progressbar_border = new Clutter.Color({red: 230, green: 230, blue: 230, alpha: 255});

        this._updateProgressOverlay();
    }

    _hideProgressOverlay() {
        if (this._progressOverlayArea)
            this._progressOverlayArea.destroy();

        this._progressOverlayArea = null;
        this._progressbar_background = null;
        this._progressbar_border = null;
    }

    _updateProgressOverlay() {

        if (this._progressOverlayArea) {
            this._progressOverlayArea.queue_repaint();
        }
    }

    _drawProgressOverlay(area) {
        let scaleFactor = Utils.getScaleFactor();
        let [surfaceWidth, surfaceHeight] = area.get_surface_size();
        let cr = area.get_context();

        let iconSize = this._source.icon.iconSize * scaleFactor;

        let x = Math.floor((surfaceWidth - iconSize) / 2);
        let y = Math.floor((surfaceHeight - iconSize) / 2);

        let lineWidth = Math.floor(1.0 * scaleFactor);
        let padding = Math.floor(iconSize * 0.05);
        let width = iconSize - 2.0*padding;
        let height = Math.floor(Math.min(18.0*scaleFactor, 0.20*iconSize));
        x += padding;
        y += iconSize - height - padding;

        cr.setLineWidth(lineWidth);

        // Draw the outer stroke
        let stroke = new Cairo.LinearGradient(0, y, 0, y + height);
        let fill = null;
        stroke.addColorStopRGBA(0.5, 0.5, 0.5, 0.5, 0.1);
        stroke.addColorStopRGBA(0.9, 0.8, 0.8, 0.8, 0.4);
        Utils.drawRoundedLine(cr, x + lineWidth/2.0, y + lineWidth/2.0, width, height, true, true, stroke, fill);

        // Draw the background
        x += lineWidth;
        y += lineWidth;
        width -= 2.0*lineWidth;
        height -= 2.0*lineWidth;

        stroke = Cairo.SolidPattern.createRGBA(0.20, 0.20, 0.20, 0.9);
        fill = new Cairo.LinearGradient(0, y, 0, y + height);
        fill.addColorStopRGBA(0.4, 0.25, 0.25, 0.25, 1.0);
        fill.addColorStopRGBA(0.9, 0.35, 0.35, 0.35, 1.0);
        Utils.drawRoundedLine(cr, x + lineWidth/2.0, y + lineWidth/2.0, width, height, true, true, stroke, fill);

        // Draw the finished bar
        x += lineWidth;
        y += lineWidth;
        width -= 2.0*lineWidth;
        height -= 2.0*lineWidth;

        let finishedWidth = Math.ceil(this._progress * width);

        let bg = this._progressbar_background;
        let bd = this._progressbar_border;

        stroke = Cairo.SolidPattern.createRGBA(bd.red/255, bd.green/255, bd.blue/255, bd.alpha/255);
        fill = Cairo.SolidPattern.createRGBA(bg.red/255, bg.green/255, bg.blue/255, bg.alpha/255);

        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            Utils.drawRoundedLine(cr, x + lineWidth/2.0 + width - finishedWidth, y + lineWidth/2.0, finishedWidth, height, true, true, stroke, fill);
        else
            Utils.drawRoundedLine(cr, x + lineWidth/2.0, y + lineWidth/2.0, finishedWidth, height, true, true, stroke, fill);

        cr.$dispose();
    }

    setProgress(progress) {
        this._progress = Math.min(Math.max(progress, 0.0), 1.0);
        this._updateProgressOverlay();
    }

    toggleProgressOverlay(activate) {
        if (activate) {
            this._showProgressOverlay();
        }
        else {
            this._hideProgressOverlay();
        }
    }

    insertEntry(appProgress) {
        if (!appProgress || this._progressManagerEntries.indexOf(appProgress) !== -1)
            return;

        this._progressManagerEntries.push(appProgress);
        this._selectEntry(appProgress);
    }

    removeEntry(appProgress) {
        if (!appProgress || this._progressManagerEntries.indexOf(appProgress) == -1)
            return;

        this._progressManagerEntries.splice(this._progressManagerEntries.indexOf(appProgress), 1);

        if (this._progressManagerEntries.length > 0) {
            this._selectEntry(this._progressManagerEntries[this._progressManagerEntries.length-1]);
        } else {
            this.setNotificationBadge(0);
            this.toggleNotificationBadge(false);
            this.setProgress(0);
            this.toggleProgressOverlay(false);
            this.setUrgent(false);
        }
    }

    _selectEntry(appProgress) {
        if (!appProgress)
            return;

        this._signalsHandler.removeWithLabel('progress-entry');

        this._signalsHandler.addWithLabel('progress-entry',
        [
            appProgress,
            'count-changed',
            (appProgress, value) => {
                this.setNotificationBadge(value);
            }
        ], [
            appProgress,
            'count-visible-changed',
            (appProgress, value) => {
                this.toggleNotificationBadge(value);
            }
        ], [
            appProgress,
            'progress-changed',
            (appProgress, value) => {
                this.setProgress(value);
            }
        ], [
            appProgress,
            'progress-visible-changed',
            (appProgress, value) => {
                this.toggleProgressOverlay(value);
            }
        ], [
            appProgress,
            'urgent-changed',
            (appProgress, value) => {
                this.setUrgent(value)
            }
        ]);

        this.setNotificationBadge(appProgress.count());
        this.toggleNotificationBadge(appProgress.countVisible());
        this.setProgress(appProgress.progress());
        this.toggleProgressOverlay(appProgress.progressVisible());

        this._isUrgent = false;
    }

    setUrgent(urgent) {
        const icon = this._source.icon._iconBin;
        if (urgent) {
            if (!this._isUrgent) {
                icon.set_pivot_point(0.5, 0.5);
                this._source.iconAnimator.addAnimation(icon, 'dance');
                this._isUrgent = true;
            }
        } else {
            if (this._isUrgent) {
                this._source.iconAnimator.removeAnimation(icon, 'dance');
                this._isUrgent = false;
            }
            icon.rotation_angle_z = 0;
        }
    }
};
