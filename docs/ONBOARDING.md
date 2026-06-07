# New Customer Onboarding Guide

How a brand-new restaurant goes from sign-up to taking orders in ~10 minutes.

## The 10-minute path

1. **Create your account** — `taproot-pos.com` → *Start free trial*. Enter your name,
   restaurant name, email, and a password. No credit card required (14-day trial).
2. **Import your menu** — upload your current menu as a **PDF or CSV**. Taproot's AI reads
   every item, price, and description and imports them automatically. Review the parsed
   items, fix anything that looks off, and confirm. (Or skip and add items manually later.)
3. **Add your team** — invite employees and set their roles (owner / manager / cashier /
   kitchen / read-only) and a 4–6 digit PIN for fast register switching. *(Skippable.)*
4. **Connect payments** — connect your Stripe account (Stripe Connect). You keep your own
   Stripe account and processing rates; Taproot takes no cut of transactions. *(Skippable —
   you can take cash immediately.)*
5. **Set your tax rate** — pick your state to auto-fill the rate, or enter it manually.
6. **Done** — you're on the register. Tap items to build an order, charge cash or card,
   and a receipt prints.

## After onboarding

- **Settings → Products** — edit items, prices, day-parts, modifiers, categories.
- **Settings → Business** — store name, address, timezone, currency, receipt text, tax.
- **Settings → Employees** — manage staff, PINs, and roles.
- **Settings → Hardware** — connect a thermal printer (print server) or barcode scanner.
- **Settings → Online Ordering / QR Codes** — turn on pickup/delivery and table QR menus.
- **Reports / Insights** — sales dashboards, end-of-day, and AI forecasting/menu engineering.

## Tips

- **Menu import gives $0 prices?** Edit prices on the review screen before confirming, or
  later in **Settings → Products**. Sub-$1 items: double-check the parsed value.
- **New employee can't see a new location?** Have them sign out and back in so their token
  picks up the added location.
- **Card payments require Stripe Connect.** Cash works everywhere, immediately — including
  offline (orders queue and sync on reconnect).
- **Switch cashiers fast:** the lock screen takes a PIN; 5 minutes idle auto-locks.

## Demo

Explore everything risk-free with the live demo: `demo@taproot.pos` / `TaprootDemo2026!`.
