// Sticky TabSZ Extension
// Configurable sticky tab rules with Multi-Account Container support

// Current rules loaded from storage
let rules = [];

// User snippets from the same storage as rules (sync when useSync is on).
// Predefined snippets live on window.StickyTabSZBuiltins (snippets/builtin.js)
// and are never read from storage.
let userSnippets = [];

// Settings (always stored locally, never synced).
// The close-protection default is NOT in this object: it lives under the
// `protectStickyTabs` key in the same storage as rules (sync when useSync
// is on, local otherwise) so it follows Firefox Sync with the rules.
let settings = {
  debugLogging: false,
  focusStickyTab: true,
  useSync: false
};

// Missing `protectStickyTabs` means enabled. Explicit false turns it off.
let protectStickyTabs = true;

// Store sticky tab IDs: Map<ruleId, Map<containerId, tabId>>
// For rules with containerSeparation: each container gets its own sticky tab
// For rules without: containerId is always 'global'
const stickyTabsByRule = new Map();

// Tab IDs temporarily exempt from sticky redirection (e.g. user chose
// "load in new tab" after a script failure). Value = expiry timestamp.
const stickyBypassUntil = new Map();
const STICKY_BYPASS_TTL_MS = 5 * 60 * 1000;

// Pending script-error prompts: Map<promptId, record>
const pendingScriptErrors = new Map();
let scriptErrorPromptSeq = 0;

// Incoming tab IDs currently inside handleScriptAction (execute + prompt).
// Prevents onCompleted + onHistoryStateUpdated from racing past the pending map.
const scriptActionInFlight = new Set();

// Sticky tab IDs whose Run JavaScript action is in flight. History updates
// caused by that script must not replace or close these tabs.
const scriptStickyTargets = new Set();

// Tab objects passed into an in-flight script action, keyed by current id.
// Session restore assigns a new id; retargeting mutates the object so the
// in-flight action and error prompt follow the restored tab.
const liveStickyTabObjects = new Map();

// Last known url/window/index for sticky tabs, used to recognize the closed
// session when Firefox only notifies us after the tab is already gone.
const stickyCloseMeta = new Map();

// Caps session-restore loops if a page keeps calling window.close().
const stickyRestoreAttempts = new Map();

/**
 * Find an open script-error prompt for an incoming tab (at most one expected).
 */
function findOpenScriptErrorForTab(incomingTabId) {
  for (const record of pendingScriptErrors.values()) {
    if (record.incomingTabId === incomingTabId && record.state === 'open') {
      return record;
    }
  }
  return null;
}

/**
 * Debug logging helper
 */
function log(...args) {
  if (settings.debugLogging) {
    console.log('[Sticky TabSZ]', ...args);
  }
}

/**
 * Get the appropriate storage based on settings
 */
function getStorage() {
  return settings.useSync ? browser.storage.sync : browser.storage.local;
}

/**
 * Load settings from storage (always local)
 */
async function loadSettings() {
  try {
    const result = await browser.storage.local.get('settings');
    settings = result.settings || {
      debugLogging: false,
      focusStickyTab: true,
      useSync: false
    };
    await loadProtectStickyTabs();
    log('Settings loaded:', settings, 'protectStickyTabs:', protectStickyTabs);
  } catch (e) {
    console.error('[Sticky TabSZ] Failed to load settings:', e);
  }
}

/**
 * Load the close-protection default from the same storage rules use.
 * Absent key → enabled, so existing profiles protect sticky tabs until
 * the user turns the default off.
 */
async function loadProtectStickyTabs() {
  try {
    const result = await getStorage().get('protectStickyTabs');
    protectStickyTabs = typeof result.protectStickyTabs === 'boolean'
      ? result.protectStickyTabs
      : true;
  } catch (e) {
    console.error('[Sticky TabSZ] Failed to load close-protection default:', e);
    protectStickyTabs = true;
  }
}

/**
 * Canonical JSON: serialize with object keys sorted recursively,
 * so structurally identical rules always produce the same string.
 * (Mirrors canonicalize() in options.js.)
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonicalize(value[k]))
    .join(',') + '}';
}

/**
 * FNV-1a 32-bit string hash of a rule's canonical JSON.
 * (Mirrors hashRule() in options.js.)
 */
