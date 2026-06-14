# App icons

`tauri.conf.json` references `32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.icns`, and `icon.ico`. These binary icon files are **not committed** — generate
them from a single source logo before building:

```bash
cd apps/desktop
npx @tauri-apps/cli icon ../web/public/icon-512.png
```

This writes all five referenced files into this directory (and the platform variants).
`tauri build` will fail until they exist.
