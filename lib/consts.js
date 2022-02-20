'use strict';

const crypto = require('crypto');

module.exports.ServerCloseTimeout = 10 * 1000; // msec
module.exports.SocketIdleTimeout = 60 * 1000; // msec
module.exports.UpgradeTimeout = 5 * 1000; // msec
module.exports.ReverseDnsTimeout = 1.5 * 1000; // msec

module.exports.DefaultTlsOptions = {
    requestOCSP: false,
    honorCipherOrder: true,
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

module.exports.StatusCodes = {
    Status: 211,
    Help: 214,
    Ready: 220,
    Goodbye: 221,
    Authenticated: 235,
    Accepted: 250,
    ForwardUser: 251,
    AttemptAccept: 252,

    ServerChallenge: 334,
    MailData: 354,

    ServiceUnavailable: 421,
    PasswordNeeded: 432,
    MailboxUnavailable: 450,
    LocalError: 451,
    InsufficientStorage: 452,
    AuthenticationFailure: 454,
    ServiceNotSupported: 455,

    InvalidCommand: 500,
    InvalidParameters: 501,
    NotImplemented: 502,
    BadSequence: 503,
    NotImplementedParam: 504,
    NoMail: 521,
    EncryptionNeeded: 523,
    AuthenticationRequired: 530,
    AuthenticationWeak: 534,
    AuthenticationInvalid: 535,
    EncryptionRequired: 538,
    NoMailboxAccess: 550,
    TryForwardUser: 551,
    ExceededStorage: 552,
    MailboxNameInvalid: 553,
    TransactionFailed: 554,
    DomainNoMail: 556,
};