function hashRule(rule) {
  const str = canonicalize(rule);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Resolve the effective rule set when sync is enabled:
 * start from the synced rules, replace entries that have a local
 * override (same id in `localRules`), and append local-only rules
 * that exist only in `localRules` (e.g. newly created overrides).
 */
function resolveEffectiveRules(syncedRules, localOverrides) {
  const overrideMap = new Map(localOverrides.map(r => [r.id, r]));
  const effective = syncedRules.map(r => overrideMap.has(r.id) ? overrideMap.get(r.id) : r);
  // Local-only rules (created while overridden, never synced)
  const localOnly = localOverrides.filter(r => !syncedRules.some(s => s.id === r.id));
  return [...effective, ...localOnly];
}

/**
 * Load rules from storage (local or sync based on settings).
 * When sync is on, produces the effective rule set: synced rules
 * overlaid with locally overridden copies from `localRules`.
 */
async function loadRules() {
  try {
    if (settings.useSync) {
      const [syncResult, localResult] = await Promise.all([
        browser.storage.sync.get('rules'),
        browser.storage.local.get('localRules')
      ]);
      const syncedRules = syncResult.rules || [];
      const localOverrides = localResult.localRules || [];
      rules = resolveEffectiveRules(syncedRules, localOverrides).filter(r => r.enabled);
      log(`Loaded ${rules.length} enabled rule(s) from sync storage (${localOverrides.length} local override(s))`);
    } else {
      const storage = getStorage();
      const result = await storage.get('rules');
      rules = (result.rules || []).filter(r => r.enabled);
      log(`Loaded ${rules.length} enabled rule(s) from ${settings.useSync ? 'sync' : 'local'} storage`);
    }
    rules.forEach(r => log(`  - ${r.name}`));
    await loadSnippets();
  } catch (e) {
    console.error('[Sticky TabSZ] Failed to load rules:', e);
    rules = [];
  }
}

/**
 * User snippets share storage with rules. Builtin snippets are ignored if
 * they were ever written into storage — the bundled set is the source of truth.
 */
async function loadSnippets() {
  try {
    const result = await getStorage().get('snippets');
    const stored = Array.isArray(result.snippets) ? result.snippets : [];
    userSnippets = stored.filter(snippet =>
      snippet && typeof snippet.id === 'string' && snippet.id.startsWith('usr-') && snippet.builtin !== true
    );
    log(`Loaded ${userSnippets.length} user snippet(s) from ${settings.useSync ? 'sync' : 'local'} storage`);
  } catch (e) {
    console.error('[Sticky TabSZ] Failed to load snippets:', e);
    userSnippets = [];
  }
}

function getBuiltinSnippets() {
  if (typeof StickyTabSZBuiltins !== 'undefined' && Array.isArray(StickyTabSZBuiltins)) {
    return StickyTabSZBuiltins;
  }
  if (typeof window !== 'undefined' && Array.isArray(window.StickyTabSZBuiltins)) {
    return window.StickyTabSZBuiltins;
  }
  return [];
}

/**
 * First non-empty match: a user snippet with this id, else a builtin.
 * @returns {string|null}
 */
function lookupSnippetCode(snippetId) {
  const user = userSnippets.find(snippet => snippet.id === snippetId);
  if (user && typeof user.code === 'string' && user.code.trim() !== '') {
    return user.code;
  }
  const builtin = getBuiltinSnippets().find(snippet => snippet && snippet.id === snippetId);
  if (builtin && typeof builtin.code === 'string' && builtin.code.trim() !== '') {
    return builtin.code;
  }
  return null;
}

/**
 * Check if a URL matches any pattern in a list
 */
function matchesPatterns(url, patterns) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some(pattern => {
    try {
      return new RegExp(pattern).test(url);
    } catch (e) {
      console.warn(`[Sticky TabSZ] Invalid regex pattern: ${pattern}`);
      return false;
    }
  });
}

/**
 * Find which rule matches a URL and how
 * Returns: { rule, matchType: 'match' | 'sticky' } or null
 */
function findMatchingRule(url) {
  for (const rule of rules) {
    // Check match patterns first (if they exist)
    if (matchesPatterns(url, rule.matchPatterns)) {
      return { rule, matchType: 'match' };
    }
    // Then check sticky patterns
    if (matchesPatterns(url, rule.stickyPatterns)) {
      return { rule, matchType: 'sticky' };
    }
  }
  return null;
}

/**
 * Get the container key for a rule
 */
function getContainerKey(rule, cookieStoreId) {
  return rule.containerSeparation ? cookieStoreId : 'global';
}

/**
 * Get container label for logging
 */
function getContainerLabel(cookieStoreId) {
  if (cookieStoreId === 'global') return 'global';
  if (cookieStoreId === 'firefox-default') return 'default';
  return cookieStoreId.replace('firefox-', '');
}

/**
 * Get or create the sticky tabs map for a rule
 */
function getStickyTabsForRule(ruleId) {
  if (!stickyTabsByRule.has(ruleId)) {
    stickyTabsByRule.set(ruleId, new Map());
  }
  return stickyTabsByRule.get(ruleId);
}

/**
 * Every rule/container slot that currently points at this tab,
 * including rules that have since been disabled (those entries are only
 * used so a close can drop the stale id).
 */
function stickyRegistrationsForTab(tabId) {
  const found = [];
  for (const [ruleId, containerMap] of stickyTabsByRule.entries()) {
    for (const [containerKey, stickyId] of containerMap.entries()) {
      if (stickyId === tabId) found.push({ ruleId, containerKey });
    }
  }
  return found;
}

/**
 * Registrations whose rule is still enabled. Disabled rules are absent
 * from `rules`, and their leftover map entries must not keep protecting
 * the tab or swallow its navigations.
 */
function activeStickyRegistrationsForTab(tabId) {
  return stickyRegistrationsForTab(tabId).filter(reg => rules.some(r => r.id === reg.ruleId));
}

function isRegisteredStickyTab(tabId) {
  return activeStickyRegistrationsForTab(tabId).length > 0;
}

/**
 * Per-rule close protection.
 * Absent / "inherit" follows the global default. "protect" and "allow" override it.
 */
function ruleProtectsStickyClose(rule) {
  const mode = rule && rule.closeProtection;
  if (mode === 'protect') return true;
  if (mode === 'allow') return false;
  return protectStickyTabs !== false;
}

function isCloseProtectedSticky(tabId) {
  const regs = activeStickyRegistrationsForTab(tabId);
  if (regs.length === 0) return false;
  return regs.some(reg => {
    const rule = rules.find(r => r.id === reg.ruleId);
    return rule ? ruleProtectsStickyClose(rule) : false;
  });
}

function rememberStickyTab(tab) {
  if (!tab || tab.id == null) return;
  const prev = stickyCloseMeta.get(tab.id) || {};
  stickyCloseMeta.set(tab.id, {
    url: tab.url || prev.url || '',
    windowId: tab.windowId != null ? tab.windowId : prev.windowId,
    index: tab.index != null ? tab.index : prev.index
  });
}

function rememberStickyUrl(tabId, url) {
  if (tabId == null) return;
  const prev = stickyCloseMeta.get(tabId) || {};
  stickyCloseMeta.set(tabId, {
    url: url || prev.url || '',
    windowId: prev.windowId,
    index: prev.index
  });
}

function forgetStickyCloseMeta(tabId) {
  if (isRegisteredStickyTab(tabId) || scriptStickyTargets.has(tabId)) return;
  stickyCloseMeta.delete(tabId);
}

/**
 * True when our own duplicate-close path must not remove this tab.
 * Covers the sticky target itself (logic bug) and any tab still registered
 * as sticky, including protected ones.
 */
function mustNotCloseTab(tabId, stickyTab) {
  if (tabId == null) return true;
  if (stickyTab && tabId === stickyTab.id) return true;
  if (scriptStickyTargets.has(tabId)) return true;
  if (isRegisteredStickyTab(tabId)) return true;
  return false;
}

