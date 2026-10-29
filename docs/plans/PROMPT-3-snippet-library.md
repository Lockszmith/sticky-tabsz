# Implementation Prompt 3: Predefined + user snippet library for the Run JavaScript action

Copy everything below the line into a new agent.

---

You are implementing a new feature in the **Sticky TabSZ** Firefox extension. Working directory: `c:\_\Code\sticky-tabsz`

## Project context
- Plain-JS Firefox WebExtension, **Manifest V2**, no bundler. Source in `xpi.src/`: `background.js`, `popup.html/js/css`, `options.html/js/css`, `manifest.json`.
- Rules: `{id, enabled, name, containerSeparation, stickyPatterns[], matchPatterns[], description, action?, actionScript?, snippetId?}` stored under `rules` (local or sync per `settings.useSync`).
- The **run-javascript action** exists on branch `feature/run-javascript-action` (merge/rebase it into your branch first — you depend on its wrapper contract): `browser.tabs.executeScript` in the sticky tab with an async-IIFE wrapper defining `const url = <destination URL>` (JSON-stringified). Wrapper must NOT add `'use strict'` (sloppy mode required). `resolveRuleScript(rule)` in background checks `snippetId` first, then `actionScript`.
- Workflow: new branch `feature/snippet-library` from `dev` + `feature/run-javascript-action`. Small conventional commits. Do NOT change manifest version. Do not push/merge/PR.
- Read all files in `xpi.src/` plus the run-javascript branch diff before coding.

## Feature: snippet library
The Run JavaScript action can pick a **snippet** from a library instead of typing inline code:
- **User-defined snippets** are fully synchronized (stored under key `snippets` in sync storage when `useSync` on; local otherwise; migrated by `handleSyncToggle` alongside rules).
- **Predefined snippets** ship inside the extension (file `xpi.src/snippets/builtin.js`) and are NEVER synced — so extension upgrades can update the predefined set.
- Predefined snippets can be **cloned** into user-defined snippets and edited.
- Editing/creating a snippet opens a **syntax-highlighted editor modal** (popup control, not a bare textarea).
- Rules reference snippets via `rule.snippetId`; background resolves builtin snippets from the bundled set and user snippets from storage. Resolution order: user snippet by id → builtin snippet by id → `actionScript` → treat as reload with `log()` warning.

## Required design
- **Data model — user snippet** (key `snippets`, array):
  `{ "id": "usr-<timestamp>-<rand>", "name": "...", "description": "...", "code": "...", "clonedFrom": "sys-<id>" | null, "builtinVersion": "<ext version at clone time>" | null, "createdAt": 0, "updatedAt": 0 }`
  Builtin ids are namespaced `sys-<slug>` so they can never collide with `usr-` ids.
- **Builtin file** `xpi.src/snippets/builtin.js`: a plain script defining `window.StickyTabSZBuiltins = [ {...snippet objects with id:'sys-...', builtin:true} ]`, loaded via `<script>` in `options.html` AND imported logically into background.js (MV2 background scripts array — add `"snippets/builtin.js"` before `"background.js"` in manifest `background.scripts`, assigning a global the background can read).
- **Editor: ACE** (vendored from `ace-builds` npm package, current release ~1.45.x, Oct 2026, BSD-3-Clause, 15+ years old, industry standard). Rationale: only candidate that is actively released AND vendorable as static files with no build system (CodeMirror 6 is ESM-only with no single-file build; CodeMirror 5 last released ~Jan 2026 — fails the 4–6 month recency bar; Monaco is far too heavy). Vendor the minimal mode: `xpi.src/vendor/ace/ace.js` (or `src-min`), plus `mode-javascript.js` if not bundled, plus LICENSE file. If the download is impossible in your environment, stop after the non-editor commits and leave exact fetch instructions — say so clearly.
- **Editor modal:** `<dialog>` (or fixed-position div) in `options.html`, dark/consistent with `options.css` tokens, ACE instance with JS highlighting, Save/Cancel buttons, name+description fields, 6KB per-snippet code cap (sync quota safety) with clear error.
- **Options page — new "Snippets" tab** in the existing tab strip (rules/settings tabs exist; support `#snippets` hash like existing tabs): two groups, "Predefined" (read-only cards with Preview + "Clone" buttons) and "My snippets" (cards with Edit/Delete). Deleting a snippet referenced by rules shows a warning naming the rules; rule cards show a "missing snippet" chip if `snippetId` doesn't resolve.
- **Rule card integration:** in the advanced-action section, a `<select class="rule-snippet">` grouped optgroups: "Predefined" (sys-*), "My snippets" (usr-*), plus options "Inline code" (uses `actionScript`) and "None". Picking a snippet sets `rule.snippetId` and hides/keeps the inline textarea accordingly. Validation warns on save if snippetId unresolvable.
- **Export/import:** add `snippets` (user only) to the export payload; import merges by id, imported wins only if `updatedAt` newer; never import over builtin ids. `handleSyncToggle` migrates `snippets` together with `rules`.
- **Sync quota:** if serialized `snippets` exceeds ~90KB when useSync is on, block save with a clear message.

## The four predefined snippets (code must remain runnable inside the async-IIFE wrapper where `url` is defined; keep verbatim semantics)
1. `sys-salesforce-lightning-link-grabber` — "Salesforce Lightning Link Grabber" — description: navigates a Salesforce Lightning sticky tab via Aura event instead of reloading:
   ```js
   if(!url) return;
   u=url;
   try {
     var x=new URL(u);
     u=x.pathname+x.search+x.hash
   } catch(e) {
   }
   var ev=$A.getEvt("markup://force:navigateToURL");
   ev.setParam("url",u);
   ev.fire();
   ```
   Note: `$A` lives in the page's Xray-protected world — access via `window.wrappedJSObject.$A` (Firefox-specific; this extension is Firefox-only). Guard: if `$A` is unavailable, log and return cleanly.
2. `sys-log-url` — "Log destination URL": `console.log('[Sticky TabSZ] destination:', url);`
3. `sys-log-url-and-load` — "Log destination URL and Load": log the URL, then `location.href = url;` (performs the load from inside the script).
4. `sys-copy-url` — "Copy destination URL": copy `url` to clipboard via `navigator.clipboard.writeText(url)` with `try/catch` + `console.warn` fallback; description must note clipboard writes can fail without a user gesture.

## Suggested commits
1. `chore(vendor): vendor ACE editor + LICENSE` (run lint early; pin previous ACE release if web-ext lint errors)
2. `feat(snippets): builtin snippet definitions (snippets/builtin.js) + manifest wiring`
3. `feat(background): user-snippet loading + snippetId resolution + fallback`
4. `feat(options): Snippets tab (list, clone, delete w/ referenced-by warning)`
5. `feat(options): ACE editor modal (create/edit/preview)`
6. `feat(options): rule-card snippet dropdown + inline-code integration`
7. `feat(options): sync migration + export/import for snippets`
8. `docs: release notes + AMO reviewer note for vendored ACE`

## Verification (do all, report results)
- Load `xpi.src/` via `about:debugging`. Test: Snippets tab renders 4 builtins; clone → editable copy under My snippets; ACE modal works (type/undo/highlight); rule wired to `sys-log-url` logs on triggered navigation; user snippet executes; missing snippet falls back with warning logged (debugLogging on); delete shows referenced-by warning; export/import round-trips snippets; sync toggle migrates snippets.
- `wsl bash scripts/test-build.sh` must pass; `wsl bash build.sh --lint-only` — watch for lint on vendored ACE (warnings OK, errors must be fixed).
- Report changes, test results, ACE version+release date you vendored, and any deviations.
