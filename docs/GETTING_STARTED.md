# Getting started

A 10-minute path from install to your first produced scene. Everything below runs locally — your
storyboards, scripts, audio, and provider metadata stay on the device.

> Prefer video-style walkthrough? The same flow is available inside the app: a welcome tour on first
> launch plus a live checklist on the Dashboard that ticks itself off as you complete each step.
> Reopen both any time from **Settings → About → Onboarding**. The interface is available in
> **English** and **Bahasa Indonesia** (Settings → General → Language).

## 1. Install

- **Windows**: NSIS installer (WebView2 required, usually preinstalled).
- **Linux**: `.deb` package or AppImage (WebKitGTK 4.1 and a Secret Service such as
  `gnome-keyring` required).
- **Android**: signed APK (arm64). Provider webview sign-in, in-app updates, and background
  execution are desktop-only.

## 2. Activate the license

The workspace opens on the license gate:

1. Open <https://license.bits.co.id/user/device-link> and sign in.
2. Copy the 8-character pairing code.
3. Paste it in the app and choose **Connect**.

Expired license? Renew in BITS License Manager, then **Try again** in the app.

## 3. Pick your language and theme

**Settings → General**: choose Dark / Light / System theme and switch language. Changes apply
immediately and are stored on the device.

## 4. Connect AI + voiceover keys (optional but recommended)

1. **Settings → Integrations**: set an OpenAI-compatible chat endpoint + model (`ai_endpoint`,
   `ai_model`) and, for audio, the speech endpoint/model/voice/format/speed.
2. **Settings → Secrets**: store `ai.api_key` (and `tts.api_key`; it falls back to `ai.api_key`).
   Secrets live in the OS keyring, never in the database.

Without keys you can still storyboard and preview voiceover with the browser speech engine.

## 5. Add a provider account

**Accounts → Add provider account**: pick the provider, fill in the metadata you want to track,
then open the isolated provider session and sign in. Each provider gets its own profile; passwords
and session cookies are never written to the database.

## 6. Create your first storyboard

**Storyboards → New storyboard**: title, logline, visual style, aspect ratio. Then add scenes and
shots — prompts, camera notes, dialogue, transitions, durations. Runtime totals update live.
Export a Markdown brief or JSON snapshot from the detail view at any time.

## 7. Generate voiceover

**Voiceover**: pick a storyboard and scene, write the script, tune voice/rate/pitch/volume, and
preview with system speech. For a downloadable track, generate audio through your TTS provider and
save it — the audio reference stays attached to the scene.

## 8. Reuse prompts, try automation

- **Prompts**: save recurring prompts with category, pin, and color.
- **Automations**: build a workflow (HTTP, delay, log, account check, condition, template, retry)
  with a manual or cron trigger. Watch it in **Runs**, debug in **Logs**.

## 9. Keep it healthy

- **Settings → Data**: backup, verify, and staged-restore your database.
- **Settings → Integrations**: optional loopback local API (bearer token in the keyring), proxy,
  update check.
- **Logs** are auto-redacted and pruned by retention (Settings → General).

## Where to go next

- Feature inventory and platform support: `docs/FEATURE_INVENTORY.md`
- Localization details and translator glossary: `docs/I18N.md`
- Security model: `SECURITY.md`
