'use strict';

const pki = require('node-forge').pki;

module.exports.HOST = 'localhost';
module.exports.PORT = 2525;

module.exports.genCert = function () {
    const keys = pki.rsa.generateKeyPair(2048);
    const crt = pki.createCertificate();
    crt.publicKey = keys.publicKey;
    crt.sign(keys.privateKey);
    return {
        certificate: pki.certificateToPem(crt),
        serviceKey: pki.privateKeyToPem(keys.privateKey),
    };
};
