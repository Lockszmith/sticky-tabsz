// Sticky TabSZ Extension
// Currently configured for: Salesforce Cases on vastdata
// Supports Firefox Multi-Account Containers

const STICKY_PATTERN = /^https:\/\/vastdata\.lightning\.force\.com\/lightning\/.\/Case\//;

// Store sticky tab IDs per container (cookieStoreId -> tabId)
const stickyTabsByContainer = new Map();

/**
 * Check if a URL matches our sticky pattern
 */
function matchesStickyPattern(url) {
  return STICKY_PATTERN.test(url);
}

/**
 * Get container name for logging
 */
function getContainerLabel(cookieStoreId) {
  if (cookieStoreId === "firefox-default") {
    return "default";
  }
  return cookieStoreId.replace("firefox-", "");
}

/**
 * Find an existing sticky tab for a specific container
 * Priority: 1) stored sticky if valid, 2) any tab matching STICKY_PATTERN
 */
async function findExistingStickyTab(cookieStoreId, excludeTabId = null) {
  const tabs = await browser.tabs.query({
    url: "*://vastdata.lightning.force.com/*",
    cookieStoreId: cookieStoreId
  });
  
  // Filter out the excluded tab
  const candidateTabs = tabs.filter(tab => tab.id !== excludeTabId);
  
  if (candidateTabs.length === 0) {
    return null;
  }
  
  // Priority 1: Check if our stored sticky tab still exists and matches pattern
  const storedStickyId = stickyTabsByContainer.get(cookieStoreId);
  if (storedStickyId !== undefined) {
    const existingSticky = candidateTabs.find(tab => tab.id === storedStickyId);
    if (existingSticky && matchesStickyPattern(existingSticky.url)) {
      return existingSticky;
    }
    // Stored tab no longer valid, clean up
    stickyTabsByContainer.delete(cookieStoreId);
  }
  
  // Priority 2: Find any tab matching STICKY_PATTERN
  const patternMatch = candidateTabs.find(tab => matchesStickyPattern(tab.url));
  if (patternMatch) {
    // Update stored sticky to this tab
    stickyTabsByContainer.set(cookieStoreId, patternMatch.id);
    return patternMatch;
  }
  
  return null;
}

/**
 * Handle completed navigation - catches direct navigations AND redirects
 */
async function handleCompletedNavigation(details) {
  if (details.frameId !== 0) return;
  if (!matchesStickyPattern(details.url)) return;
  
  const tabId = details.tabId;
  const url = details.url;
  
  // Get the tab's container info
  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch (e) {
    console.log(`[Sticky TabSZ] Could not get tab ${tabId}: ${e.message}`);
    return;
  }
  
  const containerId = tab.cookieStoreId;
  const containerLabel = getContainerLabel(containerId);
  
  // Find existing sticky tab in the same container (excluding this tab)
  const stickyTab = await findExistingStickyTab(containerId, tabId);
  
  // If no sticky tab exists in this container, this tab becomes sticky
  if (!stickyTab) {
    stickyTabsByContainer.set(containerId, tabId);
    console.log(`[Sticky TabSZ] Tab ${tabId} is now sticky for container [${containerLabel}]`);
    return;
  }
  
  // If this IS the sticky tab, just let it be
  if (tabId === stickyTab.id) {
    return;
  }
  
  // If the URL is the same, just close the new tab and focus existing
  if (url === stickyTab.url) {
    await browser.tabs.remove(tabId);
    await browser.tabs.update(stickyTab.id, { active: true });
    console.log(`[Sticky TabSZ] [${containerLabel}] Closed duplicate tab, focused sticky tab`);
    return;
  }
  
  // Redirect: update sticky tab with new URL, close new tab, focus sticky
  await browser.tabs.update(stickyTab.id, { url: url });
  await browser.tabs.remove(tabId);
  await browser.tabs.update(stickyTab.id, { active: true });
  console.log(`[Sticky TabSZ] [${containerLabel}] Redirected to sticky tab: ${url}`);
}

// Listen for completed navigations to Salesforce (catches full page loads)
browser.webNavigation.onCompleted.addListener(
  handleCompletedNavigation,
  { url: [{ hostEquals: "vastdata.lightning.force.com" }] }
);

// Listen for SPA navigation (history.pushState/replaceState) - catches Salesforce Lightning internal navigation
browser.webNavigation.onHistoryStateUpdated.addListener(
  handleCompletedNavigation,
  { url: [{ hostEquals: "vastdata.lightning.force.com" }] }
);

// DEBUG: Log ALL completed navigations to force.com
browser.webNavigation.onCompleted.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    console.log(`[Sticky TabSZ DEBUG] onCompleted:`, {
      url: details.url,
      tabId: details.tabId,
      matchesPattern: matchesStickyPattern(details.url)
    });
  },
  { url: [{ hostContains: "force.com" }] }
);

// DEBUG: Log SPA navigations
browser.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    console.log(`[Sticky TabSZ DEBUG] onHistoryStateUpdated (SPA):`, {
      url: details.url,
      tabId: details.tabId,
      matchesPattern: matchesStickyPattern(details.url)
    });
  },
  { url: [{ hostContains: "force.com" }] }
);

// Clean up if a sticky tab is closed
browser.tabs.onRemoved.addListener((tabId) => {
  for (const [containerId, stickyId] of stickyTabsByContainer.entries()) {
    if (stickyId === tabId) {
      stickyTabsByContainer.delete(containerId);
      console.log(`[Sticky TabSZ] Sticky tab for container [${getContainerLabel(containerId)}] was closed`);
      break;
    }
  }
});

console.log("[Sticky TabSZ] Extension loaded - watching for Salesforce Case URLs (container-aware)");
