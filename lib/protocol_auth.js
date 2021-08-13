'use strict';

const util = require('util');
const crypto = require('crypto');

const consts = require('./consts');
const Protocol = require('./protocol');
const { current: logger } = require('./logger');

const Commands = {
    AUTH: 'Auth',
};

const CommandsSet = new Set(Object.keys(Commands));

const Methods = {
    PLAIN: 'Plain',
    LOGIN: 'Login',
    XOAUTH2: 'XOAuth2',
    CRAMMD5: 'Cram-Md5',
    'CRAM-MD5': 'CramMd5',
};

const Username = Buffer.from('Username:').toString('base64');
const Password = Buffer.from('Password:').toString('base64');

/**
 * https://datatracker.ietf.org/doc/html/rfc4954
 */
class Authentication extends Protocol {
    getHandler(command) {
        if (CommandsSet.has(command)) {
            // do not accept commands w/o greeting reply
            if (!this._session.advertisedClientHostname) {
                return (_, callback) => {
                    this.emit(
                        'send',
                        503,
                        'Error: send ' + (this._settings.lmtp ? 'LHLO' : 'HELO/EHLO') + ' first'
                    );
                    setImmediate(callback);
                };
            }
        }

        return super.getHandler(command, Commands);
    }

    // AUTH

    handleAuth(command, callback) {
        if (this._session.user) {
            this.emit('send', 503, 'Error: already authenticated');
            callback();
            return;
        }

        if (
            !this._session.secure &&
            !this._settings.allowInsecureAuth &&
            !this.isDisabled(consts.Commands.STARTTLS)
        ) {
            this.emit('send', 538, 'Error: send STARTTLS first');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            message: 'Received',
        });

        const args = command.toString().trim().split(/\s+/);
        args.shift();
        const method = (args.shift() || '').toUpperCase();

        if (!this._settings.authMethodsSet.has(method)) {
            this.emit('send', 504, 'Error: unrecognized authentication type');
            callback();
            return;
        }

        const methodHandler = super.getHandler(method, Methods);

        if (!methodHandler) {
            this.emit('send', 504, 'Error: unsupported authentication type');
            callback();
            return;
        }

