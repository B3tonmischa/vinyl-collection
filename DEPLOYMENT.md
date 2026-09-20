# Deploying the vinyl archive on a Raspberry Pi

This is the self-hosting setup: Docker Compose running three containers —
`backend` (the NestJS API, not exposed to the network directly), `caddy`
(serves the built Angular app and reverse-proxies `/vinyl-collection/api/*`
to the backend), and `cloudflared` (an outbound-only Cloudflare Tunnel
connection that's the only thing in this stack actually reachable from
the internet). There is no router configuration involved anywhere in
this setup — no port forwarding, no dynamic DNS, nothing to change on
your router at all.

The app is served under a subpath of your own domain —
`https://michabrenner.com/vinyl-collection` — rather than at the domain's
root, so the root stays free for whatever else you want there later.

Everything below assumes you're running these commands **on the Pi
itself**, over SSH or directly. Build natively there rather than
cross-compiling elsewhere — a couple of native dependencies (`sharp`,
`better-sqlite3`) need to match the Pi's actual architecture, and
building on the Pi is the simplest way to guarantee that.

## Prerequisites

- Raspberry Pi running a **64-bit** Raspberry Pi OS (`uname -m` should
  print `aarch64`, not `armv7l` — some native dependencies don't have
  32-bit prebuilt binaries). Step 1 below covers getting there from a
  blank SD card/USB SSD if you haven't already.
- Another computer to run Raspberry Pi Imager on (your Windows laptop
  works fine) and an SD card or USB SSD for the Pi to boot from.
- A domain you control — `michabrenner.com` — and the ability to change
  its nameservers at whatever registrar holds it (needed once, to add
  the domain to Cloudflare in step 2).
- A free Cloudflare account.

Note what's **not** required: access to your router. Cloudflare Tunnel
makes an outbound-only connection from the Pi, so nothing needs to be
forwarded or opened inbound.

## 1. Flash and configure the OS

If the Pi is already running a 64-bit Raspberry Pi OS, skip to step 2.

Use **Raspberry Pi Imager** (download from raspberrypi.com/software)
on your Windows laptop. It flashes the OS onto an SD card or USB SSD
and pre-configures everything a headless setup needs in the same step
— you never need to connect a monitor or keyboard to the Pi itself.

1. Insert the SD card or USB SSD into your laptop. A USB SSD is worth
   it over an SD card if you have a spare one — more reliable and
   faster for something that'll be running a database and Docker
   continuously. Imager writes to either the same way, and Pi 4/5 both
   boot from USB directly.
2. In Imager: **Choose Device** → your Pi model. **Choose OS** →
   "Raspberry Pi OS (other)" → **Raspberry Pi OS Lite (64-bit)** — Lite
   because this Pi never needs a desktop environment, 64-bit because
   of the native-dependency requirement above. **Choose Storage** →
   the card/SSD you just inserted.
3. Before writing, open the settings (gear icon). Raspberry Pi OS
   dropped the default `pi`/`raspberry` login years ago, so this is
   where you set your own — there's no fallback if you skip it:
   - **Hostname** — anything memorable, e.g. `vinyl-pi`.
   - **Enable SSH** — password auth is simplest; use "allow public-key
     authentication only" instead if you already have an SSH key you
     use elsewhere.
   - **Username and password** — required now, not optional.
   - **Wireless LAN** — only if you're not using Ethernet. Ethernet is
     worth it for a device that's going to sit in one place
     permanently: one less thing that can flake, and no Wi-Fi
     credentials baked into the image.
   - **Locale, timezone, keyboard layout**.
4. Write, wait for verify, then move the card/SSD into the Pi and
   power it on.

Give it a minute or two to boot, then connect from your laptop:

```bash
ssh <username>@<hostname>.local
# if .local resolution doesn't work from Windows, use the IP from
# your router's connected-devices list instead
```

Once you're in:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

(The filesystem now auto-expands to fill the card/SSD on first boot —
no separate `raspi-config` step needed for that anymore.)

Two more things worth doing now, before moving on:

