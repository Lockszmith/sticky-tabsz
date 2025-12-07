// Sticky TabSZ Options Page

const RULE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

let rules = [];
let settings = {
  debugLogging: false,
  focusStickyTab: true,
  useSync: true
};
let hasUnsavedChanges = false;
let ruleIdCounter = 0;
let savedRulesSnapshot = '';
let modifiedRuleIds = new Set();

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
  setupUnsavedWarning();
  updateSaveButtonState(); // Set initial button state (grayed out)
  
  // Handle URL parameters (for creating new rules from popup)
  handleUrlParams();
  
  // Handle URL hash for tab navigation
  handleUrlHash();
});

// ============ Unsaved Changes Tracking ============

function markUnsaved() {
  hasUnsavedChanges = true;
  updateSaveButtonState();
}

function markRuleModified(ruleId) {
  modifiedRuleIds.add(ruleId);
  const card = rulesContainer.querySelector(`[data-rule-id="${ruleId}"]`);
  if (card) {
    card.classList.add('modified');
  }
  markUnsaved();
}

function markSaved() {
  hasUnsavedChanges = false;
  savedRulesSnapshot = JSON.stringify(rules);
  modifiedRuleIds.clear();
  // Remove modified class from all cards
  rulesContainer.querySelectorAll('.rule-card.modified').forEach(card => {
    card.classList.remove('modified');
  });
  updateSaveButtonState();
}

function updateSaveButtonState() {
  if (saveBtn) {
    saveBtn.classList.toggle('has-changes', hasUnsavedChanges);
    saveBtn.disabled = !hasUnsavedChanges;
    saveBtn.textContent = hasUnsavedChanges ? 'Save Rules *' : 'Save Rules';
  }
}

function setupUnsavedWarning() {
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      return e.returnValue;
    }
  });
}

// ============ URL Hash for Tab Navigation ============

function handleUrlHash() {
  const hash = window.location.hash.slice(1); // Remove #
  if (hash) {
    switchToTab(hash);
  }
  
  // Listen for hash changes (back/forward navigation)
  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash.slice(1);
    if (newHash) {
      switchToTab(newHash, false); // Don't update hash again
    }
  });
}

function switchToTab(tabName, updateHash = true) {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  // Find the matching tab button
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (!targetBtn) return;
  
  // Update button states
  tabButtons.forEach(b => b.classList.remove('active'));
  targetBtn.classList.add('active');
  
  // Update content visibility
  tabContents.forEach(content => {
    content.classList.remove('active');
    if (content.id === `tab-${tabName}`) {
      content.classList.add('active');
    }
  });
  
  // Update URL hash
  if (updateHash && window.location.hash !== `#${tabName}`) {
    history.replaceState(null, '', `#${tabName}`);
  }
}

// ============ URL Parameters ============

function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  
  // Handle new rule creation with pre-filled data
  if (params.get('new') === '1') {
    let ruleData = null;
    
    // Try to parse pre-filled data
    const dataParam = params.get('data');
    if (dataParam) {
      try {
        ruleData = JSON.parse(atob(dataParam));
      } catch (e) {
        console.error('Failed to parse rule data:', e);
      }
    }
    
    // Create the new rule
    createRuleWithData(ruleData);
    
    // Clear URL params without reload
    window.history.replaceState({}, '', window.location.pathname);
  }
  
  // Handle editing existing rule
  const ruleId = params.get('rule');
  if (ruleId) {
    focusRule(parseInt(ruleId, 10));
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/**
 * Focus on an existing rule's pattern field
 */
function focusRule(ruleId) {
  const ruleCard = rulesContainer.querySelector(`[data-rule-id="${ruleId}"]`);
  if (ruleCard) {
    ruleCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Focus the first sticky pattern input
    const patternInput = ruleCard.querySelector('.sticky-patterns .pattern-value');
    if (patternInput) {
      // Small delay to allow scroll to complete
      setTimeout(() => {
        patternInput.focus();
        patternInput.setSelectionRange(patternInput.value.length, patternInput.value.length);
      }, 300);
    }
  }
}

/**
 * Create a new rule with optional pre-filled data
 */
function createRuleWithData(data = null) {
  const newRule = {
    id: ruleIdCounter++,
    enabled: true,
    name: data?.name || '',
    containerSeparation: true,
    stickyPatterns: data?.stickyPattern ? [data.stickyPattern] : [],
    matchPatterns: [],
    description: data?.description || ''
  };
  
  rules.push(newRule);
  renderRules();
  markRuleModified(newRule.id);
  
  // Focus appropriate input
  const newCard = rulesContainer.querySelector(`[data-rule-id="${newRule.id}"]`);
  if (newCard) {
    newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Focus the sticky pattern input if data was pre-filled, otherwise focus rule name
    if (data?.stickyPattern) {
      const patternInput = newCard.querySelector('.sticky-patterns .pattern-value');
      if (patternInput) {
        patternInput.focus();
        // Move caret to end of field (no selection)
        patternInput.setSelectionRange(patternInput.value.length, patternInput.value.length);
      }
    } else {
      newCard.querySelector('.rule-name').focus();
    }
  }
  
  // Show save reminder
  showSaveStatus('Rule created - don\'t forget to save!', false);
}

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

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      switchToTab(targetTab);
    });
  });
}

