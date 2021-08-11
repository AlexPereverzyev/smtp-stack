'use strict';

const net = require('net');

const Protocol = require('./protocol');
const ipv6normalize = require('./ipv6-normalize');
const utils = require('./utils');
const { current: logger } = require('./logger');

const Commands = {
    XFORWARD: 'XForward',
};

const Params = {
    NAME: 'NAME',
    ADDR: 'ADDR',
    PORT: 'PORT',
    PROTO: 'PROTO',
    HELO: 'HELO',
    IDENT: 'IDENT',
    SOURCE: 'SOURCE',
};

const NoValue = ['[UNAVAILABLE]', '[TEMPUNAVAIL]'];

class XForward extends Protocol {
    getHandler(command) {
        return super.getHandler(command, Commands);
    }

    /**
     * http://www.postfix.org/XFORWARD_README.html
     */
    handleXForward(command, callback) {
        if (!this._settings.useXForward || this._session.xClient.has(Params.ADDR)) {
            this.send(550, 'Error: not allowed');
            callback();
            return;
        }

        if (this._session.envelope.mailFrom) {
            this.emit('send', 503, 'Error: MAIL transaction in progress');
            callback();
            return;
        }

        const parts = command.toString().trim().split(/\s+/);
        parts.shift();

        if (!parts.length) {
            this.emit('send', 501, 'Error: bad command syntax');
            callback();
            return;
        }

        const xstate = { xForward: new Map() };

        for (const part of parts) {
            let [key, value] = part.split('=');
            key = (key || '').toUpperCase();
            value = value || '';

            if (!(key in Params)) {
                this.emit('send', 501, 'Error: bad parameter syntax');
                callback();
                return;
            }

            if (!(value && value.length)) {
                this.emit('send', 501, 'Error: bad parameter syntax');
                callback();
                return;
            }

            if (xstate.xForward.has(key)) {
                this.emit('send', 501, 'Error: duplicate parameter');
                callback();
                return;
            }

            value = utils.decodeXText(value);
            xstate.xForward.set(key, value);

            if (NoValue.includes(value.toUpperCase())) {
                continue;
            }

            switch (key) {
                case Params.ADDR:
                    value = value.replace(/^IPV6:/i, '');

                    if (!net.isIP(value)) {
                        this.emit('send', 501, 'Error: invalid address');
                        callback();
                        return;
                    }
                    if (net.isIPv6(value)) {
                        value = ipv6normalize(value);
                    }

                    logger.debug({
                        sid: this._session.id,
                        command: Commands.XFORWARD,
                        message: Params.ADDR + ': ' + value,
                    });

                    xstate.remoteAddress = value;
                    break;

                case Params.PORT:
                    logger.debug({
                        sid: this._session.id,
                        command: Commands.XFORWARD,
                        message: Params.PORT + ': ' + value,
                    });
                    value = Number(value) || 0;
                    if (value) {
                        xstate.remotePort = value;
                    }
                    break;
                case Params.NAME:
                    logger.debug({
                        sid: this._session.id,
                        command: Commands.XFORWARD,
                        message: Params.NAME + ': ' + value,
                    });
                    xstate.resolvedClientHostname = value.toLowerCase();
                    break;
                case Params.HELO:
                    logger.debug({
                        sid: this._session.id,
                        command: Commands.XFORWARD,
                        message: Params.HELO + ': ' + value,
                    });
                    xstate.advertisedClientHostname = value;
                    break;
                default:
                    break;
            }
        }

        this.emit('state', xstate);
        this.emit('send', 220, 'OK');

        callback();
    }
}

module.exports.Commands = Commands;
module.exports.Params = Params;
module.exports.XForward = XForward;