/**
 * Find an existing sticky tab for a rule and container
 */
async function findExistingStickyTab(rule, containerKey, cookieStoreId, excludeTabId = null) {
  const stickyTabs = getStickyTabsForRule(rule.id);
  
  // Query for tabs - if container separation, filter by container
  const queryOptions = {};
  if (rule.containerSeparation && cookieStoreId !== 'global') {
    queryOptions.cookieStoreId = cookieStoreId;
  }
  
  const allTabs = await browser.tabs.query(queryOptions);
  const storedStickyId = stickyTabs.get(containerKey);

  // A Run JavaScript action keeps the incoming tab open until the script
  // finishes, and the script often updates history (the documented snippets
  // call history.replaceState). That fires onHistoryStateUpdated on the
  // sticky tab. Never drop or replace the tab we are injecting into.
  if (storedStickyId !== undefined && scriptStickyTargets.has(storedStickyId)) {
    const pinned = allTabs.find(tab => tab.id === storedStickyId);
    if (pinned) {
      rememberStickyTab(pinned);
      return pinned;
    }
  }

  // Callers pass the navigating tab as excludeTabId so it is not adopted as
  // its own duplicate target. When that tab IS the stored sticky, excluding
  // it from the candidate list used to look like "the sticky is gone", and
  // the still-open incoming tab (same sticky pattern) was adopted instead.
  // The caller then closed the real sticky tab as the duplicate.
  if (storedStickyId !== undefined && storedStickyId === excludeTabId) {
    const self = allTabs.find(tab => tab.id === storedStickyId);
    if (self && matchesPatterns(self.url, rule.stickyPatterns)) {
      rememberStickyTab(self);
      return self;
    }
    stickyTabs.delete(containerKey);
    forgetStickyCloseMeta(storedStickyId);
    return null;
  }
  
  // Filter to tabs matching sticky patterns (excluding the current tab)
  const candidateTabs = allTabs.filter(tab => 
    tab.id !== excludeTabId && matchesPatterns(tab.url, rule.stickyPatterns)
  );
  
  // Priority 1: Check if stored sticky tab still exists and matches
  if (storedStickyId !== undefined) {
    const existingSticky = candidateTabs.find(tab => tab.id === storedStickyId);
    if (existingSticky) {
      rememberStickyTab(existingSticky);
      return existingSticky;
    }
    // Stored tab no longer valid, clean up
    stickyTabs.delete(containerKey);
    forgetStickyCloseMeta(storedStickyId);
  }
  
  // Priority 2: Find any tab matching sticky pattern
  if (candidateTabs.length > 0) {
    const tab = candidateTabs[0];
    stickyTabs.set(containerKey, tab.id);
    rememberStickyTab(tab);
    return tab;
  }
  
  return null;
}

/**
 * Close the incoming tab and focus the sticky tab (if configured).
 * Shared by the reload path and the script path.
 * Never removes the sticky tab itself, a tab pinned for an in-flight script,
 * or any tab still registered as sticky.
 */
async function closeAndFocus(tabId, stickyTab) {
  if (mustNotCloseTab(tabId, stickyTab)) {
    log(`Refusing to close tab ${tabId}: it is a sticky tab`);
    if (settings.focusStickyTab && stickyTab && tabId !== stickyTab.id) {
      try {
        await browser.tabs.update(stickyTab.id, { active: true });
      } catch (e) {
        // Sticky tab may already be gone.
      }
    }
    return;
  }
  await browser.tabs.remove(tabId);
  if (settings.focusStickyTab && stickyTab) {
    await browser.tabs.update(stickyTab.id, { active: true });
  }
}

// MV3 MIGRATION NOTE: when this extension moves to Manifest V3, replace the
// string-based `browser.tabs.executeScript(tabId, { code: wrapper })` call in
// `executeStickyScript` with `browser.scripting.executeScript` (or
// `userScripts.execute` for arbitrary user source). Keep the `url` local +
// async IIFE contract (returning `{ ok: true }` / `{ ok: false, name,
// message, stack }`), the `with (window.wrappedJSObject)` page-global
// bridge, and do NOT inject `'use strict'`. Do not rely on
// overriding `func.toString` — Firefox Xray uses native Function.toString.
/**
 * Build the code string injected into the sticky tab.
 * The user code runs inside an async IIFE with the destination URL bound to
 * a local `url` variable:
 *   - JSON.stringify(destUrl) safely embeds the (untrusted) URL - it is
 *     never concatenated raw into the script source.
 *   - The async IIFE gives the user code top-level `await`. Exceptions and
 *     rejections are caught inside the wrapper and returned as a JSON-
 *     serializable `{ ok: false, name, message, stack }` so Firefox does not
 *     collapse them to a useless `"ERROR"` across the executeScript boundary.
 *   - User code runs in a nested async IIFE so a bare `return` in the snippet
 *     does not skip the success result.
 *   - No 'use strict' is injected: user snippets may rely on sloppy-mode
 *     behaviour (e.g. implicit globals), and `with` below requires it.
 *     Content scripts are not subject to the page's CSP.
 *   - Page globals are bridged with `with (window.wrappedJSObject)`: a
 *     content script normally sees an Xray-filtered view of the page window,
 *     so page-defined globals (e.g. Salesforce's `$A`) are NOT in scope and
 *     a bare `$A.getEvt(...)` would throw ReferenceError. The with-block
 *     puts every page global in scope, giving the snippet bookmarklet-like
 *     semantics while still running (CSP-exempt) in the content-script world.
 *     The `const url` declaration lives INSIDE the with-block so it
 *     lexically shadows a same-named page global (e.g. window.url).
 *   - Built-in Error constructors are also lexically shadowed inside the
 *     with-block. Without that, `throw new Error(...)` resolves to the
 *     *page* Error via `with`, and Firefox Xray hides `.stack` on
 *     page-compartment Error objects from content scripts — so the popup
 *     would get name/message but an empty call stack.
 *     (Firefox-only; this extension is Firefox-only.)
 */
