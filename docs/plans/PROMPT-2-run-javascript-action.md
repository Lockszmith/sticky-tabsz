# Implementation Prompt 2: Run JavaScript rule action

Copy everything below the line into a new agent.

---

You are implementing a new feature in the **Sticky TabSZ** Firefox extension. Working directory: `c:\_\Code\sticky-tabsz`

## Project context
- Plain-JS Firefox WebExtension, **Manifest V2**, no bundler/build system. All source is in `xpi.src/` and is zipped as-is: `background.js`, `popup.html/js/css`, `options.html/js/css`, `manifest.json`.
- Rules (key `rules` in `browser.storage.local` OR `browser.storage.sync` per `settings.useSync`): `{id, enabled, name, containerSeparation, stickyPatterns[], matchPatterns[], description}`.
- `background.js` `handleNavigation()`: on `webNavigation.onCompleted` / `onHistoryStateUpdated` (frameId 0), finds matching rule, finds sticky tab, then redirects via `browser.tabs.update(stickyTab.id, {url})`, closes the incoming tab, focuses sticky tab if `settings.focusStickyTab`.
- Workflow: new branch `feature/run-javascript-action` from `dev`. Small conventional commits. Do NOT change `manifest.json` version (leave 0.1.8). Do not push/merge/PR — product owner reviews first.
- Read `xpi.src/background.js`, `xpi.src/options.js`, `xpi.src/options.html`, `xpi.src/options.css` before coding.

## Feature: RUN JAVASCRIPT action
A rule may optionally execute user-provided JavaScript **in the existing sticky tab**, with the destination URL available as `url`, instead of reloading the sticky tab. Rules without a script keep today's reload behavior. The incoming tab is still closed and the sticky tab focused exactly as today.

## Required design (follow this)
- **Execution (MV2):** `browser.tabs.executeScript(stickyTab.id, { code: wrapper, runAt: 'document_idle' })` — top frame only (no `allFrames`). No new manifest permissions needed (`tabs` + `<all_urls>` already present). Do NOT add `'unsafe-eval'` CSP.
- **Wrapper (the `url` contract):**
  ```js
  function buildScriptWrapper(destUrl, userCode) {
    return `(async () => {\n  const url = ${JSON.stringify(destUrl)};\n${userCode}\n})();`;
  }
  ```
  - `JSON.stringify(destUrl)` — never concatenate the URL raw (it is not trusted input).
  - Async IIFE gives top-level `await` and turns errors/rejections into a rejected promise in the background.
  - Do NOT inject `'use strict'` into the wrapper — user snippets may rely on sloppy mode (e.g. implicit globals). Content scripts are not subject to page CSP, so this works on strict-CSP sites like Salesforce Lightning.
- **New optional rule fields (backward compatible; absent = legacy behavior):**
  - `action`: `'reload'` (default when absent) | `'script'`
  - `actionScript`: inline JS string, used when `action === 'script'`
  - `snippetId`: reserved for a later snippet-library feature; store `null` for now; a `resolveRuleScript(rule)` helper checks `snippetId` first (stub returns null for now), then `actionScript`, else returns null → treated as reload.
- **Dispatch in `handleNavigation`:** at the redirect branch:
  - `action === 'script'` and non-empty script → close the incoming tab FIRST (`browser.tabs.remove(tabId)`), then execute the script in the sticky tab; apply `settings.focusStickyTab` as today. On script failure (rejection), log via `log()` and **fall back to `browser.tabs.update(stickyTab.id, {url})`** so navigation is never lost.
  - **Duplicate-URL branch** (incoming URL equals sticky tab URL): also run the script (close + focus + execute) — re-triggering the same URL is a primary use case (e.g. re-clicking a link). Otherwise keep current close+focus behavior.
  - Else → current path verbatim.
- **New/modified background functions:** `buildScriptWrapper`, `resolveRuleScript`, `executeStickyScript(rule, stickyTab, destUrl, containerLabel)` (try/catch, returns boolean, includes a comment block explaining for AMO reviewers that the code originates solely from user input stored in the user's own extension storage — never fetched remotely), and extract a `closeAndFocus(tabId, stickyTab)` helper shared by both paths.
- **Options UI:** in `#rule-template`, after Match Patterns, add a collapsed `<details class="rule-advanced">` with:
  - `<select class="rule-action">`: `reload` → "Reload sticky tab with URL (default)", `script` → "Run JavaScript in sticky tab".
  - `<textarea class="rule-action-script" rows="8" spellcheck="false">` shown only when action is `script`, monospace, with help text: "Runs in the sticky tab. `url` = destination URL. Await supported. Top frame only."
- **Options.js:** `createRuleWithData` seeds `action: 'reload'`, `actionScript: ''`, `snippetId: null`; `renderRule` populates the controls; `setupCardEventListeners` wires them; `validateRules` blocks save when `action === 'script'` and script is empty.
- **Syntax validation:** Firefox MV2 extension CSP blocks `new Function()`. Vendor **Acorn 8.19.0** (MIT, released Oct 5, 2026; ~152M weekly npm downloads; industry-standard parser) as `xpi.src/lib/acorn.min.js` (~55KB), loaded by `<script>` in options.html only. Add `validateActionScript(code)` using `acorn.parse(code, {ecmaVersion: 'latest'})`; save-time errors show via existing `showSaveStatus()` with line/column; also add a debounced advisory `.invalid` outline while typing (non-blocking). If downloading acorn is not possible in your environment, leave a `xpi.src/lib/README.md` stub with exact fetch instructions and skip only the validation commits — say so clearly in your report.
- **CSS:** consistent with existing `options.css` tokens.
- **Export/import:** whole rule objects already round-trip; bump export payload `version` marker to `0.2.0`.

## Suggested commits
1. `feat(background): execute rule scripts in sticky tab via tabs.executeScript` (wrapper, resolve, executeStickyScript, dispatch, fallback)
2. `feat(options): per-rule action editor UI`
3. `feat(options): acorn syntax validation` (vendored lib + validation wiring)
4. `docs: README + AMO submission note (docs/misc/AMO_SUBMISSION.md) about user-authored code execution`

## Verification (do all, report results)
- Load `xpi.src/` via `about:debugging`. Test with a rule (sticky `^https://example\.org/app`, match same): script
  ```js
  console.log('sticky target:', url);
  document.title = 'STICKY: ' + new URL(url).pathname;
  history.replaceState(null, '', new URL(url).pathname + new URL(url).search);
  ```
  Confirm: no reload (marker log survives), incoming tab closed, focus per setting, title/URL change. Then test: async script with `await`; `throw new Error('boom')` → fallback reload happens; invalid syntax blocked on save; legacy rules unchanged; duplicate-URL click triggers script.
- Run `wsl bash scripts/test-build.sh` and `wsl bash build.sh --lint-only` (watch for lint complaints about the vendored acorn; if lint errors, use the unminified `acorn.js` instead).
- Report a summary of changes, test results, deviations, and the MV3-migration note (scripting.executeScript + `func`/`args`) left as a code comment above `buildScriptWrapper`.
