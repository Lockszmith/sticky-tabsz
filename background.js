// Sticky TabSZ Extension
// Currently configured for: Salesforce Cases on vastdata
// Supports Firefox Multi-Account Containers

const STICKY_PATTERN = /^https:\/\/vastdata\.lightning\.force\.com\/lightning\/r\/Case\//;

// Store sticky tab IDs per container (cookieStoreId -> tabId)
// Each container gets its own sticky tab
const stickyTabsByContainer = new Map();

/**
 * Check if a URL matches our sticky pattern
 */
function matchesStickyPattern(url) {
  return STICKY_PATTERN.test(url);
}

/**
 * Get container name for logging (for debugging)
 */
function getContainerLabel(cookieStoreId) {
  if (cookieStoreId === "firefox-default") {
    return "default";
  }
  // Container IDs look like "firefox-container-1", "firefox-container-2", etc.
  return cookieStoreId.replace("firefox-", "");
}

/**
 * Find an existing sticky tab for a specific container
 */
async function findExistingStickyTab(cookieStoreId) {
  const tabs = await browser.tabs.query({
    url: "*://vastdata.lightning.force.com/*",
    cookieStoreId: cookieStoreId
  });
  
  // First, check if our stored sticky tab for this container still exists
  const storedStickyId = stickyTabsByContainer.get(cookieStoreId);
  if (storedStickyId !== undefined) {
    const existingSticky = tabs.find(tab => tab.id === storedStickyId);
    if (existingSticky && matchesStickyPattern(existingSticky.url)) {
      return existingSticky;
    }
    // Stored tab no longer valid, clean up
    stickyTabsByContainer.delete(cookieStoreId);
  }
  
  // Otherwise, find the first tab in this container matching our Case pattern
  for (const tab of tabs) {
    if (matchesStickyPattern(tab.url)) {
      return tab;
    }
  }
  
  return null;
}

/**
 * Handle navigation events - redirect to sticky tab if applicable
 */
async function handleNavigation(details) {
  // Only handle main frame navigations
  if (details.frameId !== 0) return;
  
  // Check if URL matches our pattern
  if (!matchesStickyPattern(details.url)) return;
  
  const newTabId = details.tabId;
  const newUrl = details.url;
  
  // Get the new tab's container info
  let newTab;
  try {
    newTab = await browser.tabs.get(newTabId);
  } catch (e) {
    // Tab might have been closed already
    console.log(`[Sticky TabSZ] Could not get tab ${newTabId}: ${e.message}`);
    return;
  }
  
  const containerId = newTab.cookieStoreId;
  const containerLabel = getContainerLabel(containerId);
  
  // Find existing sticky tab in the same container
  const stickyTab = await findExistingStickyTab(containerId);
  
  // If no sticky tab exists in this container, this tab becomes sticky
  if (!stickyTab) {
    stickyTabsByContainer.set(containerId, newTabId);
    console.log(`[Sticky TabSZ] Tab ${newTabId} is now sticky for container [${containerLabel}]`);
    return;
  }
  
  // If navigation is in the sticky tab itself, just let it happen
  if (newTabId === stickyTab.id) {
    return;
  }
  
  // If the URL is the same, just close the new tab and focus existing
  if (newUrl === stickyTab.url) {
    await browser.tabs.remove(newTabId);
    await browser.tabs.update(stickyTab.id, { active: true });
    console.log(`[Sticky TabSZ] [${containerLabel}] Closed duplicate tab, focused sticky tab`);
    return;
  }
  
  // Redirect: update sticky tab with new URL, close new tab, focus sticky
  await browser.tabs.update(stickyTab.id, { url: newUrl });
  await browser.tabs.remove(newTabId);
  await browser.tabs.update(stickyTab.id, { active: true });
  console.log(`[Sticky TabSZ] [${containerLabel}] Redirected to sticky tab: ${newUrl}`);
}

// Listen for navigation events to our domain
browser.webNavigation.onBeforeNavigate.addListener(
  handleNavigation,
  { url: [{ hostEquals: "vastdata.lightning.force.com" }] }
);

// Clean up if a sticky tab is closed
browser.tabs.onRemoved.addListener((tabId) => {
  // Find and remove any container mapping for this tab
  for (const [containerId, stickyId] of stickyTabsByContainer.entries()) {
    if (stickyId === tabId) {
      stickyTabsByContainer.delete(containerId);
      console.log(`[Sticky TabSZ] Sticky tab for container [${getContainerLabel(containerId)}] was closed`);
      break;
    }
  }
});

console.log("[Sticky TabSZ] Extension loaded - watching for Salesforce Case URLs (container-aware)");