function buildScriptWrapper(destUrl, userCode) {
  return `(async () => {
  // Capture content-script Error builtins BEFORE entering \`with\` so we can
  // lexically shadow the page's constructors (see comment above).
  var __stsz_Error = Error;
  var __stsz_TypeError = TypeError;
  var __stsz_RangeError = RangeError;
  var __stsz_SyntaxError = SyntaxError;
  var __stsz_ReferenceError = ReferenceError;
  var __stsz_URIError = URIError;
  var __stsz_EvalError = EvalError;
  var __stsz_AggregateError = typeof AggregateError !== 'undefined' ? AggregateError : null;
  try {
    await (async () => {
      with (window.wrappedJSObject || {}) {
        const Error = __stsz_Error;
        const TypeError = __stsz_TypeError;
        const RangeError = __stsz_RangeError;
        const SyntaxError = __stsz_SyntaxError;
        const ReferenceError = __stsz_ReferenceError;
        const URIError = __stsz_URIError;
        const EvalError = __stsz_EvalError;
        const AggregateError = __stsz_AggregateError || Error;
        const url = ${JSON.stringify(destUrl)};
${userCode}
      }
    })();
    return { ok: true };
  } catch (e) {
    var _name = '';
    var _message = '';
    var _stack = '';
    try { _name = (e && e.name != null) ? String(e.name) : ''; } catch (_0) { _name = ''; }
    try {
      if (e && e.message != null) _message = String(e.message);
      else _message = String(e);
    } catch (_1) { _message = 'Unknown error'; }
    try { if (e && e.stack != null) _stack = String(e.stack); } catch (_2) { _stack = ''; }
    // Page-compartment Errors (e.g. thrown before shadowing, or via
    // window.Error): Xray often blanks .stack; raw wrappedJSObject may still
    // expose it.
    if (!_stack) {
      try {
        var _raw = e && e.wrappedJSObject;
        if (_raw && _raw.stack != null) _stack = String(_raw.stack);
      } catch (_3) { /* keep empty */ }
    }
    return { ok: false, name: _name, message: _message, stack: _stack };
  }
})();`;
}

/**
 * Short human-readable summary from name + message fields.
 */
function summarizeErrorParts(name, message, fallback) {
  const n = name ? String(name) : '';
  const m = message != null && message !== '' ? String(message) : '';
  if (n && m) return `${n}: ${m}`;
  return m || n || fallback || 'Unknown error';
}

/**
 * Build a structured errorDetail for the dialog's expandable panel.
 * Returns null when there is no call stack (primary summary is enough).
 */
function buildErrorDetail(name, message, stack) {
  const n = name ? String(name) : '';
  const m = message != null && message !== '' ? String(message) : '';
  const s = stack ? String(stack).trim() : '';
  // Expander is only useful when a call stack (or similar) is available.
  if (!s) return null;
  const detail = { stack: s };
  if (n) detail.name = n;
  if (m) detail.message = m;
  return detail;
}

/**
 * Format a structured script-failure return value from the wrapper.
 * @returns {{ error: string, errorDetail: object|null }}
 */
function formatScriptFailureDetail(value) {
  const name = value && value.name ? String(value.name) : '';
  const message = value && value.message != null && value.message !== ''
    ? String(value.message)
    : '';
  const stack = value && value.stack ? String(value.stack) : '';
  const error = summarizeErrorParts(name, message, 'Unknown error');
  return { error, errorDetail: buildErrorDetail(name, message, stack) };
}

/**
 * Format an executeScript / injection exception.
 * @returns {{ error: string, errorDetail: object|null }}
 */
function formatInjectionError(e) {
  const name = e && e.name ? String(e.name) : '';
  const message = e && e.message != null && e.message !== ''
    ? String(e.message)
    : '';
  let stack = '';
  try {
    if (e && e.stack != null) stack = String(e.stack);
  } catch (_0) {
    stack = '';
  }
  const fallback = (() => {
    try { return String(e); } catch (_1) { return 'Unknown error'; }
  })();
  const error = summarizeErrorParts(name, message, fallback);
  return { error, errorDetail: buildErrorDetail(name, message, stack) };
}

function isStickyBypassed(tabId) {
  const until = stickyBypassUntil.get(tabId);
  if (until === undefined) return false;
  if (Date.now() > until) {
    stickyBypassUntil.delete(tabId);
    return false;
  }
  return true;
}

function grantStickyBypass(tabId) {
  stickyBypassUntil.set(tabId, Date.now() + STICKY_BYPASS_TTL_MS);
}

/**
 * Resolve the script to run for a rule.
 * Order when snippetId is set: user snippet, builtin snippet, inline
 * actionScript, then null (caller treats that as a reload). A missing
 * snippet logs a warning when debug logging is on.
 * Returns null when no script applies (legacy reload behaviour).
 */
function resolveRuleScript(rule) {
  if (rule.snippetId) {
    const snippetCode = lookupSnippetCode(rule.snippetId);
    if (snippetCode) return snippetCode;
    if (rule.action === 'script' && rule.actionScript && rule.actionScript.trim() !== '') {
      log(`Rule "${rule.name}" snippet "${rule.snippetId}" was not found; using inline action script`);
      return rule.actionScript;
    }
    log(`Rule "${rule.name}" snippet "${rule.snippetId}" was not found; treating as reload`);
    return null;
  }
  if (rule.action === 'script' && rule.actionScript && rule.actionScript.trim() !== '') {
    return rule.actionScript;
  }
  return null;
}

/**
 * Execute the rule's action script in the sticky tab.
 *
 * NOTE FOR AMO REVIEWERS: the code passed to tabs.executeScript is either
 * (1) a predefined snippet shipped in snippets/builtin.js, which is part of
 * this add-on and reviewed with it, or (2) a script the user wrote or cloned
 * in the extension's own options page and stored in their browser
 * (browser.storage, local or Firefox Sync). It is never fetched remotely and
 * never shared. User-authored code is the same trust model as pasting into
 * the DevTools console. Predefined snippets are not read from storage, so an
 * update can replace them.
 * It runs as a content script (top frame only): not subject to the page CSP,
 * isolated from page JS. Page globals are bridged into scope via a
 * `with (window.wrappedJSObject)` block (see buildScriptWrapper).
 *
 * @returns {{ ok: true } | { ok: false, error: string, errorDetail?: { name?: string, message?: string, stack?: string } }}
 */
