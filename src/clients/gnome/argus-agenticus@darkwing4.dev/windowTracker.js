import { AGENT_TYPES, ALL_WM_CLASSES } from './constants.js';

export class WindowTracker {

    constructor() {
        this._focusSignalId = null;
        this._windowCreatedSignalId = null;
        this._monitorChangedSignalId = null;
        this._windowSignals = new Map();
        this._windowToSession = new Map();
        this._sessionToWindow = new Map();
        this._wmClassPending = new Map();
        this._windowFirstTitle = new Map();

        this.onFocusChanged = null;
        this.onCursorCliDetected = null;
        this.onWindowTracked = null;
        this.onMonitorChanged = null;
        this.onWorkspaceChanged = null;
        this.onWindowUnmanaged = null;
    }

    start() {
        this._focusSignalId = global.display.connect(
            'notify::focus-window',
            () => {
                const win = global.display.get_focus_window();
                if (win)
                    this.onFocusChanged?.(win);
            }
        );

        this._windowCreatedSignalId = global.display.connect(
            'window-created',
            (_display, win) => this._trackWindow(win)
        );

        this._monitorChangedSignalId = global.display.connect(
            'window-entered-monitor',
            (_display, _monitorIndex, win) => this.onMonitorChanged?.(win)
        );

        for (const actor of global.get_window_actors())
            this._trackWindow(actor.meta_window);
    }

    stop() {
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
        this._windowFirstTitle.clear();

        for (const [win, id] of this._wmClassPending) {
            win.disconnect(id);
        }
        this._wmClassPending.clear();
    }

    getWindowForSession(session) {
        return this._sessionToWindow.get(session) || null;
    }

    getSessionForWindow(win) {
        return this._windowToSession.get(win) || null;
    }

    extractSessionKey(title) {
        let match = title.match(/Argus \(([^)]+)\)/);
        if (match) return match[1];
        match = title.match(/Zellij \(([^)]+)\)/);
        if (match) return match[1];
        match = title.match(/^([^|]+?)\s*\|/);
        if (match) return match[1].trim();
        match = title.match(/^.+\s[\u2014\u2013\-]\s(.+?)\s[\u2014\u2013\-]\sCursor$/);
        if (match) return match[1];
        match = title.match(/^(.+?)\s[\u2014\u2013\-]\sCursor$/);
        if (match) return match[1];
        if (title.includes('ursor'))
            logError(new Error(`extractSessionKey miss: "${title}"`));
        return null;
    }

    isAgentWindow(win) {
        const wmClass = win.get_wm_class() || '';
        return ALL_WM_CLASSES.some(cls => wmClass.includes(cls));
    }

    getAgentTypeForWindow(win) {
        const wmClass = win.get_wm_class() || '';
        for (const [typeName, typeInfo] of Object.entries(AGENT_TYPES)) {
            if (typeInfo.wmClasses.some(cls => wmClass.includes(cls)))
                return [typeName, typeInfo];
        }
        const title = win.get_title() || '';
        if (title.startsWith('Cursor Agent'))
            return ['cursor', AGENT_TYPES.cursor];
        return [null, null];
    }

    getFirstTitle(win) {
        return this._windowFirstTitle.get(win) || null;
    }

    setSessionMapping(win, sessionKey) {
        this._windowToSession.set(win, sessionKey);
        this._sessionToWindow.set(sessionKey, win);
    }

    rescan() {
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
        if (!this.isAgentWindow(win) || this._windowSignals.has(win))
            return;

        const wsId = win.connect('workspace-changed', () => {
            this.onWorkspaceChanged?.();
        });

        const titleId = win.connect('notify::title', () => {
            const title = win.get_title() || '';
            const sessionKey = this.extractSessionKey(title);
            if (sessionKey) {
                this._windowToSession.set(win, sessionKey);
                this._sessionToWindow.set(sessionKey, win);
                this.onWindowTracked?.(win, sessionKey);
            }
            if (!this._windowFirstTitle.has(win) && !title.startsWith('Cursor Agent')) {
                this._windowFirstTitle.set(win, title);
            }
            if (title.startsWith('Cursor Agent')) {
                this.onCursorCliDetected?.(win);
            }
        });

        const unmanagedId = win.connect('unmanaged', () => {
            const session = this._windowToSession.get(win);
            win.disconnect(wsId);
            win.disconnect(titleId);
            win.disconnect(unmanagedId);
            if (session) this._sessionToWindow.delete(session);
            this._windowToSession.delete(win);
            this._windowFirstTitle.delete(win);
            this._windowSignals.delete(win);
            if (session) this.onWindowUnmanaged?.(session);
        });

        this._windowSignals.set(win, [wsId, titleId, unmanagedId]);

        const currentTitle = win.get_title() || '';
        if (!this._windowFirstTitle.has(win) && currentTitle && !currentTitle.startsWith('Cursor Agent')) {
            this._windowFirstTitle.set(win, currentTitle);
        }
        const currentKey = this.extractSessionKey(currentTitle);
        if (currentKey) {
            this._windowToSession.set(win, currentKey);
            this._sessionToWindow.set(currentKey, win);
        }
    }
}
