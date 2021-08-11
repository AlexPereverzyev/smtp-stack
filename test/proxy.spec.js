'use strict';

const net = require('net');
const { expect } = require('chai');
const pki = require('node-forge').pki;
const SMTPClient = require('nodemailer/lib/smtp-connection');

const test = require('./');
const SmtpServer = require('../lib/server').SmtpServer;

describe('Proxy', function () {
    this.timeout(10 * 1000);

    let cert;
    let server;

    this.beforeAll(function (done) {
        const keys = pki.rsa.generateKeyPair(2048);
        const crt = pki.createCertificate();
        crt.publicKey = keys.publicKey;
        crt.sign(keys.privateKey);
        cert = {
            certificate: pki.certificateToPem(crt),
            serviceKey: pki.privateKeyToPem(keys.privateKey),
        };
        done();
    });

    describe('Unsecure', function () {
        beforeEach(function (done) {
            server = new SmtpServer({
                useProxy: true,
                key: cert.serviceKey,
                cert: cert.certificate,
                onConnect(session, callback) {
                    if (session.remoteAddress === '1.2.3.4') {
                        const err = new Error('blacklisted');
                        err.code = 421;
                        callback(err);
                        return;
                    }
                    callback();
                },
            });
            server.start();
            server.listen(test.PORT, test.HOST, done);
        });

        afterEach(function (done) {
            server.stop(done);
        });

        it('should rewrite remote address', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                ignoreTLS: true,
            });

            connection.on('end', done);

            connection.connect(function () {
                let serverConn;
                server._connections.forEach((c) => (serverConn = c));

                connection.quit();

                expect(serverConn.remoteAddress).to.equal('1.1.1.1');
                expect(serverConn.remotePort).to.equal(33333);
            });

            setTimeout(() => {
                connection._socket.write('PROXY TCP4 1.1.1.1 2.2.2.2 33333 80\r\n');
            }, 50);
        });

        it('should reject connection when address is blacklisted', function (done) {
            const socket = net.connect(test.PORT, test.HOST, function () {
                const buffers = [];

                socket.on('data', function (chunk) {
                    buffers.push(chunk);
                });

                socket.on('end', function () {
                    const data = Buffer.concat(buffers).toString();
                    expect(data.startsWith('421')).is.true;
                    expect(data.indexOf('blacklisted')).to.be.gte(0);
                    done();
                });

                socket.write('PROXY TCP4 1.2.3.4 2.2.2.2 333333 80\r\n');
            });
        });
    });

    describe('Secure', function () {
        beforeEach(function (done) {
            server = new SmtpServer({
                useProxy: true,
                secure: true,
                key: cert.serviceKey,
                cert: cert.certificate,
            });
            server.start();
            server.listen(test.PORT, test.HOST, done);
        });

        afterEach(function (done) {
            server.stop(done);
        });

        it('should rewrite remote address', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                let serverConn;
                server._connections.forEach((c) => (serverConn = c));

                connection.quit();

                expect(serverConn.remoteAddress).to.equal('1.1.1.1');
                expect(serverConn.remotePort).to.equal(33333);
            });

            setTimeout(() => {
                connection._socket.write('PROXY TCP4 1.1.1.1 2.2.2.2 33333 80\r\n');
                connection._upgradeConnection((err) => {
                    expect(err).to.not.exist;
                });
            }, 50);
        });
    });
});
