# Taproot Print Server (thermal / ESC-POS)

Taproot prints two ways:

1. **Browser print** (built-in) — `window.print()`, works anywhere, no setup.
2. **Thermal print** (this server) — fast ESC/POS receipts + kitchen tickets + cash-drawer kick
   on Epson TM-T88 / Star TSP100 class printers.

The web app auto-detects the print server (Settings → Hardware shows status). If it's not
running, printing falls back to the browser dialog automatically.

## Run it (on the machine connected to the printer)

```bash
cd apps/print-server
# Network printer (recommended) — printer in TCP/raw mode on port 9100:
PRINTER_IP=192.168.1.50 node index.js
# No printer yet (dev/log mode): just `node index.js` — jobs print to the console.
```

Server listens on **http://localhost:3333** (override with `PORT`).

## Configure the web app

Settings → **Hardware**:
- **Print server URL** — default `http://localhost:3333`.
- **Test print** — sends a sample receipt.
- **Printer model** / **Network printer IP** — informational; the actual IP is set via the
  `PRINTER_IP` env var on the server.

## Endpoints

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/health` | — | `{ status, printer: 'connected'\|'offline' }` |
| POST | `/print/receipt` | `LastCompletedOrder` | Customer receipt |
| POST | `/print/kitchen` | `LastCompletedOrder` | Kitchen ticket |
| POST | `/drawer/open` | — | Cash-drawer kick |

## Supported hardware
- **Epson** TM-T88 V/VI (Ethernet, port 9100)
- **Star** TSP100/TSP650 (Ethernet, port 9100)
- USB printers: expose them as a network/raw queue (CUPS/Windows share) or extend `sendToPrinter`.

> Note: the prompt referenced port 3001 for the print server, but that's the API dev port —
> the print server uses **3333** to avoid the clash.
