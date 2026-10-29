# Implementation Prompt 4: Prompt for Redirection (disabled / auto / always)

Copy everything below the line into a new agent.

---

You are implementing a new feature in the **Sticky TabSZ** Firefox extension. Working directory: `c:\_\Code\sticky-tabsz`

## Project context
- Plain-JS Firefox WebExtension, **Manifest V2**, no bundler. Source in `xpi.src/`: `background.js`, `popup.html/js/css`, `options.html/js/css`, `manifest.json` (`strict_min_version: 142`).
- Rules: `{id, enabled, name, containerSeparation, stickyPatterns[], matchPatterns[], description}` under `rules` (local or sync per `settings.useSync`). Settings: `{debugLogging, focusStickyTab, useSync}` under `settings` (always local).
- `background.js` `handleNavigation()`: on `webNavigation.onCompleted`/`onHistoryStateUpdated` (frameId 0), matches rule, `findExistingStickyTab()` picks ONE sticky tab per rule+container (Map `stickyTabsByRule`), then `tabs.update(stickyTab.id,{url})`, removes incoming tab, focuses per `settings.focusStickyTab`.
- A sibling feature (branch `feature/run-javascript-action`) adds `rule.action: 'reload'|'script'` executed in the target tab. Integrate via a single seam (below) so both compose; if that branch is not available, code the seam against current reload behavior.
- Workflow: new branch `feature/redirect-prompt` from `dev`. Small conventional commits. No manifest version change, no push/merge/PR.
- Read all `xpi.src/` files before coding.

## Feature: redirection prompt
Three modes — **disabled** (exact current behavior), **auto** (DEFAULT; prompt only when >1 candidate sticky tab exists), **always** (prompt even with 1 candidate). The prompt lists every candidate sticky tab (title, created time, last refreshed time) plus "Open in a new tab". Global default lives in settings (syncable; with a local-only override for this client). Per-rule value overrides the global.

## Required design (follow this)
- **Prompt UI:** a small popup-type extension window via `browser.windows.create({ url: 'prompt.html#<promptId>', type: 'popup', width: 420, height: min(120 + 64*candidates, 480), left/top, focused: true })`. Position centered over the window of the **incoming tab** (read `browser.windows.get(tab.windowId)`; clamp to screen). This is the chosen mechanism because `browserAction.openPopup` from background only works without a user gesture since Firefox 149, and min version is 142. No new permissions (`windows` needs none). If `windows.create` fails, fall back silently to current redirect behavior + `log()`.
- **Candidates:** refactor `findExistingStickyTab` to extract `getCandidateStickyTabs(rule, cookieStoreId, excludeTabId)` returning ALL tabs matching `rule.stickyPatterns` (filtered by `cookieStoreId` only when `rule.containerSeparation`), excluding the incoming tab. `findExistingStickyTab` becomes a thin wrapper preserving today's priority logic (disabled mode = bit-identical behavior).
- **Mode resolution — new `resolvePromptMode(rule)`:** `rule.redirectPrompt !== 'default' ? rule.redirectPrompt : effectiveGlobal` where effectiveGlobal = local override (if `settings.redirectPromptLocalOnly`) else `settings.redirectPromptMode`. Defaults when absent: rule field `'default'`, global `'auto'` — fully backward compatible.
- **Settings additions:** `settings.redirectPromptMode: 'disabled'|'auto'|'always'` (default `'auto'`), `settings.redirectPromptLocalOnly: boolean` (default `false`). When localOnly is true, the client's value is stored in a local-storage key `settingsOverrides: { redirectPromptMode }` and the synced value is ignored on this client (aligned with the local-override architecture of the sibling local-toggles feature; if that branch exists, reuse its helpers/keys).
- **Timestamps (best-effort, MDN-verified):** `tabs.Tab` has NO `createdAt`; it HAS `lastAccessed` (ms epoch). Track:
  - `createdAt`: new `tabs.onCreated` listener → `tabMeta` map + debounced persist to `storage.local` key `tabMeta` (`{ [tabId]: { createdAt, lastRefreshed } }`). Pre-existing tabs after (re)start show "unknown" — acceptable; on `init()` clear persisted `tabMeta` (tabIds are session-scoped).
  - `lastRefreshed`: stamp `Date.now()` in `handleNavigation` for every top-level event (before early returns). Fallback display uses `tab.lastAccessed` labeled approximately.
  - Clean entries in `handleTabRemoved`.
