# A collection of single page web apps and tools

Live at **[app.wlf.io](https://app.wlf.io)**.

Each html file is intended to be a self contained application
with no external dependencies so they can be easily hosted anywhere

---------

# Build

```sh
node build.js
```

# Dev

### HTTP

Serve `src` from the repo root (open `http://localhost:8080`).


```sh
bunx --bun serve src -p 8080
```

```sh
deno run -RN jsr:@std/http/file-server src --port 8080
```

```sh
npx --yes serve src -p 8080
```


### HTTPS

Create a local certificate once:

```sh
mkdir -p .certs && openssl req -x509 -newkey rsa:2048 -keyout .certs/key.pem -out .certs/cert.pem -days 365 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Then start the file server with one of these commands, Open `https://localhost:8443` and accept the certificate warning.

```sh
bunx --bun serve src -p 8443 --ssl-cert .certs/cert.pem --ssl-key .certs/key.pem
```

```sh
deno run -RN jsr:@std/http/file-server src --port 8443 --cert .certs/cert.pem --key .certs/key.pem
```

```sh
npx --yes serve src -p 8443 --ssl-cert .certs/cert.pem --ssl-key .certs/key.pem
```
