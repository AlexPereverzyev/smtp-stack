# smtp-stack

Configurable SMTP stack and server with async middleware.

Supports TLS and the following SMTP extensions:

- AUTH PLAIN LOGIN XOAUTH2 CRAM-MD5
- XCLIENT
- XFORWARD
- PROXY

## Installation

```
npm install smtp-stack
```

## Usage and Options

```javascript
    const fs = require('fs');
    const { SmtpServer, LogLevels } = require('smtp-stack');

    const server = new SmtpServer({
        // server name
        name: 'mail.example.com',
    
        // security options
        secure: true, // TLS or not
        authMethods: ['PLAIN', 'LOGIN', 'XOAUTH2', 'CRAM-MD5'],
        disabledCommands: ['STARTTLS'],
        allowInsecureAuth: false,
        noAuthReply: true, // delegate final auth reply to middleware

        // TLS certificate
        key: fs.readFileSync('key.pem').toString(),
        cert: fs.readFileSync('cert.pem').toString(),

        // TLS connection upgrade options (see tls.TLSSocket)
        session: undefined,
        requestCert: false,
        rejectUnauthorized: true,
        requestOCSP: false,

        // SNI TLS extension options (see tls.createSecureContext)
        sessionIdContext: Math.random().toString().substring(2),
        honorCipherOrder: true,
        minVersion: 'TLSv1',
        sniOptions: {
            'mail.example.com': {
                // custom TLS options
                honorCipherOrder: true,
            }
        },
        SNICallback(hostname, callback) {
            callback(null, server.secureContext.get(hostname));
        },

        // timeouts
        socketTimeout: 5 * 1000, // connection idle timeout
        closeTimeout: 10 * 1000, // connections close grace period
        upgradeTimeout: 2 * 1000, // connection TLS upgrade timeout

        // logger configuration
        logLevel: LogLevels.info,
        logBackend: console,

        // max message body size
        size: 1024,

        // enable proxy
        useProxy: true,

        // override default hooks triggered before middleware
        // return error as first argument of callback to cancel
        // operation and close client connection
        onSocket(socket, callback) {
            setImmediate(callback);
        },
        onConnect(session, callback) {
            setImmediate(callback);
        },
        onAuth(session, callback) {
            setImmediate(() => callback(null, { user: 'anonymous' }));
        },
        onMailFrom(session, callback) {
            setImmediate(callback);
        },
        onRcptTo(session, callback) {
            setImmediate(callback);
        },
        onData(session, callback) {
            setImmediate(callback);
        },
        onClose(connection, callback) {
            setImmediate(callback);
        }
    });

    server.on('error', () => {
        // handle error
    });

    // handle AUTH command
    server.use(async (ctx, next) => {

        await next();

        if (ctx.session.auth) {
            let valid = true;

            // todo: validate credentials:
            // - ctx.session.auth.method
            // - ctx.session.auth.username
            // - ctx.session.auth.password

            if (valid) {
                // set user principal
                ctx.session.user = {
                    name: 'John Smith',
                };

                // send final reply
                ctx.send(235, 'Authentication successful');
            } else {
                ctx.send(535, 'Authentication failed');
                ctx.close(); // close connection
            }

            ctx.session.auth = null;
        }
    });

    // handle MAIL FROM/RCPT TO commands
    server.use(async (ctx, next) => {
        if (ctx.commandName === 'MAIL') {
            // todo: parse, validate, alter
            // - ctx.session.envelope.mailFrom
        }

        if (ctx.commandName === 'RCPT') {
            // todo: parse, validate, alter
            // - ctx.session.envelope.rcptTo.forEach
            // - ctx.session.envelope.lastTo
        }

        await next();
    });

    // handle complete MAIL message
    server.use(async (ctx, next) => {
        
        await next();

        if (ctx.commandName === 'DATA' && ctx.session.envelope.dataStream) {
            // copy mail message
            const message = Object.assign({}, ctx.session.envelope);

            // read message body
            const chunks = [];

            ctx.session.envelope.dataStream.on('data', (chunk) => chunks.push(chunk));
            ctx.session.envelope.dataStream.once('end', () => {
                // todo: process the message
                message.body = Buffer.concat(chunks).toString();
            });
        }
    });

    server.start(25, 'localhost', () => {
        console.log('SMTP server started');
    });
```

## Testing

Tested with the following SMTP clients:

- `nodemailer` client NPM package (integrations tests in `test` directory)
- `ssmtp` CLI SMTP client (see the [instructions](docs/ssmtp.md))
- Mozilla Thunderbird (make sure you have valid certificate for testing w/ TLS)
