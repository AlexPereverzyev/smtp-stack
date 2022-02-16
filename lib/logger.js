class Logger {
    constructor(level, backend = console) {
        this.level = level in LogLevels ? level : LogLevels.none;
        this.backend = backend;

        Object.keys(LogLevels)
            .filter((l) => !!l)
            .forEach(
                (l) =>
                    (this[l] = (m) => {
                        if (this.level <= LogLevels[l]) {
                            this.backend[l](m);
                        }
                    })
            );
    }
}

const LogLevels = {
    none: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
};

module.exports = {
    current: new Logger(),
    LogLevels,
    Logger,
};
