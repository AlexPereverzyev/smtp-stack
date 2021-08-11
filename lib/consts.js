'use strict';

const crypto = require('crypto');

module.exports.ServerCloseTimeout = 10 * 1000; // msec
module.exports.SocketIdleTimeout = 30 * 1000; // msec
module.exports.ReverseDnsTimeout = 1.5 * 1000; // msec

module.exports.DefaultTlsOptions = {
    honorCipherOrder: true,
    requestOCSP: false,
    sessionIdContext: crypto
        .createHash('sha1')
        .update(process.argv.join(' '))
        .digest('hex')
        .slice(0, 32),
    minVersion: 'TLSv1',
};

// https://stackoverflow.com/questions/46155/how-to-validate-an-email-address-in-javascript
module.exports.EmailPattern =
    // eslint-disable-next-line max-len
    /^<(([^<>()[\].,;:\s@"]+(\.[^<>()[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+\.)+[^<>()[\].,;:\s@"]{2,})>$/i;

module.exports.Commands = {
    HELO: 'HELO',
    EHLO: 'EHLO',
    LHLO: 'LHLO',
    QUIT: 'QUIT',
    NOOP: 'NOOP',
    RSET: 'RSET',
    HELP: 'HELP',
    VRFY: 'VRFY',
    AUTH: 'AUTH',
    MAIL: 'MAIL',
    RCPT: 'RCPT',
    DATA: 'DATA',
    STARTTLS: 'STARTTLS',
    XCLIENT: 'XCLIENT',
    XFORWARD: 'XFORWARD',
};