- **Give the Pi a fixed local IP.** Reserve one for its MAC address in
  your router's DHCP settings, rather than setting a static IP on the
  Pi itself — a reservation survives a reinstall, a static IP on the
  Pi doesn't. This isn't required for the tunnel to work (Cloudflare
  only ever sees the Pi's outbound connection), but it makes SSHing
  back in later more reliable than depending on `.local` resolution or
  DHCP handing out a different address.
- **Check available memory** with `free -h`. If the Pi has 2GB of RAM
  or less, the frontend's Docker build (`ng build` inside `npm ci`)
  can be memory-hungry enough to fail or get OOM-killed. If that
  happens when you get to step 6, add swap first:
  ```bash
  sudo dphys-swapfile swapoff
  sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
  sudo dphys-swapfile setup
  sudo dphys-swapfile swapon
  ```

## 2. Set up Cloudflare Tunnel

This replaces DNS records and router port forwarding entirely. The Pi
initiates an outbound connection to Cloudflare; Cloudflare terminates
public HTTPS and forwards matching requests down that connection.

1. **Add your domain to Cloudflare.** In the Cloudflare dashboard,
   "Add a site" → enter `michabrenner.com` → pick the Free plan.
   Cloudflare gives you two nameservers to set at your domain's
   registrar (wherever `michabrenner.com` is currently registered —
   this is a registrar setting, not a Cloudflare one). This step can
   take anywhere from a few minutes to a few hours to propagate;
   Cloudflare emails you once it's active.
2. **Create a tunnel.** In the Cloudflare **Zero Trust** dashboard
   (separate from the main dashboard — there's a link to it in the
   sidebar): **Networks → Tunnels → Create a tunnel**. Choose
   **Cloudflared** as the connector type, give the tunnel a name (e.g.
   `vinyl-archive`).
3. The next screen shows an install command for various platforms —
   ignore the install command itself (you're running this in Docker,
   not installing `cloudflared` directly on the Pi). What you actually
   need is the token: it's the long value after `--token` in that
   command. Copy it.
4. **Add a Public Hostname** for the tunnel, still in the same setup
   flow (or under the tunnel's **Public Hostname** tab afterward):
   - **Domain**: `michabrenner.com`
   - **Path**: `vinyl-collection`
   - **Type**: `HTTP`
   - **URL**: `http://caddy:80` (the dashboard's URL field wants the
     full scheme included, even though the **Type** dropdown above it
     already says HTTP — a bare `caddy:80` gets rejected with "Invalid
     service URL format")

   (`caddy` resolves because `cloudflared` and `caddy` share the
   `internal` Docker network in `docker-compose.yml` — no IP address or
   port publishing needed.)
5. You'll paste the token from step 3 into `TUNNEL_TOKEN` in the root
   `.env` file in step 5 below.

## 3. Install Docker on the Pi

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in for the group change to apply
docker compose version   # confirms the Compose plugin is present
```

## 4. Get the code onto the Pi

```bash
git clone <your repo url> vinyl-archive
cd vinyl-archive
```

(If you're not using git yet, copying the folder over some other way —
`scp`, a USB drive — works just as well; nothing here depends on git
specifically.)

## 5. Configure environment files

Two separate `.env` files — one for Compose itself, one for the
backend container:

```bash
cp .env.example .env
cp backend/.env.docker.example backend/.env
```

Edit the root **`.env`**:
- `TUNNEL_TOKEN` — the token you copied in step 2.

Edit **`backend/.env`**:
- `FRONTEND_ORIGIN` — `https://michabrenner.com` (already set correctly
  in the example — just confirm it matches your domain).
- `ADMIN_USERNAME` — whatever you want to log into `/admin` with.
- `ADMIN_PASSWORD_HASH` — generate this **on your own machine**
  (bcryptjs is pure JavaScript, so this works identically on Windows,
  macOS, or Linux — you already have Node installed there for frontend
  work):
  ```bash
  cd backend
  npm run hash:password -- "your-password-here"
  ```
  Paste the printed hash into `backend/.env` on the Pi. (If you'd
  rather generate it on the Pi after the image is built instead:
  `docker compose run --rm backend node scripts/hash-password.js "your-password-here"`.)
- `JWT_SECRET` — any long random string, e.g. generated on the Pi with
  `openssl rand -hex 32`.
- `DATABASE_URL` and `UPLOADS_ROOT` are already set correctly for this
  Docker setup — leave them as the example has them.

Neither `.env` file should ever be committed — both are already
excluded from what gets copied into the Docker build context, and
belong in your repo's `.gitignore` if you haven't added one yet.

## 6. Build and start

```bash
docker compose up -d --build
```

The first build takes a while (compiling the frontend, installing
backend dependencies, fetching Prisma's schema-engine binary — all
need real work, and the last one needs a working internet connection,
same as it did the first time you ran `npm install`/`prisma generate`
locally).

## 7. Verify

```bash
docker compose logs -f backend       # look for "Applying database migrations..." then "listening on http://localhost:3000"
docker compose logs -f cloudflared   # look for "Registered tunnel connection" (no certificate messages — Cloudflare handles that)
```

Then visit `https://michabrenner.com/vinyl-collection/` in a browser.
You should see the public gallery (empty carousel, since nothing's in
it yet on this instance) and be able to reach
`https://michabrenner.com/vinyl-collection/admin/login`.

## 8. Log in and add your first record

`/vinyl-collection/admin/login` with the username/password you hashed
in step 5. Add a record through the form as a sanity check that the
whole stack — Cloudflare → cloudflared → Caddy → backend → SQLite →
uploads volume — actually works end to end on the Pi, not just in a
browser build.

## Backups

Everything that matters lives under `./data/` next to
`docker-compose.yml`: `data/db` (the SQLite file) and `data/uploads`
(processed scans). Neither Caddy nor cloudflared hold any state worth
backing up separately.

A simple periodic backup is enough for a personal collection:

```bash
tar -czf vinyl-archive-backup-$(date +%F).tar.gz data/db data/uploads
```

Worth copying that archive somewhere other than the Pi's own SD
card/SSD — a cron job pushing it to another machine or cloud storage,
even just occasionally, is the difference between "annoying" and
"catastrophic" if the Pi's storage fails.

## Updating

```bash
git pull   # or however you're syncing changes onto the Pi
docker compose up -d --build
```

The backend's entrypoint runs `prisma migrate deploy` on every start,
so any new migrations that came in with the update are applied
automatically — no separate manual step.

## Troubleshooting

- **`docker compose up` fails immediately with `permission denied while
  trying to connect to the docker API at unix:///var/run/docker.sock`**:
  `sudo usermod -aG docker $USER` (step 3) only takes effect for
  sessions started *after* it ran — your current SSH session is still
  using the group list from before that command, so it doesn't have
  `docker` group access yet even though the command succeeded. Fix
  without disconnecting: `newgrp docker`, then retry. Or just close
  the SSH session and reconnect. Confirm with `groups` — it should
  list `docker`.
- **A `WARN` about some unrelated-looking variable name "not set,
  defaulting to a blank string"** when running `docker compose up`:
  Compose treats an unescaped `$` inside any `.env` value as the start
  of a variable reference (`$foo` or `${foo}`) and substitutes it —
  this is Compose's own interpolation, not something specific to this
  project. Check `.env` for a stray `$` in `TUNNEL_TOKEN` (shouldn't be
  one in a real Cloudflare token, but worth eliminating) or anywhere
  else in the file; a literal `$` you actually want kept needs to be
  escaped as `$$`. After fixing, `docker compose config` prints the
  fully resolved compose file with variables substituted — useful to
  confirm `TUNNEL_TOKEN` actually resolved to your real token and not
  an empty string (that command prints the real token to your
  terminal, so don't paste its output anywhere outside your own
  machine).
- **Backend container keeps restarting, logs show a migration/network
  error reaching `binaries.prisma.sh`**: this is the same Prisma 7 CLI
  behavior documented in `claude/architecture-and-data-model.md` — the
  CLI needs to reach that host. Should just work on a normal home
  connection; if it doesn't, check the Pi's own internet access first,
  not the app.
- **`npm ci` or the build fails with a native-module error
  (`sharp`/`better-sqlite3`)**: almost always means the image was built
  somewhere other than the Pi (cross-compiled), so npm picked the wrong
  platform's prebuilt binary. Rebuild directly on the Pi.
- **The frontend build hangs, gets killed, or the Pi becomes
  unresponsive during `docker compose up -d --build`**: likely an
  out-of-memory Docker build on a lower-RAM Pi — see the swap note in
  step 1.
- **`cloudflared` container keeps restarting, or `docker compose logs
  cloudflared` shows an authentication/token error**: `TUNNEL_TOKEN` in
  `.env` is missing, truncated, or from a deleted tunnel — re-copy it
  from the tunnel's page in the Zero Trust dashboard.
- **`https://michabrenner.com/vinyl-collection/` gives a Cloudflare
  "error 1033" or similar edge error, but `cloudflared`'s own logs look
  healthy**: check the Public Hostname rule in the tunnel's dashboard
  (step 2.4) — domain, path, and service URL (`http://caddy:80`,
  scheme included) have to match exactly, and the path must not have a
  leading slash in that field.
- **Page loads but assets 404, or the site loads at the wrong base
  path**: means the frontend was built without the `--base-href
  /vinyl-collection/` flag — check `frontend/Dockerfile` still has it,
  then rebuild (`docker compose up -d --build caddy`).
- **502 from Caddy right after `docker compose up`**: the backend is
  still applying migrations/starting up; give it a few seconds and
  reload. Persistent 502s mean check `docker compose logs backend`.
- **Login works but nothing else does, or requests look blocked as
  cross-origin**: double-check `FRONTEND_ORIGIN` in `backend/.env` is
  exactly `https://michabrenner.com` (scheme included, no trailing
  slash, no `/vinyl-collection` — CORS checks the origin, not the
  path).
