const PREFIX = 'Argus';

const LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

let _level = 0;

export function setLogLevel(level) {
    _level = LEVELS[level] ?? 0;
}

export class Logger {
    constructor(tag) {
        this._tag = tag;
    }

    error(msg) {
        if (_level >= LEVELS.error)
            console.error(`[ERROR ${PREFIX}:${this._tag}] ${msg}`);
    }

    warn(msg) {
        if (_level >= LEVELS.warn)
            console.warn(`[WARN ${PREFIX}:${this._tag}] ${msg}`);
    }

    info(msg) {
        if (_level >= LEVELS.info)
            console.log(`[INFO ${PREFIX}:${this._tag}] ${msg}`);
    }

    debug(msg) {
        if (_level >= LEVELS.debug)
            console.log(`[DEBUG ${PREFIX}:${this._tag}] ${msg}`);
    }

    log(tag, message) {
        if (_level >= LEVELS.debug)
            console.log(`[DEBUG ${PREFIX}:${this._tag}:${tag}] ${message}`);
    }
}
