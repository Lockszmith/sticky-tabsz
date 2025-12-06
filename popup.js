// Sticky TabSZ Popup

async function init() {
  const statusIcon = document.getElementById('status-icon');
  const statusText = document.getElementById('status-text');
  const ruleStatus = document.getElementById('rule-status');
  const settingsBtn = document.getElementById('settings-btn');

  // Get current tab
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  const currentUrl = currentTab?.url || '';

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
    ruleStatus.addEventListener('click', () => {
      browser.tabs.create({ url: browser.runtime.getURL('options.html') + `?rule=${matchingRule.id}` });
      window.close();
    });
  } else {
    statusIcon.classList.add('inactive');
    statusIcon.classList.remove('active');
    statusText.textContent = 'Create Rule...';
    statusText.classList.add('create-rule');
    
    // Click to create new rule
    ruleStatus.title = 'Click to create a new rule for this site';
    ruleStatus.addEventListener('click', () => {
      browser.tabs.create({ url: browser.runtime.getURL('options.html') + '?new=1' });
      window.close();
    });
  }

  // Settings button
  settingsBtn.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
    window.close();
  });
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

