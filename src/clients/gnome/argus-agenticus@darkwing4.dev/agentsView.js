import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { DaemonClient } from './daemonClient.js';
import { WindowTracker } from './windowTracker.js';
import { FocusManager } from './focusManager.js';
import { Renderer } from './renderer.js';
import { IdleMonitor } from './idleMonitor.js';
import { updateTerminalWmClasses } from './constants.js';

export const AgentsView = GObject.registerClass(
class AgentsView extends St.BoxLayout {

    _init(settings, extensionPath, version) {
        super._init({
            style_class: 'panel-status-indicators-box',
            reactive: false,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._settings = settings;
        this._agents = [];
        this._cancellable = new Gio.Cancellable();

        this._setupSettings();

        this._daemon = new DaemonClient(this._cancellable);
        this._windowTracker = new WindowTracker();
        this._focusManager = new FocusManager(this._windowTracker);
        this._renderer = new Renderer(extensionPath);
        this._idleMonitor = new IdleMonitor(this._inputIdleThresholdMs);

        const { logo, autoFocusButton, groupsBox } = this._renderer.createPanelContent();
        this.add_child(logo);

        autoFocusButton.connect('clicked', () => {
            this._settings.set_boolean('auto-focus-enabled', !this._autoFocusEnabled);
        });
        autoFocusButton.connect('enter-event', () => {
            this._renderer.showTooltip(autoFocusButton, 'Auto-focus awaiting');
        });
        autoFocusButton.connect('leave-event', () => {
            this._renderer.hideTooltip();
        });
        this._renderer.updateAutoFocusButtonStyle(this._autoFocusEnabled);
        this.add_child(autoFocusButton);
        this.add_child(groupsBox);

        this._buildMenu(logo, version);

        this._wireDaemon();
        this._wireWindowTracker();
        this._wireIdleMonitor();

        this._idleMonitor.start();
        this._windowTracker.start();
        this._daemon.start();
    }

    _buildMenu(logo, version) {
        this._menu = new PopupMenu.PopupMenu(logo, 0.0, St.Side.TOP);
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();

        this._menu.addMenuItem(new PopupMenu.PopupMenuItem(
            `Argus Agenticus v${version}`, { reactive: false }
        ));

        this._daemonStatusItem = new PopupMenu.PopupMenuItem(
            'Daemon: disconnected', { reactive: false }
        );
        this._menu.addMenuItem(this._daemonStatusItem);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._menu.addAction('Clear agents list', () => {
            this._daemon.send({ type: 'clear_agents' });
        });
        this._menu.addAction('Mark all awaiting as started', () => {
            this._daemon.send({ type: 'mark_all_started' });
        });

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._showLabelsSwitch = new PopupMenu.PopupSwitchMenuItem(
            'Show labels', this._showLabels
        );
        this._showLabelsSwitch.connect('toggled', (_item, state) => {
            this._settings.set_boolean('show-labels', state);
        });
        this._menu.addMenuItem(this._showLabelsSwitch);

        this._buildRadioSubMenu(
            'Dot size',
            [
                { label: 'Small', value: 'small' },
                { label: 'Medium', value: 'medium' },
                { label: 'Large', value: 'large' },
            ],
            'dot-size'
        );

        this._buildRadioSubMenu(
            'Position',
            [
                { label: 'Left', value: 'left' },
                { label: 'Center', value: 'center' },
                { label: 'Right', value: 'right' },
            ],
            'panel-position'
        );

        logo.connect('clicked', () => this._menu.toggle());
    }

    _buildRadioSubMenu(title, options, settingsKey) {
        const subMenu = new PopupMenu.PopupSubMenuMenuItem(title);
        const items = [];

        for (const opt of options) {
            const item = new PopupMenu.PopupMenuItem(opt.label);
            item._settingsValue = opt.value;
            item.connect('activate', () => {
                this._settings.set_string(settingsKey, opt.value);
            });
            subMenu.menu.addMenuItem(item);
            items.push(item);
        }

        this._menu.addMenuItem(subMenu);

        if (!this._radioMenus)
            this._radioMenus = {};
        this._radioMenus[settingsKey] = items;

        this._updateRadioOrnaments(settingsKey, this._settings.get_string(settingsKey));
    }

    _updateRadioOrnaments(settingsKey, currentValue) {
        const items = this._radioMenus?.[settingsKey];
        if (!items) return;
        for (const item of items) {
            item.setOrnament(
                item._settingsValue === currentValue
                    ? PopupMenu.Ornament.DOT
                    : PopupMenu.Ornament.NONE
            );
        }
    }

    _setupSettings() {
        updateTerminalWmClasses(this._settings.get_strv('terminal-wm-classes'));
        this._autoFocusEnabled = this._settings.get_boolean('auto-focus-enabled');
        this._focusDelayMs = this._settings.get_int('focus-delay-ms');
        this._inputIdleThresholdMs = this._settings.get_int('input-idle-threshold-ms');
        this._dotSize = this._settings.get_string('dot-size');
        this._showLabels = this._settings.get_boolean('show-labels');

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            switch (key) {
                case 'terminal-wm-classes':
                    updateTerminalWmClasses(settings.get_strv(key));
                    this._windowTracker.rescan();
                    break;
                case 'auto-focus-enabled':
                    this._autoFocusEnabled = settings.get_boolean(key);
                    this._renderer.updateAutoFocusButtonStyle(this._autoFocusEnabled);
                    this._sendAutoFocusConfig();
                    break;
                case 'focus-delay-ms':
                    this._focusDelayMs = settings.get_int(key);
                    this._sendAutoFocusConfig();
                    break;
                case 'input-idle-threshold-ms':
                    this._inputIdleThresholdMs = settings.get_int(key);
                    this._idleMonitor.updateThreshold(this._inputIdleThresholdMs);
                    break;
                case 'dot-size':
                    this._dotSize = settings.get_string(key);
                    this._updateRadioOrnaments('dot-size', this._dotSize);
                    this._updateDots();
                    break;
                case 'show-labels':
                    this._showLabels = settings.get_boolean(key);
                    if (this._showLabelsSwitch)
                        this._showLabelsSwitch.setToggleState(this._showLabels);
                    this._updateDots();
                    break;
                case 'panel-position':
                    this._updateRadioOrnaments('panel-position', settings.get_string(key));
                    break;
            }
        });
    }

    _wireDaemon() {
        this._daemonSignals = [];

        this._daemonSignals.push(
            this._daemon.connect('message-received', (_self, line) => this._handleMessage(line))
        );

        this._daemonSignals.push(
            this._daemon.connect('connected', () => {
                if (this._daemonStatusItem)
                    this._daemonStatusItem.label.text = 'Daemon: connected';
                this._focusManager.resetWorkspaceCache();
                this._onFocusWindowChanged();
                this._focusManager.sendAllWorkspaces((msg) => this._daemon.send(msg));
                this._sendAutoFocusConfig();
            })
        );

        this._daemonSignals.push(
            this._daemon.connect('disconnected', () => {
                if (this._daemonStatusItem)
                    this._daemonStatusItem.label.text = 'Daemon: disconnected';
                this._agents = [];
                this._updateDots();
            })
        );
    }

    _wireWindowTracker() {
        this._windowTracker.onFocusChanged = () => this._onFocusWindowChanged();

        this._windowTracker.onWindowTracked = (win) => {
            this._focusManager.sendWorkspaceForWindow(win, (msg) => this._daemon.send(msg));
        };

        this._windowTracker.onMonitorChanged = (win) => {
            this._focusManager.sendWorkspaceForWindow(win, (msg) => this._daemon.send(msg));
        };

        this._windowTracker.onWorkspaceChanged = () => {
            this._focusManager.sendAllWorkspaces((msg) => this._daemon.send(msg));
            this._focusManager.sendWindowFocus(
                global.display.get_focus_window(),
                (msg) => this._daemon.send(msg)
            );
        };
    }

    _wireIdleMonitor() {
        this._idleMonitor.onIdle = () => this._daemon.send({ type: 'idle_status', idle: true });
        this._idleMonitor.onActive = () => this._daemon.send({ type: 'idle_status', idle: false });
    }

    _sendAutoFocusConfig() {
        this._daemon.send({
            type: 'auto_focus_config',
            enabled: this._autoFocusEnabled,
            focus_delay_ms: this._focusDelayMs,
        });
    }

    _onFocusWindowChanged() {
        const win = global.display.get_focus_window();
        if (!win)
            return;

        this._focusManager.sendWindowFocus(win, (msg) => this._daemon.send(msg));
        this._focusManager.sendWorkspaceForWindow(win, (msg) => this._daemon.send(msg));
        this._focusManager.updateOriginalWorkspace(win, this._agents);
    }

    _handleMessage(line) {
        try {
            const msg = JSON.parse(line);

            if (msg.type === 'render') {
                this._agents = msg.agents;
                this._updateDots();
            } else if (msg.type === 'focus') {
                this._focusManager.focusWindow(msg.session);
            } else if (msg.type === 'auto_focus') {
                this._focusManager.handleAutoFocus(msg.session);
            } else if (msg.type === 'return_workspace') {
                this._focusManager.returnWorkspace();
            }
        } catch (e) {
            logError(e, 'Failed to parse daemon message');
        }
    }

    _updateDots() {
        const visible = this._renderer.updateDots(this._agents, {
            onDotClicked: (session) => this._daemon.send({ type: 'click', session }),
        }, {
            dotSize: this._dotSize,
            showLabels: this._showLabels,
        });
        this.visible = visible;
    }

    focusNext() {
        this._daemon.send({ type: 'focus_next' });
    }

    destroy() {
        this._cancellable.cancel();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        for (const id of this._daemonSignals)
            this._daemon.disconnect(id);

        this._idleMonitor.stop();
        this._windowTracker.stop();
        this._daemon.stop();
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }

        this._focusManager.destroy();
        this._renderer.destroy();

        super.destroy();
    }
});
