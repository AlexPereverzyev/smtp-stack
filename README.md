# [WIP]

# smtp-stack

Configurable SMTP stack with async middleware:

- SMTP
- AUTH
- XCLIENT
- XFORWARD
- TLS
- PROXY

## Usage

Naive example:

```javascript
    const { SmtpServer } = require('smtp-stack'); 

    const server = new SmtpServer({
        socketTimeout: 1000,
        key: 'private-key-PEM',
        cert: 'public-certificate-PEM',
    });

    server.use(async (ctx, next) => {            
        console.log('Before', ctx.commandName);

        if (TooManyMails.has(ctx.session.remoteAddress)) {
            ctx.send(455, 'Please slow down');
        } else {
            await next();
        }

        if (ctx.commandName === 'MAIL') {
            TooManyMails.add(ctx.session.remoteAddress);
        }

        console.log('After', ctx.commandName);
    });

    server.start(25, 'localhost', () => {
        console.log('SMTP server started');
    });

    const TooManyMails = new Set();
    setInterval(() => TooManyMails.clear(), 1000);
```

## TODO

### P1

- add command selectors
- add more tests
- refine configuration
- add docs and examples
- packaging
