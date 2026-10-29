# Implementation Prompt 1: Local Toggles for Rules (per-rule sync override)

Copy everything below the line into a new agent.

---

You are implementing a new feature in the **Sticky TabSZ** Firefox extension. Working directory: `c:\_\Code\sticky-tabsz`

## Project context
- Plain-JS Firefox WebExtension, **Manifest V2**, no bundler/build system. All source is in `xpi.src/` and is zipped as-is: `background.js`, `popup.html/js/css`, `options.html/js/css`, `manifest.json`.
- Rules (key `rules` in `browser.storage.local` OR `browser.storage.sync` depending on `settings.useSync`): `{id, enabled, name, containerSeparation, stickyPatterns[], matchPatterns[], description}`.
- Settings (always local, key `settings`): `{debugLogging, focusStickyTab, useSync}`. `handleSyncToggle()` in `options.js` migrates rules between storages when useSync flips.
- `background.js` listens to `webNavigation.onCompleted` / `onHistoryStateUpdated`, matches rules, redirects to a sticky tab. `handleStorageChange` reloads rules on storage changes.
- Workflow rules: work on a new branch `feature/local-rule-toggles` cut from `dev`. Commit in small logical steps with conventional commit messages. Do NOT modify `manifest.json` version (leave at 0.1.8). Do not push/merge/PR — the product owner reviews first.
- Read `xpi.src/background.js`, `xpi.src/options.js`, `xpi.src/options.html`, `xpi.src/options.css`, `xpi.src/popup.js` before coding.

## Feature: per-rule LOCAL OVERRIDE of sync
When sync (`useSync`) is on:
1. Each rule card in the options page gets a **"Sync this rule"** toggle (checked = synchronized, unchecked = local override).
2. When local override is ON, edits to that rule are NOT written to the synced `rules` key — they stay on this device only.
3. When the user switches a rule BACK to synchronized and the remote copy differs from the local copy, show a **3-way modal** (not native `confirm()`): "Keep Local", "Keep Remote", "Cancel" (cancel reverts the toggle to local-override).
4. When sync is off entirely, hide the toggles (feature is a no-op).

## Required design (follow this)
- **Storage architecture — "placement defines state":**
  - Synced rules stay under `rules` in the sync storage (unmodified entries only).
  - New **local** storage key `localRules`: array of rule copies that are locally overridden (full rule objects).
  - New **local** storage key `overrideMeta`: `{ "[ruleId]": { "lastSyncedHash": "<sha-like string>" } }` — the canonical-JSON hash of the rule as last seen in sync, used to label conflicts as "changed remotely since override".
- **Effective rule set** (a new shared helper, e.g. `getEffectiveRules()` in background.js and an equivalent in options.js): when `useSync` is on, start from synced `rules`, then replace each rule whose id exists in `localRules` with the local copy. When off, today's behavior.
- **Hashing:** canonical JSON (`JSON.stringify` after sorting object keys) → simple string hash (FNV-1a or djb2 is fine). No external library.
- **Save path (options.js `saveRules`):** when sync on, split rules into synced part (write to sync `rules`) and overridden part (write to `localRules`); update `overrideMeta.lastSyncedHash` only for rules being written to sync.
- **Toggle-off flow:** moving a rule to local override = copy it into `localRules`, remove from synced set, record hash of the last synced copy in `overrideMeta`.
- **Toggle-on flow (conflict check):** compare local copy's hash to the synced copy's current hash AND to `lastSyncedHash`:
  - Remote unchanged since override → adopt local copy into sync (local wins silently).
  - Remote differs → 3-way modal: Keep Local (write local copy to sync), Keep Remote (discard local copy), Cancel (revert toggle).
- **Modal UI:** add a hidden modal `<div id="conflict-modal">` in `options.html` styled to match existing `options.css` design tokens, with the rule name, short diff summary (e.g. "Last synced: <date> · Remote changed: yes"), and three buttons. Promise-based `showConflictModal(rule, localCopy, remoteCopy)` helper.
- **Backward compatibility:** existing stored rules have no override state → all default to "synchronized". No migration needed; absence of `localRules`/`overrideMeta` keys = no overrides.
- **Background.js:** `loadRules()` must produce the effective rule set (synced rules overlaid with `localRules` overrides). Add a listener so changes to `localRules` in local storage also trigger a reload when `useSync` is on.
- **Bug fix (commit 1):** audit sync-storage reads. Known bug: `popup.js` reads rules from `browser.storage.local` unconditionally (line ~21) — it must respect `settings.useSync` (read settings first, then the right storage). Verify `background.js` handles this correctly already; fix only if broken.
- **Import/Export:** include `localRules` + `overrideMeta` in the export payload and restore them on import (merge, imported wins).

## Suggested commits
1. `fix(popup): read rules from the correct storage when sync is enabled` (plus any background sync-read fix if verified needed)
2. `feat(storage): localRules/overrideMeta data model + effective-rules resolution in background`
3. `feat(options): per-rule sync toggle UI + split save path`
4. `feat(options): 3-way conflict modal for re-sync with diverged remote`
5. `feat(options): include overrides in export/import; hide toggles when sync off`
6. `docs: README note for local override toggles`

## Verification (do all, report results)
- Load `xpi.src/` via `about:debugging` → temporary add-on. Walk through: sync on → override a rule → edit it → confirm sync `rules` untouched (inspect via Browser Console `browser.storage.sync.get('rules')`); re-enable sync with a diverged remote → modal appears with all three choices working; sync off → toggles hidden; existing rules behave as before.
- Run `wsl bash scripts/test-build.sh` (must pass) and `wsl bash build.sh --lint-only` (no lint errors).
- Report a summary of all changes with file paths, the test results, and anything you deviated from in this plan and why.