async function executeStickyScript(rule, stickyTab, destUrl, containerLabel) {
  const userCode = resolveRuleScript(rule);
  if (!userCode) {
    return { ok: false, error: 'No action script configured for this rule.' };
  }
  try {
    const wrapper = buildScriptWrapper(destUrl, userCode);
    // Top frame only (no allFrames) - the destination URL refers to the page.
    // Result is [{ ok: true }] or [{ ok: false, name, message, stack }] from the wrapper.
    const results = await browser.tabs.executeScript(stickyTab.id, {
      code: wrapper,
      runAt: 'document_idle'
    });
    const value = results && results[0];
    if (value && value.ok === false) {
      const { error, errorDetail } = formatScriptFailureDetail(value);
      const logDetail = errorDetail && errorDetail.stack
        ? `${error}\n${errorDetail.stack}`
        : error;
      console.error(`[Sticky TabSZ] [${rule.name}] [${containerLabel}] Script action failed: ${logDetail}`);
      return { ok: false, error, errorDetail: errorDetail || undefined };
    }
    log(`[${rule.name}] [${containerLabel}] Script action completed in sticky tab for: ${destUrl}`);
    return { ok: true };
  } catch (e) {
    const { error, errorDetail } = formatInjectionError(e);
    const logDetail = errorDetail && errorDetail.stack
      ? `${error}\n${errorDetail.stack}`
      : error;
    console.error(`[Sticky TabSZ] [${rule.name}] [${containerLabel}] Script action failed: ${logDetail}`);
    return { ok: false, error, errorDetail: errorDetail || undefined };
  }
}

/**
 * Open a small popup asking what to do after a script action failure.
 * Incoming tab is left open until the user chooses.
 * At most one open prompt per incomingTabId — if one exists, refresh its
 * error/dest metadata and focus the existing window instead of opening another.
 */
async function promptScriptError({ rule, stickyTab, incomingTabId, destUrl, containerLabel, error, errorDetail }) {
  const existing = findOpenScriptErrorForTab(incomingTabId);
  if (existing) {
    existing.ruleId = rule.id;
    existing.ruleName = rule.name;
    existing.stickyTabId = stickyTab.id;
    existing.destUrl = destUrl;
    existing.containerLabel = containerLabel;
    existing.error = error || existing.error || 'Unknown error';
    existing.errorDetail = errorDetail || null;
    log(`[${rule.name}] Script-error prompt already open for tab ${incomingTabId}, reusing`);
    if (existing.windowId != null) {
      try {
        await browser.windows.update(existing.windowId, { focused: true });
      } catch (e) {
        // Window may have been closed; leave the record for message handlers.
      }
    }
    return;
  }

  const promptId = `se-${++scriptErrorPromptSeq}-${Date.now()}`;
  const record = {
    promptId,
    ruleId: rule.id,
    ruleName: rule.name,
    stickyTabId: stickyTab.id,
    incomingTabId,
    destUrl,
    containerLabel,
    error: error || 'Unknown error',
    errorDetail: errorDetail || null,
    windowId: null,
    state: 'open'
  };
  // Record before await so concurrent callers see the open prompt.
  pendingScriptErrors.set(promptId, record);

  let left = 100;
  let top = 100;
  try {
    const incoming = await browser.tabs.get(incomingTabId);
    const win = await browser.windows.get(incoming.windowId);
    const width = 460;
    const height = 520;
    left = Math.max(0, (win.left || 0) + Math.floor(((win.width || width) - width) / 2));
    top = Math.max(0, (win.top || 0) + Math.floor(((win.height || height) - height) / 3));
    const created = await browser.windows.create({
      url: browser.runtime.getURL(`script-error.html#${promptId}`),
      type: 'popup',
      width,
      height,
      left,
      top,
      focused: true
    });
    record.windowId = created.id;
  } catch (e) {
    pendingScriptErrors.delete(promptId);
    console.error(`[Sticky TabSZ] Could not open script-error prompt: ${e.message}`);
    // Last resort: default sticky reload so navigation is not lost.
    try {
      await browser.tabs.update(stickyTab.id, { url: destUrl });
      await closeAndFocus(incomingTabId, stickyTab);
    } catch (e2) {
      console.error(`[Sticky TabSZ] Fallback reload also failed: ${e2.message}`);
    }
  }
}

async function closeScriptErrorPromptWindow(record) {
  if (!record || record.windowId == null) return;
  try {
    await browser.windows.remove(record.windowId);
  } catch (e) {
    // Window may already be gone.
  }
}

/**
 * Persist immediate deactivation of a rule from the script-error prompt.
 * Mirrors the options-page sync-override model ("placement defines state"):
 * - sync off: set enabled:false in local rules
 * - sync on + already overridden: set enabled:false in localRules only
 * - sync on + still synced: record overrideMeta, remove from sync, append
 *   disabled copy to localRules
 */
async function deactivateRuleFromScriptError(ruleId) {
  if (!settings.useSync) {
    const result = await browser.storage.local.get('rules');
    const list = result.rules || [];
    const idx = list.findIndex(r => r.id === ruleId);
    if (idx === -1) {
      throw new Error('Rule not found in local storage.');
    }
    list[idx] = { ...list[idx], enabled: false };
    await browser.storage.local.set({ rules: list });
  } else {
    const [syncResult, localResult] = await Promise.all([
      browser.storage.sync.get('rules'),
      browser.storage.local.get(['localRules', 'overrideMeta'])
    ]);
    const syncedRules = syncResult.rules || [];
    let localOverrides = [...(localResult.localRules || [])];
    const meta = { ...(localResult.overrideMeta || {}) };

    const localIdx = localOverrides.findIndex(r => r.id === ruleId);
    if (localIdx !== -1) {
      // Already a local override — disable locally only; leave sync alone.
      localOverrides[localIdx] = { ...localOverrides[localIdx], enabled: false };
      await browser.storage.local.set({ localRules: localOverrides });
    } else {
      const syncedIdx = syncedRules.findIndex(r => r.id === ruleId);
      if (syncedIdx === -1) {
        throw new Error('Rule not found in sync or local overrides.');
      }
      const syncedCopy = syncedRules[syncedIdx];
      meta[ruleId] = {
        lastSyncedHash: hashRule(syncedCopy),
        lastSyncedAt: Date.now()
      };
      const disabledLocal = { ...syncedCopy, enabled: false };
      localOverrides = [...localOverrides, disabledLocal];
      // Write local override first so resolveEffectiveRules never briefly
      // drops the rule if sync removal races ahead of the local write.
      await browser.storage.local.set({ localRules: localOverrides, overrideMeta: meta });
      await browser.storage.sync.set({
        rules: syncedRules.filter(r => r.id !== ruleId)
      });
    }
  }

  stickyTabsByRule.delete(ruleId);
  // Storage listeners also reload; call explicitly so memory is current
  // before we grant sticky bypass on the incoming tab.
  await loadRules();
}

