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
 * Load rules from storage (local or sync based on settings)
 */
async function loadRules() {
  try {
    const storage = getStorage();
    const result = await storage.get('rules');
    rules = (result.rules || []).filter(r => r.enabled);
    log(`Loaded ${rules.length} enabled rule(s) from ${settings.useSync ? 'sync' : 'local'} storage`);
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
    await browser.tabs.remove(tabId);
    if (settings.focusStickyTab) {
      await browser.tabs.update(stickyTab.id, { active: true });
    }
    log(`[${ruleName}] [${containerLabel}] Closed duplicate tab, focused sticky tab`);
    return;
  }
  
  // Redirect: update sticky tab with new URL, close new tab, focus sticky
  await browser.tabs.update(stickyTab.id, { url: url });
  await browser.tabs.remove(tabId);
  if (settings.focusStickyTab) {
    await browser.tabs.update(stickyTab.id, { active: true });
  }
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
