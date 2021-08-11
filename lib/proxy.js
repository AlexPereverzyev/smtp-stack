'use strict';

const { current: logger } = require('./logger');

const Commands = {
    PROXY: 'PROXY',
};

const LF = 0x0a;

module.exports.readRemoteAddress = function (socket, socketOptions, options, callback) {
    const buffers = [];

    const proxyHeaderReader = () => {
        let chunk;

        while ((chunk = socket.read()) !== null) {
            for (let i = 0; i < chunk.length; i++) {
                const chr = chunk[i];
                if (chr !== LF) {
                    continue;
                }

                socket.removeListener('readable', proxyHeaderReader);

                buffers.push(chunk.slice(0, i + 1));

                const remainder = chunk.slice(i + 1);
                if (remainder.length) {
                    socket.unshift(remainder);
                }

                const params = Buffer.concat(buffers).toString().trim().split(' ');
                const commandName = params.length ? params[0].toUpperCase() : null;

                if (commandName !== Commands.PROXY) {
                    callback(new Error('Invalid PROXY header\r\n'));
                    return;
                }

                if (params[2]) {
                    socketOptions.remoteAddress = params[2].trim().toLowerCase();

                    socketOptions.ignore =
                        options.ignoredHosts &&
                        options.ignoredHosts.includes(socketOptions.remoteAddress);

                    logger.debug({
                        sid: socketOptions.id,
                        command: Commands.PROXY,
                        message: `Proxy from ${params[2]} through ${params[3]}`,
                        ignore: socketOptions.ignore,
                    });

                    if (params[4]) {
                        socketOptions.remotePort =
                            Number(params[4].trim()) || socketOptions.remotePort;
                    }
                }

                callback(null);
                return;
            }

            buffers.push(chunk);
        }
    };

    socket.on('readable', proxyHeaderReader);
};
