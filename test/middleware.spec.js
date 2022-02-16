'use strict';

const { expect } = require('chai');
const { stub } = require('sinon');
const SMTPClient = require('nodemailer/lib/smtp-connection');

const test = require('./');
const SmtpServer = require('../lib/server').SmtpServer;
const { LogLevels } = require('../lib/logger');

describe('Middleware', function () {
    this.timeout(10 * 1000);

    let server;
    let connection;
    let callBefore;
    let callAfter;

    beforeEach(function (done) {
        server = new SmtpServer({
            allowInsecureAuth: true,
            logLevel: LogLevels.none,
        });

        server.use(async (ctx, next) => {
            callBefore();

            await next();

            callAfter();
        });

        server.start(test.PORT, test.HOST, function () {
            connection = new SMTPClient({
                port: test.PORT,
                host: test.HOST,
                ignoreTLS: true,
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

        callBefore = stub();
        callAfter = stub();
    });

    afterEach(function (done) {
        connection.on('end', function () {
            server.stop(done);
        });
        connection.close();
    });

    it('should invoke middleware', function (done) {
        connection.send(
            {
                from: 'sender@example.com',
                to: ['recipient@exmaple.com'],
            },
            'testmessage',
            function (err, status) {
                expect(err).to.not.exist;
                expect(callBefore.calledBefore(callAfter)).is.true;
                expect(callBefore.callCount).is.equal(callAfter.callCount);
                done();
            }
        );
    });
});
