class Logger {
    constructor(level) {
        this.level = level in LogLevels ? level : LogLevels.none;
        this.backend = console;

        Object.keys(LogLevels).forEach(
            (l) =>
                (this[l] = (m) => {
                    if (this.level < LogLevels[l]) {
                        this.backend[l](m);
                    }
                })
        );
    }
}

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
