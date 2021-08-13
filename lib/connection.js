'use strict';

const net = require('net');
const EventEmitter = require('events');

const consts = require('./consts');
const utils = require('./utils');
const ipv6normalize = require('./ipv6-normalize');
const SmtpStream = require('./parser').SmtpStream;
const { current: logger } = require('./logger');

const { Auth } = require('./protocol_auth');
const { Handshake } = require('./protocol_helo');
const { Mail } = require('./protocol_mail');
const { XClient } = require('./protocol_xclient');
const { XForward } = require('./protocol_xforward');

class SmtpConnection extends EventEmitter {
    constructor(manager, settings, socket, socketSettings) {
        super();

        this.id = socketSettings.id || utils.sid();

        this._manager = manager;
        this._settings = settings;
        this._socket = socket;
        this._parser = new SmtpStream().on('command', (b, c) => this._onCommand(b, c));
        this._transactions = 0;

        this._ready = false;
        this._upgrading = false;
        this._closing = false;
        this._closed = false;

        this.resolvedClientHostname = null;
        this.advertisedClientHostname = null;
        this.clientGreeting = null;

        this.secure = !!this._settings.secure;
        this.session = this.session = {
            id: this.id,
            secure: this.secure,
        };

        this.xClient = new Map();
        this.xForward = new Map();

        // TLS
        this.tlsOptions = this.secure && this._socket.getCipher ? this._socket.getCipher() : false;

        // local address
        this.localAddress = (
            socketSettings.localAddress ||
            this._socket.localAddress ||
            ''
        ).replace(/^::ffff:/, '');
        this.localPort = Number(socketSettings.localPort || this._socket.localPort) || 0;

        if (this.localAddress && net.isIPv6(this.localAddress)) {
            this.localAddress = ipv6normalize(this.localAddress);
        }

        // remote address
        this.remoteAddress = (
            (!socketSettings.ignore && socketSettings.remoteAddress) ||
            this._socket.remoteAddress ||
            ''
        ).replace(/^::ffff:/, '');
        this.remotePort =
            Number(
                (!socketSettings.ignore && socketSettings.remotePort) || this._socket.remotePort
            ) || 0;

        if (this.remoteAddress && net.isIPv6(this.remoteAddress)) {
            this.remoteAddress = ipv6normalize(this.remoteAddress);
        }

        // SMTP stack
        this._pipeline = [
            new Auth(this._settings, this.session)
                .on('send', (c, m) => this.send(c, m))
                .on('auth', (c, s, cb) => this.emit('auth', c, s, cb)),
            new Handshake(this._settings, this.session)
                .on('send', (c, m) => this.send(c, m))
                .on('upgrade', () => this._upgradeConn())
                .on('state', (u) => this._updateState(u))
                .on('reset', () => this._resetSession())
                .on('close', () => this.close()),
            new Mail(this._settings, this.session, this._parser)
                .on('send', (c, m) => this.send(c, m))
                .on('mail', (a, s, c) => this.emit('mail', a, s, c))
                .on('rcpt', (a, s, c) => this.emit('rcpt', a, s, c))
                .on('data', (s, c) => this.emit('data', s, c))
                .on('reset', () => this._resetSession()),
            new XClient(this._settings, this.session)
                .on('send', (c, m) => this.send(c, m))
                .on('state', (u) => this._updateState(u))
                .on('close', () => this.close()),
            new XForward(this._settings, this.session)
                .on('send', (c, m) => this.send(c, m))
                .on('state', (u) => this._updateState(u)),
        ];

        // default SMTP middleware
        this._middleware = [this._smtpMiddleware.bind(this)];
    }

    use(...middleware) {
        this._middleware.push(...middleware);
    }

    init() {
        this._socket.on('error', (err) => this._onError(err));
        this._socket.on('close', (hadError) => this._onClose(hadError));
        this._socket.setTimeout(this._settings.socketTimeout, () => this._onTimeout());
        this._socket.pipe(this._parser);

        this._manager.reverseDns(this.remoteAddress.toString(), (err, hostnames) => {
            if (err) {
                logger.warn({
                    err,
                    sid: this.session.id,
                    command: 'reverseDns',
                    message: err.message,
                    host: this.remoteAddress,
                });
            }

            if (this._closing || this._closed) {
                return;
            }

            this.resolvedClientHostname =
                (hostnames && hostnames.shift()) || '[' + this.remoteAddress + ']';

            this._resetSession();

            this.emit('init', this.session, (err) => {
                if (err) {
                    this.send(err.code || 554, err.message);
                    this.close();
                    return;
                }

                logger.debug({
                    sid: this.session.id,
                    command: 'init',
                    message: 'connection initialized',
                    host: this.remoteAddress,
                });

                this.send(
                    220,
                    this._settings.name +
                        ' ' +
                        (this._settings.lmtp ? 'LMTP' : 'ESMTP') +
                        (this._settings.banner ? ' ' + this._settings.banner : '')
                );

                this._ready = true;
            });
        });
    }

    send(code, data) {
        let payload;

        if (Array.isArray(data)) {
            payload = data
                .map((line, i, arr) => code + (i < arr.length - 1 ? '-' : ' ') + line)
                .join('\r\n');
        } else {
            payload = code + ' ' + data;
        }

        payload += '\r\n';

        if (this._socket && this._socket.writable) {
            this._socket.write(payload);

            logger.debug({
                sid: this.session.id,
                command: 'send',
                payload,
            });
        }

        if (code >= 400) {
            this.session.error = payload;
        }

        if (code === 421) {
            this.close();
        }
    }

