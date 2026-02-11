import { AGENT_TYPES } from './constants.js';

export class FocusManager {

    constructor(windowTracker) {
        this._windowTracker = windowTracker;
        this._originalWorkspace = null;
        this._sessionWorkspaces = new Map();
    }

    focusWindow(session) {
        const mapped = this._windowTracker.getWindowForSession(session);
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
            } else if (this._windowTracker.isAgentWindow(win)) {
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

    isOnPrimaryMonitor(session) {
        const mapped = this._windowTracker.getWindowForSession(session);
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
            } else if (this._windowTracker.isAgentWindow(win)) {
                if ((win.get_title() || '').includes(groupName))
                    return win.get_monitor() === primary;
            }
        }
        return true;
    }

    handleAutoFocus(session) {
        if (this._originalWorkspace === null && this.isOnPrimaryMonitor(session)) {
            this._originalWorkspace = global.workspace_manager.get_active_workspace_index();
        }
        this.focusWindow(session);
    }

    returnWorkspace() {
        if (this._originalWorkspace === null)
            return;

        const ws = global.workspace_manager.get_workspace_by_index(this._originalWorkspace);
        if (ws)
            ws.activate(global.get_current_time());
        this._originalWorkspace = null;
    }

    updateOriginalWorkspace(win, agents) {
        if (this._originalWorkspace === null)
            return;

        if (this._windowTracker.isAgentWindow(win)) {
            const wmClass = win.get_wm_class() || '';
            const title = win.get_title() || '';
            const hasAwaiting = agents.some(a => {
                if (a.state !== 'awaiting') return false;
                const groupName = a.session.split('#')[0];
                const standaloneType = AGENT_TYPES[groupName];
                if (standaloneType) {
                    return standaloneType.wmClasses.some(cls => wmClass.includes(cls));
                }
                return title.includes(groupName);
            });
            if (!hasAwaiting)
                this._originalWorkspace = null;
        } else {
            this._originalWorkspace = null;
        }
    }

    sendWindowFocus(win, sendMessage) {
        if (!win)
            return;

        if (!this._windowTracker.isAgentWindow(win)) {
            sendMessage({ type: 'window_focus', title: '' });
            return;
        }

        const mapped = this._windowTracker.getSessionForWindow(win);
        const title = mapped || win.get_title() || '';
        sendMessage({ type: 'window_focus', title });
    }

    sendWorkspaceForWindow(win, sendMessage) {
        if (!win || !this._windowTracker.isAgentWindow(win))
            return;

        const sessionKey = this._windowTracker.getSessionForWindow(win)
            || this._windowTracker.extractSessionKey(win.get_title() || '');
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
        sendMessage({ type: 'session_workspace', session: groupName, workspace, monitor });
    }

    sendAllWorkspaces(sendMessage) {
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            this.sendWorkspaceForWindow(win, sendMessage);
        }
    }

    resetWorkspaceCache() {
        this._sessionWorkspaces.clear();
    }

    destroy() {
        this._sessionWorkspaces.clear();
        this._originalWorkspace = null;
    }
}
