'use strict';

const { expect } = require('chai');
const SMTPClient = require('nodemailer/lib/smtp-connection');

const test = require('./');
const SmtpServer = require('../lib/server').SmtpServer;

describe('Mail', function () {
    this.timeout(10 * 1000);

    let cert;
    let server;
    let connection;

    this.beforeAll(function () {
        cert = test.genCert();
    });

    beforeEach(function (done) {
        server = new SmtpServer({
            authMethods: ['PLAIN', 'LOGIN', 'XOAUTH2'],
            key: cert.serviceKey,
            cert: cert.certificate,
            size: 1024,
        });

        server.onAuth = function (session, callback) {
            if (session.auth.username === 'testuser' && session.auth.password === 'testpassword') {
                callback(null, { user: 'user' });
            } else {
                callback(null, { message: 'Authentication failed' });
            }
        };

        server.onMailFrom = function (session, callback) {
            if (session.envelope.mailFrom.address.startsWith('reject')) {
                callback(new Error('Not accepted'));
                return;
            }
            callback();
        };

        server.onRcptTo = function (session, callback) {
            if (session.envelope.lastTo.address.startsWith('reject')) {
                callback(new Error('Not accepted'));
                return;
            }
            callback();
        };

        server.onData = function (session, callback) {
            const buffers = [];

            session.envelope.dataStream.on('data', (chunk) => {
                buffers.push(chunk);
            });

            session.envelope.dataStream.on('end', () => {
                const message = Buffer.concat(buffers).toString();

                if (message.startsWith('reject')) {
                    callback(new Error('Not accepted'));
                    return;
                }

                if (session.envelope.dataStream.bytesExceeded) {
                    const err = new Error('Maximum size exceeded');
                    err.code = 552;
                    callback(err);
                    return;
                }

                callback(null, 'Message accepted');
            });
        };

        server.start(test.PORT, test.HOST, function () {
            connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.connect(function () {
                connection.login(
                    {
                        user: 'testuser',
                        pass: 'testpassword',
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        done();
                    }
                );
            });
        });
    });

    afterEach(function (done) {
        connection.on('end', function () {
            server.stop(done);
        });
        connection.close();
    });

    it('should successfully send email', function (done) {
        connection.send(
            {
                from: 'sender@example.com',
                to: ['recipient@exmaple.com'],
            },
            'testmessage',
            function (err, status) {
                expect(err).to.not.exist;
                expect(status.accepted.length).to.equal(1);
                expect(status.rejected.length).to.equal(0);
                done();
            }
        );
    });

    it('should reject second recipient', function (done) {
        connection.send(
            {
                from: 'sender@example.com',
                to: ['recipient@exmaple.com', 'reject-recipient@example.com'],
            },
            'testmessage',
            function (err, status) {
                expect(err).to.not.exist;
                expect(status.accepted.length).to.equal(1);
                expect(status.rejected.length).to.equal(1);
                done();
            }
        );
    });

    it('should reject sender', function (done) {
        connection.send(
            {
                from: 'reject-sender@example.com',
                to: ['recipient@exmaple.com'],
            },
            'testmessage',
            function (err) {
                expect(err).to.exist;
                done();
            }
        );
    });

    it('should reject recipients', function (done) {
        connection.send(
            {
                from: 'sender@example.com',
                to: ['reject-recipient@exmaple.com'],
            },
            'testmessage',
            function (err) {
                expect(err).to.exist;
                done();
            }
        );
    });

    it('should reject message', function (done) {
        connection.send(
            {
                from: 'sender@example.com',
                to: ['recipient@exmaple.com'],
            },
            'reject-testmessage',
            function (err) {
                expect(err).to.exist;
                done();
            }
        );
    });

    it('should reject oversized message', function (done) {
        connection.send(
            {
                from: 'sender@example.com',
                to: ['recipient@exmaple.com'],
            },
            new Array(1000).join('testmessage'),
            function (err) {
                expect(err).to.exist;
                done();
            }
        );
    });

    it('should send multiple messages', function (done) {
        connection.send(
            {
                from: 'sender@example.com',
                to: ['recipient@exmaple.com'],
            },
            'testmessage1',
            function (err, status) {
                expect(err).to.not.exist;
                expect(status.accepted.length).to.equal(1);
                expect(status.rejected.length).to.equal(0);

                connection.send(
                    {
                        from: 'sender@example.com',
                        to: ['recipient@exmaple.com'],
                    },
                    'testmessage2',
                    function (err, status) {
                        expect(err).to.not.exist;
                        expect(status.accepted.length).to.equal(1);
                        expect(status.rejected.length).to.equal(0);

                        connection.send(
                            {
                                from: 'sender@example.com',
                                to: ['recipient@exmaple.com'],
                            },
                            'reject-testmessage',
                            function (err) {
                                expect(err).to.exist;

                                connection.send(
                                    {
                                        from: 'sender@example.com',
                                        to: ['recipient@exmaple.com'],
                                    },
                                    'testmessage3',
                                    function (err, status) {
                                        expect(err).to.not.exist;
                                        expect(status.accepted.length).to.equal(1);
                                        expect(status.rejected.length).to.equal(0);
                                        done();
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});
