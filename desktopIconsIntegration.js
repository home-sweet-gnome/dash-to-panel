/*
 * The code in this file is distributed under a "1-clause BSD license",
 * which makes it compatible with GPLv2 and GPLv3 too, and others.
 *
 * License text:
 *
 * Copyright (C) 2021 Sergio Costas (rastersoft@gmail.com)
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

/*******************************************************************************
 * Integration class
 *
 * This class must be added to other extensions in order to integrate
 * them with Desktop Icons NG. It allows an extension to notify how much margin
 * it uses in each side of each monitor.
 *
 * DON'T SEND PATCHES TO THIS FILE TO THE EXTENSION MAINTAINER. SEND THEM TO
 * DESKTOP ICONS NG MAINTAINER: https://gitlab.com/rastersoft/desktop-icons-ng
 *
 * In the *enable()* function, create a *DesktopIconsUsableAreaClass()*
 * object with
 *
 *     new DesktopIconsIntegration.DesktopIconsUsableAreaClass(object);
 *
 * Now, in the *disable()* function just call to the *destroy()* method before
 * nullifying the pointer. You must create a new object in enable() the next
 * time the extension is enabled.
 *
 * In your code, every time you change the margins, you should call first to
 * *resetMargins()* method to clear the current margins, and then call to
 * *setMargins(...)* method as many times as you need to set the margins in each
 * monitor. You don't need to call it for all the monitors, only for those where
 * you are painting something. If you don't set values for a monitor, they will
 * be considered zero.
 *
 * The margins values are relative to the monitor border.
 *
 *******************************************************************************/

const GLib = imports.gi.GLib;
const Main = imports.ui.main;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const IDENTIFIER_UUID = "130cbc66-235c-4bd6-8571-98d2d8bba5e2";

var DesktopIconsUsableAreaClass = class {
    constructor() {
        this._extensionManager = Main.extensionManager;
        this._timedMarginsID = 0;
        this._margins = {};
        this._emID = this._extensionManager.connect('extension-state-changed', (_obj, extension) => {
            if (!extension)
                return;

            // If an extension is being enabled and lacks the DesktopIconsUsableArea object, we can avoid launching a refresh
            if (extension.state === ExtensionUtils.ExtensionState.ENABLED) {
                this._sendMarginsToExtension(extension);
                return;
            }
            // if the extension is being disabled, we must do a full refresh, because if there were other extensions originally
            // loaded after that extension, those extensions will be disabled and enabled again without notification
            this._changedMargins();
        });
    }

    /**
     * Sets or updates the top, bottom, left and right margins for a
     * monitor. Values are measured from the monitor border (and NOT from
     * the workspace border).
     *
     * @param {int} monitor Monitor number to which set the margins.
     *                      A negative value means "the primary monitor".
     * @param {int} top Top margin in pixels
     * @param {int} bottom Bottom margin in pixels
     * @param {int} left Left margin in pixels
     * @param {int} right Right margin in pixels
     */
    setMargins(monitor, top, bottom, left, right) {
        this._margins[monitor] = {
            'top': top,
            'bottom': bottom,
            'left': left,
            'right': right
        };
        this._changedMargins();
    }

    /**
     * Clears the current margins. Must be called before configuring the monitors
     * margins with setMargins().
     */
    resetMargins() {
        this._margins = {};
        this._changedMargins();
    }

    /**
     * Disconnects all the signals and removes the margins.
     */
    destroy() {
        if (this._emID) {
            this._extensionManager.disconnect(this._emID);
            this._emID = 0;
        }
        if (this._timedMarginsID) {
            GLib.source_remove(this._timedMarginsID);
            this._timedMarginsID = 0;
        }
        this._margins = null;
        this._changedMargins();
    }

    _changedMargins() {
        if (this._timedMarginsID) {
            GLib.source_remove(this._timedMarginsID);
        }
        this._timedMarginsID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, ()=> {
            this._sendMarginsToAll();
            this._timedMarginsID = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _sendMarginsToAll() {
        this._extensionManager.getUuids().forEach(uuid =>
            this._sendMarginsToExtension(this._extensionManager.lookup(uuid)));
    }

    _sendMarginsToExtension(extension) {
        // check that the extension is an extension that has the logic to accept
        // working margins
        if (extension?.state !== ExtensionUtils.ExtensionState.ENABLED)
            return;

        const usableArea = extension?.stateObj?.DesktopIconsUsableArea;
         if (usableArea?.uuid === IDENTIFIER_UUID)
            usableArea.setMarginsForExtension(Me.uuid, this._margins);
    }
}
