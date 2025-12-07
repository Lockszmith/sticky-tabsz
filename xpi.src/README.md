# Sticky TabSZ

**Firefox/Zen Extension to prevent tabs from multiplying like rabbits** 🐰

## What It Does

When you open a link matching the configured pattern, the extension will:

1. **If a matching tab already exists** → Close the new tab, update the existing tab with the new URL, and focus it
2. **If no matching tab exists** → The new tab becomes the sticky tab for that container

This prevents tab clutter when repeatedly opening links to the same type of page.

## Features

- **Configurable Rules** — Create rules with regex patterns for any site
- **Multi-Account Container support** — Each container gets its own independent sticky tab
- **SPA-aware** — Handles single-page app navigation (like Salesforce Lightning)
- **Redirect-aware** — Works with SSO redirects and other redirect chains
- **Quick Rule Creation** — Click the toolbar icon to create a rule for the current page
- **Import/Export** — Backup and share your rules configuration
- **Debug Logging** — Optional console logging for troubleshooting

## Installation

### Temporary (Development)

1. Open `about:debugging` in Firefox/Zen
2. Click **"about:debugging#/runtime/this-firefox"** (or "This Zen")
3. Click **"Load Temporary Add-on..."**
4. Select the `manifest.json` file from this directory

### Permanent

Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/sticky-tabsz/)

## Usage

1. Click the **Sticky TabSZ** icon in the toolbar
2. If the current page matches a rule, you'll see the rule name
3. If not, click **"Create Rule..."** to auto-generate a rule for this site
4. Customize the pattern and save

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Extension configuration and permissions |
| `background.js` | Core sticky tab logic |
| `options.html/js/css` | Settings page UI |
| `popup.html/js/css` | Toolbar popup UI |
| `icons/` | Extension icons |
| `LICENSE` | Unlicense (public domain) |

## Links

- **Firefox Add-ons:** https://addons.mozilla.org/en-US/firefox/addon/sticky-tabsz/
- **Homepage:** https://code.lksz.me/lksz/sticky-tabsz
- **Issues:** https://code.lksz.me/lksz/sticky-tabsz/issues
- **Community:** https://github.com/Lockszmith-GH/sticky-tabsz/discussions
- **Buy Me a Coffee:** https://studio.buymeacoffee.com/dashboard

## Author

Lockszmith

## License

[Unlicense](LICENSE) (Public Domain)
