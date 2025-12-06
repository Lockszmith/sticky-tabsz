// Sticky Tab Extension
// Currently configured for: Salesforce Cases on vastdata

const STICKY_PATTERN = /^https:\/\/vastdata\.lightning\.force\.com\/lightning\/r\/Case\//;

// Store the sticky tab ID (persists during browser session)
let stickyTabId = null;

/**
 * Check if a URL matches our sticky pattern
 */
function matchesStickyPattern(url) {
  return STICKY_PATTERN.test(url);
}

/**
 * Find an existing tab that matches our pattern
 */
async function findExistingStickyTab() {
  const tabs = await browser.tabs.query({ url: "*://vastdata.lightning.force.com/*" });
  
  // First, check if our stored sticky tab still exists and matches
  if (stickyTabId !== null) {
    const existingSticky = tabs.find(tab => tab.id === stickyTabId);
    if (existingSticky && matchesStickyPattern(existingSticky.url)) {
      return existingSticky;
    }
  }
  
  // Otherwise, find the first tab matching our Case pattern
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
  
  // Find existing sticky tab
  const stickyTab = await findExistingStickyTab();
  
  // If no sticky tab exists, this tab becomes the sticky tab
  if (!stickyTab) {
    stickyTabId = newTabId;
    console.log(`[Sticky Tab] Tab ${newTabId} is now the sticky tab`);
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
    console.log(`[Sticky Tab] Closed duplicate tab, focused sticky tab`);
    return;
  }
  
  // Redirect: update sticky tab with new URL, close new tab, focus sticky
  await browser.tabs.update(stickyTab.id, { url: newUrl });
  await browser.tabs.remove(newTabId);
  await browser.tabs.update(stickyTab.id, { active: true });
  console.log(`[Sticky Tab] Redirected to sticky tab: ${newUrl}`);
}

// Listen for navigation events to our domain
browser.webNavigation.onBeforeNavigate.addListener(
  handleNavigation,
  { url: [{ hostEquals: "vastdata.lightning.force.com" }] }
);

// Clean up if sticky tab is closed
browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === stickyTabId) {
    stickyTabId = null;
    console.log(`[Sticky Tab] Sticky tab was closed`);
  }
});

console.log("[Sticky Tab] Extension loaded - watching for Salesforce Case URLs");

