'use strict';

const { expect } = require('chai');
const XOAuth2 = require('nodemailer/lib/xoauth2');
const SMTPClient = require('nodemailer/lib/smtp-connection');

const test = require('./');
const SmtpServer = require('../lib/server').SmtpServer;

describe('Authentication', function () {
    this.timeout(10 * 1000);

    let cert;
    let server;

    this.beforeAll(function () {
        cert = test.genCert();
    });

    beforeEach(function (done) {
        server = new SmtpServer({
            authMethods: ['PLAIN', 'LOGIN', 'XOAUTH2', 'CRAM-MD5'],
            allowInsecureAuth: true,
            key: cert.serviceKey,
            cert: cert.certificate,
            onAuth(auth, session, callback) {
                expect(session.tlsOptions).to.exist;

                if (auth.method === 'XOAUTH2') {
                    if (auth.username === 'testuser' && auth.accessToken === 'testtoken') {
                        callback(null, {
                            user: 'user',
                        });
                    } else {
                        callback(null, {
                            data: {
                                status: '401',
                                schemes: 'bearer mac',
                                scope: 'https://www.example.com',
                            },
                        });
                    }
                    return;
                }

                if (
                    auth.username === 'testuser' &&
                    (auth.method === 'CRAM-MD5'
                        ? auth.validate('testpassword')
                        : auth.password === 'testpassword')
                ) {
                    callback(null, {
                        user: 'user',
                    });
                    return;
                }

                callback(null, {
                    message: 'Authentication failed',
                });
            },
        });

        server.start(test.PORT, test.HOST, done);
    });

    afterEach(function (done) {
        server.stop(done);
    });

    describe('PLAIN', function () {
        it('should authenticate', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        method: 'PLAIN',
                        user: 'testuser',
                        pass: 'testpassword',
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        connection.quit();
                    }
                );
            });
        });

        it('should not authenticate', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        user: 'testuser',
                        pass: 'invalid',
                        method: 'PLAIN',
                    },
                    function (err) {
                        expect(err).to.exist;
                        connection.quit();
                    }
                );
            });
        });
    });

    describe('LOGIN', function () {
        it('should authenticate', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        method: 'LOGIN',
                        user: 'testuser',
                        pass: 'testpassword',
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        connection.quit();
                    }
                );
            });
        });

        it('should authenticate without TLS', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                ignoreTLS: true,
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        method: 'LOGIN',
                        user: 'testuser',
                        pass: 'testpassword',
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        connection.quit();
                    }
                );
            });
        });

        it('should not authenticate', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        method: 'LOGIN',
                        user: 'testuser',
                        pass: 'invalid',
                    },
                    function (err) {
                        expect(err).to.exist;
                        connection.quit();
                    }
                );
            });
        });
    });

    describe('XOAUTH2', function () {
        it('should authenticate', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        method: 'XOAUTH2',
                        oauth2: new XOAuth2(
                            {
                                user: 'testuser',
                                accessToken: 'testtoken',
                            },
                            false
                        ),
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        connection.quit();
                    }
                );
            });
        });

        it('should not authenticate', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        method: 'XOAUTH2',
                        oauth2: new XOAuth2(
                            {
                                user: 'testuser',
                                accessToken: 'expired',
                            },
                            false
                        ),
                    },
                    function (err) {
                        expect(err).to.exist;
                        connection.quit();
                    }
                );
            });
        });
    });

    describe('CRAM-MD5', function () {
        it('should authenticate', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        method: 'CRAM-MD5',
                        user: 'testuser',
                        pass: 'testpassword',
                    },
                    function (err) {
                        expect(err).to.not.exist;
                        connection.quit();
                    }
                );
            });
        });

        it('should not authenticate', function (done) {
            const connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                tls: {
                    rejectUnauthorized: false,
                },
            });

            connection.on('end', done);

            connection.connect(function () {
                connection.login(
                    {
                        method: 'CRAM-MD5',
                        user: 'testuser',
                        pass: 'invalid',
                    },
                    function (err) {
                        expect(err).to.exist;
                        connection.quit();
                    }
                );
            });
        });
    });
});
