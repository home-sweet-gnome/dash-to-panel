import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Utils from './utils.js';

import {SETTINGS} from './extension.js';

export const LinearSwitcher = class {
    constructor() {
        
    }

    enable (primaryPanel) {
        this._panel = primaryPanel;
        this.taskbar = primaryPanel.taskbar;

        this._addKeybindings();
    }

    disable() {
        this._removeKeybindings();
    }
    
    _addKeybindings() {
        Utils.addKeybinding('app-hotkey-switch-left', SETTINGS, () => this._switchWindow(-1));
        Utils.addKeybinding('app-hotkey-switch-right', SETTINGS, () => this._switchWindow(1));
    }

    _removeKeybindings() {
        Utils.removeKeybinding('app-hotkey-switch-left');
        Utils.removeKeybinding('app-hotkey-switch-right');
    }

    _switchWindow(direction) {
        let is = [];
        let tracker = Shell.WindowTracker.get_default();

        log(tracker.focus_app.id);

        let currentFocusIndex = 0;
        
        let appIcons = this.taskbar._getAppIcons();

        if(appIcons.length > 1){
            for(let i in appIcons) {
                if(appIcons[i]._isFocusedWindow()) {
                    currentFocusIndex = i;
                }
                
                if(appIcons[i].isRunning()) {
                    is.push(i);
                }
                // apps.push(appIcons[i]);
            }

            let currentIndexI = is.indexOf(currentFocusIndex);

            let newIndexI = currentIndexI+direction;
    
            if(newIndexI < 0) {
                newIndexI = is.length-1;
            }

            if(newIndexI > is.length-1) {
                newIndexI = 0;
            }
            
            let newI = is[newIndexI];

            let prefixModifiers = Clutter.ModifierType.SUPER_MASK
    
            let button = 1;
            appIcons[newI].activate(button, prefixModifiers, !this.taskbar.allowSplitApps);
        }
    }
};
