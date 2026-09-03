## A collection of random single page web apps

Live at **[app.wlf.io](https://app.wlf.io)**.

Each html file is intended to be a self contained application
with no external dependencies so they can be easily hosted anywhere

 - [`apps/arty.html`](https://app.wlf.io/apps/arty.html) A simple trig range and angle calculator, meant for artilary in games

<details>
<summary>Dev</summary>

Serve the project from the repo root (open `http://localhost:8080`).

```sh
python -m http.server 8080
```

```sh
npx --yes serve -p 8080
```

```sh
deno run -RN jsr:@std/http/file-server --port 8080
```

```sh
bunx --bun serve -p 8080
```

</details>
