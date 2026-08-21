# SENDATRACK relay

SENDATRACK's own network rejects API calls from Cloudflare's (and most
cloud/datacenter) IP ranges, but works fine from residential/mobile
connections. This relay is a tiny proxy that runs on a device with a real
residential/mobile IP (e.g. an old Android phone) and forwards SENDATRACK
calls on behalf of the TrackFleet Worker, which can't reach SENDATRACK
directly.

It only forwards requests to `backend2.sendatrack.com` — it is not a
general-purpose open proxy, and it never sees your dispatcher accounts or
customer data, only the SENDATRACK login/fleet calls.

## What you need

- An Android device with **Termux** and **Termux:Boot** installed from
  [F-Droid](https://f-droid.org/) (not the Play Store versions, which are
  outdated and unmaintained).
- The device kept plugged in and connected to WiFi (or mobile data) at all
  times.

## One-time setup (in Termux)

```sh
pkg update && pkg upgrade
pkg install nodejs cloudflared git
```

Get the relay files onto the device (either `git clone` the TrackFleet repo,
or copy just the `relay/` folder over) and generate a shared secret — this
is a separate secret from every dispatcher password, used only so the Worker
and the relay can authenticate each other:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save that value — you'll set it as `SENDATRACK_RELAY_SECRET` on the
Cloudflare Worker, and as `RELAY_SHARED_SECRET` here.

Create `~/relay.env` in Termux with:

```sh
export RELAY_SHARED_SECRET="<the secret you generated>"
```

## Auto-start on boot

Termux:Boot runs any script placed in `~/.termux/boot/`. Create
`~/.termux/boot/start-relay.sh`:

```sh
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
source ~/relay.env
cd ~/trackfleet/relay
node run.mjs >> ~/relay.log 2>&1
```

```sh
mkdir -p ~/.termux/boot
chmod +x ~/.termux/boot/start-relay.sh
```

Then either reboot the phone once, or start it manually the first time:

```sh
source ~/relay.env
cd ~/trackfleet/relay
node run.mjs
```

You should see `relay HTTP server listening on :8787`, then `starting
cloudflared tunnel...`, then a line like `registered relay URL with
TrackFleet: https://random-words.trycloudflare.com`.

## How it works

- `server.mjs` is the actual proxy: it accepts `POST /proxy` requests
  (authenticated with the shared secret) describing a request to make, does
  it, and returns the result.
- `run.mjs` starts that server, opens a free Cloudflare quick tunnel to it,
  and — since a quick tunnel's URL changes every time it (re)connects — tells
  the TrackFleet Worker the new address by calling
  `POST /api/sendatrack/relay`. If the tunnel drops, `run.mjs` restarts it
  and re-registers automatically. No fixed domain or manual URL updates are
  needed.
- The Worker only starts routing SENDATRACK calls through the relay once
  `SENDATRACK_RELAY_SECRET` is set on Cloudflare — until then, this is a
  no-op and TrackFleet behaves exactly as it does today.

## If the device is offline

TrackFleet falls back to its existing degraded behavior (last known
positions, no automatic transitions) — the same as any other SENDATRACK
outage — rather than breaking anything further.