/**
 * Apply the user's choice from the script-error prompt.
 * @param {'reload'|'newTab'|'cancel'|'deactivate'} choice
 */
async function applyScriptErrorChoice(promptId, choice) {
  const record = pendingScriptErrors.get(promptId);
  if (!record || record.state !== 'open') {
    return { ok: false, error: 'This prompt is no longer active.' };
  }
  record.state = 'answered';
  pendingScriptErrors.delete(promptId);

  const { stickyTabId, incomingTabId, destUrl, ruleName, containerLabel, ruleId } = record;

  try {
    if (choice === 'reload') {
      let stickyTab;
      try {
        stickyTab = await browser.tabs.get(stickyTabId);
      } catch (e) {
        stickyTab = null;
      }
      if (stickyTab) {
        await browser.tabs.update(stickyTab.id, { url: destUrl });
        await closeAndFocus(incomingTabId, stickyTab);
        log(`[${ruleName}] [${containerLabel}] Script-error choice: reload sticky with ${destUrl}`);
      } else {
        // Sticky gone - keep the incoming tab (it already has the URL).
        grantStickyBypass(incomingTabId);
        if (settings.focusStickyTab) {
          await browser.tabs.update(incomingTabId, { active: true });
        }
        log(`[${ruleName}] [${containerLabel}] Script-error choice: reload, but sticky was gone; kept incoming tab`);
      }
    } else if (choice === 'newTab') {
      grantStickyBypass(incomingTabId);
      await browser.tabs.update(incomingTabId, { active: true });
      log(`[${ruleName}] [${containerLabel}] Script-error choice: keep incoming tab (sticky bypass)`);
    } else if (choice === 'deactivate') {
      try {
        await deactivateRuleFromScriptError(ruleId);
      } catch (e) {
        // Restore prompt so the popup can re-enable buttons and retry.
        record.state = 'open';
        pendingScriptErrors.set(promptId, record);
        return { ok: false, error: e && e.message ? e.message : String(e) };
      }
      grantStickyBypass(incomingTabId);
      await browser.tabs.update(incomingTabId, { active: true });
      log(`[${ruleName}] [${containerLabel}] Script-error choice: deactivate rule ${ruleId}; keep incoming tab`);
    } else {
      // cancel: abandon navigation - close incoming, leave sticky alone
      try {
        if (mustNotCloseTab(incomingTabId, null)) {
          log(`Refusing to close tab ${incomingTabId}: it is a sticky tab`);
        } else {
          await browser.tabs.remove(incomingTabId);
        }
      } catch (e) {
        // Incoming may already be closed.
      }
      try {
        if (settings.focusStickyTab) {
          await browser.tabs.update(stickyTabId, { active: true });
        }
      } catch (e) {
        // Sticky may be gone.
      }
      log(`[${ruleName}] [${containerLabel}] Script-error choice: cancel`);
    }
  } finally {
    // Skip close when deactivate restored the prompt after a storage failure.
    if (record.state === 'answered') {
      await closeScriptErrorPromptWindow(record);
    }
  }
  return { ok: true };
}

/**
 * Run a script action for an incoming navigation. Keeps the incoming tab open
 * until success (then closes it) or until the user answers the error prompt.
 * Dedupes concurrent onCompleted / onHistoryStateUpdated for the same tab.
 */
async function handleScriptAction(rule, stickyTab, incomingTabId, destUrl, containerLabel) {
  if (findOpenScriptErrorForTab(incomingTabId)) {
    log(`[${rule.name}] Script-error prompt already open for tab ${incomingTabId}, skipping`);
    return;
  }
  if (scriptActionInFlight.has(incomingTabId)) {
    log(`[${rule.name}] Script action already in flight for tab ${incomingTabId}, skipping`);
    return;
  }

  scriptActionInFlight.add(incomingTabId);
  scriptStickyTargets.add(stickyTab.id);
  liveStickyTabObjects.set(stickyTab.id, stickyTab);
  rememberStickyTab(stickyTab);
  try {
    const result = await executeStickyScript(rule, stickyTab, destUrl, containerLabel);
    if (result.ok) {
      await closeAndFocus(incomingTabId, stickyTab);
      return;
    }
    // Re-check after await: another path may have opened a prompt meanwhile.
    if (findOpenScriptErrorForTab(incomingTabId)) {
      log(`[${rule.name}] Script-error prompt appeared during execute for tab ${incomingTabId}, skipping`);
      return;
    }
    await promptScriptError({
      rule,
      stickyTab,
      incomingTabId,
      destUrl,
      containerLabel,
      error: result.error,
      errorDetail: result.errorDetail || null
    });
  } finally {
    scriptActionInFlight.delete(incomingTabId);
    scriptStickyTargets.delete(stickyTab.id);
    liveStickyTabObjects.delete(stickyTab.id);
  }
}

/**
 * Handle navigation event
 */
