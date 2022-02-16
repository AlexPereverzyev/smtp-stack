'use strict';

const tls = require('tls');
const dns = require('dns');

const punycode = require('../node_modules/punycode');

const consts = require('./consts');
const { current: logger } = require('./logger');

const AdditionalTlsOptions = [
    'session',
    'requestCert',
    'rejectUnauthorized',
    'NPNProtocols',
    'requestOCSP',
];

class ConnectionManager {
    constructor(server) {
        this._server = server;
    }

    upgrade(socket, callback) {
        const tlsSocketOptions = {
            isServer: true,
            server: this._server,
            secureContext: this._server.secureContext.get('*'),

            SNICallback: (servername, cb) => {
                this._server.options.SNICallback(normalizeHostname(servername), (err, context) => {
                    if (err) {
                        logger.error({
                            err,
                            command: 'SNI',
                            message: err.message,
                            servername,
                        });
                    }
                    cb(null, context || this._server.secureContext.get('*'));
                });
            },
        };

        AdditionalTlsOptions.forEach((key) => {
            if (key in this._server.options) {
                tlsSocketOptions[key] = this._server.options[key];
            }
        });

        let isFailed = false;
        const onError = (err) => {
            if (isFailed) {
                return;
            }
            isFailed = true;

            callback(err || new Error('Unexpected error'));
        };

        socket.removeAllListeners();
        socket.once('error', onError);

        const tlsSocket = new tls.TLSSocket(socket, tlsSocketOptions)
            .once('close', onError)
            .once('error', onError)
            .once('clientError', onError)
            .once('tlsClientError', onError)
            .on('secure', () => {
                socket.removeListener('error', onError);

                tlsSocket
                    .removeListener('close', onError)
                    .removeListener('error', onError)
                    .removeListener('clientError', onError)
                    .removeListener('tlsClientError', onError);

                if (isFailed) {
                    tlsSocket.end(() => tlsSocket.destroy());
                    return;
                }

                callback(null, tlsSocket);
            });
    }

    reverseDns(address, callback) {
        if (this._server.options.disableReverseLookup) {
            callback(null, false);
            return;
        }

        let resolved = false;
        const reverseTimer = setTimeout(() => {
            clearTimeout(reverseTimer);
            if (resolved) {
                return;
            }
            resolved = true;

            callback(new Error('DNS lookup timed out'));
        }, consts.ReverseDnsTimeout);

        try {
            dns.reverse(address, (err, hostnames) => {
                clearTimeout(reverseTimer);
                if (resolved) {
                    return;
                }
                resolved = true;

                callback(err, hostnames);
            });
        } catch (err) {
            clearTimeout(reverseTimer);
            if (resolved) {
                return;
            }
            resolved = true;

            callback(err);
        }
    }
}

function normalizeHostname(hostname) {
    hostname = (hostname || '').toString().trim();
    try {
        hostname = punycode.toUnicode(hostname).toLowerCase();
    } catch (err) {
        logger.error({
            err,
            command: 'punycode domain',
            message: err.message,
        });
    }

    return hostname;
}

module.exports.ConnectionManager = ConnectionManager;
module.exports.normalizeHostname = normalizeHostname;
