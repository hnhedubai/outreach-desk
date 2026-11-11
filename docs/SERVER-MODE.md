# Server mode (`OUTREACH_MODE=server`)

Outreach Desk is a loopback-only, single-user local application by default. Server mode
relaxes the three guards that make the app unreachable behind a hosting proxy so it can
be exercised, and eventually deployed, in front of one.

It is **opt-in and fail-closed**. With `OUTREACH_MODE` unset every guard behaves exactly
as documented in `SECURITY.md` §1, and there is no way to reach the app over a network
address.

> Server mode is **not** sufficient to expose the app publicly. See
> [What server mode does not solve](#what-server-mode-does-not-solve).

## What the flag changes

| Guard | Default | `OUTREACH_MODE=server` |
|---|---|---|
| Bind address | `127.0.0.1` | `0.0.0.0` |
| `Host` validation | must equal `127.0.0.1:<port>` or `localhost:<port>` | must appear in `OUTREACH_ALLOWED_HOSTS` |
| CSRF `Origin` scheme | always `http://` | from `X-Forwarded-Proto`, defaulting to `https://` |

Startup **fails closed**: server mode with an empty `OUTREACH_ALLOWED_HOSTS` throws and
the process exits, rather than silently accepting any `Host`.

## Test it locally

`localhost` works as-is — no hosts-file entry and no TLS proxy needed for GET requests.

```powershell
cd C:\Users\mohdz\outreach-desk-repo

# 1. Give the data directory a password, otherwise login returns 401
$env:OUTREACH_DATA_DIR="$env:TEMP\od-servermode"
node reset-password.mjs

# 2. Start in server mode
$env:OUTREACH_MODE="server"
$env:OUTREACH_ALLOWED_HOSTS="localhost:8282"
node server.mjs
```

The startup line confirms the mode: `listening on 0.0.0.0:8282 (server mode)`. Browse to
`http://localhost:8282`.

`reset-password.mjs` prompts twice at the terminal and reads `OUTREACH_DATA_DIR`
(`reset-password.mjs:8`). For a non-interactive equivalent — a script or CI job — use:

```powershell
node -e "import('./auth.mjs').then(a=>a.setPassword(process.env.OUTREACH_DATA_DIR,'correct horse battery staple').then(()=>console.log('password set')))"
```

When finished, clear the flags — `OUTREACH_MODE` is process-wide, so a later `npm start`
in the same shell would silently stay in server mode:

```powershell
Remove-Item Env:OUTREACH_MODE,Env:OUTREACH_ALLOWED_HOSTS,Env:OUTREACH_DATA_DIR
```

## Verified behaviour

Observed against a running instance with `OUTREACH_ALLOWED_HOSTS="localhost:8283"`:

| Request | Status |
|---|---|
| GET, `Host: localhost:8283` | 200 |
| GET, `Host: 127.0.0.1:8283` | 403 |
| GET, `Host: evil.com` | 403 |
| POST, `Origin: http://localhost:8283` + `X-Forwarded-Proto: http` | 200 |
| POST, `Origin: https://localhost:8283` + `X-Forwarded-Proto: https` | 200 |
| POST, `Origin: http://localhost:8283`, no `X-Forwarded-Proto` | 403 |

## Caveats that will bite you

**1. The host allow-list is an exact string match, port included.** `localhost:8282` and
`127.0.0.1:8282` are two different entries, and `localhost` without the port does not
match `localhost:8282`. List every form you intend to use:

```powershell
$env:OUTREACH_ALLOWED_HOSTS="localhost:8282,127.0.0.1:8282"
```

Matching is case-insensitive and surrounding spaces are trimmed.

**2. Over plain `http`, every POST returns 403 — including login.** With no
`X-Forwarded-Proto`, the expected scheme defaults to `https`, so the browser's `http://`
`Origin` never matches. The page loads and then every submit fails. This is deliberate:
server mode assumes a TLS-terminating proxy. To exercise POSTs without TLS, send the
header yourself:

```powershell
# Put the body in a file. Passing inline JSON to curl.exe through PowerShell gets mangled
# by argument quoting and the app replies 400 "Expected a valid JSON object."
'{"username":"admin","password":"correct horse battery staple"}' |
  Set-Content login.json -Encoding ascii -NoNewline

curl.exe -s -w "`n-> %{http_code}`n" -X POST http://127.0.0.1:8282/api/auth/login `
  -H "Host: localhost:8282" `
  -H "Origin: http://localhost:8282" `
  -H "X-Forwarded-Proto: http" `
  -H "Content-Type: application/json" `
  --data-binary "@login.json"
```

Expected: `{"ok":true}` and `200`. Drop the `X-Forwarded-Proto` header and the same
request returns 403, which is the behaviour being tested.

For a real browser test over `https`, put a local TLS proxy in front — for example
`caddy reverse-proxy --from https://localhost:8443 --to 127.0.0.1:8282`, which sets
`X-Forwarded-Proto: https` automatically. The `Host` header only omits the port when the
proxy listens on the scheme's default port, so `https://localhost` arrives as `localhost`
but `https://localhost:8443` arrives as `localhost:8443` — match the allow-list to whichever
you use.

**3. `.localhost` subdomains do not resolve through Windows DNS.** Bare `localhost`
resolves fine (`::1` and `127.0.0.1`, via the built-in resolver — there is no hosts-file
entry). A made-up name like `desk.localhost` returns `ENOTFOUND`, so use `localhost` or
add a hosts-file entry (requires administrator).

**4. Test headers with a precise client.** PowerShell's `Invoke-WebRequest` reuses
keep-alive connections and can rewrite request headers; it has produced misleading
results here (a non-allow-listed `Host` appearing to return 200). Use `curl.exe` or a
`node` HTTP client when checking guard behaviour — and with `curl.exe`, pass the body from
a file as shown above, because inline `-d` JSON does not survive PowerShell quoting.

**5. `0.0.0.0` means the LAN can reach the app.** While server mode runs, other machines
on the network can connect if the Windows firewall permits inbound. Don't leave it
running, and don't use a weak password.

**6. A fresh data directory has no password**, so login returns 401. That is not a bug —
run `node reset-password.mjs` against the same `OUTREACH_DATA_DIR` first.

## What server mode does not solve

These remain as they are for a local install, and each blocks safe public exposure:

- Sessions live in an in-memory `Map` (`auth.mjs:7`). Every restart logs users out, and
  multiple instances cannot share sessions.
- There is exactly one hardcoded username, `admin` (`auth.mjs:5`). No per-user accounts.
- The session cookie carries no `Secure` flag (`server.mjs:213`, `:225`, `:234`).

## Production checklist

- The proxy must **overwrite** `X-Forwarded-Proto`. If clients can reach the instance
  directly, that header is attacker-controlled and the origin check can be downgraded to
  `http://`.
- `OUTREACH_ALLOWED_HOSTS` must be the complete set of public names for the deployment.
- TLS terminates at the proxy; the app itself serves plain HTTP.
- `PORT` is read from the environment (`server.mjs:25`), which matches what Render,
  Railway and Fly inject.

## Automated tests

```powershell
node --test test/server-mode.test.mjs
```

Covers: refuse-to-start without a host list, the `0.0.0.0` bind, allow-listed and
rejected hosts, `https` origin accepted behind a TLS-terminating proxy, mismatched origin
still rejected, comma-separated list with case and spacing tolerance, and a local-mode
regression test asserting the original 403 behaviour.