        methodHandler(args, callback);
    }

    // AUTH PLAIN

    handlePlain(args, callback) {
        if (args.length > 1) {
            this.emit('send', 501, 'Error: AUTH PLAIN syntax');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.PLAIN,
            message: 'Started',
        });

        if (!args.length) {
            this.scheduleHandler(this.handlePlainToken);
            this.emit('send', 304);
            callback();
            return;
        }

        this.handlePlainToken(args[0], callback);
    }

    handlePlainToken(token, callback) {
        token = (token || '').toString().trim();

        const payload = Buffer.from(token, 'base64').toString().split('\x00');

        if (payload.length !== 3) {
            this.emit('send', 501, 'Error: AUTH PLAIN payload');
            callback();
            return;
        }

        const username = payload[1];
        const password = payload[2];

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.PLAIN,
            message: 'Token',
            username,
        });

        this.emit(
            'auth',
            {
                method: Methods.PLAIN.toUpperCase(),
                username,
                password,
            },
            this._session,
            (err, result) => this._handleAuthResult(err, result, Methods.PLAIN, username, callback)
        );
    }

    // AUTH LOGIN

    handleLogin(args, callback) {
        if (args.length > 1) {
            this.emit('send', 501, 'Error: AUTH LOGIN syntax');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.LOGIN,
            message: 'Started',
        });

        if (!args.length) {
            this.scheduleHandler(this.handleLoginUsername);
            this.emit('send', 334, Username);
            callback();
            return;
        }

        this.handleLoginUsername(args[0], callback);
    }

    handleLoginUsername(username, callback) {
        username = (username || '').toString().trim();
        username = Buffer.from(username, 'base64').toString();

        if (!username) {
            this.emit('send', 501, 'Error: username missing');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.LOGIN,
            message: 'Username',
            username,
        });

        this.scheduleHandler(this.handleLoginPassword, username);
        this.emit('send', 334, Password);
        callback();
    }

    handleLoginPassword(username, password, callback) {
        password = (password || '').toString().trim();
        password = Buffer.from(password, 'base64').toString();

        if (!password) {
            this.emit('send', 501, 'Error: password missing');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.LOGIN,
            message: 'Password',
            username,
        });

        this.emit(
            'auth',
            {
                method: Methods.LOGIN.toUpperCase(),
                username,
                password,
            },
            this._session,
            (err, result) => this._handleAuthResult(err, result, Methods.LOGIN, username, callback)
        );
    }

    // AUTH XOAUTH2

    handleXOAuth2(args, callback) {
        if (args.length > 1) {
            this.emit('send', 501, 'Error: invalid AUTH XOAUTH2 syntax');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.XOAUTH2,
            message: 'Started',
        });

        if (!args.length) {
            this.scheduleHandler(this.handleXOAuth2Token);
            this.emit('send', 334);
            callback();
            return;
        }

        this.handleXOAuth2Token(args[0], callback);
    }

    handleXOAuth2Token(token, callback) {
        token = (token || '').toString().trim();

        let username;
        let accessToken;

        Buffer.from(token, 'base64')
            .toString()
            .split('\x01')
            .forEach((part) => {
                part = part.split('=');
                const key = part.shift().toLowerCase();
                let value = part.join('=').trim();

                if (key === 'user') {
                    username = value;
                    return;
                }

                if (key === 'auth') {
                    value = value.split(/\s+/);

                    if (value.shift().toLowerCase() === 'bearer') {
                        accessToken = value.join(' ');
                    }
                }
            });

        if (!(username && accessToken)) {
            this.emit('send', 501, 'Error: invalid XOAUTH2 payload');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.XOAUTH2,
            message: 'Token',
            username,
        });

        this.emit(
            'auth',
            {
                method: Methods.XOAUTH2.toUpperCase(),
                username,
                accessToken,
            },
            this._session,
            (err, result) =>
                this._handleAuthResult(err, result, Methods.XOAUTH2, username, callback)
        );
    }

    // AUTH CRAM-MD5

    handleCramMd5(args, callback) {
        if (args.length) {
            this.emit('send', 501, 'Error: invalid AUTH CRAM-MD5 syntax');
            callback();
            return;
        }

        const challenge = util.format(
            '<%s%s@%s>',
            Math.random().toString().substr(2, 10),
            (Date.now() / 1000) | 0,
            this._settings.name
        );

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.CRAMMD5,
            message: 'Started',
        });

        this.scheduleHandler(this.handleCramMd5Token, challenge);
        this.emit('send', 334, Buffer.from(challenge).toString('base64'));
        callback();
    }

    handleCramMd5Token(challenge, token, callback) {
        token = (token || '').toString().trim();

        const parts = Buffer.from(token, 'base64').toString().split(' ');
        const username = parts.shift();
        const challengeResponse = (parts.shift() || '').toLowerCase();

        if (!(username && challengeResponse)) {
            this.emit('send', 501, 'Error: challenge response missing');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: Methods.CRAMMD5,
            message: 'Challenge',
            username,
        });

        this.emit(
            'auth',
            {
                method: Methods.CRAMMD5.toUpperCase(),
                username,
                validate: function (secret) {
                    return (
                        crypto
                            .createHmac('md5', secret)
                            .update(challenge)
                            .digest('hex')
                            .toLowerCase() === challengeResponse
                    );
                },
            },
            this._session,
            (err, result) =>
                this._handleAuthResult(err, result, Methods.CRAMMD5, username, callback)
        );
    }

    _handleAuthResult(err, result, method, username, callback) {
        if (err) {
            logger.error({
                sid: this._session.id,
                command: Commands.AUTH,
                method: method,
                message: err.message,
                username,
                err,
            });
            this.emit('send', err.code || 535, err.message);
            callback();
            return;
        }

        if (!result.user) {
            logger.debug({
                sid: this._session.id,
                command: Commands.AUTH,
                method: method,
                message: 'Authentication failed',
                username,
            });
            this.emit('send', result.code || 535, result.message || 'Error: authentication failed');
            callback();
            return;
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.AUTH,
            method: method,
            message: 'Authentication successful',
            username,
        });

        this._session.user = result.user;
        this.emit('send', 235, 'Authentication successful');
        callback();
    }
}

module.exports.Commands = Commands;
module.exports.Methods = Methods;
module.exports.Auth = Authentication;