- **Pending prompt state machine (background, in-memory `Map<promptId, record>`):** record = `{promptId, ruleId, containerKey, incomingTabId, incomingUrl, candidates[], windowId, state}`. States: open → answered | cancelled. **Incoming tab stays open** while pending (move the `tabs.remove` into the choice handler). Cancel (prompt window closed via `windows.onRemoved`, or Cancel button, or Esc) = keep incoming tab as-is, no redirect. Incoming tab closed by user → auto-close prompt window, drop record. Coalesce: one prompt per rule+containerKey — a newer navigation replaces the pending one (update URL/candidates in place via `runtime.sendMessage` push to the prompt page; close the superseded incoming tab). Different rules → separate stacked windows (offset cascade, cap 3, overflow falls back to legacy redirect + log).
- **Messaging:** `runtime.onMessage` handlers: `getPromptData` (returns fresh snapshot: rule name, incoming URL/title, candidates with live `tabs.get` title + tabMeta timestamps + `isStoredSticky` flag — background is source of truth), `promptChoice` (`{kind:'tab', tabId}` | `{kind:'newTab'}` | `{kind:'cancel'}`), plus push message `promptUpdated` to the page. Prompt page (`prompt.html/js/css`, new files, vanilla JS, styling consistent with `options.css`): renders header (rule name + incoming URL), candidate rows (title; "Created: <time|unknown>"; "Last refreshed: <relative time>"; "★ current" badge for stored sticky; container label when separated), "Open in a new tab" button, Cancel. Keyboard: arrows + Enter + Esc. Use `Intl.RelativeTimeFormat`/`toLocaleString` — no libraries.
- **Choice dispatch — single seam `applyRedirect(rule, targetTab, incomingTabId, incomingUrl, containerKey)`:** navigate/execute the rule's action in the chosen tab (composes with run-javascript: `action==='script'` → execute script in target tab, else `tabs.update({url})`), close incoming tab (unless the choice IS the incoming tab), focus per `settings.focusStickyTab`, and register chosen tab in `stickyTabsByRule`. "Open in a new tab" = **keep the incoming tab** (it already holds the URL — do not create a second tab) and register it as sticky for the rule+container. Re-validate chosen tab liveness (`tabs.get` try/catch) before dispatch; on failure re-render prompt with updated candidates.
- **Options UI:** Settings tab: new group "Redirection Prompt" — `<select id="setting-redirect-prompt-mode">` (Disabled/Auto (recommended)/Always) + checkbox `#setting-redirect-prompt-local-only` ("Use my own setting on this device") + help text. Rule card: `<select class="redirect-prompt">` with Default (auto) / Disabled / Auto / Always; `createRuleWithData` seeds `'default'`; wire in `renderRule`/`setupCardEventListeners`; `loadSettings`/`saveSettings` handle the new settings.
- **Edge cases:** zero candidates → never prompt (existing no-sticky branch); `about:`/privileged URLs filtered defensively from candidates; incognito candidates only from same incognito-ness; discarded tabs listed with "(sleeping)" hint; background restart → prompt window detects dead promptId (background replies unknown) → shows "Stale prompt" and self-closes.

## Suggested commits
1. `feat(background): track tab created/lastRefreshed timestamps (tabMeta)`
2. `refactor(background): extract getCandidateStickyTabs + applyRedirect seam`
3. `feat(prompt): prompt.html/js/css chooser window + pending-prompt state machine`
4. `feat(background): wire modes into handleNavigation with coalescing`
5. `feat(options): global prompt setting + per-rule redirectPrompt select`
6. `docs: release notes entry`

## Verification (do all, report results)
- Load `xpi.src/` via `about:debugging`. Test matrix: disabled → no prompt, legacy; auto + 1 candidate → no prompt; auto + 2 candidates → prompt lists both with plausible timestamps + new-tab option; always + 1 → prompt; per-rule overrides global; cancel/close window → incoming tab stays; close incoming while pending → prompt auto-closes; choose a candidate closed meanwhile → inline re-render; double navigation same rule → coalesced; "Open in a new tab" keeps incoming tab and it becomes sticky; restart browser → no stale prompts, created shows unknown for old tabs; local-only toggle ignores synced value.
- `wsl bash scripts/test-build.sh` must pass; `wsl bash build.sh --lint-only` clean.
- Report changes, test results, and deviations.