    close() {
        if (this._closing) {
            return;
        }

        this._closing = true;

        if (this._socket.destroyed || !this._socket.writable) {
            return;
        }

        this._socket.end(() => this._socket.destroy());
    }

    _onClose(hadError) {
        if (this._closed) {
            return;
        }

        this._closed = true;
        this._closing = false;

        logger.debug({
            sid: this.session.id,
            command: 'close',
            message: 'connection closing',
            host: this.remoteAddress,
            hadError,
        });

        if (this._parser) {
            this._parser.closed = true;
            this._socket.unpipe(this._parser);
            this._parser = null;
        }

        this._pipeline.forEach((h) => h.close());

        setImmediate(() => this.emit('close', this));

        logger.debug({
            sid: this.session.id,
            command: 'close',
            message: 'connection closed',
            host: this.remoteAddress,
        });
    }

    _onError(err) {
        err.remote = this.remoteAddress;

        logger.error({
            err,
            sid: this.session.id,
            command: 'connection socket',
            message: err.message,
        });

        this.emit('error', err);
    }

    _onTimeout() {
        this.send(421, 'Connection idle timeout');
    }

    _resetSession() {
        this.session.localAddress = this.localAddress;
        this.session.localPort = this.localPort;
        this.session.remoteAddress = this.remoteAddress;
        this.session.remotePort = this.remotePort;
        this.session.clientGreeting = this.clientGreeting;
        this.session.resolvedClientHostname = this.resolvedClientHostname;
        this.session.advertisedClientHostname = this.advertisedClientHostname;
        this.session.tlsOptions = this.tlsOptions;
        this.session.xClient = this.xClient;
        this.session.xForward = this.xForward;

        this.session.envelope = {};
        this.session.envelope.mailFrom = null;
        this.session.envelope.rcptTo = new Map();

        if (this.session.dataStream) {
            this.session.dataStream.unpipe();
            this.session.dataStream = null;
        }

        this.session.transaction = ++this._transactions;
    }

    _updateState(updates) {
        Object.keys(updates).forEach((k) => {
            if (this[k] instanceof Map && updates[k] instanceof Map) {
                updates[k].forEach((value, key) => this[k].set(key, value));
            } else {
                this[k] = updates[k];
            }
        });
    }

    _upgradeConn() {
        this._upgrading = true;
        this._socket.unpipe(this._parser);

        this._manager.upgrade(this._socket, (err, tlsSocket) => {
            if (err) {
                logger.error({
                    sid: this.session.id,
                    command: consts.Commands.STARTTLS,
                    message: err.message,
                });
                this.close();
                return;
            }

            this._upgrading = false;
            this._socket = tlsSocket;
            this._socket.setTimeout(this._settings.socketTimeout, () => this._onTimeout());

            this.session.secure = this.secure = true;
            this.session.tlsOptions = this.tlsOptions = this._socket.getCipher();

            logger.debug({
                sid: this.session.id,
                command: consts.Commands.STARTTLS,
                message: 'connection upgraded',
            });

            this._socket.pipe(this._parser);
        });
    }

    _onCommand(command, callback) {
        const commandArgs = command.toString().split(' ');
        const commandName = commandArgs.shift().toUpperCase();

        logger.debug({
            sid: this.session.id,
            command: commandName,
            message: 'message received',
        });

        if (this._upgrading) {
            setImmediate(callback);
            return;
        }

        if (!this._ready) {
            this.send(421, this._settings.name + ' Wait to be ready');
            return;
        }

        const context = {
            command,
            commandName,
            commandArgs,
            session: this.session,
            send: (c, m) => this.send(c, m),
            close: () => this.close(),
        };

        // the main strategy is to exit quickly in case of error or parser callback
        // otherwise return promise
        const next = (err) => {
            if (end) {
                return;
            }
            if (err) {
                end = true;
                setImmediate(() => callback(err));
                logger.error({
                    err,
                    sid: context.session.id,
                    command: context.commandName,
                    message: err.message,
                });
                return;
            }
            if (!mwi) {
                end = true;
                setImmediate(() => callback());
                return;
            }

            // next call should not fail middleware
            let maybePromise;
            try {
                // todo: expand mw selection logic
                maybePromise = this._middleware[--mwi](context, next);
            } catch (err) {
                end = true;
                setImmediate(() => callback(err));
                logger.error({
                    err,
                    sid: context.session.id,
                    command: context.commandName,
                    message: err.message,
                });
                return;
            }
            if (maybePromise && maybePromise.catch) {
                maybePromise.catch((err) => {
                    if (end) {
                        return;
                    }
                    end = true;
                    setImmediate(() => callback(err));
                    logger.error({
                        err,
                        sid: context.session.id,
                        command: context.commandName,
                        message: err.message,
                    });
                });
            }

            return maybePromise;
        };

        // ensure error or parser callback are called once
        let end = false;
        let mwi = this._middleware.length;

        next();
    }

    _smtpMiddleware(ctx, next) {
        let handler;
        for (const protocol of this._pipeline) {
            if ((handler = protocol.getHandler(ctx.commandName))) {
                break;
            }
        }

        if (!handler) {
            const err = new Error('Error: command not recognized');
            ctx.send(500, err.message);
            next(err);
            return;
        }

        return new Promise((resolve, reject) => {
            const nextRunner = (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                const maybePromise = next();

                // error or parser callback do not return promise
                if (maybePromise && maybePromise.then) {
                    maybePromise.then(resolve);
                } else {
                    resolve();
                }
            };

            handler(ctx.command, nextRunner);
        });
    }
}

module.exports.SmtpConnection = SmtpConnection;
