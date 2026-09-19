# Deploying the vinyl archive on a Raspberry Pi

This is the self-hosting setup: Docker Compose running two containers —
`backend` (the NestJS API, not exposed to the network directly) and
`caddy` (serves the built Angular app and reverse-proxies `/api/*` to
the backend, with automatic HTTPS for your domain). A third, optional
container, `ddns-updater`, keeps a Porkbun DNS record pointed at your
home IP if it isn't static.

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
- A domain name you control, with its DNS managed at Porkbun (or
  wherever — Porkbun is only required if you want the optional DDNS
  container).
- Access to your home router to forward ports 80 and 443, and to set a
  DHCP reservation.

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
  Pi doesn't. You'll want this fixed address for the port forwarding
  in step 2.
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

## 2. Point your domain at the Pi

Caddy needs a real, publicly-resolvable domain to automatically obtain
a Let's Encrypt certificate — it won't do this for a bare IP address.

**If your home IP is static:** create an `A` record for your domain (or
subdomain, e.g. `vinyl.yourdomain.com`) pointing at your public IP, at
whatever registrar/DNS host manages the domain. Skip to the port
forwarding step below.

**If your home IP is dynamic** and the domain's DNS is at Porkbun, use
the bundled `ddns-updater` service instead of updating the record by
hand:

1. In Porkbun: **Account → API Access**, create a key, and save both
   the API key and secret key immediately — they're only shown once.
2. In Porkbun: **Account → Domain Management → (your domain) → Details**,
   enable **API Access** for that domain.
3. You'll put these into `DDNS_CONFIG` in the root `.env` file in step 5
   below. The full field reference (including wildcard/`ipv6_suffix`
   options) is at
   github.com/qdm12/ddns-updater/blob/master/docs/porkbun.md.

**Either way**, forward ports **80** and **443** on your router to the
Pi's local IP (the fixed one from step 1) — port 80 is needed for the
initial certificate request (Let's Encrypt's HTTP-01 challenge), and
both are needed for normal traffic afterward.

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
- `DOMAIN` — the domain from step 2.
- `ACME_EMAIL` — required, not optional (Caddy won't start with this
  blank — see the comment in the file).
- `DDNS_CONFIG` — only if you're using the dynamic-IP path from step 2;
  delete or ignore it otherwise.

Edit **`backend/.env`**:
- `FRONTEND_ORIGIN` — `https://` plus the same domain.
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

Add `--profile ddns` before `up` if you're using the dynamic-DNS
container:

```bash
docker compose --profile ddns up -d --build
```

The first build takes a while (compiling the frontend, installing
backend dependencies, fetching Prisma's schema-engine binary — all
need real work, and the last one needs a working internet connection,
same as it did the first time you ran `npm install`/`prisma generate`
locally).

## 7. Verify

```bash
docker compose logs -f backend   # look for "Applying database migrations..." then "listening on http://localhost:3000"
docker compose logs -f caddy     # look for certificate obtained successfully
```

Then visit `https://<your domain>` in a browser. You should see the
public gallery (empty carousel, since nothing's in it yet on this
instance) and be able to reach `/admin/login`.

If the site loads over plain HTTP but not HTTPS, or Caddy's logs show
certificate errors, it's almost always DNS or port forwarding — double
check the `A` record actually resolves to your current public IP
(`dig +short <your domain>`) and that ports 80/443 are actually
reaching the Pi (`curl -I http://<your domain>` from a machine outside
your home network).

## 8. Log in and add your first record

`/admin/login` with the username/password you hashed in step 5. Add a
record through the form as a sanity check that the whole stack — Caddy
→ backend → SQLite → uploads volume — actually works end to end on the
Pi, not just in a browser build.

## Backups

Everything that matters lives under `./data/` next to
`docker-compose.yml`: `data/db` (the SQLite file) and `data/uploads`
(processed scans). Caddy's own volumes (`caddy_data`/`caddy_config`)
only hold certificates and ACME account state — not worth backing up,
Caddy just re-obtains a certificate if they're ever lost.

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
- **Caddy container fails to start with a Caddyfile parse error
  mentioning `email`**: `ACME_EMAIL` is blank in `.env` — see step 5.
- **502 from Caddy right after `docker compose up`**: the backend is
  still applying migrations/starting up; give it a few seconds and
  reload. Persistent 502s mean check `docker compose logs backend`.
- **Login works but nothing else does, or requests look blocked as
  cross-origin**: double-check `FRONTEND_ORIGIN` in `backend/.env`
  matches `https://<domain>` exactly (scheme included, no trailing
  slash).
