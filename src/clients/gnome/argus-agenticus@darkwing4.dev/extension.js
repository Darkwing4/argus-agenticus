import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { AgentsView } from './agentsView.js';

export default class AgentsMonitorV2Extension extends Extension {

    enable() {
        console.log('Argus Agenticus: enabling');
        this._settings = this.getSettings();
        this._view = new AgentsView(this._settings, this.path);
        Main.panel._leftBox.add_child(this._view);

        Main.wm.addKeybinding(
            'focus-next-awaiting',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._view.focusNext()
        );
    }

    disable() {
        console.log('Argus Agenticus: disabling');
        Main.wm.removeKeybinding('focus-next-awaiting');
        this._settings = null;

        if (this._view) {
            Main.panel._leftBox.remove_child(this._view);
            this._view.destroy();
            this._view = null;
        }
    }
}
