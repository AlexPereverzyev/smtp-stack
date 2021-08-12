'use strict';

const os = require('os');
const net = require('net');
const tls = require('tls');
const EventEmitter = require('events');

const consts = require('./consts');
const utils = require('./utils');
const proxy = require('./proxy');
const { ConnectionManager } = require('./manager');
const { current: logger } = require('./logger');
const SmtpConnection = require('./connection').SmtpConnection;

class SmtpServer extends EventEmitter {
    constructor(options) {
        super();

        this._manager = new ConnectionManager(this);
        this._connections = new Set();

        this.options = Object.assign({}, options);
        this.options.name = this.options.name || os.hostname();
        this.options.closeTimeout = this.options.closeTimeout || consts.ServerCloseTimeout;
        this.options.socketTimeout = this.options.socketTimeout || consts.SocketIdleTimeout;

        const tlsOptions = Object.assign({}, consts.DefaultTlsOptions, this.options);
        const sniOptions = this.options.sniOptions || {};

        this.secureContext = new Map();
        this.secureContext.set('*', tls.createSecureContext(tlsOptions));

        Object.keys(sniOptions).forEach((servername) => {
            this.secureContext.set(
                utils.normalizeHostname(servername),
                tls.createSecureContext(
                    Object.assign({}, consts.DefaultTlsOptions, sniOptions[servername])
                )
            );
        });

        if (this.options.secure) {
            Object.keys(tlsOptions).forEach((key) => {
                if (!(key in this.options)) {
                    this.options[key] = tlsOptions[key];
                }
            });

            if (typeof this.options.SNICallback !== 'function') {
                this.options.SNICallback = (servername, callback) => {
                    callback(null, this.secureContext.get(servername));
                };
            }
        }

        // setup disabled commands
        this.options.disabledCommandsSet = new Set(
            (this.options.disabledCommands || [])
                .map((c) => (c || '').toString().trim().toUpperCase())
                .filter((c) => !!c)
        );

        // setup authentication methods
        this.options.authMethodsSet = new Set(
            (this.options.authMethods || [])
                .map((m) => (m || '').toString().trim().toUpperCase())
                .filter((m) => !!m)
                .concat(['LOGIN', 'PLAIN'])
        );

        // setup event hooks
        EventHooks.filter((h) => typeof this.options[h] === 'function').forEach(
            (h) => (this[h] = this.options[h])
        );
    }

    start(...args) {
        if (this._server) {
            throw new Error('Server is started');
        }

        const socketEmitter = (socket) => {
            this.onSocket(socket, (err) => {
                if (err) {
                    socket.end(err.message, () => socket.destroy());
                    return;
                }

                socketProxier(socket);
            });
        };

        const socketProxier = (socket) => {
            const socketOptions = { id: utils.sid() };
            this._acceptProxy(socket, socketOptions, (err) => {
                if (err) {
                    logger.warn({
                        err,
                        sid: socketOptions.id,
                        command: 'PROXY',
                        message: err.message,
                    });

                    socket.end(err.message, () => socket.destroy());
                    return;
                }

                socketHandler(socket, socketOptions);
            });
        };

        const socketHandler = this.options.secure
            ? (socket, options) => this._secureHandler(socket, options)
            : (socket, options) => this._unsecureHandler(socket, options);

        this._server = net
            .createServer(this.options, socketEmitter)
            .on('error', (err) => this._onServerError(err))
            .once('close', () => this._onServerClose())
            .once('listening', () => this._onServerListening());

        return this._server.listen(...args);
    }

    stop(callback) {
        if (!this._server) {
            return;
        }

        logger.info({
            command: 'server stop',
            connections: this._connections.size,
        });

        this._server.close(() => {
            clearTimeout(closeTimeout);

            if (this._server) {
                this._server.removeAllListeners();
                this._server = null;
            }

            if (typeof callback === 'function') {
                callback();
            }
        });

        const closeTimeout = setTimeout(() => {
            const connections = this._connections.size;

            logger.info({
                command: 'server stop timeout',
                connections,
            });

            if (connections) {
                this._connections.forEach((connection) =>
                    connection.send(421, 'Server stopping...')
                );
            }

            if (this._server) {
                this._server.removeAllListeners();
                this._server = null;
            }

            if (typeof callback === 'function') {
                callback();
            }
        }, this.options.closeTimeout);
    }

