# [WIP]

# smtp-stack

Configurable SMTP stack with async middleware:

- SMTP
- AUTH PLAIN LOGIN XOAUTH2 CRAM-MD5
- XCLIENT
- XFORWARD
- PROXY
- TLS

## Usage

```javascript
    const { SmtpServer, LogLevels } = require('smtp-stack');

    const server = new SmtpServer({
        name: 'mail.example.com',
        socketTimeout: 1000,
        noAuthReply: true, // handle final auth reply in middleware
        secure: false, // TLS or not
        allowInsecureAuth: true,
        key: 'private-key-PEM',
        cert: 'public-certificate-PEM',
        logLevel: LogLevels.info,
        logBackend: console,
    });

    server.on('error', () => {
        // handle
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
