# Sticky TabSZ

A Firefox/Zen browser extension that keeps specific URLs in a single "sticky" tab per container.

## What It Does

When you open a link matching the configured pattern, the extension will:

1. **If a matching tab already exists** → Close the new tab, update the existing tab with the new URL, and focus it
2. **If no matching tab exists** → The new tab becomes the sticky tab for that container

This prevents tab clutter when repeatedly opening links to the same type of page.

## Features

- **Multi-Account Container support** — Each container gets its own independent sticky tab
- **SPA-aware** — Handles single-page app navigation (like Salesforce Lightning)
- **Redirect-aware** — Works with SSO redirects and other redirect chains

## Current Configuration

- **Pattern:** `https://vastdata.lightning.force.com/lightning/*/Case/*`
- **Use case:** Salesforce Case pages

## Installation

1. Open `about:debugging` in Firefox/Zen
2. Click **"This Firefox"** (or "This Zen")
3. Click **"Load Temporary Add-on..."**
4. Select the `manifest.json` file from this directory

## Files

- `manifest.json` — Extension configuration and permissions
- `background.js` — Core sticky tab logic
- `LICENSE` — Unlicense (public domain)

## Author

Lockszmith