    _unsecureHandler(socket, socketOptions) {
        this._onConnOpen(socket, socketOptions);
    }

    _secureHandler(socket, socketOptions) {
        if (this.options.secured) {
            this._onConnOpen(socket, socketOptions);
            return;
        }

        this._manager.upgrade(socket, (err, tlsSocket) => {
            if (err) {
                logger.warn({
                    err,
                    sid: socketOptions.id,
                    command: 'upgrade',
                    message: err.message,
                });

                socket.end(() => socket.destroy());
                return;
            }

            this._onConnOpen(tlsSocket, socketOptions);
        });
    }

    _acceptProxy(socket, socketOptions, callback) {
        if (
            !this.options.useProxy ||
            (Array.isArray(this.options.useProxy) &&
                !this.options.useProxy.includes(socket.remoteAddress) &&
                !this.options.useProxy.includes('*'))
        ) {
            socketOptions.ignore =
                this.options.ignoredHosts &&
                this.options.ignoredHosts.includes(socket.remoteAddress);

            setImmediate(callback);
        } else {
            proxy.readRemoteAddress(socket, socketOptions, this.options, callback);
        }
    }

    _onServerListening() {
        const address = this._server.address() || { address: null, port: null };

        logger.info({
            command: 'listen',
            host: address.address,
            port: address.port,
            secure: this.options.secure,
            protocol: this.options.lmtp ? 'LMTP' : 'SMTP',
        });

        this.emit('listening');
    }

    _onServerClose() {
        logger.info({
            command: 'server stop',
            message: 'closed',
        });

        this.emit('close');
    }

    _onServerError(err) {
        logger.error({
            err,
            command: 'server error',
            message: err.message,
        });

        this.emit('error', err);
    }

    _onConnOpen(socket, socketOptions) {
        const connection = new SmtpConnection(this._manager, this.options, socket, socketOptions);

        this._connections.add(connection);

        connection.on('error', (err) => this._onConnError(err, connection));
        connection.on('init', (session, callback) => this.onConnect(session, callback));
        connection.on('auth', (creds, session, callback) => this.onAuth(creds, session, callback));
        connection.on('mail', (address, session, callback) =>
            this.onMailFrom(address, session, callback)
        );
        connection.on('rcpt', (address, session, callback) =>
            this.onRcptTo(address, session, callback)
        );
        connection.on('data', (stream, session, callback) =>
            this.onData(stream, session, callback)
        );
        connection.on('close', (connection) => this._onConnClose(connection));

        connection.init();
    }

    _onConnClose(connection) {
        this.onClose(connection.session, () => {
            connection.removeAllListeners();
            connection.on('error', function () {});
            this._connections.delete(connection);
        });
    }

    _onConnError(err, connection) {
        this.emit('error', err);
        connection.close();
    }

    // DEFAULT HOOKS

    onSocket(socket, callback) {
        setImmediate(callback);
    }

    onConnect(session, callback) {
        setImmediate(callback);
    }

    onAuth(auth, session, callback) {
        setImmediate(() => callback(new Error('Not implemented')));
    }

    onMailFrom(address, session, callback) {
        setImmediate(callback);
    }

    onRcptTo(address, session, callback) {
        setImmediate(callback);
    }

    onData(stream, session, callback) {
        let chunklen = 0;

        stream.on('data', (chunk) => {
            chunklen += chunk.length;
        });

        stream.on('end', () => {
            logger.info({
                sid: session.id,
                command: 'DATA',
                size: chunklen,
            });

            callback();
        });
    }

    onClose(connection, callback) {
        setImmediate(callback);
    }
}

const EventHooks = [
    'onSocket',
    'onConnect',
    'onAuth',
    'onMailFrom',
    'onRcptTo',
    'onData',
    'onClose',
];

module.exports.SmtpServer = SmtpServer;
