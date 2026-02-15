import { AGENT_TYPES } from './constants.js';

export class FocusManager {

    constructor(windowTracker) {
        this._windowTracker = windowTracker;
        this._originalWorkspace = null;
        this._sessionWorkspaces = new Map();
    }

    focusWindow(session, agentType) {
        let mapped = this._windowTracker.getWindowForSession(session);
        if (!mapped) {
            const groupName = session.split('#')[0];
            if (groupName !== session)
                mapped = this._windowTracker.getWindowForSession(groupName);
        }
        if (mapped) {
            this._windowTracker.setSessionMapping(mapped, session);
            this._activateWindow(mapped);
            return;
        }

        const groupName = session.split('#')[0];

        const typeInfo = agentType ? AGENT_TYPES[agentType] : null;
        if (typeInfo) {
            const match = this._findStableMatch(
                w => typeInfo.wmClasses.some(cls => (w.get_wm_class() || '').includes(cls))
                    && (w.get_title() || '').includes(groupName)
            );
            if (match) {
                this._activateWindow(match);
                return;
            }

            if (agentType === 'cursor') {
                let cursorMatch = this._findStableMatch(
                    w => (w.get_title() || '').startsWith('Cursor Agent')
                        && (this._windowTracker.getFirstTitle(w) || '').includes(groupName)
                );
                if (!cursorMatch) {
                    cursorMatch = this._findStableMatch(
                        w => (w.get_title() || '').startsWith('Cursor Agent')
                    );
                }
                if (cursorMatch) {
                    this._windowTracker.setSessionMapping(cursorMatch, session);
                    this._activateWindow(cursorMatch);
                    return;
                }
            }
        }
        const standaloneType = AGENT_TYPES[groupName];

        const match = this._findStableMatch(w => {
            const wmClass = w.get_wm_class() || '';
            if (standaloneType)
                return standaloneType.wmClasses.some(cls => wmClass.includes(cls));
            if (this._windowTracker.isAgentWindow(w))
                return (w.get_title() || '').includes(groupName);
            return false;
        });
        if (match)
            this._activateWindow(match);
    }

    _findStableMatch(predicate) {
        const candidates = global.get_window_actors()
            .map(a => a.meta_window)
            .filter(predicate);
        if (candidates.length === 0)
            return null;
        if (candidates.length === 1)
            return candidates[0];
        candidates.sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        return candidates[0];
    }

    _activateWindow(win) {
        if (win.get_monitor() === global.display.get_primary_monitor()) {
            const ws = win.get_workspace();
            if (ws)
                ws.activate(global.get_current_time());
        }
        win.activate(global.get_current_time());
    }

    isOnPrimaryMonitor(session) {
        let mapped = this._windowTracker.getWindowForSession(session);
        if (!mapped) {
            const groupName = session.split('#')[0];
            if (groupName !== session)
                mapped = this._windowTracker.getWindowForSession(groupName);
        }
        if (mapped)
            return mapped.get_monitor() === global.display.get_primary_monitor();

        const groupName = session.split('#')[0];
        const standaloneType = AGENT_TYPES[groupName];
        const primary = global.display.get_primary_monitor();

        let match = this._findStableMatch(w => {
            const wmClass = w.get_wm_class() || '';
            if (standaloneType)
                return standaloneType.wmClasses.some(cls => wmClass.includes(cls));
            if (this._windowTracker.isAgentWindow(w))
                return (w.get_title() || '').includes(groupName);
            return false;
        });
        if (!match) {
            match = this._findStableMatch(
                w => (w.get_title() || '').startsWith('Cursor Agent')
                    && (this._windowTracker.getFirstTitle(w) || '').includes(groupName)
            );
        }
        return match ? match.get_monitor() === primary : true;
    }

    handleAutoFocus(session, agentType) {
        if (this._originalWorkspace === null && this.isOnPrimaryMonitor(session)) {
            this._originalWorkspace = global.workspace_manager.get_active_workspace_index();
        }
        this.focusWindow(session, agentType);
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

        const [agentType] = this._windowTracker.getAgentTypeForWindow(win);
        const mapped = this._windowTracker.getSessionForWindow(win);
        const title = mapped || win.get_title() || '';
        sendMessage({ type: 'window_focus', title, agent_type: agentType || '' });
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
