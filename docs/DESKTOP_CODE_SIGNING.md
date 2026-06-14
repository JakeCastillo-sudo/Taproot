# Taproot POS Desktop — Code Signing Guide

## macOS Code Signing + Notarization

### Why It Matters
Without signing: macOS shows "app is damaged"
or "cannot verify developer" → users can't install.
With signing + notarization: installs silently.

### What You Need
- Apple Developer account ($99/year)
  → Same account used for iOS App Store
- Developer ID Application certificate
  (different from iOS Distribution certificate)

### Step by Step

1. In Xcode:
   Preferences → Accounts → [your Apple ID]
   → Manage Certificates → +
   → Developer ID Application
   → Export as .p12 file (save the password)

2. Convert to base64 for GitHub secrets:
   base64 -i certificate.p12 | pbcopy

3. Get your signing identity name:
   security find-identity -v -p codesigning
   Copy the line starting with "Developer ID Application:"

4. Create app-specific password:
   → appleid.apple.com → Sign-In and Security
   → App-Specific Passwords → + Generate

5. Add GitHub Secrets (repo → Settings → Secrets):
   APPLE_CERTIFICATE       (base64 from step 2)
   APPLE_CERTIFICATE_PASSWORD (p12 password)
   APPLE_SIGNING_IDENTITY  (full string from step 3)
   APPLE_ID                (your@apple.com)
   APPLE_PASSWORD          (app-specific password)
   APPLE_TEAM_ID           (10-char code from developer.apple.com)

### Testing Unsigned (Development)
cd apps/desktop && npm run dev
Opens window loading taproot-pos.com.
No signing needed for local dev.

npm run build (without secrets) creates
an unsigned .dmg — shows warning on install
but works for testing.

## Windows Code Signing

### Option A: Azure Trusted Signing (Recommended)
Free tier available. Removes SmartScreen warnings.
→ portal.azure.com → Azure Trusted Signing
Add secrets: AZURE_TENANT_ID, AZURE_CLIENT_ID,
             AZURE_CLIENT_SECRET

### Option B: No Signing (for now)
Users see SmartScreen: "Windows protected your PC"
They click "More info" → "Run anyway"
Acceptable for beta/testing.
Add signing before public launch.

## Triggering a Release

Push a version tag:
git tag desktop-v1.0.0
git push --tags

GitHub Actions automatically:
1. Builds macOS universal binary
2. Builds Windows installer
3. Creates draft GitHub release
4. Attaches .dmg and .exe

Download artifacts, test install,
then publish the draft release.

## Distribution URLs (after first release)

taproot-pos.com/download/mac → redirects to:
github.com/JakeCastillo-sudo/Taproot/releases/
  latest/download/taproot-pos.dmg

taproot-pos.com/download/win → redirects to:
github.com/JakeCastillo-sudo/Taproot/releases/
  latest/download/taproot-pos-setup.exe

These redirects are already configured in the API.

> ⚠️ **Asset-name caveat:** Tauri's default bundle names are like
> `Taproot POS_1.0.0_universal.dmg` and `Taproot POS_1.0.0_x64-setup.exe`, which do
> NOT match the `taproot-pos.dmg` / `taproot-pos-setup.exe` names the API redirects
> expect. Before publishing a release, rename the assets (or add a rename step to the
> CI release job) so the `/download/mac` and `/download/win` redirects resolve.
