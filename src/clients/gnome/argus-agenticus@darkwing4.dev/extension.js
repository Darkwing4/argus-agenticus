import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { AgentsView } from './agentsView.js';

const PANEL_BOXES = {
    'left': () => Main.panel._leftBox,
    'center': () => Main.panel._centerBox,
    'right': () => Main.panel._rightBox,
};

export default class AgentsMonitorV2Extension extends Extension {

    enable() {
        console.log('Argus Agenticus: enabling');
        this._settings = this.getSettings();
        this._view = new AgentsView(this._settings, this.path, this.metadata.version);
        this._addToPanel(this._settings.get_string('panel-position'));

        this._positionChangedId = this._settings.connect('changed::panel-position', () => {
            this._removeFromPanel();
            this._addToPanel(this._settings.get_string('panel-position'));
        });

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

        if (this._positionChangedId) {
            this._settings.disconnect(this._positionChangedId);
            this._positionChangedId = null;
        }
        this._settings = null;

        if (this._view) {
            this._removeFromPanel();
            this._view.destroy();
            this._view = null;
        }
    }

    _addToPanel(position) {
        const getBox = PANEL_BOXES[position] || PANEL_BOXES['left'];
        this._currentBox = getBox();
        this._currentBox.add_child(this._view);
    }

    _removeFromPanel() {
        if (this._currentBox && this._view)
            this._currentBox.remove_child(this._view);
    }
}