// ============ Storage Helpers ============

function getStorage() {
  return settings.useSync ? browser.storage.sync : browser.storage.local;
}

// ============ Rules Management ============

async function loadRules() {
  try {
    // Always load settings first from local storage to know which storage to use for rules
    const settingsResult = await browser.storage.local.get('settings');
    settings = settingsResult.settings || {
      debugLogging: false,
      focusStickyTab: true,
      useSync: false
    };
    
    // Load rules from the appropriate storage
    const storage = getStorage();
    const result = await storage.get('rules');
    rules = result.rules || [];
    ruleIdCounter = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 0;
    
    // Save initial snapshot for change tracking
    savedRulesSnapshot = JSON.stringify(rules);
    hasUnsavedChanges = false;
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

    const storage = getStorage();
    await storage.set({ rules });
    markSaved();
    showSaveStatus('Rules saved!' + (settings.useSync ? ' (synced)' : ''), false);
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
    markRuleModified(rule.id);
  });
  
  card.querySelector('.rule-name').addEventListener('input', (e) => {
    const input = e.target;
    const isValid = RULE_NAME_PATTERN.test(input.value) || input.value === '';
    input.classList.toggle('invalid', !isValid && input.value !== '');
    rule.name = input.value;
    markRuleModified(rule.id);
  });
  
  card.querySelector('.container-separation').addEventListener('change', (e) => {
    rule.containerSeparation = e.target.checked;
    markRuleModified(rule.id);
  });
  
  card.querySelector('.rule-description').addEventListener('input', (e) => {
    rule.description = e.target.value;
    markRuleModified(rule.id);
  });
  
  card.querySelector('.delete-rule').addEventListener('click', () => {
    deleteRule(rule.id);
  });
  
  card.querySelector('.add-sticky-pattern').addEventListener('click', () => {
    const container = card.querySelector('.sticky-patterns');
    container.appendChild(createPatternInput());
    updatePatternsFromDOM(card, rule);
    setupPatternListeners(card, rule);
    markRuleModified(rule.id);
  });
  
  card.querySelector('.add-match-pattern').addEventListener('click', () => {
    const container = card.querySelector('.match-patterns');
    container.appendChild(createPatternInput());
    updatePatternsFromDOM(card, rule);
    setupPatternListeners(card, rule);
    markRuleModified(rule.id);
  });
  
  setupPatternListeners(card, rule);
}

