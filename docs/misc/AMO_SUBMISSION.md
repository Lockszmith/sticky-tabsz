# Mozilla Add-ons (AMO) Submission Notes

Use this information when submitting to https://addons.mozilla.org/

**Submit the public flavor only.** The unlisted package (custom JavaScript / full snippet library) is for direct distribution and must not be uploaded to the public listing.

---

## Basic Information

**Name:** Sticky TabSZ

**Summary (250 chars max):**
```
Prevent tabs from multiplying like rabbits.<br/> Prevent tab clutter by keeping specific URLs in a single "sticky" tab. Create rules with regex patterns. Supports Firefox Multi-Account Containers.
```

**Description:**
```
# Sticky TabSZ

**Keep tabs from multiplying like rabbits!** 🐰

When you repeatedly open links to the same site (like Salesforce cases, Jira tickets, or GitHub issues), tabs can quickly pile up. Sticky TabSZ solves this by keeping specific URLs in a single "sticky" tab.

## How It Works

1. Create a rule with a URL pattern (regex)
2. When you open a link matching that pattern:
   - If a sticky tab already exists → Updates that tab and closes the new one
   - If no sticky tab exists → The new tab becomes the sticky tab

## Features

✅ **Configurable Rules** — Create rules with regex patterns for any site
✅ **Salesforce Lightning Link Grabber** — Optional reviewed JavaScript action that navigates Lightning via Aura instead of reloading
✅ **Close protection** — Optionally restore sticky tabs closed individually
✅ **Multi-Account Containers** — Each container gets its own sticky tab
✅ **SPA Support** — Works with single-page apps like Salesforce Lightning
✅ **SSO Redirect Support** — Handles authentication redirects (JumpCloud, Okta, etc.)
✅ **Quick Rule Creation** — Click the toolbar icon to auto-generate a rule
✅ **Import/Export** — Backup and share your rules

## Use Cases

- Salesforce case management
- Jira/GitHub issue tracking
- Documentation wikis
- Any site where you want to prevent duplicate tabs

## Privacy

- No data collection or tracking
- All data stored locally in your browser
- Open source: https://code.lksz.me/lksz/sticky-tabsz
```

---

## Categories

- **Primary:** Tabs
- **Secondary:** Productivity

---

## Tags

`tabs`, `tab-management`, `containers`, `multi-account-containers`, `productivity`, `salesforce`, `sticky-tab`

---

## Support Information

- **Homepage:** https://code.lksz.me/lksz/sticky-tabsz
- **Community:** https://github.com/Lockszmith/sticky-tabsz/discussions
- **Support Email:** sticky-tabsz () mail domain

---

## Permissions Justification

When AMO asks about permissions, use these explanations:

### `<all_urls>`
**Why needed:** The extension needs to monitor navigation events on any website to detect when a URL matches a user-configured rule. Users define their own URL patterns, so the extension cannot know in advance which sites to request access for. Host access also covers injecting the reviewed Salesforce Lightning Link Grabber content script when a rule selects that action.

### `tabs`
**Why needed:** Required to query open tabs, close duplicate tabs, update tab URLs, focus the sticky tab when redirecting, and run the optional reviewed Salesforce snippet via `tabs.executeScript`. The extension does not close a tab that is currently the sticky tab for a rule.

### `webNavigation`
**Why needed:** Required to detect when navigation occurs (including SPA navigation via history state updates) and intercept it before duplicate tabs are created.

### `storage`
**Why needed:** Required to save user-configured rules and settings. When the user turns on Firefox Sync in the extension, rules and the sticky close-protection default are stored in `browser.storage.sync`. Other settings stay on the device. (The public package does not offer user-authored snippets.)

### `sessions`
**Why needed:** Firefox has no cancelable "tab is about to close" event. If a protected sticky tab is closed on its own (the user, the page, or other code), the extension immediately restores that tab with `sessions.restore`, including its back/forward history. Closing the window, or quitting Firefox, is not undone (`tabs.onRemoved` reports `isWindowClosing`).

---

## JavaScript execution (for AMO reviewers) — public package

The **public** ZIP submitted to AMO does **not** allow custom JavaScript, snippet cloning, or a user snippet library.

