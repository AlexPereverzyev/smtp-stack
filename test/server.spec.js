'use strict';

const net = require('net');
const { expect } = require('chai');
const SMTPClient = require('nodemailer/lib/smtp-connection');

const test = require('./');
const SmtpServer = require('../lib/server').SmtpServer;
const { LogLevels } = require('../lib/logger');

describe('Server', function () {
    this.timeout(10 * 1000);

    let cert;

    this.beforeAll(function () {
        cert = test.genCert();
    });

    describe('Unsecure', function () {
        let server;

        beforeEach(function (done) {
            server = new SmtpServer({
                socketTimeout: 500,
                closeTimeout: 100,
                key: cert.serviceKey,
                cert: cert.certificate,
                logLevel: LogLevels.none,
            });
            server.start(test.PORT, test.HOST, done);
        });

        afterEach(function (done) {
            server.stop(done);
        });

        it('should connect without TLS', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                ignoreTLS: true,
            });

            connection.on('end', done);

            connection.connect(function () {
                expect(connection.secure).to.be.false;
                connection.quit();
            });
        });

        it('should connect and start TLS', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                expect(connection.secure).to.be.true;
                connection.quit();
            });
        });

        it('should close idle connection', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                ignoreTLS: true,
            });

            connection.on('error', function (err) {
                expect(err).to.exist;
            });

            connection.on('end', done);

            connection.connect(function () {
                // timeout
            });
        });

        it('should close idle TLS connection', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('error', function (err) {
                expect(err).to.exist;
            });

            connection.on('end', done);

            connection.connect(function () {
                // timeout
            });
        });

        it('should close not ready connection when command received', function (done) {
            const connection = net.connect(test.PORT, test.HOST, function () {
                const buffers = [];

                connection.on('data', function (chunk) {
                    buffers.push(chunk);
                });

                connection.on('end', function () {
                    const data = Buffer.concat(buffers).toString();
                    expect(data.startsWith('421')).to.be.true;
                    done();
                });

                connection.write('EHLO test\r\n');
            });
        });

        it('should accept multiple connections', function (done) {
            const limit = 5;
            const connections = [];
            let disconnected = 0;

            const openConnection = () => {
                const connection = new SMTPClient({
                    port: test.PORT,
                    host: test.HOST,
                    tls: {
                        rejectUnauthorized: false,
                    },
                });

                connection.on('error', function (err) {
                    expect(err).to.not.exist;
                    connection.close();
                });

                connection.on('end', function () {
                    if (++disconnected >= limit) {
                        done();
                    }
                });

                connection.connect(function () {
                    connections.push(connection);

                    if (connections.length >= limit) {
                        connections.forEach((c) => c.close());
                    }
                });
            };

            for (let i = 0; i < limit; i++) {
                openConnection();
            }
        });

        it('should close all connections when server stops', function (done) {
            const limit = 10;
            const connections = [];
            let disconnected = 0;

            const openConnection = function (callback) {
                const connection = new SMTPClient({
                    port: test.PORT,
                    host: test.HOST,
                    tls: {
                        rejectUnauthorized: false,
                    },
                });

                connection.on('error', function (err) {
                    expect(err.responseCode).to.equal(421);
                });

                connection.on('end', function () {
                    if (++disconnected >= limit) {
                        // done();
                    }
                });

                connection.connect(function () {
                    connections.push(connection);

                    if (connections.length >= limit) {
                        server.stop();
                        done();
                    }
                });
            };

            for (let i = 0; i < limit; i++) {
                openConnection();
            }
        });
    });

    describe('Secure', function () {
        let server;

        beforeEach(function (done) {
            server = new SmtpServer({
                secure: true,
                key: cert.serviceKey,
                cert: cert.certificate,
                logLevel: LogLevels.none,
            });
            server.start(test.PORT, test.HOST, done);
        });

        afterEach(function (done) {
            server.stop(done);
        });

        it('should connect with TLS', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                secure: true,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                expect(connection.secure).to.be.true;
                connection.quit();
            });
        });
    });

    describe('Disabled', function () {
        let server;

        beforeEach(function (done) {
            server = new SmtpServer({
                disabledCommands: ['STARTTLS'],
                socketTimeout: 1000,
                key: cert.serviceKey,
                cert: cert.certificate,
                logLevel: LogLevels.none,
            });
            server.start(test.PORT, test.HOST, done);
        });

        afterEach(function (done) {
            server.stop(done);
        });

        it('should fail to start TLS', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                requireTLS: true,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            let error;

            connection.on('error', function (err) {
                error = err;
            });

            connection.on('end', function () {
                expect(error).to.exist;
                done();
            });

            connection.connect(function () {
                expect(false).to.be.true;
                connection.quit();
            });
        });
    });
});
