// Sticky TabSZ Options Page

const RULE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

let rules = [];
let settings = {
  debugLogging: true,
  focusStickyTab: true
};
let ruleIdCounter = 0;

// DOM Elements - will be set after DOMContentLoaded
let rulesContainer, noRulesMessage, addRuleBtn, saveBtn, saveStatus;
let ruleTemplate, patternTemplate;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  rulesContainer = document.getElementById('rules-container');
  noRulesMessage = document.getElementById('no-rules');
  addRuleBtn = document.getElementById('add-rule');
  saveBtn = document.getElementById('save-btn');
  saveStatus = document.getElementById('save-status');
  ruleTemplate = document.getElementById('rule-template');
  patternTemplate = document.getElementById('pattern-template');

  await loadRules();
  await loadSettings();
  renderRules();
  setupEventListeners();
  setupTabNavigation();
  setupSettingsListeners();
  setupPopOutButton();
});

// ============ Pop-Out Button ============

function setupPopOutButton() {
  const popOutBtn = document.getElementById('pop-out-btn');
  if (popOutBtn) {
    popOutBtn.addEventListener('click', () => {
      // Open options.html in a new tab
      browser.tabs.create({ url: browser.runtime.getURL('options.html') });
    });
  }
}

// ============ Tab Navigation ============

function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      // Update button states
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update content visibility
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `tab-${targetTab}`) {
          content.classList.add('active');
        }
      });
    });
  });
}

// ============ Rules Management ============

async function loadRules() {
  try {
    const result = await browser.storage.local.get('rules');
    rules = result.rules || [];
    ruleIdCounter = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 0;
  } catch (e) {
    console.error('Failed to load rules:', e);
    rules = [];
  }
}

async function saveRules() {
  try {
    const validation = validateRules();
    if (!validation.valid) {
      showSaveStatus(validation.error, true);
      return false;
    }

    await browser.storage.local.set({ rules });
    showSaveStatus('Rules saved!', false);
    return true;
  } catch (e) {
    console.error('Failed to save rules:', e);
    showSaveStatus('Failed to save rules', true);
    return false;
  }
}

function validateRules() {
  for (const rule of rules) {
    if (!rule.name || !RULE_NAME_PATTERN.test(rule.name)) {
      return { valid: false, error: `Invalid rule name: "${rule.name}". Use only alphanumeric, dash, underscore.` };
    }
    if (!rule.stickyPatterns || rule.stickyPatterns.length === 0) {
      return { valid: false, error: `Rule "${rule.name}" must have at least one sticky pattern.` };
    }
    for (const pattern of rule.stickyPatterns) {
      try {
        new RegExp(pattern);
      } catch (e) {
        return { valid: false, error: `Invalid regex in "${rule.name}" sticky patterns: ${pattern}` };
      }
    }
    for (const pattern of (rule.matchPatterns || [])) {
      try {
        new RegExp(pattern);
      } catch (e) {
        return { valid: false, error: `Invalid regex in "${rule.name}" match patterns: ${pattern}` };
      }
    }
  }
  return { valid: true };
}

function showSaveStatus(message, isError, statusElement = saveStatus) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', isError);
  statusElement.classList.add('visible');
  setTimeout(() => {
    statusElement.classList.remove('visible');
  }, 3000);
}

function renderRules() {
  rulesContainer.innerHTML = '';
  
  if (rules.length === 0) {
    noRulesMessage.classList.remove('hidden');
  } else {
    noRulesMessage.classList.add('hidden');
    rules.forEach(rule => renderRule(rule));
  }
}

function renderRule(rule) {
  const template = ruleTemplate.content.cloneNode(true);
  const card = template.querySelector('.rule-card');
  
  card.dataset.ruleId = rule.id;
  card.classList.toggle('disabled', !rule.enabled);
  
  card.querySelector('.rule-enabled').checked = rule.enabled;
  card.querySelector('.rule-name').value = rule.name;
  card.querySelector('.container-separation').checked = rule.containerSeparation;
  card.querySelector('.rule-description').value = rule.description || '';
  
  const stickyPatternsContainer = card.querySelector('.sticky-patterns');
  const matchPatternsContainer = card.querySelector('.match-patterns');
  
  (rule.stickyPatterns || []).forEach(pattern => {
    stickyPatternsContainer.appendChild(createPatternInput(pattern));
  });
  
  (rule.matchPatterns || []).forEach(pattern => {
    matchPatternsContainer.appendChild(createPatternInput(pattern));
  });
  
  setupCardEventListeners(card, rule);
  rulesContainer.appendChild(card);
}

function createPatternInput(value = '') {
  const template = patternTemplate.content.cloneNode(true);
  const input = template.querySelector('.pattern-value');
  input.value = value;
  return template;
}

