'use strict';

const os = require('os');
const net = require('net');
const tls = require('tls');
const EventEmitter = require('events');

const consts = require('./consts');
const utils = require('./utils');
const proxy = require('./proxy');
const { current: logger } = require('./logger');
const { ConnectionManager } = require('./manager');
const SmtpConnection = require('./connection').SmtpConnection;

class SmtpServer extends EventEmitter {
    constructor(options) {
        super();

        this.options = Object.assign({}, options);
        this.options.name = this.options.name || os.hostname();
        this.options.closeTimeout = this.options.closeTimeout || consts.ServerCloseTimeout;
        this.options.socketTimeout = this.options.socketTimeout || consts.SocketIdleTimeout;
        this.options.upgradeTimeout = this.options.upgradeTimeout || consts.UpgradeTimeout;

        logger.setup(this.options.logLevel, this.options.logBackend);

        this._manager = new ConnectionManager(this);
        this._connections = new Set();
        this._middleware = [];

        const tlsOptions = Object.assign({}, consts.DefaultTlsOptions, this.options);
        const sniOptions = this.options.sniOptions || {};

        this.secureContext = new Map();
        this.secureContext.set('*', tls.createSecureContext(tlsOptions));

        Object.keys(sniOptions).forEach((servername) => {
            this.secureContext.set(
                this._manager.normalizeHostname(servername),
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

    use(middleware) {
        if (typeof middleware !== 'function') {
            throw new TypeError('Invalid middleware');
        }

        this._middleware.splice(1, 0, middleware);
    }

    start(...args) {
        if (this._server) {
            throw new Error('Server is started');
        }

        const socketEmitter = (socket) => {
            const socketOptions = { id: utils.sid() };

            logger.debug({
                sid: socketOptions.id,
                command: 'connected',
                address: socket.remoteAddress,
            });

            this.onSocket(socket, (err) => {
                if (err) {
                    this._manager.destroy(socket);
                    return;
                }

                socketProxier(socket, socketOptions);
            });
        };

        const socketProxier = (socket, socketOptions) => {
            logger.debug({
                sid: socketOptions.id,
                command: 'proxying',
            });

            this._acceptProxy(socket, socketOptions, (err) => {
                if (err) {
                    logger.warn({
                        err,
                        sid: socketOptions.id,
                        command: 'PROXY',
                        message: err.message,
                    });

                    this._manager.destroy(socket);
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
                    connection.send(consts.StatusCodes.ServiceUnavailable, 'Server stopping...')
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

        logger.debug({
            sid: socketOptions.id,
            command: 'upgrading',
        });

        this._manager.upgrade(socket, (err, tlsSocket) => {
            if (err) {
                logger.warn({
                    err,
                    sid: socketOptions.id,
                    command: 'upgrade',
                    message: err.message,
                });

                this._manager.destroy(socket);
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
        logger.debug({
            sid: socketOptions.id,
            command: 'opened',
        });

        const connection = new SmtpConnection(this._manager, this.options, socket, socketOptions);
        this._connections.add(connection);

        connection.on('error', (err) => this._onConnError(err, connection));
        connection.on('init', (session, callback) => this.onConnect(session, callback));
        connection.on('auth', (session, callback) => this.onAuth(session, callback));
        connection.on('mail', (session, callback) => this.onMailFrom(session, callback));
        connection.on('rcpt', (session, callback) => this.onRcptTo(session, callback));
        connection.on('data', (session, callback) => this.onData(session, callback));
        connection.on('close', (connection) => this._onConnClose(connection));

        connection.use(...this._middleware);
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

    onAuth(session, callback) {
        setImmediate(() => callback(null, { user: 'anonymous' }));
    }

    onMailFrom(session, callback) {
        setImmediate(callback);
    }

    onRcptTo(session, callback) {
        setImmediate(callback);
    }

    onData(session, callback) {
        // ensure the stream is consumed and mail - accepted
        session.envelope.dataStream.on('data', function () {});

        setImmediate(callback);
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