function setupPatternListeners(card, rule) {
  card.querySelectorAll('.remove-pattern').forEach(btn => {
    btn.onclick = (e) => {
      e.target.closest('.pattern-input').remove();
      updatePatternsFromDOM(card, rule);
      markRuleModified(rule.id);
    };
  });
  
  card.querySelectorAll('.pattern-value').forEach(input => {
    input.oninput = () => {
      updatePatternsFromDOM(card, rule);
      markRuleModified(rule.id);
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
  createRuleWithData(null);
}

function deleteRule(ruleId) {
  rules = rules.filter(r => r.id !== ruleId);
  markUnsaved();
  renderRules();
}

// ============ Settings Management ============

async function loadSettings() {
  try {
    // Settings are already loaded in loadRules(), just update UI
    document.getElementById('setting-debug-logging').checked = settings.debugLogging;
    document.getElementById('setting-focus-sticky').checked = settings.focusStickyTab;
    document.getElementById('setting-use-sync').checked = settings.useSync;
    
    // Update sync status display
    updateSyncStatus();
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function updateSyncStatus() {
  const syncStatus = document.getElementById('sync-status');
  if (settings.useSync) {
    syncStatus.textContent = '✓ Rules will sync across devices via Firefox Account';
    syncStatus.className = 'sync-status visible success';
  } else {
    syncStatus.textContent = '';
    syncStatus.className = 'sync-status';
  }
}

async function saveSettings() {
  try {
    settings.debugLogging = document.getElementById('setting-debug-logging').checked;
    settings.focusStickyTab = document.getElementById('setting-focus-sticky').checked;
    
    // Settings always stored locally
    await browser.storage.local.set({ settings });
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

/**
 * Handle sync toggle change - migrate rules between local and sync storage
 */
async function handleSyncToggle(newUseSync) {
  const syncStatus = document.getElementById('sync-status');
  const oldUseSync = settings.useSync;
  
  if (newUseSync === oldUseSync) return;
  
  try {
    syncStatus.textContent = newUseSync ? 'Migrating rules to sync storage...' : 'Migrating rules to local storage...';
    syncStatus.className = 'sync-status visible info';
    
    // Get current rules from the current storage
    const currentStorage = getStorage();
    const currentRules = (await currentStorage.get('rules')).rules || [];
    
    // Update setting
    settings.useSync = newUseSync;
    
    // Get the new storage
    const newStorage = getStorage();
    
    // Check if new storage has existing rules
    const newStorageRules = (await newStorage.get('rules')).rules || [];
    
    if (newStorageRules.length > 0 && currentRules.length > 0) {
      // Both have rules - ask user what to do
      const merge = confirm(
        `You have ${currentRules.length} rule(s) locally and ${newStorageRules.length} rule(s) in sync storage.\n\n` +
        `Click OK to merge both sets, or Cancel to replace sync with local rules.`
      );
      
      if (merge) {
        // Merge: combine rules, avoiding duplicates by name
        const existingNames = new Set(newStorageRules.map(r => r.name));
        const uniqueCurrentRules = currentRules.filter(r => !existingNames.has(r.name));
        rules = [...newStorageRules, ...uniqueCurrentRules];
        
        // Update ID counter
        ruleIdCounter = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 0;
      } else {
        // Replace: use current rules
        rules = currentRules;
      }
    } else if (newStorageRules.length > 0 && currentRules.length === 0) {
      // New storage has rules, current doesn't - use new storage rules
      rules = newStorageRules;
      ruleIdCounter = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 0;
    }
    // else: current rules stay as-is (including if both empty)
    
    // Save rules to new storage
    await newStorage.set({ rules });
    
    // Save settings (always local)
    await browser.storage.local.set({ settings });
    
    // Clear old storage rules (optional, for cleanliness)
    const oldStorage = oldUseSync ? browser.storage.sync : browser.storage.local;
    // Don't clear old storage - keep as backup
    
    // Update UI
    renderRules();
    updateSyncStatus();
    
    syncStatus.textContent = newUseSync 
      ? '✓ Rules migrated to sync storage' 
      : '✓ Rules migrated to local storage';
    syncStatus.className = 'sync-status visible success';
    
    setTimeout(() => updateSyncStatus(), 3000);
    
  } catch (e) {
    console.error('Failed to toggle sync:', e);
    
    // Revert toggle
    settings.useSync = oldUseSync;
    document.getElementById('setting-use-sync').checked = oldUseSync;
    
    syncStatus.textContent = 'Failed to migrate: ' + e.message;
    syncStatus.className = 'sync-status visible error';
  }
}

function setupSettingsListeners() {
  // All settings save immediately on change
  document.getElementById('setting-debug-logging').addEventListener('change', saveSettings);
  document.getElementById('setting-focus-sticky').addEventListener('change', saveSettings);
  
  // Sync toggle - handle immediately with migration logic
  document.getElementById('setting-use-sync').addEventListener('change', (e) => {
    handleSyncToggle(e.target.checked);
  });
  
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
          // Preserve current sync setting, update others
          const currentUseSync = settings.useSync;
          settings = { ...data.settings, useSync: currentUseSync };
          document.getElementById('setting-debug-logging').checked = settings.debugLogging;
          document.getElementById('setting-focus-sticky').checked = settings.focusStickyTab;
        }
        
        // Save imported data to appropriate storage
        const storage = getStorage();
        await storage.set({ rules });
        await browser.storage.local.set({ settings });
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
