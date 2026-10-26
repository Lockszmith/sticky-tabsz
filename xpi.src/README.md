# Sticky TabSZ

**Firefox/Zen Extension to prevent tabs from multiplying like rabbits** 🐰

## What It Does

When you open a link matching the configured pattern, the extension will:

1. **If a matching tab already exists** → Close the new tab, update the existing tab with the new URL, and focus it
2. **If no matching tab exists** → The new tab becomes the sticky tab for that container

This prevents tab clutter when repeatedly opening links to the same type of page.


|                                📸 [All Screenshots](docs/SCREENSHOTS.md)                                 |
| :------------------------------------------------------------------------------------------------------: |
| [![Click for more screenshots](/docs/images/20251206-Scr01-CreateRule.png)](docs/SCREENSHOTS.md#rules-editing) |

## Features

- **Configurable Rules** — Create rules with regex patterns for any site
- **Quick Rule Creation** — Click the toolbar icon to create a rule for the current page
- **Run JavaScript Action** — Optionally run your own script in the sticky tab (destination URL available as `url`) instead of reloading it
- **Multi-Account Container support** — Each container gets its own independent sticky tab
- **SPA-aware** — Handles single-page app navigation (like Salesforce Lightning)
- **Redirect-aware** — Works with SSO redirects and other redirect chains
- **Sync Support** — Rules are synchronized over Firefox Sync (can be disabled)
- **Per-Rule Local Override** — When sync is on, uncheck "Sync this rule" on any rule to keep edits on this device only; re-syncing a rule that changed on both sides offers a Keep Local / Keep Remote / Cancel choice
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

### Run JavaScript Action

For each rule, under **Advanced: Action**, you can choose what happens when a
matching URL is redirected to its sticky tab:

- **Reload sticky tab with URL (default)** — the sticky tab navigates to the new URL
- **Run JavaScript in sticky tab** — the sticky tab stays as-is and your script runs instead

Inside the script:

- `url` — the destination URL that would have been loaded
- `await` is supported (the script runs inside an async function)
- Runs in the top frame of the sticky tab as a **content script** (not subject to the page's CSP). Page globals (for example Salesforce `$A`) are in scope directly, so snippets behave like bookmarklets:

```js
// works exactly as it would in a bookmarklet:
var ev = $A.getEvt("markup://force:navigateToURL");
```

Example (SPA-friendly navigation without a reload):

```js
console.log('sticky target:', url);
document.title = 'STICKY: ' + new URL(url).pathname;
history.replaceState(null, '', new URL(url).pathname + new URL(url).search);
```

If the script throws or rejects, Sticky TabSZ opens a small prompt with the
error and lets you **reload the sticky tab**, **keep the URL in the new tab**
(with sticky temporarily bypassed for that tab), or **cancel**. The script is
checked for syntax errors (via the bundled [Acorn](https://github.com/acornjs/acorn)
parser) before you can save.

## Links

- **Firefox Add-ons:** https://addons.mozilla.org/en-US/firefox/addon/sticky-tabsz/
- **Homepage:** https://code.lksz.me/lksz/sticky-tabsz
- **Issues:** https://code.lksz.me/lksz/sticky-tabsz/issues
- **Community:** https://github.com/Lockszmith/sticky-tabsz/discussions
- **Buy Me a Coffee:** https://studio.buymeacoffee.com/dashboard

## License

[Unlicense](LICENSE) (Public Domain)
