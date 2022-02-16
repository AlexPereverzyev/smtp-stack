class Logger {
    constructor(level, backend) {
        this.setup(level, backend);

        Object.keys(LogLevels)
            .filter((l) => !!l)
            .forEach(
                (l) =>
                    (this[l] = (m) => {
                        if (this.level >= LogLevels[l]) {
                            this.backend[l](m);
                        }
                    })
            );
    }

    setup(level, backend = console) {
        this.level = Object.values(LogLevels).includes(level) ? level : LogLevels.none;
        this.backend = backend;
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
