'use strict';

const consts = require('./consts');
const Protocol = require('./protocol');
const { current: logger } = require('./logger');

const Commands = {
    MAIL: 'Mail',
    RCPT: 'Rcpt',
    DATA: 'Data',
};

const CommandsSet = new Set(Object.keys(Commands));

/**
 * https://tools.ietf.org/html/rfc5321
 */
class Mail extends Protocol {
    constructor(settings, session, parser) {
        super(settings, session);
        this._parser = parser;
    }

    getHandler(command) {
        if (CommandsSet.has(command)) {
            // do not accept commands w/o greeting reply
            if (!this._session.advertisedClientHostname) {
                return (_, callback) => {
                    this.emit(
                        'send',
                        503,
                        'Error: send ' + (this._settings.lmtp ? 'LHLO' : 'HELO/EHLO') + ' first'
                    );
                    setImmediate(callback);
                };
            }

            // do not accept unauthenticated commands
            if (
                !this._session.user &&
                !this._settings.authOptional &&
                !this._settings.disabledCommandsSet.has(consts.Commands.AUTH)
            ) {
                return (_, callback) => {
                    this.emit('send', 530, 'Error: authentication required');
                    setImmediate(callback);
                };
            }
        }

        return super.getHandler(command, Commands);
    }

    close() {
        super.close();

        if (this._session.dataStream) {
            this._session.dataStream.removeAllListeners();
            this._session.dataStream = null;
        }

        this._parser = null;
    }

    handleMail(command, callback) {
        if (this._session.envelope.mailFrom) {
            this.emit('send', 503, 'Error: MAIL transaction in progress');
            callback();
            return;
        }

        const parsed = this._parser.parseAddress('mail from', command);
        if (!parsed) {
            this.emit('send', 501, 'Error: bad address syntax');
            callback();
            return;
        }

        if (
            this._settings.size &&
            parsed.args.SIZE &&
            Number(parsed.args.SIZE) > this._settings.size
        ) {
            this.emit(
                'send',
                552,
                'Error: message exceeds max message size ' + this._settings.size
            );
            callback();
            return;
        }

        this._session.envelope.mailFrom = parsed;

        this.emit('mail', this._session, (err) => {
            if (err) {
                this.emit('send', err.code || 550, err.message);
                callback();
                return;
            }

            this.emit('send', 250, 'Accepted');
            callback();
        });
    }

    handleRcpt(command, callback) {
        if (!this._session.envelope.mailFrom) {
            this.emit('send', 503, 'Error: send MAIL command first');
            callback();
            return;
        }

        const parsed = this._parser.parseAddress('rcpt to', command);
        if (!(parsed && parsed.address)) {
            this.emit('send', 501, 'Error: bad address syntax');
            callback();
            return;
        }

        this._session.envelope.rcptTo.set(parsed.address, parsed);
        this._session.envelope.lastTo = parsed;

        this.emit('rcpt', this._session, (err) => {
            if (err) {
                this.emit('send', err.code || 550, err.message);
                callback();
                return;
            }

            this.emit('send', 250, 'Accepted');
            callback();
        });
    }

    handleData(command, callback) {
        if (!this._session.envelope.rcptTo.size) {
            this.emit('send', 503, 'Error: send RCPT command first');
            callback();
            return;
        }

        this._session.dataStream = this._parser.startData(this._settings.size);

        this.emit('data', this._session, (err, message) => {
            if (this._session.dataStream && this._session.dataStream.readable) {
                // do not close until the stream is consumed
                this._session.dataStream.on('end', () => this._endDataStream(err, message));
                return;
            }

            this._endDataStream(err, message);
        });

        this.emit('send', 354, 'End data with <CR><LF>.<CR><LF>');
        callback();
    }

    _endDataStream(err, message) {
        const code = err ? err.code || 450 : 250;

        if (this._settings.lmtp) {
            const messages = Array.from(this._session.envelope.rcptTo.values()).map((r) =>
                err
                    ? `${r.address}: ${err.message}`
                    : `${r.address}: ${message || 'Message accepted'}`
            );

            this.emit('send', code, messages);
        } else {
            this.emit('send', code, err ? err.message : message || 'Message accepted');
        }

        logger.debug({
            sid: this._session.id,
            command: Commands.DATA,
            message: 'DATA done',
        });

        this.emit('reset');

        this._parser.startCommand();
    }
}

module.exports.Commands = Commands;
module.exports.Mail = Mail;
