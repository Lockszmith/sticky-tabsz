// Sticky TabSZ Popup

// Extension's options page URL pattern
const OPTIONS_URL_PATTERN = browser.runtime.getURL('options.html');

async function init() {
  const statusIcon = document.getElementById('status-icon');
  const statusText = document.getElementById('status-text');
  const ruleStatus = document.getElementById('rule-status');
  const settingsBtn = document.getElementById('settings-btn');

  // Get current tab
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  const currentUrl = currentTab?.url || '';
  const currentTitle = currentTab?.title || '';

  // Load rules from storage
  const result = await browser.storage.local.get('rules');
  const rules = (result.rules || []).filter(r => r.enabled);

  // Find matching rule
  let matchingRule = null;
  for (const rule of rules) {
    // Check match patterns first
    if (matchesPatterns(currentUrl, rule.matchPatterns)) {
      matchingRule = rule;
      break;
    }
    // Then check sticky patterns
    if (matchesPatterns(currentUrl, rule.stickyPatterns)) {
      matchingRule = rule;
      break;
    }
  }

  // Update UI
  if (matchingRule) {
    statusIcon.classList.add('active');
    statusIcon.classList.remove('inactive');
    statusText.textContent = matchingRule.name;
    statusText.classList.remove('create-rule');
    
    // Click to edit this rule
    ruleStatus.title = 'Click to edit this rule';
    ruleStatus.addEventListener('click', async () => {
      await openOptionsPage(`?rule=${matchingRule.id}`);
      window.close();
    });
  } else {
    statusIcon.classList.add('inactive');
    statusIcon.classList.remove('active');
    statusText.textContent = 'Create Rule...';
    statusText.classList.add('create-rule');
    
    // Click to create new rule with pre-filled data
    ruleStatus.title = 'Click to create a new rule for this site';
    ruleStatus.addEventListener('click', async () => {
      const newRuleData = generateRuleData(currentUrl, currentTitle);
      const params = new URLSearchParams({
        new: '1',
        data: btoa(JSON.stringify(newRuleData))
      });
      await openOptionsPage('?' + params.toString());
      window.close();
    });
  }

  // Settings button - check preference for pop-out vs embedded
  settingsBtn.addEventListener('click', async () => {
    const { preferPopOut } = await browser.storage.local.get('preferPopOut');
    if (preferPopOut) {
      await openOptionsPage();
    } else {
      await browser.runtime.openOptionsPage();
    }
    window.close();
  });
}

/**
 * Open options page - reuse existing tab if already open
 */
async function openOptionsPage(queryString = '') {
  const optionsUrl = OPTIONS_URL_PATTERN + queryString;
  
  // Find existing options tab
  const existingTabs = await browser.tabs.query({ url: OPTIONS_URL_PATTERN + '*' });
  
  if (existingTabs.length > 0) {
    // Reuse existing tab - update URL and focus
    const existingTab = existingTabs[0];
    await browser.tabs.update(existingTab.id, { 
      url: optionsUrl,
      active: true 
    });
    // Focus the window containing the tab
    await browser.windows.update(existingTab.windowId, { focused: true });
  } else {
    // Create new tab
    await browser.tabs.create({ url: optionsUrl });
  }
}

/**
 * Generate rule data from URL and title
 */
function generateRuleData(url, title) {
  let hostname = '';
  let stickyPattern = '';
  
  try {
    const urlObj = new URL(url);
    hostname = urlObj.hostname;
    
    // Generate a regex pattern from the URL
    // Escape special regex characters in the URL parts
    const escapedProtocol = urlObj.protocol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedHostname = urlObj.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedPathname = urlObj.pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Create pattern: match the base URL with any query/hash
    stickyPattern = `^${escapedProtocol}//${escapedHostname}${escapedPathname}`;
  } catch (e) {
    // Fallback for non-standard URLs
    hostname = 'new-rule';
    stickyPattern = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  // Clean up hostname for rule name (remove common prefixes)
  let ruleName = hostname
    .replace(/^www\./, '')
    .replace(/\./g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '');
  
  return {
    name: ruleName,
    description: title,
    stickyPattern: stickyPattern
  };
}

function matchesPatterns(url, patterns) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some(pattern => {
    try {
      return new RegExp(pattern).test(url);
    } catch (e) {
      return false;
    }
  });
}

init();
