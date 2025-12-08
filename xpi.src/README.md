# Sticky TabSZ

**Firefox/Zen Extension to prevent tabs from multiplying like rabbits** 🐰

## What It Does

When you open a link matching the configured pattern, the extension will:

1. **If a matching tab already exists** → Close the new tab, update the existing tab with the new URL, and focus it
2. **If no matching tab exists** → The new tab becomes the sticky tab for that container

This prevents tab clutter when repeatedly opening links to the same type of page.

<div align="center">
<a href="images/SCREENSHOTS.md"><img src="images/20251206-Scr02-Rules.png" width="320" alt="Click for more screenshots"></a>
</div>

📸 [All Screenshots](images/SCREENSHOTS.md)

## Features

- **Configurable Rules** — Create rules with regex patterns for any site
- **Quick Rule Creation** — Click the toolbar icon to create a rule for the current page
- **Multi-Account Container support** — Each container gets its own independent sticky tab
- **SPA-aware** — Handles single-page app navigation (like Salesforce Lightning)
- **Redirect-aware** — Works with SSO redirects and other redirect chains
- **Sync Support** — Rules are synchronized over Firefox Sync (can be disabled)
- **Import/Export** — Backup/Restore rules and settings from file.

## Installation

Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/sticky-tabsz/) (Currently in review)

### Temporary (Development)

1. Clone git repo.
2. Open `about:debugging` in Firefox/Zen
3. Click **"about:debugging#/runtime/this-firefox"** (or "This Zen")
4. Click **"Load Temporary Add-on..."**
5. Select the `manifest.json` file from `xpi.src` directory

## Usage

1. Click the **Sticky TabSZ** icon in the toolbar
2. If the current page matches a rule, you'll see the rule name
3. If not, click **"Create Rule..."** to auto-generate a rule for this site
4. Customize the pattern and save

## Links

- **Firefox Add-ons:** https://addons.mozilla.org/en-US/firefox/addon/sticky-tabsz/
- **Homepage:** https://code.lksz.me/lksz/sticky-tabsz
- **Issues:** https://code.lksz.me/lksz/sticky-tabsz/issues
- **Community:** https://github.com/Lockszmith/sticky-tabsz/discussions
- **Buy Me a Coffee:** https://studio.buymeacoffee.com/dashboard

## License

[Unlicense](LICENSE) (Public Domain)
