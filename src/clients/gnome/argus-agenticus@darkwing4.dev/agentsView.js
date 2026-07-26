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
import { Logger, setLogLevel } from './logger.js';

const logger = new Logger('agentsView.js');

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
        this._autoFocusButton = autoFocusButton;
        this._groupsBox = groupsBox;
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
            'Log level',
            [
                { label: 'Off', value: 'off' },
                { label: 'Error', value: 'error' },
                { label: 'Warn', value: 'warn' },
                { label: 'Info', value: 'info' },
                { label: 'Debug', value: 'debug' },
            ],
            'log-level'
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

        this._buildSpinnerMenuItem('Dot size', 'dot-size', 4, 20, 2);
        this._buildSpinnerMenuItem('Dot gap', 'dot-gap', 0, 16, 2);
        this._buildSpinnerMenuItem('Font size', 'font-size', 8, 20, 1);
        this._buildSpinnerMenuItem('Group padding', 'group-padding', 0, 16, 2);
        this._buildSpinnerMenuItem('Hover offset %', 'hover-offset-percent', 0, 200, 10);
        this._buildSpinnerMenuItem('Hover rise ms', 'hover-rise-ms', 0, 2000, 20);
        this._buildSpinnerMenuItem('Hover fall ms', 'hover-fall-ms', 0, 2000, 20);
        this._buildSpinnerMenuItem('A label size %', 'af-label-size-percent', 30, 200, 5);

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

    _buildSpinnerMenuItem(title, settingsKey, min, max, step) {
        const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
        const box = new St.BoxLayout({ x_expand: true });

        box.add_child(new St.Label({
            text: title,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));

        const decBtn = new St.Button({
            style_class: 'button',
            label: '\u25C0',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const valueLabel = new St.Label({
            text: `${this._settings.get_int(settingsKey)}`,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'min-width: 2em; text-align: center;',
        });

        const incBtn = new St.Button({
            style_class: 'button',
            label: '\u25B6',
            y_align: Clutter.ActorAlign.CENTER,
        });

        decBtn.connect('clicked', () => {
            const cur = this._settings.get_int(settingsKey);
            if (cur - step >= min)
                this._settings.set_int(settingsKey, cur - step);
        });

        incBtn.connect('clicked', () => {
            const cur = this._settings.get_int(settingsKey);
            if (cur + step <= max)
                this._settings.set_int(settingsKey, cur + step);
        });

        box.add_child(decBtn);
        box.add_child(valueLabel);
        box.add_child(incBtn);

        item.add_child(box);
        this._menu.addMenuItem(item);

        const camelKey = settingsKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this[`_${camelKey}Label`] = valueLabel;
    }

    _setupSettings() {
        updateTerminalWmClasses(this._settings.get_strv('terminal-wm-classes'));
        this._autoFocusEnabled = this._settings.get_boolean('auto-focus-enabled');
        this._focusDelayMs = this._settings.get_int('focus-delay-ms');
        this._inputIdleThresholdMs = this._settings.get_int('input-idle-threshold-ms');
        this._dotSize = this._settings.get_int('dot-size');
        this._dotGap = this._settings.get_int('dot-gap');
        this._fontSize = this._settings.get_int('font-size');
        this._groupPadding = this._settings.get_int('group-padding');
        this._hoverOffsetPercent = this._settings.get_int('hover-offset-percent');
        this._hoverRiseMs = this._settings.get_int('hover-rise-ms');
        this._hoverFallMs = this._settings.get_int('hover-fall-ms');
        this._afLabelSizePercent = this._settings.get_int('af-label-size-percent');
        this._showLabels = this._settings.get_boolean('show-labels');
        try {
            this._logLevel = this._settings.get_string('log-level');
        } catch(_) {
            this._logLevel = 'off';
        }
        setLogLevel(this._logLevel);

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
                    this._dotSize = settings.get_int(key);
                    if (this._dotSizeLabel)
                        this._dotSizeLabel.text = `${this._dotSize}`;
                    this._updateDots();
                    break;
                case 'dot-gap':
                    this._dotGap = settings.get_int(key);
                    if (this._dotGapLabel)
                        this._dotGapLabel.text = `${this._dotGap}`;
                    this._updateDots();
                    break;
                case 'font-size':
                    this._fontSize = settings.get_int(key);
                    if (this._fontSizeLabel)
                        this._fontSizeLabel.text = `${this._fontSize}`;
                    this._updateDots();
                    break;
                case 'group-padding':
                    this._groupPadding = settings.get_int(key);
                    if (this._groupPaddingLabel)
                        this._groupPaddingLabel.text = `${this._groupPadding}`;
                    this._updateDots();
                    break;
                case 'hover-offset-percent':
                    this._hoverOffsetPercent = settings.get_int(key);
                    if (this._hoverOffsetPercentLabel)
                        this._hoverOffsetPercentLabel.text = `${this._hoverOffsetPercent}`;
                    this._updateDots();
                    break;
                case 'hover-rise-ms':
                    this._hoverRiseMs = settings.get_int(key);
                    if (this._hoverRiseMsLabel)
                        this._hoverRiseMsLabel.text = `${this._hoverRiseMs}`;
                    this._updateDots();
                    break;
                case 'hover-fall-ms':
                    this._hoverFallMs = settings.get_int(key);
                    if (this._hoverFallMsLabel)
                        this._hoverFallMsLabel.text = `${this._hoverFallMs}`;
                    this._updateDots();
                    break;
                case 'af-label-size-percent':
                    this._afLabelSizePercent = settings.get_int(key);
                    if (this._afLabelSizePercentLabel)
                        this._afLabelSizePercentLabel.text = `${this._afLabelSizePercent}`;
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
                case 'log-level':
                    this._logLevel = settings.get_string(key);
                    setLogLevel(this._logLevel);
                    this._updateRadioOrnaments('log-level', this._logLevel);
                    this._sendLogLevel();
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
                this._sendLogLevel();
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
            this._focusManager.resetWorkspaceCache();
            this._focusManager.sendAllWorkspaces((msg) => this._daemon.send(msg));
            this._focusManager.sendWindowFocus(
                global.display.get_focus_window(),
                (msg) => this._daemon.send(msg)
            );
        };

        this._windowTracker.onWindowUnmanaged = (session) => {
            this._daemon.send({ type: 'window_closed', session });
        };

        this._windowTracker.onCursorCliDetected = (win) => {
            this._tryMapCursorCliWindows();
        };
    }

    _wireIdleMonitor() {
        this._idleMonitor.onIdle = () => this._daemon.send({ type: 'idle_status', idle: true });
        this._idleMonitor.onActive = () => this._daemon.send({ type: 'idle_status', idle: false });
    }

    _sendLogLevel() {
        this._daemon.send({ type: 'set_log_level', level: this._logLevel });
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

        this._focusManager.handleStackReset(win);
        this._focusManager.sendWindowFocus(win, (msg) => this._daemon.send(msg));
        this._focusManager.sendWorkspaceForWindow(win, (msg) => this._daemon.send(msg));
        this._focusManager.updateOriginalWorkspace(win, this._agents);
    }

    _handleMessage(line) {
        try {
            const msg = JSON.parse(line);

            if (msg.type === 'render') {
                this._agents = msg.agents;
                logger.log('Render', msg.agents.map(a => `${a.session}(g:${a.group})`).join(', '));
                this._updateDots();
                this._tryMapCursorCliWindows();
            } else if (msg.type === 'focus') {
                this._focusManager.focusWindow(msg.session, msg.agent_type);
            } else if (msg.type === 'auto_focus') {
                this._focusManager.handleAutoFocus(msg.session, msg.agent_type);
            } else if (msg.type === 'return_workspace') {
                this._focusManager.returnWorkspace();
            }
        } catch (e) {
            logError(e, 'Failed to parse daemon message');
        }
    }

    _tryMapCursorCliWindows() {
        for (const agent of this._agents) {
            if (agent.agent_type !== 'cursor') continue;
            if (this._windowTracker.getWindowForSession(agent.session)) continue;
            const groupName = agent.session.split('#')[0];
            for (const actor of global.get_window_actors()) {
                const win = actor.meta_window;
                if (!(win.get_title() || '').startsWith('Cursor Agent')) continue;
                if (this._windowTracker.getSessionForWindow(win)) continue;
                const firstTitle = this._windowTracker.getFirstTitle(win);
                if (firstTitle && firstTitle.includes(groupName)) {
                    this._windowTracker.setSessionMapping(win, agent.session);
                    this._focusManager.sendWorkspaceForWindow(win, (msg) => this._daemon.send(msg));
                    break;
                }
            }
        }
    }

    _updateDots() {
        const visible = this._renderer.updateDots(this._agents, {
            onDotClicked: (session) => {
                this._daemon.send({ type: 'click', session });
            },
            onDotMiddleClicked: (session) => {
                this._daemon.send({ type: 'cycle_auto_focus', session });
            },
            onGroupAutoFocusClicked: (group) => {
                this._daemon.send({ type: 'cycle_auto_focus_group', group });
            },
        }, {
            dotSize: this._dotSize,
            dotGap: this._dotGap,
            fontSize: this._fontSize,
            groupPadding: this._groupPadding,
            showLabels: this._showLabels,
            hoverOffsetPercent: this._hoverOffsetPercent,
            hoverRiseMs: this._hoverRiseMs,
            hoverFallMs: this._hoverFallMs,
            afLabelSizePercent: this._afLabelSizePercent,
        });
        this._groupsBox.visible = visible;
        this._autoFocusButton.visible = visible;
    }

    focusNext() {
        if (this._agents.length === 0)
            return;
        this._focusManager.pushCurrentWindow();
        this._focusManager.beginNavigation();
        this._daemon.send({ type: 'focus_next' });
    }

    focusPrev() {
        this._focusManager.focusPrev();
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