async function handleNavigation(details) {
  if (details.frameId !== 0) return;

  const url = details.url;
  const tabId = details.tabId;

  // User chose "load in new tab" after a script failure - leave this tab alone.
  if (isStickyBypassed(tabId)) {
    log(`Tab ${tabId} has temporary sticky bypass, allowing navigation`);
    return;
  }

  // This tab is already the sticky tab (or the tab a script action is running
  // in). Its own onCompleted / onHistoryStateUpdated — including
  // history.replaceState/pushState from the action script, and the reload
  // Firefox performs when executeScript wakes a discarded tab — must not be
  // matched again. Re-matching used to adopt the still-open incoming tab as
  // the new sticky and then tabs.remove the real one.
  if (isRegisteredStickyTab(tabId) || scriptStickyTargets.has(tabId)) {
    rememberStickyUrl(tabId, url);
    log(`Tab ${tabId} is sticky; allowing its navigation`);
    return;
  }

  // Find matching rule
  const match = findMatchingRule(url);
  if (!match) return;

  const { rule, matchType } = match;
  const ruleName = rule.name;

  // Get tab info for container
  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch (e) {
    log(`[${ruleName}] Could not get tab ${tabId}: ${e.message}`);
    return;
  }

  const cookieStoreId = tab.cookieStoreId;
  const containerKey = getContainerKey(rule, cookieStoreId);
  const containerLabel = getContainerLabel(containerKey);

  // Find existing sticky tab
  const stickyTab = await findExistingStickyTab(rule, containerKey, cookieStoreId, tabId);

  // If no sticky tab exists, this tab becomes sticky (only if it matches sticky pattern)
  if (!stickyTab) {
    if (matchType === 'sticky') {
      const stickyTabs = getStickyTabsForRule(rule.id);
      stickyTabs.set(containerKey, tabId);
      rememberStickyTab(tab);
      log(`[${ruleName}] [${containerLabel}] Tab ${tabId} is now sticky`);
    } else {
      // URL matched 'match' pattern but no sticky tab exists - let it be
      log(`[${ruleName}] [${containerLabel}] No sticky tab for match pattern, allowing new tab`);
    }
    return;
  }

  // If this IS the sticky tab, just let it navigate
  if (tabId === stickyTab.id) {
    return;
  }

  // If the URL is the same, just close the new tab and focus existing
  if (url === stickyTab.url) {
    // Re-triggering the same URL is a primary use case for the script action
    // (e.g. re-clicking a link) - run the script instead of doing nothing.
    if (rule.action === 'script' && resolveRuleScript(rule)) {
      await handleScriptAction(rule, stickyTab, tabId, url, containerLabel);
      log(`[${ruleName}] [${containerLabel}] Duplicate URL, script action dispatched`);
      return;
    }
    await closeAndFocus(tabId, stickyTab);
    log(`[${ruleName}] [${containerLabel}] Closed duplicate tab, focused sticky tab`);
    return;
  }

  // Script action: run the rule's JavaScript in the sticky tab instead of
  // reloading it. Incoming tab stays open until the script succeeds or the
  // user answers the error prompt.
  if (rule.action === 'script' && resolveRuleScript(rule)) {
    await handleScriptAction(rule, stickyTab, tabId, url, containerLabel);
    return;
  }

  // Redirect: update sticky tab with new URL, close new tab, focus sticky
  await browser.tabs.update(stickyTab.id, { url: url });
  await closeAndFocus(tabId, stickyTab);
  log(`[${ruleName}] [${containerLabel}] Redirected to sticky tab: ${url}`);
}

function sessionTabUrl(tab) {
  if (!tab) return '';
  return tab.url || tab.pendingUrl || '';
}

/**
 * Pick the closed session that corresponds to a sticky tab we just saw close.
 * Requires a URL match. getRecentlyClosed is most-recent-first, so the first
 * fresh match is the tab that just closed. Window id is not required: the
 * tab may have been moved, and a stale window id must not block restore.
 */
function pickClosedSession(recent, meta) {
  if (!meta || !meta.url) return null;
  const now = Date.now();
  const matched = (recent || []).filter(session => {
    if (!session || !session.tab || !session.tab.sessionId) return false;
    if (session.lastModified && now - session.lastModified > 15000) return false;
    return sessionTabUrl(session.tab) === meta.url;
  });
  return matched.length ? matched[0] : null;
}

/**
 * Stop a page that calls window.close() on load from flapping forever.
 * Two restores of the same url+window inside 10s are allowed; further
 * closes stay closed so the user is not trapped.
 */
function allowStickyRestore(meta) {
  const key = `${meta.windowId}|${meta.url}`;
  const now = Date.now();
  const prev = stickyRestoreAttempts.get(key);
  if (!prev || now - prev.at > 10000) {
    stickyRestoreAttempts.set(key, { count: 1, at: now });
    return true;
  }
  if (prev.count >= 2) return false;
  prev.count += 1;
  prev.at = now;
  return true;
}

/**
 * Firefox MV2 has no cancelable before-close event (tabs.onRemoved fires
 * after the tab is gone; bug 1399885's onBeforeRemoved was never shipped).
 * Put the protected sticky tab back with sessions.restore when the close
 * was of that tab alone. Window close (isWindowClosing) and quitting
 * Firefox are not restored.
 */
async function restoreProtectedStickyTab(tabId, removeInfo, registrations) {
  const meta = stickyCloseMeta.get(tabId) || {};
  stickyCloseMeta.delete(tabId);
  if (!meta.url) {
    console.warn(`[Sticky TabSZ] Protected sticky tab ${tabId} was closed but its URL was not known, so it was not restored`);
    return;
  }
  try {
    if (removeInfo.windowId != null) {
      try {
        await browser.windows.get(removeInfo.windowId);
      } catch (e) {
        log(`Window ${removeInfo.windowId} is gone; not restoring sticky tab ${tabId}`);
        return;
      }
    }
    const recent = await browser.sessions.getRecentlyClosed({ maxResults: 15 });
    const session = pickClosedSession(recent, meta);
    if (!session) {
      console.warn(`[Sticky TabSZ] Protected sticky tab ${tabId} was closed but no matching session was found to restore`);
      return;
    }
    if (!allowStickyRestore(meta)) {
      log(`Sticky tab ${tabId} closed repeatedly; leaving it closed`);
      return;
    }
    const restored = await browser.sessions.restore(session.tab.sessionId);
    const newTab = restored && restored.tab;
    if (!newTab || newTab.id == null) {
      console.warn('[Sticky TabSZ] Session restore did not return a tab');
      return;
    }
    for (const reg of registrations) {
      const map = getStickyTabsForRule(reg.ruleId);
      const current = map.get(reg.containerKey);
      if (current === undefined || current === tabId) {
        map.set(reg.containerKey, newTab.id);
      }
    }
    const live = liveStickyTabObjects.get(tabId);
    if (live) {
      liveStickyTabObjects.delete(tabId);
      live.id = newTab.id;
      if (newTab.url) live.url = newTab.url;
      liveStickyTabObjects.set(newTab.id, live);
      // handleTabRemoved already dropped the closed id. Keep the in-flight
      // script pinned to the restored tab until handleScriptAction finishes.
      scriptStickyTargets.add(newTab.id);
    }
    for (const record of pendingScriptErrors.values()) {
      if (record.stickyTabId === tabId) record.stickyTabId = newTab.id;
    }
    rememberStickyTab(newTab);
    log(`Restored protected sticky tab ${tabId} as ${newTab.id}`);
  } catch (e) {
    console.error('[Sticky TabSZ] Failed to restore protected sticky tab:', e);
  }
}