function setupCardEventListeners(card, rule) {
  card.querySelector('.rule-enabled').addEventListener('change', (e) => {
    rule.enabled = e.target.checked;
    card.classList.toggle('disabled', !rule.enabled);
  });
  
  card.querySelector('.rule-name').addEventListener('input', (e) => {
    const input = e.target;
    const isValid = RULE_NAME_PATTERN.test(input.value) || input.value === '';
    input.classList.toggle('invalid', !isValid && input.value !== '');
    rule.name = input.value;
  });
  
  card.querySelector('.container-separation').addEventListener('change', (e) => {
    rule.containerSeparation = e.target.checked;
  });
  
  card.querySelector('.rule-description').addEventListener('input', (e) => {
    rule.description = e.target.value;
  });
  
  card.querySelector('.delete-rule').addEventListener('click', () => {
    deleteRule(rule.id);
  });
  
  card.querySelector('.add-sticky-pattern').addEventListener('click', () => {
    const container = card.querySelector('.sticky-patterns');
    container.appendChild(createPatternInput());
    updatePatternsFromDOM(card, rule);
    setupPatternListeners(card, rule);
  });
  
  card.querySelector('.add-match-pattern').addEventListener('click', () => {
    const container = card.querySelector('.match-patterns');
    container.appendChild(createPatternInput());
    updatePatternsFromDOM(card, rule);
    setupPatternListeners(card, rule);
  });
  
  setupPatternListeners(card, rule);
}

function setupPatternListeners(card, rule) {
  card.querySelectorAll('.remove-pattern').forEach(btn => {
    btn.onclick = (e) => {
      e.target.closest('.pattern-input').remove();
      updatePatternsFromDOM(card, rule);
    };
  });
  
  card.querySelectorAll('.pattern-value').forEach(input => {
    input.oninput = () => {
      updatePatternsFromDOM(card, rule);
    };
  });
}

function updatePatternsFromDOM(card, rule) {
  rule.stickyPatterns = Array.from(card.querySelectorAll('.sticky-patterns .pattern-value'))
    .map(input => input.value)
    .filter(v => v.trim() !== '');
  
  rule.matchPatterns = Array.from(card.querySelectorAll('.match-patterns .pattern-value'))
    .map(input => input.value)
    .filter(v => v.trim() !== '');
}

function addRule() {
  const newRule = {
    id: ruleIdCounter++,
    enabled: true,
    name: '',
    containerSeparation: true,
    stickyPatterns: [],
    matchPatterns: [],
    description: ''
  };
  
  rules.push(newRule);
  renderRules();
  
  const newCard = rulesContainer.querySelector(`[data-rule-id="${newRule.id}"]`);
  if (newCard) {
    newCard.querySelector('.rule-name').focus();
  }
}

function deleteRule(ruleId) {
  rules = rules.filter(r => r.id !== ruleId);
  renderRules();
}

// ============ Settings Management ============

async function loadSettings() {
  try {
    const result = await browser.storage.local.get('settings');
    settings = result.settings || {
      debugLogging: true,
      focusStickyTab: true
    };
    
    // Update UI
    document.getElementById('setting-debug-logging').checked = settings.debugLogging;
    document.getElementById('setting-focus-sticky').checked = settings.focusStickyTab;
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

async function saveSettings() {
  try {
    settings.debugLogging = document.getElementById('setting-debug-logging').checked;
    settings.focusStickyTab = document.getElementById('setting-focus-sticky').checked;
    
    await browser.storage.local.set({ settings });
    showSaveStatus('Settings saved!', false, document.getElementById('settings-save-status'));
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    showSaveStatus('Failed to save settings', true, document.getElementById('settings-save-status'));
    return false;
  }
}

function setupSettingsListeners() {
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  
  // Export rules
  document.getElementById('export-rules').addEventListener('click', () => {
    const data = {
      version: '0.1.4',
      exportDate: new Date().toISOString(),
      rules: rules,
      settings: settings
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sticky-tabsz-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  
  // Import rules
  const importFile = document.getElementById('import-file');
  document.getElementById('import-rules').addEventListener('click', () => {
    importFile.click();
  });
  
  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (data.rules && Array.isArray(data.rules)) {
        rules = data.rules;
        ruleIdCounter = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 0;
        renderRules();
        
        if (data.settings) {
          settings = data.settings;
          document.getElementById('setting-debug-logging').checked = settings.debugLogging;
          document.getElementById('setting-focus-sticky').checked = settings.focusStickyTab;
        }
        
        // Save imported data
        await browser.storage.local.set({ rules, settings });
        showSaveStatus('Import successful!', false, document.getElementById('settings-save-status'));
      } else {
        throw new Error('Invalid backup file format');
      }
    } catch (err) {
      console.error('Import failed:', err);
      showSaveStatus('Import failed: ' + err.message, true, document.getElementById('settings-save-status'));
    }
    
    // Reset file input
    importFile.value = '';
  });
}

// ============ Global Event Listeners ============

function setupEventListeners() {
  addRuleBtn.addEventListener('click', addRule);
  saveBtn.addEventListener('click', saveRules);
  
  // Keyboard shortcut: Ctrl+S to save
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      // Save based on active tab
      const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
      if (activeTab === 'rules') {
        saveRules();
      } else if (activeTab === 'settings') {
        saveSettings();
      }
    }
  });
}
