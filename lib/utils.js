'use strict';

const crypto = require('crypto');

module.exports.encodeXText = function (str) {
    // ! 0x21
    // + 0x2B
    // = 0x3D
    // ~ 0x7E
    if (!/[^\x21-\x2A\x2C-\x3C\x3E-\x7E]/.test(str)) {
        return str;
    }

    const buf = Buffer.from(str);

    let result = '';
    for (let i = 0; i < buf.length; i++) {
        const c = buf[i];

        if (c < 0x21 || c > 0x7e || c === 0x2b || c === 0x3d) {
            result += '+' + (c < 0x10 ? '0' : '') + c.toString(16).toUpperCase();
        } else {
            result += String.fromCharCode(c);
        }
    }

    return result;
};

module.exports.decodeXText = function (str) {
    return str.replace(/\+([0-9A-F]{2})/g, (_, hex) => unescape('%' + hex));
};

module.exports.sid = function () {
    return crypto.randomBytes(10).toString('base64');
};

module.exports.timestamp = function () {
    return (Date.now() / 1000) | 0;
};