Rules may optionally select a **Run JavaScript** action that runs only the predefined **Salesforce Lightning Link Grabber** snippet (`sys-salesforce-lightning-link-grabber`), shipped in `snippets/builtin.js` and reviewed with this add-on. It is injected via `browser.tabs.executeScript` (top frame, content-script world). Content scripts are not subject to the page's CSP. Page globals (Salesforce `$A`) are bridged via Firefox's `window.wrappedJSObject` (a `with` block in the injected wrapper).

**No remote code is involved. No user-authored code is executed.**

Please note:

- `flavor.js` in the public package sets `allowCustomJavaScript: false` and
  `allowedBuiltinIds: ['sys-salesforce-lightning-link-grabber']`.
- Background resolution refuses user snippets (`usr-*`), legacy inline
  `actionScript` fields, and any builtin outside that allowlist. Missing or
  disallowed snippets fall back to a normal sticky-tab reload.
- The Options UI does not offer New snippet / Clone / My snippets, and does not
  ship the ACE editor or Acorn parser.
- Import of a backup that contains custom snippets skips those snippets and
  clears disallowed script references on rules.
- The destination URL is injected into the wrapper via `JSON.stringify` — it is
  never concatenated raw into script source.
- If the reviewed snippet throws or rejects, a small prompt offers Reload sticky
  tab / Keep in new tab / Cancel — navigation is never silently lost.
- Injection uses the MV2 `tabs.executeScript` `code` option (no `eval` /
  `new Function` in the extension's own scripts). The extension CSP is
  unchanged: no `'unsafe-eval'`.

Host access is already granted by `<all_urls>`; no extra `scripting` permission
is required for this path.

### Unlisted package (not for AMO public listing)

The unlisted build (`sticky-tabsz-*-unlisted.zip`, id
`sticky-tabsz-unlisted@code.lksz.me`) keeps the full snippet library, user
snippets, cloning, ACE, and Acorn. Do **not** upload that ZIP to the public
AMO listing. It is for direct distribution only.

---

## Screenshots to Include

1. **Toolbar popup** - Showing rule name for matched site
2. **Toolbar popup** - Showing "Create Rule..." for unmatched site
3. **Options page** - Rules tab with a configured rule
4. **Options page** - Settings tab

---

## Submission Checklist

- [ ] **Public** flavor ZIP only (`sticky-tabsz-v{VERSION}.zip` — not `-unlisted`)
- [ ] Prefer the zip from the Forgejo Release for the version tag (see Build and Package)
- [ ] Confirm the zip has **no** `vendor/ace/`, **no** `lib/acorn*`, and `flavor.js` with `allowCustomJavaScript: false`
- [ ] `web-ext lint --warnings-as-errors` clean on the public package (build.sh enforces this)
- [ ] All files use UTF-8 encoding
- [ ] No minified code in extension-authored files (public package has no ACE/Acorn)
- [ ] manifest.json version matches submission
- [ ] Tested on Firefox 142+ (`strict_min_version` in `xpi.src/manifest.json`)
- [ ] Tested on Zen browser (optional)
- [ ] Screenshots prepared
- [ ] Developer account created on AMO
- [ ] Listing description matches the **public** feature set (no custom JS / snippet library claims)

---

## Build and Package

### Preferred: Forgejo Release

After `dev` → `main` and a new `v*` tag push, the Release workflow builds both flavors and attaches them to the Forgejo Release. For AMO, download:

- **Public (submit this):** `sticky-tabsz-v{VERSION}.zip` — id `sticky-tabsz@code.lksz.me`
- **Unlisted (not for the public listing):** `sticky-tabsz-v{VERSION}-unlisted.zip`

### Local build

```bash
./build.sh --ci --flavor public
# → _build/sticky-tabsz-v{VERSION}.zip
# Public lint runs with --warnings-as-errors on the prepared public tree.
```

Interactive local packaging (`./build.sh`) defaults to the public flavor. Use `--flavor both` or `--flavor unlisted` when you need the unlisted id.

### Manual zip (if needed)

Do **not** zip `xpi.src/` by hand for AMO. Source includes unlisted tooling (ACE, full builtins). Always use `build.sh --flavor public` so flavor overlays and file stripping are applied.
