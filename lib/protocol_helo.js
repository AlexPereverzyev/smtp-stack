'use strict';

const consts = require('./consts');
const Protocol = require('./protocol');

const Commands = {
    HELO: 'Helo',
    EHLO: 'Ehlo',
    LHLO: 'Lhlo',
    QUIT: 'Quit',
    NOOP: 'Noop',
    RSET: 'Rset',
    HELP: 'Help',
    VRFY: 'Vrfy',
    STARTTLS: 'StartTls',
};

const GreetingsCommands = new Set([
    Commands.HELO.toUpperCase(),
    Commands.EHLO.toUpperCase(),
    Commands.LHLO.toUpperCase(),
]);

/**
 * https://tools.ietf.org/html/rfc5321
 */
class Handshake extends Protocol {
    getHandler(command) {
        if (GreetingsCommands.has(command)) {
            this.emit('state', { clientGreeting: command });

            if (this._settings.lmtp) {
                switch (command) {
                    case consts.Commands.HELO:
                    case consts.Commands.EHLO:
                        return (cmd, callback) => {
                            this.emit('send', 500, 'Error: ' + cmd + ' not allowed in LMTP server');
                            setImmediate(callback);
                        };
                    case consts.Commands.LHLO:
                        command = consts.Commands.EHLO;
                        break;
                }
            }
        }

        return super.getHandler(command, Commands);
    }

    handleEhlo(command, callback) {
        const parts = command.toString().trim().split(/\s+/);

        if (parts.length !== 2) {
            this.emit(
                'send',
                501,
                'Error: ' + (this._settings.lmtp ? 'LHLO' : 'EHLO') + ' hostname missing'
            );
            callback();
            return;
        }

        // respond with server features
        const features = ['PIPELINING', '8BITMIME', 'SMTPUTF8'];

        if (
            this._settings.authMethodsSet.size &&
            !this.isDisabled(consts.Commands.AUTH) &&
            !this._session.user
        ) {
            features.push(
                [consts.Commands.AUTH].concat(Array.from(this._settings.authMethodsSet)).join(' ')
            );
        }

        if (!this._session.secure && !this.isDisabled(consts.Commands.STARTTLS)) {
            features.push(consts.Commands.STARTTLS);
        }

        if (this._settings.size) {
            features.push('SIZE' + this._settings.size);
        }

        // XCLIENT ADDR can be used only once
        if (
            this._settings.useXClient &&
            !this._session.xClient.has('ADDR') &&
            !this.isDisabled(consts.Commands.XCLIENT)
        ) {
            features.push('XCLIENT NAME ADDR PORT PROTO HELO LOGIN');
        }

        // XCLIENT ADDR used once disables XFORWARD
        if (
            this._settings.useXForward &&
            !this._session.xClient.has('ADDR') &&
            !this.isDisabled(consts.Commands.XFORWARD)
        ) {
            features.push('XFORWARD NAME ADDR PORT PROTO HELO IDENT SOURCE');
        }

        this.emit('state', { advertisedClientHostname: parts[1].toLowerCase() });
        this.emit('reset');
        this.emit(
            'send',
            250,
            [this._settings.name + ' Welcome, ' + this._session.resolvedClientHostname].concat(
                features
            )
        );

        callback();
    }

    handleHelo(command, callback) {
        const parts = command.toString().trim().split(/\s+/);

        if (parts.length !== 2) {
            this.emit('send', 501, 'Error: Syntax: HELO hostname');
            callback();
            return;
        }

        this.emit('state', { advertisedClientHostname: parts[1].toLowerCase() });
        this.emit('reset');
        this.emit(
            'send',
            250,
            this._Settings.name + ' Welcome, ' + this._session.resolvedClientHostname
        );

        callback();
    }

    handleQuit(command, callback) {
        this.emit('send', 221, 'Goodbye');
        this.emit('close');

        callback();
    }

    handleNoop(command, callback) {
        this.emit('send', 250, 'OK');

        callback();
    }

    handleRset(command, callback) {
        this.emit('reset');
        this.emit('send', 250, 'Reset');

        callback();
    }

    handleHelp(command, callback) {
        this.emit('send', 214, 'See https://tools.ietf.org/html/rfc5321 for details');

        callback();
    }

    handleStartTls(command, callback) {
        if (this._session.secure) {
            this.emit('send', 503, 'Error: TLS already active');
            callback();
            return;
        }

        setImmediate(callback);

        this.emit('send', 220, 'Ready to start TLS');
        this.emit('upgrade');
    }
}

module.exports.Commands = Commands;
module.exports.Handshake = Handshake;
