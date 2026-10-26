// Sticky TabSZ Extension
// Configurable sticky tab rules with Multi-Account Container support

// Current rules loaded from storage
let rules = [];

// Settings (always stored locally, never synced)
let settings = {
  debugLogging: false,
  focusStickyTab: true,
  useSync: false
};

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
    log('Settings loaded:', settings);
  } catch (e) {
    console.error('[Sticky TabSZ] Failed to load settings:', e);
  }
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
  } catch (e) {
    console.error('[Sticky TabSZ] Failed to load rules:', e);
    rules = [];
  }
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
  
  // Filter to tabs matching sticky patterns (excluding the current tab)
  const candidateTabs = allTabs.filter(tab => 
    tab.id !== excludeTabId && matchesPatterns(tab.url, rule.stickyPatterns)
  );
  
  // Priority 1: Check if stored sticky tab still exists and matches
  const storedStickyId = stickyTabs.get(containerKey);
  if (storedStickyId !== undefined) {
    const existingSticky = candidateTabs.find(tab => tab.id === storedStickyId);
    if (existingSticky) {
      return existingSticky;
    }
    // Stored tab no longer valid, clean up
    stickyTabs.delete(containerKey);
  }
  
  // Priority 2: Find any tab matching sticky pattern
  if (candidateTabs.length > 0) {
    const tab = candidateTabs[0];
    stickyTabs.set(containerKey, tab.id);
    return tab;
  }
  
  return null;
}

/**
 * Close the incoming tab and focus the sticky tab (if configured).
 * Shared by the reload path and the script path.
 */
async function closeAndFocus(tabId, stickyTab) {
  await browser.tabs.remove(tabId);
  if (settings.focusStickyTab) {
    await browser.tabs.update(stickyTab.id, { active: true });
  }
}

// MV3 MIGRATION NOTE: when this extension moves to Manifest V3, replace the
// string-based `browser.tabs.executeScript(tabId, { code: wrapper })` call in
// `executeStickyScript` with `browser.scripting.executeScript` (or
// `userScripts.execute` for arbitrary user source). Keep the `url` local +
// async IIFE contract, the `with (window.wrappedJSObject)` page-global
// bridge, and do NOT inject `'use strict'`. Do not rely on
// overriding `func.toString` — Firefox Xray uses native Function.toString.
/**
 * Build the code string injected into the sticky tab.
 * The user code runs inside an async IIFE with the destination URL bound to
 * a local `url` variable:
 *   - JSON.stringify(destUrl) safely embeds the (untrusted) URL - it is
 *     never concatenated raw into the script source.
 *   - The async IIFE gives the user code top-level `await` and turns any
 *     error/rejection into a rejected promise in the background script
 *     (where `tabs.executeScript` surfaces it and we can prompt).
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
 *     (Firefox-only; this extension is Firefox-only.)
 */
function buildScriptWrapper(destUrl, userCode) {
  return `(async () => {
  with (window.wrappedJSObject || {}) {
    const url = ${JSON.stringify(destUrl)};
${userCode}
  }
})();`;
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
 * Order: snippetId (snippet library - not implemented yet, stub) then
 * actionScript. Returns null when no script applies (legacy reload behaviour).
 */
function resolveRuleScript(rule) {
  if (rule.snippetId) {
    // Reserved for a future snippet-library feature.
    // TODO: look up the snippet in storage and return its code.
    log(`Rule "${rule.name}" references snippetId but snippets are not implemented yet`);
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
 * NOTE FOR AMO REVIEWERS: the code passed to tabs.executeScript originates
 * solely from user input - the extension's own options page stores the
 * snippet in the user's browser (browser.storage). It is never fetched
 * remotely, never bundled with the extension, and never shared. This is the
 * same trust model as a user pasting code into their own devtools console.
 * It runs as a content script (top frame only): not subject to the page CSP,
 * isolated from page JS. Page globals are bridged into scope via a
 * `with (window.wrappedJSObject)` block (see buildScriptWrapper).
 *
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
async function executeStickyScript(rule, stickyTab, destUrl, containerLabel) {
  const userCode = resolveRuleScript(rule);
  if (!userCode) {
    return { ok: false, error: 'No action script configured for this rule.' };
  }
  try {
    const wrapper = buildScriptWrapper(destUrl, userCode);
    // Top frame only (no allFrames) - the destination URL refers to the page.
    await browser.tabs.executeScript(stickyTab.id, { code: wrapper, runAt: 'document_idle' });
    log(`[${rule.name}] [${containerLabel}] Script action completed in sticky tab for: ${destUrl}`);
    return { ok: true };
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    console.error(`[Sticky TabSZ] [${rule.name}] [${containerLabel}] Script action failed: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * Open a small popup asking what to do after a script action failure.
 * Incoming tab is left open until the user chooses.
 * At most one open prompt per incomingTabId — if one exists, refresh its
 * error/dest metadata and focus the existing window instead of opening another.
 */
async function promptScriptError({ rule, stickyTab, incomingTabId, destUrl, containerLabel, error }) {
  const existing = findOpenScriptErrorForTab(incomingTabId);
  if (existing) {
    existing.ruleId = rule.id;
    existing.ruleName = rule.name;
    existing.stickyTabId = stickyTab.id;
    existing.destUrl = destUrl;
    existing.containerLabel = containerLabel;
    existing.error = error || existing.error || 'Unknown error';
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
    const height = 420;
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
 * Apply the user's choice from the script-error prompt.
 * @param {'reload'|'newTab'|'cancel'} choice
 */
async function applyScriptErrorChoice(promptId, choice) {
  const record = pendingScriptErrors.get(promptId);
  if (!record || record.state !== 'open') {
    return { ok: false, error: 'This prompt is no longer active.' };
  }
  record.state = 'answered';
  pendingScriptErrors.delete(promptId);

  const { stickyTabId, incomingTabId, destUrl, ruleName, containerLabel } = record;

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
    } else {
      // cancel: abandon navigation - close incoming, leave sticky alone
      try {
        await browser.tabs.remove(incomingTabId);
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
    await closeScriptErrorPromptWindow(record);
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
      error: result.error
    });
  } finally {
    scriptActionInFlight.delete(incomingTabId);
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

/**
 * Handle tab removal - clean up sticky tab tracking and pending prompts
 */
function handleTabRemoved(tabId) {
  stickyBypassUntil.delete(tabId);
  scriptActionInFlight.delete(tabId);

  for (const [promptId, record] of pendingScriptErrors.entries()) {
    if (record.incomingTabId === tabId && record.state === 'open') {
      record.state = 'cancelled';
      pendingScriptErrors.delete(promptId);
      closeScriptErrorPromptWindow(record);
    }
  }

  for (const [ruleId, containerMap] of stickyTabsByRule.entries()) {
    for (const [containerKey, stickyId] of containerMap.entries()) {
      if (stickyId === tabId) {
        containerMap.delete(containerKey);
        const rule = rules.find(r => r.id === ruleId);
        const ruleName = rule ? rule.name : `rule-${ruleId}`;
        log(`[${ruleName}] [${getContainerLabel(containerKey)}] Sticky tab was closed`);
        return;
      }
    }
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
  
  // Rules can be in local or sync storage
  if (changes.rules) {
    const expectedArea = settings.useSync ? 'sync' : 'local';
    if (area === expectedArea) {
      log(`Rules changed in ${area} storage, reloading...`);
      loadRules();
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
