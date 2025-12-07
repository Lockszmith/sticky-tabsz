# Mozilla Add-ons (AMO) Submission Notes

Use this information when submitting to https://addons.mozilla.org/

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
**Why needed:** The extension needs to monitor navigation events on any website to detect when a URL matches a user-configured rule. Users define their own URL patterns, so the extension cannot know in advance which sites to request access for.

### `tabs`
**Why needed:** Required to query open tabs, close duplicate tabs, update tab URLs, and focus the sticky tab when redirecting.

### `webNavigation`
**Why needed:** Required to detect when navigation occurs (including SPA navigation via history state updates) and intercept it before duplicate tabs are created.

### `storage`
**Why needed:** Required to save user-configured rules and settings locally.

---

## Screenshots to Include

1. **Toolbar popup** - Showing rule name for matched site
2. **Toolbar popup** - Showing "Create Rule..." for unmatched site
3. **Options page** - Rules tab with a configured rule
4. **Options page** - Settings tab

---

## Submission Checklist

- [ ] Extension ZIP file created (exclude AMO_SUBMISSION.md)
- [ ] All files use UTF-8 encoding
- [ ] No minified code (AMO prefers readable source)
- [ ] manifest.json version matches submission
- [ ] Tested on Firefox 91+ (strict_min_version)
- [ ] Tested on Zen browser (optional)
- [ ] Screenshots prepared
- [ ] Developer account created on AMO

---

## Build and Package

Use the build script to update version, lint, and package:

```bash
./build.sh
```

The script will:
1. Prompt for version update (patch/minor/major/custom)
2. Run `web-ext lint` to validate
3. Create ZIP in `_build/sticky-tabsz-v{VERSION}.zip`

### Manual Build (if needed)

```bash
cd xpi.src
npx web-ext lint
zip -r ../_build/sticky-tabsz-v0.1.6.zip . -x ".DS_Store" -x "*.git*"
```

