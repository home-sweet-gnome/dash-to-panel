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
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;
const FileUtils = imports.misc.fileUtils;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

let apiUrl = '';

function init() {
    Me.settings.connect('changed::force-check-update', () => {
        if (Me.settings.get_boolean('force-check-update')) {
            checkForUpdate(true);
            Me.settings.set_boolean('force-check-update', false);
        }
    });

//!start-update
    //check for update now, then every 4 hours
    checkForUpdate();
    imports.mainloop.timeout_add(14400000, () => checkForUpdate());

    Me.settings.connect('changed::version-to-install', () => installRelease(Me.settings.get_string('version-to-install'), true));
//!end-update
}

function checkForUpdate(fromSettings) {
    if (!apiUrl) {
        return notifyError(_('Unavailable when installed from extensions.gnome.org'));
    }

//!start-update
    if (fromSettings || Me.settings.get_boolean('check-update')) {
        getLatestReleaseInfo((err, latestRelease) => {
            if (err) {
                return notifyError(err);
            }
            
            let latestVersion = latestRelease.tag.substring(1);
            
            if (Me.metadata.version < latestVersion && latestRelease.zipUrl) {
                notify(
                    _('Version %s (%s) is available').format(latestVersion, latestRelease.name),
                    [{ text: _('Details'), func: () => imports.misc.util.spawn(['xdg-open', latestRelease.url]) },
                     { text: _('Update'), func: () => installRelease(latestRelease.zipUrl, fromSettings) }]
                );
            } else if (fromSettings) {
                notify(_('Already up to date'));
            }
        });
    }
//!end-update
}

function notifyError(err) {
    Me.imports.utils.notify(_('Error: ') + err, 'dialog-error', null, true);
}

function notify(msg, action) {
    Me.imports.utils.notify(msg, 'dialog-information', action, true);
}

//!start-update
apiUrl = 'https://api.github.com/repos/home-sweet-gnome/dash-to-panel/';
const tagsApiUrl = apiUrl + 'tags';
const releasesApiUrl = apiUrl + 'releases';

let httpSession;

function getLatestReleaseInfo(cb) {
    getReleaseInfo('/latest', cb);
}

function getTaggedReleaseInfo(releaseTag, cb) {
    getReleaseInfo('/tags/' + releaseTag, cb);
}

function getReleaseInfo(suffix, cb) {
    getHttpMessageResponseBody(createGet(releasesApiUrl + suffix), (err, body) => {
        if (err) {
            return cb(err);
        }

        try {
            let release = JSON.parse(body.data);
            let releaseInfo = {
                name: release.name, 
                tag: release.tag_name,
                url: release.html_url,
                zipUrl: (release.assets.length ? release.assets[0].browser_download_url : 0),
            };

            cb(null, releaseInfo);
        } catch (e) {
            cb(e.message);
        }
    });
}

function installRelease(releaseAssetUrl, fromSettings) {
    getHttpMessageResponseBody(createGet(releaseAssetUrl), (err, body) => {
        if (err) {
            return notifyInstallResult(err);
        }

        let name = 'dtp_install';
        let zipFile = createTmp(name + '.zip');
        let stream = zipFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
        let extDir = Gio.file_new_for_path(Me.path);
        let tmpDir = createTmp(name, true);
        let bckDir = createTmp(Me.uuid, true);

        stream.write_bytes(body.flatten().get_as_bytes(), null);
        stream.close(null);

        unzipFile(zipFile, tmpDir, err => {
            if (err) {
                return notifyInstallResult(err);
            }
            
            try {
                FileUtils.recursivelyMoveDir(extDir, bckDir);
                FileUtils.recursivelyMoveDir(tmpDir, extDir);

                if (fromSettings) {
                    let [success, out, err, exitCode] = GLib.spawn_command_line_sync('pidof "gnome-shell-extension-prefs"');

                    if (success && !exitCode) {
                        GLib.spawn_command_line_sync('kill -9 ' + imports.byteArray.toString(out));
                    }
                }
            } catch (e) {
                FileUtils.recursivelyDeleteDir(extDir, false);
                FileUtils.recursivelyMoveDir(bckDir, extDir);

                return notifyInstallResult(e.message);
            }

            notifyInstallResult(null);
        });
    });
}

function notifyInstallResult(err) {
    if (err) {
        notifyError(err);
    } else if (imports.gi.Meta.is_wayland_compositor()) {
        notify(
            _('Update successful, please log out/in'),
            { text: _('Log out'), func: () => new imports.misc.systemActions.getDefault().activateLogout() }
        );
    } else {
        notify(
            _('Update successful, please restart GNOME Shell'), 
            { text: _('Restart GNOME Shell'), func: () => imports.gi.Meta.restart(_("Restarting GNOME Shell...")) }
        );
    }
}

function createTmp(name, isDir) {
    let tmp = Gio.file_new_for_path('/tmp/' + name);

    if (isDir && tmp.query_exists(null)) {
        FileUtils.recursivelyDeleteDir(tmp, false);
    }

    return tmp;
}

function unzipFile(zipFile, destDir, cb) {
    let [success, pid] = GLib.spawn_async(
        null,
        ['unzip', '-uod', destDir.get_path(), '--', zipFile.get_path()],
        null,
        GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD | GLib.SpawnFlags.STDOUT_TO_DEV_NULL,
        null
    );

    if (!success) {
        return cb('unzip spawn error');
    }

    GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, (pid, status) => {
        GLib.spawn_close_pid(pid);

        if (status != 0) {
            return cb('extraction error')
        }
        
        return cb(null);
    });
}

function createGet(url, params) {
    return Soup.form_request_new_from_hash('GET', url, params || {});
}

function getHttpMessageResponseBody(message, cb) {
    if (!httpSession) {
        httpSession = new Soup.Session();
        httpSession.user_agent = Me.metadata.uuid;
    }

    httpSession.queue_message(message, (httpSession, message) => {
        try {
            if (!message.response_body || !message.response_body.data) {
                return cb('No data received');
            }

            return cb(null, message.response_body);
        } catch (e) {
            return cb(e.message);
        }
    });
}
//!end-update
