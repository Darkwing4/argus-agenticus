export class IdleMonitor {

    constructor(thresholdMs) {
        this._thresholdMs = thresholdMs;
        this._idleMonitor = null;
        this._idleWatchId = 0;
        this._activeWatchId = 0;

        this.onIdle = null;
        this.onActive = null;
    }

    start() {
        this._idleMonitor = global.backend.get_core_idle_monitor();
        this._resetWatch();
    }

    updateThreshold(ms) {
        this._thresholdMs = ms;
        this._resetWatch();
    }

    stop() {
        if (this._idleWatchId) {
            this._idleMonitor.remove_watch(this._idleWatchId);
            this._idleWatchId = 0;
        }
        if (this._activeWatchId) {
            this._idleMonitor.remove_watch(this._activeWatchId);
            this._activeWatchId = 0;
        }
        this._idleMonitor = null;
    }

    _resetWatch() {
        if (this._idleWatchId) {
            this._idleMonitor.remove_watch(this._idleWatchId);
            this._idleWatchId = 0;
        }
        if (this._activeWatchId) {
            this._idleMonitor.remove_watch(this._activeWatchId);
            this._activeWatchId = 0;
        }

        this.onActive?.();

        this._idleWatchId = this._idleMonitor.add_idle_watch(
            this._thresholdMs,
            () => {
                this.onIdle?.();

                this._activeWatchId = this._idleMonitor.add_user_active_watch(() => {
                    this.onActive?.();
                    this._activeWatchId = 0;
                    this._resetWatch();
                });
            }
        );
    }
}
