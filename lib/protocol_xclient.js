'use strict';

const net = require('net');

const Protocol = require('./protocol');
const ipv6normalize = require('./ipv6-normalize');
const utils = require('./utils');
const { current: logger } = require('./logger');

const Commands = {
    XCLIENT: 'XClient',
};

const Params = {
    NAME: 'NAME',
    ADDR: 'ADDR',
    PORT: 'PORT',
    PROTO: 'PROTO',
    HELO: 'HELO',
    LOGIN: 'LOGIN',
};

const NoValue = ['[UNAVAILABLE]', '[TEMPUNAVAIL]'];

class XClient extends Protocol {
    getHandler(command) {
        return super.getHandler(command, Commands);
    }

    /**
     * http://www.postfix.org/XCLIENT_README.html
     */
    handleXClient(command, callback) {
        if (!this._settings.useXClient || this._session.xClient.has(Params.ADDR)) {
            this.emit('send', 550, 'Error: not allowed');
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
            this.emit('send', 501, 'Error: bad parameter syntax');
            callback();
            return;
        }

        let deferLogin = false;
        const xstate = { xClient: new Map() };

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

            if (xstate.xClient.has(key)) {
                this.emit('send', 501, 'Error: duplicate parameter');
                callback();
                return;
            }

            value = utils.decodeXText(value);
            xstate.xClient.set(key, value);

            if (NoValue.includes(value.toUpperCase())) {
                continue;
            }

            switch (key) {
                case Params.LOGIN:
                    deferLogin = value;
                    break;
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
                        command: Commands.XCLIENT,
                        message: Params.ADDR + ': ' + value,
                    });

                    xstate.remoteAddress = value;
                    xstate.advertisedClientHostname = false;
                    break;

                case Params.PORT:
                    logger.debug({
                        sid: this._session.id,
                        command: Commands.XCLIENT,
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
                        command: Commands.XCLIENT,
                        message: Params.NAME + ': ' + value,
                    });
                    xstate.resolvedClientHostname = value.toLowerCase();
                    break;
                default:
                    break;
            }
        }

        if (xstate.remoteAddress && !xstate.resolvedClientHostname) {
            xstate.resolvedClientHostname = '[' + xstate.remoteAddress + ']';
        }

        const res =
            this._settings.name +
            ' ' +
            (this._settings.lmtp ? 'LMTP' : 'ESMTP') +
            (this._settings.banner ? ' ' + this._settings.banner : '');

        if (!deferLogin) {
            this.emit('state', xstate);
            this.emit('send', 220, res);

            callback();
            return;
        }

        this.handleXClientLogin(this, deferLogin, (err) => {
            if (err) {
                this.emit('send', 550, err.message);
                this.emit('close');
                return;
            }

            this.emit('state', xstate);
            this.emit('send', 220, res);

            callback();
        });
    }

    handleXClientLogin(args, callback) {
        const username = (args || '').toString().trim();

        if (!username) {
            callback(new Error('Username missing'));
            return;
        }

        this._session.auth = {
            command: Commands.XCLIENT.toUpperCase(),
            username,
        };

        this.emit('login', this._session, (err, result) => {
            if (err) {
                logger.error({
                    err,
                    sid: this._session.id,
                    command: Commands.XCLIENT,
                    message: err.message,
                    user: username,
                });
                callback(err);
                return;
            }

            if (!result.user) {
                logger.debug({
                    sid: this._session.id,
                    command: Commands.XCLIENT,
                    message: 'Login validation failed',
                    user: username,
                });
                callback(new Error('Login invalid'));
                return;
            }

            logger.debug({
                sid: this._session.id,
                command: Commands.XCLIENT,
                message: 'Login validated successfully',
                user: username,
            });

            this._session.user = result.user;
            callback();
        });
    }
}

module.exports.Commands = Commands;
module.exports.Params = Params;
module.exports.XClient = XClient;
