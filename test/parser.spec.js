'use strict';

const { expect } = require('chai');

const SmtpStream = require('../lib/parser').SmtpStream;

describe('Parser', function () {
    it('should parse commands', function (done) {
        const parser = new SmtpStream();
        const expected = ['CMD1', 'CMD2', 'CMD3'];

        parser.on('command', function (command, callback) {
            expect(command.toString()).to.equal(expected.shift());

            if (callback) {
                callback();
            } else {
                done();
            }
        });

        parser.end('CMD1\r\nCMD2\r\nCMD3');
    });

    it('should parse mail body', function (done) {
        const parser = new SmtpStream();
        const expected = ['DATA', 'QUIT'];

        parser.on('command', function (command, callback) {
            command = command.toString();
            expect(command).to.equal(expected.shift());

            if (command === 'DATA') {
                let output = '';

                const stream = parser.startData();

                stream.on('data', function (chunk) {
                    output += chunk.toString();
                });

                stream.on('end', function () {
                    expect(output).to.equal('TXT1\r\n.TXT2\r\n.TXT3\r\n');
                });
            }

            if (callback) {
                callback();
            } else {
                done();
            }
        });

        parser.end('DATA\r\nTXT1\r\n..TXT2\r\n.TXT3\r\n.\r\nQUIT');
    });

    it('should parse email address', function () {
        const parser = new SmtpStream();

        expect(parser.parseAddress('MAIL FROM', 'MAIL FROM:<sender@example.com>')).to.deep.equal({
            address: 'sender@example.com',
            args: false,
        });

        expect(
            parser.parseAddress('MAIL FROM', 'MAIL FROM:<sender@example.com> SIZE=1024 ')
        ).to.deep.equal({
            address: 'sender@example.com',
            args: {
                SIZE: '1024',
            },
        });

        expect(
            parser.parseAddress('RCPT TO', 'RCPT TO:<recipient@example.com> MSG=hello+20world')
        ).to.deep.equal({
            address: 'recipient@example.com',
            args: {
                MSG: 'hello world',
            },
        });

        expect(parser.parseAddress('MAIL', 'MAIL FROM:<sender@example.com>')).to.be.false;
    });
});
