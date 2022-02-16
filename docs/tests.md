# Manual Tests

## Test with ssmtp

Install [ssmtp](https://packages.ubuntu.com/search?keywords=ssmtp):

```
sudo apt-get install ssmtp
```

Update ssmtp configuration:

```
sudo nano /etc/ssmtp/ssmtp.conf
```

```
root=postmaster
mailhub=localhost:2525
rewriteDomain=localhost.my
hostname=localhost.my
FromLineOverride=YES
UseTLS=NO
AuthUser=username
AuthPass=password
Debug=YES
```

From command line run:

```
ssmtp receiver@localhost.my
```
Then enter (there is whitespace between subject and body):

```
To: receiver@localhost.my
From: sender@localhost.my
Subject: Test
 
This is just a test.
```

Press `Ctrl+D` to send the message.

Observe `smtp-stack` server logs.

Note, idle connections are closed in 30 sec by default.
