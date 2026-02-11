import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import { DaemonClient } from './daemonClient.js';
import { WindowTracker } from './windowTracker.js';
import { FocusManager } from './focusManager.js';
import { Renderer } from './renderer.js';
import { IdleMonitor } from './idleMonitor.js';

export const AgentsView = GObject.registerClass(
class AgentsView extends St.BoxLayout {

    _init(settings, extensionPath) {
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

        this._wireDaemon();
        this._wireWindowTracker();
        this._wireIdleMonitor();

        this._idleMonitor.start();
        this._windowTracker.start();
        this._daemon.start();
    }

    _setupSettings() {
        this._autoFocusEnabled = this._settings.get_boolean('auto-focus-enabled');
        this._focusDelayMs = this._settings.get_int('focus-delay-ms');
        this._inputIdleThresholdMs = this._settings.get_int('input-idle-threshold-ms');

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            switch (key) {
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
                this._focusManager.resetWorkspaceCache();
                this._onFocusWindowChanged();
                this._focusManager.sendAllWorkspaces((msg) => this._daemon.send(msg));
                this._sendAutoFocusConfig();
            })
        );

        this._daemonSignals.push(
            this._daemon.connect('disconnected', () => {
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
        this._focusManager.destroy();
        this._renderer.destroy();

        super.destroy();
    }
});
