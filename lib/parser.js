'use strict';

const { Writable, PassThrough } = require('stream');

const punycode = require('../node_modules/punycode');

const consts = require('./consts');
const utils = require('./utils');
const { current: logger } = require('./logger');

const Dt = 0x2e;
const CR = 0x0d;
const LF = 0x0a;

class SmtpStream extends Writable {
    constructor(options) {
        super(options);

        this._remainderCmd = Buffer.allocUnsafe(0);
        this._remainderDta = Buffer.allocUnsafe(0);
        this._data = false;
        this._dataStream = null;
        this._dataBytes = 0;

        this.closed = false;

        this.once('finish', () => this._flushData());
    }

    startData(maxBytes = Infinity) {
        this._maxBytes = Number(maxBytes);
        this._data = true;
        this._dataBytes = 0;
        return (this._dataStream = new PassThrough());
    }

    stopData() {
        this._data = false;
        this._dataBytes = 0;
        this._dataStream = null;
    }

    _write(chunk, encoding, callback) {
        if (!(chunk && chunk.length) || this.closed) {
            callback();
            return;
        }

        if (this._data) {
            this._feedData(chunk, callback);
        } else {
            this._feedCommand(chunk, callback);
        }
    }

    _feedCommand(chunk, done) {
        const data = Buffer.concat([this._remainderCmd, chunk]);
        let pos = 0;

        const readLine = (_) => {
            // mode can change if command is DATA
            if (this._data) {
                this._remainderCmd = Buffer.allocUnsafe(0);

                const dataBuffer = data.slice(pos);

                // continue to read mail body
                this._write(dataBuffer, 'buffer', done);
                return;
            }

            // scan for command termination sequence
            for (let i = pos; i < data.length - 1; i++) {
                if (data[i] === CR && data[i + 1] === LF) {
                    // extract command and keep tail in remainder
                    const line = data.slice(pos, i);

                    pos += line.length + 2;

                    // continue after the command is handled
                    if (line.length) {
                        this.emit('command', line, readLine);
                        return;
                    }

                    setImmediate(readLine);
                }
            }

            // not found - store remainder and exit
            this._remainderCmd = data.slice(pos);
            done();
        };

        readLine();
    }

    _feedData(chunk, done) {
        let data = Buffer.concat([this._remainderDta, chunk]);
        this._remainderDta = Buffer.allocUnsafe(0);

        // handle empty body
        if (
            !this._dataBytes &&
            data.length >= 3 &&
            data[0] === Dt &&
            data[1] === CR &&
            data[2] === LF
        ) {
            this._endData(null, data.slice(3), done);
            return;
        }

        // unescape starting dot
        if (!this._dataBytes && data.length >= 2 && data[0] === Dt && data[1] === Dt) {
            data = data.slice(1);
        }

        // scan for termination sequence
        let once;
        do {
            once = true;

            for (let i = 0; i < data.length - 4; i++) {
                if (!(data[i] === CR && data[i + 1] === LF && data[i + 2] === Dt)) {
                    continue;
                }

                // detect termination sequence
                if (data[i + 3] === CR && data[i + 4] === LF) {
                    if (i) {
                        const chunkBuffer = data.slice(0, i + 2);
                        this._dataBytes += chunkBuffer.length;

                        this._endData(chunkBuffer, data.slice(i + 5), done);
                    } else {
                        this._endData(null, data.slice(i + 5), done);
                    }
                    return;
                }

                // detect escaped dots
                if (data[i + 3] === Dt) {
                    const chunkBuffer = data.slice(0, i + 2);
                    this._dataBytes += chunkBuffer.length;

                    if (this._dataStream.writable) {
                        this._dataStream.write(chunkBuffer);
                    }

                    // unescape dot and repeat
                    data = data.slice(i + 3);
                    once = false;
                    break;
                }
            }
        } while (!once);

        // always remember at least 4 bytes to detect trermination sequence later
        if (data.length < 4) {
            this._remainderDta = data;
        } else {
            this._remainderDta = data.slice(data.length - 4);
        }

        // if there is more data besides the reminder - emit it
        if (this._remainderDta.length < data.length) {
            const dataBuffer = data.slice(0, data.length - this._remainderDta.length);
            this._dataBytes += dataBuffer.length;

            if (this._dataStream.writable) {
                this._dataStream.write(dataBuffer);
            }
        }

        done();
    }

    _endData(lastChunk, remainder, callback) {
        // push remainder after data back for processing
        this._dataStream.once('end', () => {
            if (remainder && remainder.length) {
                this._write(remainder, 'buffer', callback);
            } else {
                callback();
            }
        });
        this._dataStream.bytesExceeded = this._dataBytes > this._maxBytes;

        // write last chunk
        if (lastChunk && lastChunk.length) {
            if (this._dataStream.writable) {
                this._dataStream.end(lastChunk);
            }
        } else {
            this._dataStream.end();
        }

        this._remainderCmd = Buffer.allocUnsafe(0);
        this.stopData();
    }

    _flushData() {
        if (!this._remainderCmd.length || this.closed) {
            return;
        }

        this.emit('command', this._remainderCmd);

        this._remainderCmd = Buffer.allocUnsafe(0);
    }

    parseAddress(name, command) {
        name = name.toUpperCase();
        command = (command || '').toString();

        const parts = command.split(':');
        if (!parts.length) {
            return false;
        }

        command = parts.shift().trim().toUpperCase();
        if (name !== command) {
            return false;
        }

        const optParts = parts.join(':').trim().split(/\s+/);

        let address = optParts.shift();
        if (!consts.EmailPattern.test(address)) {
            return false;
        }

        address = address.substr(1, address.length - 2).toLowerCase();
        if (!(address && address.length)) {
            return false;
        }

        address = address.split('@');
        try {
            address = [address[0], '@', punycode.toUnicode(address[1])].join('');
        } catch (err) {
            logger.error({
                err,
                command: 'punycode domain',
                message: err.message,
            });

            // fall back
            address = [address[0], '@', address[1]].join('');
        }

        let args = false;
        optParts.forEach((part) => {
            part = part.split('=');

            const key = part.shift().toUpperCase();
            let value = part.join('=') || true;

            if (typeof value === 'string') {
                value = utils.decodeXText(value);
            }

            if (!args) {
                args = {};
            }
            args[key] = value;
        });

        return {
            address,
            args,
        };
    }
}

module.exports.SmtpStream = SmtpStream;
