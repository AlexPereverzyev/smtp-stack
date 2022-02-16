const { timestamp } = require('./utils');

class Logger {
    constructor(level, backend) {
        this.setup(level, backend);

        Object.keys(LogLevels)
            .filter((l) => !!l)
            .forEach(
                (l) =>
                    (this[l] = (m) => {
                        if (this.level >= LogLevels[l]) {
                            this.backend[l](this._format(m, l));
                        }
                    })
            );
    }

    setup(level, backend = console) {
        this.level = Object.values(LogLevels).includes(level) ? level : LogLevels.none;
        this.backend = backend;
    }

    _format(obj, level) {
        return (
            `[${timestamp()}] ${level} ` +
            `${obj.sid || '?'} ` +
            `${obj.command || '?'} - ` +
            (obj.method ? `${obj.method} - ` : '') +
            (obj.message ? `${obj.message} - ` : '') +
            JSON.stringify(obj, (key, value) => {
                if (LogHeader.has(key)) {
                    return undefined;
                }
                return value;
            })
        );
    }
}

const LogHeader = new Set(['sid', 'command', 'method', 'message']);

const LogLevels = {
    none: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};

module.exports = {
    current: new Logger(),
    LogLevels,
    Logger,
};
