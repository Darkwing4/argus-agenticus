import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const AGENT_TYPES = {
    claude: {
        wmClasses: [],
        dotClass: null,
    },
    cursor: {
        wmClasses: ['Cursor'],
        dotClass: 'agent-dot-cursor',
    },
};

let ALL_WM_CLASSES = Object.values(AGENT_TYPES).flatMap(t => t.wmClasses);
const HOVER_SCALE = 1.2;
const MARGIN_SAME_GROUP = 0;
const MARGIN_DIFFERENT_GROUP = 6;
const CLICK_PADDING = 8;
const RECONNECT_DELAY = 3000;

const AgentsView = GObject.registerClass(
class AgentsView extends St.BoxLayout {

    _init(settings, extensionPath) {
        super._init({
            style_class: 'panel-status-indicators-box',
            reactive: false,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._settings = settings;
        this._extensionPath = extensionPath;
        this._agents = [];
        this._dotWidgets = new Map();
        this._groupContainers = new Map();
        this._tooltip = null;
        this._connection = null;
        this._inputStream = null;
        this._outputStream = null;
        this._focusSignalId = null;
        this._windowCreatedSignalId = null;
        this._monitorChangedSignalId = null;
        this._reconnectTimeout = null;
        this._sessionWorkspaces = new Map();
        this._windowToSession = new Map();
        this._sessionToWindow = new Map();
        this._wmClassPending = new Map();

        this._originalWorkspace = null;
        this._idleMonitor = null;
        this._idleWatchId = 0;
        this._activeWatchId = 0;
        this._settingsChangedId = null;
        this._cancellable = new Gio.Cancellable();

        this._setupSettings();
        this._setupLogo();
        this._setupAutoFocusButton();
        this._groupsBox = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._groupsBox);
        this._setupIdleMonitor();
        this._setupFocusMonitoring();
        this._connectToDaemon();
    }

    _getAgentTypeForWindow(win) {
        const wmClass = win.get_wm_class() || '';
        for (const [typeName, typeInfo] of Object.entries(AGENT_TYPES)) {
            if (typeInfo.wmClasses.some(cls => wmClass.includes(cls))) {
                return [typeName, typeInfo];
            }
        }
        return [null, null];
    }

    _isAgentWindow(win) {
        const wmClass = win.get_wm_class() || '';
        return ALL_WM_CLASSES.some(cls => wmClass.includes(cls));
    }

    _setupSettings() {
        this._updateTerminalWmClasses();
        this._autoFocusEnabled = this._settings.get_boolean('auto-focus-enabled');
        this._focusDelayMs = this._settings.get_int('focus-delay-ms');
        this._inputIdleThresholdMs = this._settings.get_int('input-idle-threshold-ms');

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            switch (key) {
                case 'terminal-wm-classes':
                    this._updateTerminalWmClasses();
                    this._scanExistingWindows();
                    break;
                case 'auto-focus-enabled':
                    this._autoFocusEnabled = settings.get_boolean(key);
                    this._updateAutoFocusButtonStyle();
                    this._sendAutoFocusConfig();
                    break;
                case 'focus-delay-ms':
                    this._focusDelayMs = settings.get_int(key);
                    this._sendAutoFocusConfig();
                    break;
                case 'input-idle-threshold-ms':
                    this._inputIdleThresholdMs = settings.get_int(key);
                    this._resetIdleMonitor();
                    break;
            }
        });
    }

    _updateTerminalWmClasses() {
        AGENT_TYPES.claude.wmClasses = this._settings.get_strv('terminal-wm-classes');
        ALL_WM_CLASSES = Object.values(AGENT_TYPES).flatMap(t => t.wmClasses);
    }

    _scanExistingWindows() {
        for (const actor of global.get_window_actors())
            this._trackWindow(actor.meta_window);
    }

    _setupLogo() {
        const file = Gio.File.new_for_path(this._extensionPath + '/logo.png');
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const texture = St.TextureCache.get_default().load_file_async(file, -1, 14, scaleFactor, scaleFactor);
        this._logo = new St.Bin({
            style_class: 'argus-logo',
            y_align: Clutter.ActorAlign.CENTER,
            child: texture,
        });
        this.add_child(this._logo);
    }

    _setupAutoFocusButton() {
        this._autoFocusButton = new St.Button({
            style_class: 'auto-focus-button',
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._autoFocusLabel = new St.Label({
            text: 'A',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._autoFocusButton.set_child(this._autoFocusLabel);

        this._autoFocusButton.connect('clicked', () => {
            this._settings.set_boolean('auto-focus-enabled', !this._autoFocusEnabled);
        });

        this._autoFocusButton.connect('enter-event', () => {
            this._showTooltip(this._autoFocusButton, 'Auto-focus awaiting');
        });

        this._autoFocusButton.connect('leave-event', () => {
            this._hideTooltip();
        });

        this._updateAutoFocusButtonStyle();
        this.add_child(this._autoFocusButton);
    }

    _updateAutoFocusButtonStyle() {
        if (this._autoFocusEnabled) {
            this._autoFocusButton.add_style_class_name('auto-focus-enabled');
        } else {
            this._autoFocusButton.remove_style_class_name('auto-focus-enabled');
        }
    }

    _setupIdleMonitor() {
        this._idleMonitor = global.backend.get_core_idle_monitor();
        this._resetIdleMonitor();
    }

    _resetIdleMonitor() {
        if (this._idleWatchId) {
            this._idleMonitor.remove_watch(this._idleWatchId);
            this._idleWatchId = 0;
        }
        if (this._activeWatchId) {
            this._idleMonitor.remove_watch(this._activeWatchId);
            this._activeWatchId = 0;
        }

        this._sendMessage({ type: 'idle_status', idle: false });

        this._idleWatchId = this._idleMonitor.add_idle_watch(
            this._inputIdleThresholdMs,
            () => {
                this._sendMessage({ type: 'idle_status', idle: true });

                this._activeWatchId = this._idleMonitor.add_user_active_watch(() => {
                    this._sendMessage({ type: 'idle_status', idle: false });
                    this._activeWatchId = 0;
                    this._resetIdleMonitor();
                });
            }
        );
    }

    _sendAutoFocusConfig() {
        this._sendMessage({
            type: 'auto_focus_config',
            enabled: this._autoFocusEnabled,
            focus_delay_ms: this._focusDelayMs,
        });
    }

    _getSocketPath() {
        return GLib.get_user_runtime_dir() + '/agents-monitor/daemon.sock';
    }

    _connectToDaemon() {
        if (this._cancellable.is_cancelled())
            return;

        const socketPath = this._getSocketPath();
        const address = Gio.UnixSocketAddress.new(socketPath);
        const client = new Gio.SocketClient();

        client.connect_async(address, this._cancellable, (client, result) => {
            try {
                this._connection = client.connect_finish(result);
                this._connection.get_socket().set_blocking(false);
                this._inputStream = new Gio.DataInputStream({
                    base_stream: this._connection.get_input_stream(),
                });
                this._outputStream = this._connection.get_output_stream();

                this._sessionWorkspaces.clear();
                this._onFocusWindowChanged();
                this._sendAllWorkspaces();
                this._sendAutoFocusConfig();
                this._readLoop();
            } catch (e) {
                if (!this._cancellable.is_cancelled())
                    this._scheduleReconnect();
            }
        });
    }

    _scheduleReconnect() {
        if (this._reconnectTimeout !== null || this._cancellable.is_cancelled())
            return;

        this._reconnectTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RECONNECT_DELAY, () => {
            this._reconnectTimeout = null;
            this._connectToDaemon();
            return GLib.SOURCE_REMOVE;
        });
    }

    _readLoop() {
        if (!this._inputStream || this._cancellable.is_cancelled())
            return;

        this._inputStream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
            try {
                const [line] = stream.read_line_finish_utf8(result);

                if (line === null) {
                    this._onDisconnected();
                    return;
                }

                this._handleMessage(line);
                this._readLoop();
            } catch (e) {
                if (!this._cancellable.is_cancelled())
                    this._onDisconnected();
            }
        });
    }

    _onDisconnected() {
        this._connection = null;
        this._inputStream = null;
        this._outputStream = null;
        this._agents = [];
        this._updateDots();
        this._scheduleReconnect();
    }

    _handleMessage(line) {
        try {
            const msg = JSON.parse(line);

            if (msg.type === 'render') {
                this._agents = msg.agents;
                this._updateDots();
            } else if (msg.type === 'focus') {
                this._focusWindow(msg.session);
            } else if (msg.type === 'auto_focus') {
                this._onAutoFocus(msg.session);
            } else if (msg.type === 'return_workspace') {
                this._onReturnWorkspace();
            }
        } catch (e) {
            logError(e, 'Failed to parse daemon message');
        }
    }

    _onAutoFocus(session) {
        if (this._originalWorkspace === null && this._isOnPrimaryMonitor(session)) {
            this._originalWorkspace = global.workspace_manager.get_active_workspace_index();
        }
        this._focusWindow(session);
    }

    _isOnPrimaryMonitor(session) {
        const mapped = this._sessionToWindow.get(session);
        if (mapped)
            return mapped.get_monitor() === global.display.get_primary_monitor();

        const groupName = session.split('#')[0];
        const standaloneType = AGENT_TYPES[groupName];
        const primary = global.display.get_primary_monitor();

        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            const wmClass = win.get_wm_class() || '';

            if (standaloneType) {
                if (standaloneType.wmClasses.some(cls => wmClass.includes(cls)))
                    return win.get_monitor() === primary;
            } else if (this._isAgentWindow(win)) {
                if ((win.get_title() || '').includes(groupName))
                    return win.get_monitor() === primary;
            }
        }
        return true;
    }

    _onReturnWorkspace() {
        if (this._originalWorkspace === null) {
            return;
        }

        const ws = global.workspace_manager.get_workspace_by_index(this._originalWorkspace);
        if (ws) {
            ws.activate(global.get_current_time());
        }
        this._originalWorkspace = null;
    }

    _sendMessage(msg) {
        if (!this._outputStream) {
            return;
        }

        try {
            const json = JSON.stringify(msg) + '\n';
            const bytes = new GLib.Bytes(new TextEncoder().encode(json));
            this._outputStream.write_bytes(bytes, null);
        } catch (e) {
            this._onDisconnected();
        }
    }

    _setupFocusMonitoring() {
        this._focusSignalId = global.display.connect(
            'notify::focus-window',
            () => this._onFocusWindowChanged()
        );

        this._windowSignals = new Map();
        this._windowCreatedSignalId = global.display.connect(
            'window-created',
            (_display, win) => this._trackWindow(win)
        );
        this._monitorChangedSignalId = global.display.connect(
            'window-entered-monitor',
            (_display, _monitorIndex, win) => this._sendWorkspaceForWindow(win)
        );
        for (const actor of global.get_window_actors())
            this._trackWindow(actor.meta_window);
    }

    _trackWindow(win) {
        const wm = win.get_wm_class() || '';
        if (!wm) {
            if (!this._wmClassPending.has(win)) {
                const id = win.connect('notify::wm-class', () => {
                    win.disconnect(id);
                    this._wmClassPending.delete(win);
                    this._trackWindow(win);
                });
                this._wmClassPending.set(win, id);
            }
            return;
        }
        if (!this._isAgentWindow(win) || this._windowSignals.has(win))
            return;

        const wsId = win.connect('workspace-changed', () => {
            this._sendAllWorkspaces();
            this._sendWindowFocus(global.display.get_focus_window());
        });
        const titleId = win.connect('notify::title', () => {
            const title = win.get_title() || '';
            const sessionKey = this._extractSessionKey(title);
            if (sessionKey) {
                this._windowToSession.set(win, sessionKey);
                this._sessionToWindow.set(sessionKey, win);
                this._sendWorkspaceForWindow(win);
            }
        });
        const unmanagedId = win.connect('unmanaged', () => {
            const session = this._windowToSession.get(win);
            win.disconnect(wsId);
            win.disconnect(titleId);
            win.disconnect(unmanagedId);
            if (session) this._sessionToWindow.delete(session);
            this._windowToSession.delete(win);
            this._windowSignals.delete(win);
        });
        this._windowSignals.set(win, [wsId, titleId, unmanagedId]);
    }

    _onFocusWindowChanged() {
        const win = global.display.get_focus_window();
        if (!win) {
            return;
        }

        this._sendWindowFocus(win);
        this._sendWorkspaceForWindow(win);

        if (this._originalWorkspace !== null) {
            if (this._isAgentWindow(win)) {
                const wmClass = win.get_wm_class() || '';
                const title = win.get_title() || '';
                const hasAwaiting = this._agents.some(a => {
                    if (a.state !== 'awaiting') return false;
                    const groupName = a.session.split('#')[0];
                    const standaloneType = AGENT_TYPES[groupName];
                    if (standaloneType) {
                        return standaloneType.wmClasses.some(cls => wmClass.includes(cls));
                    }
                    return title.includes(groupName);
                });
                if (!hasAwaiting) {
                    this._originalWorkspace = null;
                }
            } else {
                this._originalWorkspace = null;
            }
        }
    }

    _sendWindowFocus(win) {
        if (!win)
            return;

        if (!this._isAgentWindow(win)) {
            this._sendMessage({ type: 'window_focus', title: '' });
            return;
        }

        const mapped = this._windowToSession.get(win);
        const title = mapped || win.get_title() || '';
        this._sendMessage({ type: 'window_focus', title });
    }

    _sendWorkspaceForWindow(win) {
        if (!win || !this._isAgentWindow(win))
            return;

        const sessionKey = this._windowToSession.get(win)
            || this._extractSessionKey(win.get_title() || '');
        const groupName = sessionKey
            ? (sessionKey.split('#')[0] || sessionKey)
            : (win.get_title() || '');
        if (!groupName) return;

        const ws = win.get_workspace();
        const workspace = ws ? ws.index() : 0;
        const monitor = win.get_monitor();

        const cached = this._sessionWorkspaces.get(groupName);
        if (cached && cached.workspace === workspace && cached.monitor === monitor)
            return;

        this._sessionWorkspaces.set(groupName, { workspace, monitor });
        this._sendMessage({ type: 'session_workspace', session: groupName, workspace, monitor });
    }

    _extractSessionKey(title) {
        let match = title.match(/Argus \(([^)]+)\)/);
        if (match) return match[1];
        match = title.match(/Zellij \(([^)]+)\)/);
        if (match) return match[1];
        match = title.match(/^([^|]+?)\s*\|/);
        if (match) return match[1].trim();
        return null;
    }

    _sendAllWorkspaces() {
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            this._sendWorkspaceForWindow(win);
        }
    }

    _updateDots() {
        const activeKeys = new Set(this._agents.map(a => a.session));
        const activeGroups = new Set(this._agents.map(a => a.group));

        for (const [session, widgets] of this._dotWidgets) {
            if (!activeKeys.has(session)) {
                widgets.button.get_parent()?.remove_child(widgets.button);
                widgets.button.destroy();
                this._dotWidgets.delete(session);
            }
        }

        for (const [groupId, container] of this._groupContainers) {
            if (!activeGroups.has(groupId)) {
                container.remove_all_children();
                this._groupsBox.remove_child(container);
                container.destroy();
                this._groupContainers.delete(groupId);
            }
        }

        const groups = new Map();
        for (const agent of this._agents) {
            if (!groups.has(agent.group)) {
                groups.set(agent.group, []);
            }
            groups.get(agent.group).push(agent);
        }

        let groupIndex = 0;
        for (const [groupId, agents] of groups) {
            let container = this._groupContainers.get(groupId);
            if (!container) {
                container = new St.BoxLayout({
                    style_class: 'agent-group',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._groupContainers.set(groupId, container);
                this._groupsBox.add_child(container);
            }

            const isFocused = agents.some(a => a.focused);
            if (isFocused) {
                container.add_style_class_name('agent-group-focused');
            } else {
                container.remove_style_class_name('agent-group-focused');
            }

            container.style = groupIndex > 0 ? `margin-left: ${MARGIN_DIFFERENT_GROUP}px;` : '';

            for (let i = 0; i < agents.length; i++) {
                const agent = agents[i];
                let widgets = this._dotWidgets.get(agent.session);

                if (!widgets) {
                    widgets = this._createDot(agent);
                    this._dotWidgets.set(agent.session, widgets);
                }

                this._setDotState(widgets.dot, agent.state);
                this._setDotType(widgets.dot, agent.agent_type);

                if (widgets.button.get_parent() !== container) {
                    widgets.button.get_parent()?.remove_child(widgets.button);
                    container.add_child(widgets.button);
                }

                container.set_child_at_index(widgets.button, i);
                widgets.button.style = `padding: ${CLICK_PADDING}px;`;
            }

            this._groupsBox.set_child_at_index(container, groupIndex);
            groupIndex++;
        }

        this.visible = this._agents.length > 0;
    }

    _setDotState(dot, state) {
        const states = ['started', 'awaiting', 'working', 'processing', 'completed', 'ended'];
        for (const s of states) {
            dot.remove_style_class_name(`agent-dot-${s}`);
        }
        dot.add_style_class_name(`agent-dot-${state}`);
    }

    _setDotType(dot, agentType) {
        for (const [, typeInfo] of Object.entries(AGENT_TYPES)) {
            if (typeInfo.dotClass) {
                dot.remove_style_class_name(typeInfo.dotClass);
            }
        }
        const typeInfo = AGENT_TYPES[agentType];
        if (typeInfo?.dotClass) {
            dot.add_style_class_name(typeInfo.dotClass);
        }
    }

    _createDot(agent) {
        const button = new St.Button({
            style: `padding: ${CLICK_PADDING}px;`,
            reactive: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const typeInfo = AGENT_TYPES[agent.agent_type];
        const dotClass = typeInfo?.dotClass
            ? `agent-dot agent-dot-${agent.state} ${typeInfo.dotClass}`
            : `agent-dot agent-dot-${agent.state}`;

        const dot = new St.Widget({
            style_class: dotClass,
            width: 10,
            height: 10,
        });
        dot.set_pivot_point(0.5, 0.5);

        button.set_child(dot);

        button.connect('enter-event', () => {
            dot.set_scale(HOVER_SCALE, HOVER_SCALE);
            this._showTooltip(button, agent.session);
        });

        button.connect('leave-event', () => {
            dot.set_scale(1, 1);
            this._hideTooltip();
        });

        button.connect('clicked', () => {
            this._sendMessage({ type: 'click', session: agent.session });
        });

        return { button, dot };
    }

    _showTooltip(anchor, text) {
        this._hideTooltip();

        this._tooltip = new St.Label({
            text: text,
            style_class: 'dash-label',
            style: 'font-size: 11px;',
        });

        Main.uiGroup.add_child(this._tooltip);

        const [x, y] = anchor.get_transformed_position();
        const [anchorWidth, anchorHeight] = anchor.get_size();
        const [tipWidth] = this._tooltip.get_size();

        this._tooltip.set_position(
            Math.round(x + anchorWidth / 2 - tipWidth / 2),
            Math.round(y + anchorHeight + 6)
        );
    }

    _hideTooltip() {
        if (this._tooltip) {
            Main.uiGroup.remove_child(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
    }

    _focusWindow(session) {
        const mapped = this._sessionToWindow.get(session);
        if (mapped) {
            const ws = mapped.get_workspace();
            if (ws && mapped.get_monitor() === global.display.get_primary_monitor())
                ws.activate(global.get_current_time());
            mapped.activate(global.get_current_time());
            return;
        }

        const groupName = session.split('#')[0];
        const standaloneType = AGENT_TYPES[groupName];

        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            const wmClass = win.get_wm_class() || '';
            let matched = false;

            if (standaloneType) {
                matched = standaloneType.wmClasses.some(cls => wmClass.includes(cls));
            } else if (this._isAgentWindow(win)) {
                const title = win.get_title() || '';
                matched = title.includes(groupName);
            }

            if (matched) {
                if (win.get_monitor() === global.display.get_primary_monitor()) {
                    const ws = win.get_workspace();
                    if (ws)
                        ws.activate(global.get_current_time());
                }
                win.activate(global.get_current_time());
                return;
            }
        }
    }

    focusNext() {
        this._sendMessage({ type: 'focus_next' });
    }

    destroy() {
        this._cancellable.cancel();
        this._hideTooltip();

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._idleWatchId) {
            this._idleMonitor.remove_watch(this._idleWatchId);
            this._idleWatchId = 0;
        }

        if (this._activeWatchId) {
            this._idleMonitor.remove_watch(this._activeWatchId);
            this._activeWatchId = 0;
        }

        if (this._focusSignalId !== null) {
            global.display.disconnect(this._focusSignalId);
            this._focusSignalId = null;
        }

        if (this._windowCreatedSignalId !== null) {
            global.display.disconnect(this._windowCreatedSignalId);
            this._windowCreatedSignalId = null;
        }

        if (this._monitorChangedSignalId !== null) {
            global.display.disconnect(this._monitorChangedSignalId);
            this._monitorChangedSignalId = null;
        }
        for (const [win, signals] of this._windowSignals) {
            for (const id of signals)
                win.disconnect(id);
        }
        this._windowSignals.clear();
        this._windowToSession.clear();
        this._sessionToWindow.clear();
        for (const [win, id] of this._wmClassPending) {
            win.disconnect(id);
        }
        this._wmClassPending.clear();

        if (this._reconnectTimeout !== null) {
            GLib.source_remove(this._reconnectTimeout);
            this._reconnectTimeout = null;
        }

        if (this._connection) {
            this._connection.close(null);
            this._connection = null;
        }

        this._inputStream = null;
        this._outputStream = null;
        this._dotWidgets.clear();
        this._groupContainers.clear();
        this._sessionWorkspaces.clear();
        this._originalWorkspace = null;

        super.destroy();
    }
});

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
