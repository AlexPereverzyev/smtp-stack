'use strict';

const { EventEmitter } = require('events');

class Protocol extends EventEmitter {
    constructor(settings, session) {
        super({ objectMode: true });

        this._settings = settings;
        this._session = session;
        this._pending = [];
    }

    close() {
        this._pending.length = 0;
    }

    getHandler(command, supported = {}) {
        const item = this._pending.shift();

        if (item) {
            return item.handler.bind(this, ...item.args);
        }

        if (!(command in supported && !this.isDisabled(command))) {
            return null;
        }

        const handler = this['handle' + supported[command]].bind(this);

        return handler;
    }

    scheduleHandler(handler, ...args) {
        this._pending.push({ handler, args });
    }

    isDisabled(command) {
        return this._settings.disabledCommandsSet.has((command || '').trim().toUpperCase());
    }
}

module.exports = Protocol;