/**
 * Handle tab removal - clean up sticky tab tracking and pending prompts.
 * Individual closes of a protected sticky tab are restored. Closes that
 * happen because the window is closing (including quitting Firefox) are not.
 */
function handleTabRemoved(tabId, removeInfo) {
  const info = removeInfo || {};
  const registrations = stickyRegistrationsForTab(tabId);
  const activeRegistrations = activeStickyRegistrationsForTab(tabId);
  // Decide before the map entries are removed.
  const protectedClose = info.isWindowClosing === false && isCloseProtectedSticky(tabId);

  stickyBypassUntil.delete(tabId);
  scriptActionInFlight.delete(tabId);
  scriptStickyTargets.delete(tabId);

  for (const [promptId, record] of pendingScriptErrors.entries()) {
    if (record.incomingTabId === tabId && record.state === 'open') {
      record.state = 'cancelled';
      pendingScriptErrors.delete(promptId);
      closeScriptErrorPromptWindow(record);
    }
  }

  for (const reg of registrations) {
    const containerMap = stickyTabsByRule.get(reg.ruleId);
    if (containerMap) containerMap.delete(reg.containerKey);
    const rule = rules.find(r => r.id === reg.ruleId);
    const ruleName = rule ? rule.name : `rule-${reg.ruleId}`;
    log(`[${ruleName}] [${getContainerLabel(reg.containerKey)}] Sticky tab was closed`);
  }

  if (protectedClose) {
    restoreProtectedStickyTab(tabId, info, activeRegistrations);
  } else {
    stickyCloseMeta.delete(tabId);
  }
}

/**
 * Closing the script-error popup without choosing = Cancel.
 */
function handleWindowRemoved(windowId) {
  for (const [promptId, record] of pendingScriptErrors.entries()) {
    if (record.windowId === windowId && record.state === 'open') {
      // Treat as cancel without trying to remove the already-gone window.
      record.windowId = null;
      applyScriptErrorChoice(promptId, 'cancel');
      return;
    }
  }
}

function handleRuntimeMessage(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'getScriptErrorPrompt') {
    const record = pendingScriptErrors.get(message.promptId);
    if (!record || record.state !== 'open') {
      return Promise.resolve({ ok: false, error: 'stale' });
    }
    return Promise.resolve({
      ok: true,
      promptId: record.promptId,
      ruleName: record.ruleName,
      destUrl: record.destUrl,
      error: record.error,
      errorDetail: record.errorDetail || null,
      containerLabel: record.containerLabel
    });
  }

  if (message.type === 'scriptErrorChoice') {
    return applyScriptErrorChoice(message.promptId, message.choice);
  }
}

/**
 * Handle storage changes - reload rules and settings
 */
function handleStorageChange(changes, area) {
  // Settings are always in local storage
  if (area === 'local' && changes.settings) {
    const oldUseSync = settings.useSync;
    log('Settings changed, reloading...');
    loadSettings().then(() => {
      // If useSync changed, reload rules from new storage
      if (settings.useSync !== oldUseSync) {
        log(`Sync setting changed to ${settings.useSync}, reloading rules...`);
        loadRules();
      }
    });
  }

  if (changes.snippets) {
    const expectedArea = settings.useSync ? 'sync' : 'local';
    if (area === expectedArea) {
      log(`Snippets changed in ${area} storage, reloading...`);
      loadSnippets();
    }
  }
  
  // Rules can be in local or sync storage
  if (changes.rules) {
    const expectedArea = settings.useSync ? 'sync' : 'local';
    if (area === expectedArea) {
      log(`Rules changed in ${area} storage, reloading...`);
      loadRules();
    }
  }
  
  // Close-protection default lives with the rules (sync or local).
  if (Object.prototype.hasOwnProperty.call(changes, 'protectStickyTabs')) {
    const expectedArea = settings.useSync ? 'sync' : 'local';
    if (area === expectedArea) {
      const value = changes.protectStickyTabs.newValue;
      protectStickyTabs = typeof value === 'boolean' ? value : true;
      log('Close protection default is', protectStickyTabs);
    }
  }

  // Local rule overrides (localRules key) affect the effective set when sync is on
  if (area === 'local' && changes.localRules && settings.useSync) {
    log('Local rule overrides changed, reloading effective rules...');
    loadRules();
  }
}

// Initialize
async function init() {
  await loadSettings();
  await loadRules();
  
  // Listen for navigations (full page loads)
  browser.webNavigation.onCompleted.addListener(handleNavigation);
  
  // Listen for SPA navigation
  browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation);
  
  // Clean up on tab close
  browser.tabs.onRemoved.addListener(handleTabRemoved);

  // Script-error prompt closed via window X / Esc-equivalent
  browser.windows.onRemoved.addListener(handleWindowRemoved);

  // Prompt page messaging
  browser.runtime.onMessage.addListener(handleRuntimeMessage);

  // Reload rules when storage changes
  browser.storage.onChanged.addListener(handleStorageChange);

  log('Extension loaded and ready');
}

init();
