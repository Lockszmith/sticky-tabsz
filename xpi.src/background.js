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
// `executeStickyScript` with `browser.scripting.executeScript({
//   target: { tabId: stickyTab.id },
//   func: (url) => { /* user code */ },
//   args: [destUrl]
// })`. Note that MV3's `func` serialization cannot carry arbitrary
// user-authored source text directly, so the practical migration is to keep
// building a wrapper string but pass it via `scripting.executeScript`'s
// `files`/data-URL alternatives, or (more robustly) to keep a small injected
// bootstrap file that receives the user code via `browser.scripting.executeScript`
// arguments or messaging. The `buildScriptWrapper` contract (`url` local + async
// IIFE) should be preserved so user snippets keep working unchanged.
/**
 * Build the code string injected into the sticky tab.
 * The user code runs inside an async IIFE with the destination URL bound to
 * a local `url` variable:
 *   - JSON.stringify(destUrl) safely embeds the (untrusted) URL - it is
 *     never concatenated raw into the script source.
 *   - The async IIFE gives the user code top-level `await` and turns any
 *     error/rejection into a rejected promise in the background script
 *     (where `tabs.executeScript` surfaces it and we can fall back).
 *   - No 'use strict' is injected: user snippets may rely on sloppy-mode
 *     behaviour (e.g. implicit globals). Content scripts are not subject to
 *     the page's CSP, so this works even on strict-CSP sites (Salesforce
 *     Lightning, etc.).
 */
function buildScriptWrapper(destUrl, userCode) {
  return `(async () => {\n  const url = ${JSON.stringify(destUrl)};\n${userCode}\n})();`;
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
 *
 * @returns {boolean} true if the script ran and resolved without error,
 *   false if there is no script, execution could not start, or the script
 *   threw/rejected (the caller falls back to a plain reload).
 */
async function executeStickyScript(rule, stickyTab, destUrl, containerLabel) {
  const userCode = resolveRuleScript(rule);
  if (!userCode) return false;
  try {
    const wrapper = buildScriptWrapper(destUrl, userCode);
    // Top frame only (no allFrames) - the destination URL refers to the page.
    await browser.tabs.executeScript(stickyTab.id, { code: wrapper, runAt: 'document_idle' });
    log(`[${rule.name}] [${containerLabel}] Script action completed in sticky tab for: ${destUrl}`);
    return true;
  } catch (e) {
    log(`[${rule.name}] [${containerLabel}] Script action failed: ${e.message} (will fall back to reload)`);
    return false;
  }
}

/**
 * Handle navigation event
 */
async function handleNavigation(details) {
  if (details.frameId !== 0) return;
  
  const url = details.url;
  const tabId = details.tabId;
  
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
      await closeAndFocus(tabId, stickyTab);
      await executeStickyScript(rule, stickyTab, url, containerLabel);
      log(`[${ruleName}] [${containerLabel}] Duplicate URL, ran script action in sticky tab`);
      return;
    }
    await closeAndFocus(tabId, stickyTab);
    log(`[${ruleName}] [${containerLabel}] Closed duplicate tab, focused sticky tab`);
    return;
  }

  // Script action: run the rule's JavaScript in the sticky tab instead of
  // reloading it. Close the incoming tab FIRST so it never lingers, then
  // execute; on failure fall back to a plain reload so navigation is never lost.
  if (rule.action === 'script' && resolveRuleScript(rule)) {
    await closeAndFocus(tabId, stickyTab);
    const ran = await executeStickyScript(rule, stickyTab, url, containerLabel);
    if (!ran) {
      // Script failed to start or rejected - fall back to reloading the tab.
      await browser.tabs.update(stickyTab.id, { url: url });
      log(`[${ruleName}] [${containerLabel}] Fell back to reload: ${url}`);
    }
    return;
  }

  // Redirect: update sticky tab with new URL, close new tab, focus sticky
  await browser.tabs.update(stickyTab.id, { url: url });
  await closeAndFocus(tabId, stickyTab);
  log(`[${ruleName}] [${containerLabel}] Redirected to sticky tab: ${url}`);
}

/**
 * Handle tab removal - clean up sticky tab tracking
 */
function handleTabRemoved(tabId) {
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
  
  // Reload rules when storage changes
  browser.storage.onChanged.addListener(handleStorageChange);
  
  log('Extension loaded and ready');
}

init();
