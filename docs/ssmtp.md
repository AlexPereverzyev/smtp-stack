# Manual test with ssmtp

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
rewriteDomain=mail.example.com
hostname=mail.example.com
FromLineOverride=YES
UseTLS=NO
AuthUser=user
AuthPass=pass
Debug=YES
```

From command line run:

```
ssmtp receiver@mail.example.com
```
Then enter (there is whitespace between subject and body):

```
To: receiver@mail.example.com
From: sender@mail.example.com
Subject: Test
 
This is just a test.
```

Press `Ctrl+D` to send the message.

Observe `smtp-stack` server logs.

Note, by default idle connections are closed after 30 sec.
