// Sticky TabSZ Options Page

const RULE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

let rules = [];
// User snippets (key `snippets`). Predefined snippets are window.StickyTabSZBuiltins.
let snippets = [];
let extensionVersion = '';
const SNIPPETS_SYNC_MAX_BYTES = 90 * 1024;
const SNIPPET_CODE_MAX_BYTES = 6 * 1024;
let snippetAce = null;
let snippetEditorState = null;
let settings = {
  debugLogging: false,
  focusStickyTab: true,
  useSync: true
};
// Close-protection default. Same storage as rules (sync when useSync is on).
// Missing key means enabled. Not part of the local-only `settings` object.
let protectStickyTabs = true;
let hasUnsavedChanges = false;
let ruleIdCounter = 0;
let savedRulesSnapshot = '';
let modifiedRuleIds = new Set();

// Per-rule sync override state (only meaningful when useSync is on)
// syncedRules: raw copies of rules as they exist in sync storage
// localRules: rule copies overridden to be local-only
// overrideMeta: { [ruleId]: { lastSyncedHash, lastSyncedAt } }
// localOverrideIds: ids of rules currently overridden (in-memory working set)
let syncedRules = [];
let localRules = [];
let overrideMeta = {};
let localOverrideIds = new Set();

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
  await loadSnippets();
  await loadSettings();
  extensionVersion = browser.runtime.getManifest().version;
  renderRules();
  renderSnippets();
  setupEventListeners();
  setupSnippetTab();
  setupTabNavigation();
  setupSettingsListeners();
  setupPopOutButton();
  setupUnsavedWarning();
  updateSaveButtonState(); // Set initial button state (grayed out)
  
  // Load info from manifest
  const manifest = browser.runtime.getManifest();
  document.getElementById('version').textContent = manifest.version;
  document.getElementById('author').textContent = manifest.author;
  document.getElementById('link-homepage').href = manifest.homepage_url;
  document.getElementById('link-issues').href = manifest.homepage_url + '/issues';
  
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
    description: data?.description || '',
    action: 'reload',           // 'reload' (default) | 'script'
    actionScript: '',           // inline JS, used when action === 'script'
    snippetId: null             // reserved for a future snippet library
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
    popOutBtn.addEventListener('click', async () => {
      // Save preference to use pop-out mode
      await browser.storage.local.set({ preferPopOut: true });
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

// ============ Rule Hashing (canonical JSON + FNV-1a) ============

/**
 * Canonical JSON: serialize with object keys sorted recursively,
 * so structurally identical rules always produce the same string.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonicalize(value[k]))
    .join(',') + '}';
}

/**
 * FNV-1a 32-bit string hash of a rule's canonical JSON.
 * Used to detect whether the synced copy changed since a local override.
 */
function hashRule(rule) {
  const str = canonicalize(rule);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ============ Effective Rule Resolution ============

/**
 * Effective rule set when sync is on: synced rules overlaid with
 * locally overridden copies, plus local-only override rules.
 * (Mirrors resolveEffectiveRules() in background.js.)
 */
function getEffectiveRules(baseRules, overrides) {
  const overrideMap = new Map(overrides.map(r => [r.id, r]));
  const effective = baseRules.map(r => overrideMap.has(r.id) ? overrideMap.get(r.id) : r);
  const localOnly = overrides.filter(r => !baseRules.some(s => s.id === r.id));
  return [...effective, ...localOnly];
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
    
    // Load override state (always local)
    const localResult = await browser.storage.local.get(['localRules', 'overrideMeta']);
    localRules = localResult.localRules || [];
    overrideMeta = localResult.overrideMeta || {};
    localOverrideIds = new Set(localRules.map(r => r.id));
    
    if (settings.useSync) {
      // Effective set: synced rules overlaid with local overrides
      const syncResult = await browser.storage.sync.get('rules');
      syncedRules = syncResult.rules || [];
      rules = getEffectiveRules(syncedRules, localRules);
    } else {
      // Sync off: overrides are a no-op, plain rules from local storage
      const result = await browser.storage.local.get('rules');
      syncedRules = [];
      rules = result.rules || [];
    }
    ruleIdCounter = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 0;

    const protectResult = await getStorage().get('protectStickyTabs');
    protectStickyTabs = typeof protectResult.protectStickyTabs === 'boolean'
      ? protectResult.protectStickyTabs
      : true;
    
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

    if (settings.useSync) {
      // Split into synced part and locally overridden part
      const syncedPart = rules.filter(r => !localOverrideIds.has(r.id));
      const overriddenPart = rules.filter(r => localOverrideIds.has(r.id));
      
      // Update overrideMeta.lastSyncedHash for rules being written to sync
      // (frozen for overridden rules - their meta keeps the hash from the
      // moment they were overridden, which is what conflict detection needs)
      const meta = { ...overrideMeta };
      const liveIds = new Set(rules.map(r => r.id));
      for (const r of syncedPart) {
        meta[r.id] = { lastSyncedHash: hashRule(r), lastSyncedAt: Date.now() };
      }
      // Prune meta for deleted rules
      for (const id of Object.keys(meta)) {
        if (!liveIds.has(Number(id))) delete meta[id];
      }
      
      await browser.storage.sync.set({ rules: syncedPart });
      await browser.storage.local.set({ localRules: overriddenPart, overrideMeta: meta });
      overrideMeta = meta;
      localRules = overriddenPart;
      // Keep the in-memory synced snapshot fresh so overrideRule()
      // hashes the copy that is actually in sync storage right now
      syncedRules = syncedPart;
    } else {
      const storage = getStorage();
      await storage.set({ rules });
    }
    markSaved();
    const syncNote = settings.useSync ? ' (synced)' : '';
    const warnings = validation.warnings || [];
    if (warnings.length) {
      showSaveStatus(`Rules saved!${syncNote} Warning: ${warnings.join(' ')}`, 'warning', saveStatus, 8000);
    } else {
      showSaveStatus('Rules saved!' + syncNote, false);
    }
    return true;
  } catch (e) {
    console.error('Failed to save rules:', e);
    showSaveStatus('Failed to save rules', true);
    return false;
  }
}

// ============ Action Script Syntax Validation ============

/**
 * Validate action script syntax using the vendored acorn parser.
 * Note: the extension's own CSP blocks new Function()/eval(), so the code is
 * parsed statically instead of test-compiled.
 * @param {string} code - the user's action script
 * @returns {{valid: boolean, error?: string, line?: number, column?: number}}
 */
function validateActionScript(code) {
  if (typeof acorn === 'undefined') {
    // Vendored parser missing - never block saving on a packaging problem.
    return { valid: true };
  }
  try {
    // The snippet executes inside an async IIFE (see background.js
    // buildScriptWrapper), so top-level `await` and `return` are legal.
    acorn.parse(code, {
      ecmaVersion: 'latest',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true
    });
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: e.message,
      line: e.loc ? e.loc.line : null,
      column: e.loc ? e.loc.column : null
    };
  }
}

// Per-textarea debounce handles for the advisory (non-blocking) syntax outline
const scriptSyntaxTimers = new WeakMap();

/**
 * Advisory syntax feedback while typing: flags obvious parse errors with a
 * red outline after a short debounce. Non-blocking - save-time validation
 * is the authoritative gate.
 */
function debouncedSyntaxCheck(textarea) {
  clearTimeout(scriptSyntaxTimers.get(textarea));
  scriptSyntaxTimers.set(textarea, setTimeout(() => {
    const code = textarea.value;
    // Empty scripts are reported at save time; only flag non-empty invalid code
    textarea.classList.toggle('invalid',
      code.trim() !== '' && !validateActionScript(code).valid);
  }, 400));
}

function validateRules() {
  const warnings = [];
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
    if (rule.snippetId && !findLibrarySnippet(rule.snippetId)) {
      warnings.push(`Rule "${rule.name}" references missing snippet "${rule.snippetId}".`);
      if ((rule.actionScript || '').trim()) {
        const fallback = validateActionScript(rule.actionScript);
        if (!fallback.valid) {
          const pos = fallback.line ? ` (line ${fallback.line}, column ${(fallback.column ?? 0) + 1})` : '';
          return { valid: false, error: `Rule "${rule.name}" would fall back to an inline script with a syntax error${pos}: ${fallback.error}` };
        }
      }
    }
    const usesInline = rule.action === 'script' && !rule.snippetId;
    if (usesInline && !(rule.actionScript || '').trim()) {
      return { valid: false, error: `Rule "${rule.name}" uses the JavaScript action but has an empty script.` };
    }
    if (usesInline && (rule.actionScript || '').trim()) {
      const check = validateActionScript(rule.actionScript);
      if (!check.valid) {
        const pos = check.line ? ` (line ${check.line}, column ${(check.column ?? 0) + 1})` : '';
        return { valid: false, error: `Syntax error in "${rule.name}" action script${pos}: ${check.error}` };
      }
    }
  }
  return { valid: true, warnings };
}

function showSaveStatus(message, isError, statusElement = saveStatus, duration = 3000) {
  if (!statusElement) return;
  statusElement.textContent = message;
  const tone = isError === 'warning' ? 'warning' : isError ? 'error' : '';
  statusElement.classList.toggle('error', tone === 'error');
  statusElement.classList.toggle('warning', tone === 'warning');
  statusElement.classList.add('visible');
  setTimeout(() => {
    statusElement.classList.remove('visible');
  }, duration);
}

function renderRules() {
  rulesContainer.innerHTML = '';
  
  // Sync override toggles are only meaningful when sync is on
  rulesContainer.classList.toggle('sync-off', !settings.useSync);
  
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

  // Action controls (optional fields - default to legacy 'reload' behavior)
  const actionSelect = card.querySelector('.rule-action');
  const action = rule.action === 'script' ? 'script' : 'reload';
  actionSelect.value = action;
  card.querySelector('.rule-action-script').value = rule.actionScript || '';
  populateSnippetSelect(card.querySelector('.rule-snippet'), rule);
  updateRuleSnippetUi(card, rule);
  card.querySelector('.rule-close-protection').value = closeProtectionValue(rule);
  
  const syncToggle = card.querySelector('.rule-sync');
  if (syncToggle) {
    syncToggle.checked = !localOverrideIds.has(rule.id);
  }
  
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

/**
 * Rule close protection. Missing or unknown values follow the global default.
 */
function closeProtectionValue(rule) {
  if (rule && (rule.closeProtection === 'protect' || rule.closeProtection === 'allow')) {
    return rule.closeProtection;
  }
  return 'inherit';
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

  // Absent closeProtection means "inherit" (global default). Only store
  // protect/allow when the user overrides; putting inherit back removes the field
  // so previously saved rules stay unchanged until they actually choose.
  card.querySelector('.rule-close-protection').addEventListener('change', (e) => {
    if (e.target.value === 'protect' || e.target.value === 'allow') {
      rule.closeProtection = e.target.value;
    } else {
      delete rule.closeProtection;
    }
    markRuleModified(rule.id);
  });

  // Action selector: reload clears the snippet choice; script with no snippet is inline code
  card.querySelector('.rule-action').addEventListener('change', (e) => {
    const action = e.target.value === 'script' ? 'script' : 'reload';
    rule.action = action;
    if (action === 'reload') rule.snippetId = null;
    populateSnippetSelect(card.querySelector('.rule-snippet'), rule);
    updateRuleSnippetUi(card, rule);
    markRuleModified(rule.id);
  });

  card.querySelector('.rule-snippet').addEventListener('change', (e) => {
    const value = e.target.value;
    if (value === 'none') {
      rule.action = 'reload';
      rule.snippetId = null;
    } else if (value === 'inline') {
      rule.action = 'script';
      rule.snippetId = null;
    } else {
      rule.action = 'script';
      rule.snippetId = value;
    }
    card.querySelector('.rule-action').value = rule.action === 'script' ? 'script' : 'reload';
    updateRuleSnippetUi(card, rule);
    markRuleModified(rule.id);
  });

  // Script editor: update rule, with advisory (non-blocking) syntax feedback while typing
  card.querySelector('.rule-action-script').addEventListener('input', (e) => {
    rule.actionScript = e.target.value;
    markRuleModified(rule.id);
    debouncedSyntaxCheck(e.target);
  });
  
  card.querySelector('.rule-description').addEventListener('input', (e) => {
    rule.description = e.target.value;
    markRuleModified(rule.id);
  });
  
  card.querySelector('.delete-rule').addEventListener('click', () => {
    deleteRule(rule.id);
  });
  
  const syncToggle = card.querySelector('.rule-sync');
  if (syncToggle) {
    syncToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        resyncRule(rule, card);
      } else {
        overrideRule(rule);
      }
    });
  }
  
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

// ============ Per-Rule Sync Override ============

/**
 * Toggle OFF (unchecked = local override):
 * Copy the rule into localRules, remove it from the synced set,
 * and record the hash of the last synced copy in overrideMeta so a
 * later re-sync can detect remote changes.
 */
function overrideRule(rule) {
  localOverrideIds.add(rule.id);
  
  // Record the hash of the last synced copy (if the rule is synced at all)
  const syncedCopy = syncedRules.find(r => r.id === rule.id);
  if (syncedCopy) {
    overrideMeta[rule.id] = {
      ...(overrideMeta[rule.id] || {}),
      lastSyncedHash: hashRule(syncedCopy),
      lastSyncedAt: Date.now()
    };
  }
  
  markRuleModified(rule.id);
  showSaveStatus(`Rule "${rule.name}" stays on this device only - save to apply`, false);
}

/**
 * Toggle ON (checked = synchronized):
 * Check whether the synced copy diverged since the override.
 * - No remote copy / identical / remote unchanged / local untouched:
 *   adopt silently (local or remote wins accordingly).
 * - Both sides changed: 3-way conflict modal.
 */
async function resyncRule(rule, card) {
  const syncToggle = card.querySelector('.rule-sync');
  try {
    // Read the synced set fresh so remote changes since page load are caught
    const syncResult = await browser.storage.sync.get('rules');
    const remoteCopy = (syncResult.rules || []).find(r => r.id === rule.id);
    const meta = overrideMeta[rule.id];
    
    if (!remoteCopy) {
      // Rule was created locally while overridden - adopt local copy
      localOverrideIds.delete(rule.id);
      markRuleModified(rule.id);
      showSaveStatus(`Rule "${rule.name}" will sync - save to apply`, false);
      return;
    }
    
    const localHash = hashRule(rule);
    const remoteHash = hashRule(remoteCopy);
    const lastSyncedHash = meta?.lastSyncedHash;
    
    if (localHash === remoteHash) {
      // Local and remote are identical - just move back to synced
      localOverrideIds.delete(rule.id);
      markRuleModified(rule.id);
      return;
    }
    
    if (lastSyncedHash !== undefined && remoteHash === lastSyncedHash) {
      // Remote unchanged since override - local copy wins silently
      localOverrideIds.delete(rule.id);
      markRuleModified(rule.id);
      showSaveStatus(`Rule "${rule.name}" will sync with local changes - save to apply`, false);
      return;
    }
    
    if (lastSyncedHash !== undefined && localHash === lastSyncedHash) {
      // Local copy never edited since override - remote changes win silently
      Object.assign(rule, JSON.parse(JSON.stringify(remoteCopy)));
      localOverrideIds.delete(rule.id);
      renderRules();
      markRuleModified(rule.id);
      showSaveStatus(`Rule "${rule.name}" updated from synced copy`, false);
      return;
    }
    
    // Both sides changed since the override - 3-way modal
    const choice = await showConflictModal(rule, rule, remoteCopy);
    if (choice === 'local') {
      localOverrideIds.delete(rule.id);
      markRuleModified(rule.id);
      showSaveStatus(`Rule "${rule.name}" will sync with local changes - save to apply`, false);
    } else if (choice === 'remote') {
      Object.assign(rule, JSON.parse(JSON.stringify(remoteCopy)));
      localOverrideIds.delete(rule.id);
      renderRules();
      markRuleModified(rule.id);
      showSaveStatus(`Rule "${rule.name}" restored from synced copy`, false);
    } else {
      // Cancel - revert toggle back to local override
      syncToggle.checked = false;
    }
  } catch (e) {
    console.error('Failed to re-sync rule:', e);
    syncToggle.checked = false;
    showSaveStatus('Failed to re-sync rule: ' + e.message, true);
  }
}

// ============ Sync Conflict Modal ============

/**
 * Show the 3-way sync conflict modal.
 * Resolves: 'local' (keep local copy), 'remote' (keep synced copy),
 * or 'cancel' (stay overridden).
 */
function showConflictModal(rule, localCopy, remoteCopy) {
  return new Promise((resolve) => {
    const modal = document.getElementById('conflict-modal');
    document.getElementById('conflict-rule-name').textContent =
      `"${rule.name}" changed on this device and in sync since it was overridden.`;
    
    const meta = overrideMeta[rule.id];
    const remoteChanged =
      meta?.lastSyncedHash !== undefined &&
      hashRule(remoteCopy) !== meta.lastSyncedHash;
    const lastSyncedAt = meta?.lastSyncedAt
      ? new Date(meta.lastSyncedAt).toLocaleString()
      : 'unknown';
    
    const describe = (copy) => {
      const patterns = (copy.stickyPatterns || []).join(' | ') || '-';
      const state = [
        copy.enabled ? 'enabled' : 'disabled',
        copy.containerSeparation ? 'container separation' : null
      ].filter(Boolean).join(', ');
      return `${(copy.stickyPatterns || []).length} sticky pattern(s), ${state}`;
    };
    
    // Build details with DOM APIs (no innerHTML) so user/imported rule
    // names and patterns can never inject markup
    const details = document.getElementById('conflict-details');
    details.textContent = '';
    
    const summary = document.createElement('div');
    summary.className = 'conflict-summary';
    const summaryLastSynced = document.createElement('span');
    summaryLastSynced.textContent = `Last synced: ${lastSyncedAt}`;
    const summarySeparator = document.createElement('span');
    summarySeparator.className = 'separator';
    summarySeparator.textContent = '·';
    const summaryRemote = document.createElement('span');
    summaryRemote.textContent = `Remote changed: ${remoteChanged ? 'yes' : 'no'}`;
    summary.append(summaryLastSynced, summarySeparator, summaryRemote);
    
    const diff = document.createElement('div');
    diff.className = 'conflict-diff';
    
    const makeSide = (title, copy) => {
      const side = document.createElement('div');
      side.className = 'conflict-side';
      const sideTitle = document.createElement('strong');
      sideTitle.textContent = title;
      const sideSmall = document.createElement('small');
      sideSmall.textContent = describe(copy);
      const sidePatterns = document.createElement('code');
      sidePatterns.textContent = (copy.stickyPatterns || []).join(' | ') || '-';
      side.append(sideTitle, sideSmall, sidePatterns);
      return side;
    };
    
    diff.append(
      makeSide('Local (this device)', localCopy),
      makeSide('Remote (synced)', remoteCopy)
    );
    details.append(summary, diff);
    
    const keepLocalBtn = document.getElementById('conflict-keep-local');
    const keepRemoteBtn = document.getElementById('conflict-keep-remote');
    const cancelBtn = document.getElementById('conflict-cancel');
    
    const close = (choice) => {
      modal.classList.add('hidden');
      keepLocalBtn.onclick = null;
      keepRemoteBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      resolve(choice);
    };
    
    keepLocalBtn.onclick = () => close('local');
    keepRemoteBtn.onclick = () => close('remote');
    cancelBtn.onclick = () => close('cancel');
    modal.onclick = (e) => {
      if (e.target === modal) close('cancel');
    };
    
    modal.classList.remove('hidden');
    keepLocalBtn.focus();
  });
}

// ============ Settings Management ============

async function loadSettings() {
  try {
    // Settings are already loaded in loadRules(), just update UI
    document.getElementById('setting-debug-logging').checked = settings.debugLogging;
    document.getElementById('setting-focus-sticky').checked = settings.focusStickyTab;
    document.getElementById('setting-protect-sticky').checked = protectStickyTabs !== false;
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
    protectStickyTabs = document.getElementById('setting-protect-sticky').checked;
    
    // Settings object stays local. The close-protection default is stored
    // with the rules so it syncs when Sync rules is on.
    await browser.storage.local.set({ settings });
    await getStorage().set({ protectStickyTabs });
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

/**
 * Move the close-protection default with the rules when Sync is toggled.
 * An explicit value on this device wins. If this device never stored one,
 * keep whatever the destination storage already has. If neither has a value,
 * leave the key unset (runtime default is enabled).
 */
async function migrateProtectStickyTabs(oldUseSync, newStorage) {
  const oldStorage = oldUseSync ? browser.storage.sync : browser.storage.local;
  const [oldData, newData] = await Promise.all([
    oldStorage.get('protectStickyTabs'),
    newStorage.get('protectStickyTabs')
  ]);
  if (typeof oldData.protectStickyTabs === 'boolean') {
    protectStickyTabs = oldData.protectStickyTabs;
    await newStorage.set({ protectStickyTabs });
  } else if (typeof newData.protectStickyTabs === 'boolean') {
    protectStickyTabs = newData.protectStickyTabs;
  } else {
    protectStickyTabs = true;
  }
  const checkbox = document.getElementById('setting-protect-sticky');
  if (checkbox) checkbox.checked = protectStickyTabs;
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
    
    // Get current rules from the current storage.
    // When leaving sync, use the effective set (sync + local overrides)
    // so overridden edits are not lost in the migration.
    let currentRules;
    if (oldUseSync) {
      const syncRules = (await browser.storage.sync.get('rules')).rules || [];
      const overrides = (await browser.storage.local.get('localRules')).localRules || [];
      currentRules = getEffectiveRules(syncRules, overrides);
    } else {
      currentRules = (await browser.storage.local.get('rules')).rules || [];
    }
    
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
    
    // Keep the synced snapshot consistent with the new placement
    syncedRules = newUseSync ? rules : [];
    
    // Per-rule overrides are meaningless after a wholesale migration:
    // moving to local merges overridden copies into the canonical set,
    // moving to sync syncs everything. Clear the override state.
    localRules = [];
    localOverrideIds = new Set();
    overrideMeta = {};
    await browser.storage.local.set({ localRules: [], overrideMeta: {} });

    // Close-protection default follows rules to the storage Sync now points at.
    // Write it before saving `settings`, so the background reload sees the key.
    await migrateProtectStickyTabs(oldUseSync, newStorage);
    
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
  document.getElementById('setting-protect-sticky').addEventListener('change', saveSettings);
  
  // Sync toggle - handle immediately with migration logic
  document.getElementById('setting-use-sync').addEventListener('change', (e) => {
    handleSyncToggle(e.target.checked);
  });
  
  // Export rules
  document.getElementById('export-rules').addEventListener('click', () => {
    const data = {
      version: '0.2.0',
      exportDate: new Date().toISOString(),
      rules: rules,
      settings: settings,
      protectStickyTabs: protectStickyTabs,
      // Per-rule local overrides (only meaningful when sync is on)
      localRules: settings.useSync ? rules.filter(r => localOverrideIds.has(r.id)) : [],
      overrideMeta: settings.useSync ? overrideMeta : {}
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
        // Merge rules by id (imported wins)
        const rulesById = new Map(rules.map(r => [r.id, r]));
        data.rules.forEach(r => rulesById.set(r.id, r));
        rules = [...rulesById.values()];
        
        // Merge local rule overrides by id (imported wins)
        if (Array.isArray(data.localRules)) {
          const localById = new Map(localRules.map(r => [r.id, r]));
          data.localRules.forEach(r => localById.set(r.id, r));
          localRules = [...localById.values()];
        }
        
        // Merge override meta by rule id (imported wins)
        if (data.overrideMeta && typeof data.overrideMeta === 'object') {
          overrideMeta = { ...overrideMeta, ...data.overrideMeta };
        }
        localOverrideIds = new Set(localRules.map(r => r.id));
        
        ruleIdCounter = rules.length > 0 ? Math.max(...rules.map(r => r.id)) + 1 : 0;
        renderRules();
        
        if (data.settings) {
          // Preserve current sync setting, update others
          const currentUseSync = settings.useSync;
          settings = { ...data.settings, useSync: currentUseSync };
          document.getElementById('setting-debug-logging').checked = settings.debugLogging;
          document.getElementById('setting-focus-sticky').checked = settings.focusStickyTab;
        }

        if (typeof data.protectStickyTabs === 'boolean') {
          protectStickyTabs = data.protectStickyTabs;
          document.getElementById('setting-protect-sticky').checked = protectStickyTabs;
          await getStorage().set({ protectStickyTabs });
        }
        
        // Persist through the split save path (respects per-rule overrides)
        const saved = await saveRules();
        await browser.storage.local.set({ settings });
        if (!settings.useSync) {
          // Restore override state too (inactive while sync is off,
          // but preserved in case sync is re-enabled later)
          await browser.storage.local.set({ localRules, overrideMeta });
        }
        showSaveStatus(
          saved ? 'Import successful!' : 'Imported rules failed validation - fix and save',
          !saved,
          document.getElementById('settings-save-status')
        );
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
      } else if (activeTab === 'snippets' && snippetEditorState && snippetEditorState.mode !== 'preview') {
        saveSnippetFromEditor();
      }
    }
  });
}

// ============ Snippet library ============

function findLibrarySnippet(id) {
  if (!id) return null;
  const user = snippets.find(snippet => snippet.id === id);
  if (user && typeof user.code === 'string' && user.code.trim() !== '') return user;
  const builtin = getBuiltinSnippets().find(snippet => snippet && snippet.id === id);
  if (builtin && typeof builtin.code === 'string' && builtin.code.trim() !== '') return builtin;
  return null;
}

function populateSnippetSelect(select, rule) {
  if (!select) return;
  const choice = rule.snippetId ? rule.snippetId : (rule.action === 'script' ? 'inline' : 'none');
  select.textContent = '';

  const add = (value, label, parent) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    (parent || select).appendChild(option);
  };

  add('none', 'None');
  add('inline', 'Inline code');

  const predefined = document.createElement('optgroup');
  predefined.label = 'Predefined';
  getBuiltinSnippets().forEach(snippet => add(snippet.id, snippet.name, predefined));

  const mine = document.createElement('optgroup');
  mine.label = 'My snippets';
  snippets.forEach(snippet => add(snippet.id, snippet.name, mine));

  select.append(predefined, mine);

  if (rule.snippetId && !Array.from(select.options).some(option => option.value === rule.snippetId)) {
    add(rule.snippetId, `Missing snippet (${rule.snippetId})`);
  }
  select.value = choice;
}

function updateRuleSnippetUi(card, rule) {
  const inline = rule.action === 'script' && !rule.snippetId;
  const scriptGroup = card.querySelector('.rule-script-group');
  if (scriptGroup) scriptGroup.classList.toggle('hidden', !inline);
  const missing = !!(rule.snippetId && !findLibrarySnippet(rule.snippetId));
  card.querySelectorAll('.snippet-missing-chip').forEach(chip => {
    chip.classList.toggle('hidden', !missing);
  });
}

function refreshRuleSnippetSelects() {
  if (!rulesContainer) return;
  rulesContainer.querySelectorAll('.rule-card').forEach(card => {
    const rule = rules.find(item => String(item.id) === String(card.dataset.ruleId));
    if (!rule) return;
    populateSnippetSelect(card.querySelector('.rule-snippet'), rule);
    updateRuleSnippetUi(card, rule);
  });
}

function getBuiltinSnippets() {
  if (typeof StickyTabSZBuiltins !== 'undefined' && Array.isArray(StickyTabSZBuiltins)) {
    return StickyTabSZBuiltins;
  }
  if (typeof window !== 'undefined' && Array.isArray(window.StickyTabSZBuiltins)) {
    return window.StickyTabSZBuiltins;
  }
  return [];
}

function isUserSnippetRecord(snippet) {
  return !!(
    snippet &&
    typeof snippet.id === 'string' &&
    snippet.id.startsWith('usr-') &&
    !snippet.id.startsWith('sys-') &&
    snippet.builtin !== true &&
    typeof snippet.name === 'string' &&
    typeof snippet.code === 'string'
  );
}

function normalizeUserSnippet(snippet) {
  return {
    id: snippet.id,
    name: snippet.name,
    description: typeof snippet.description === 'string' ? snippet.description : '',
    code: snippet.code,
    clonedFrom: typeof snippet.clonedFrom === 'string' && snippet.clonedFrom.startsWith('sys-')
      ? snippet.clonedFrom
      : null,
    builtinVersion: typeof snippet.builtinVersion === 'string' ? snippet.builtinVersion : null,
    createdAt: typeof snippet.createdAt === 'number' ? snippet.createdAt : 0,
    updatedAt: typeof snippet.updatedAt === 'number' ? snippet.updatedAt : 0
  };
}

function newUserSnippetId() {
  return `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializedSnippetBytes(list) {
  return new TextEncoder().encode(JSON.stringify(list)).length;
}

function showSnippetStatus(message, isError) {
  showSaveStatus(message, isError, document.getElementById('snippet-status'), isError ? 8000 : 3000);
}

async function loadSnippets() {
  try {
    const result = await getStorage().get('snippets');
    const stored = Array.isArray(result.snippets) ? result.snippets : [];
    snippets = stored.filter(isUserSnippetRecord).map(normalizeUserSnippet);
  } catch (e) {
    console.error('Failed to load snippets:', e);
    snippets = [];
  }
}

async function saveUserSnippets() {
  const payload = snippets.filter(isUserSnippetRecord).map(normalizeUserSnippet);
  if (settings.useSync && serializedSnippetBytes(payload) > SNIPPETS_SYNC_MAX_BYTES) {
    const kb = Math.ceil(serializedSnippetBytes(payload) / 1024);
    showSnippetStatus(
      `Snippets are ${kb}KB. Saving is blocked above 90KB while Firefox Sync is on, so the sync item stays under the quota. Shorten them or turn Sync off.`,
      true
    );
    return false;
  }
  try {
    await getStorage().set({ snippets: payload });
    snippets = payload;
    return true;
  } catch (e) {
    console.error('Failed to save snippets:', e);
    showSnippetStatus('Failed to save snippets: ' + e.message, true);
    return false;
  }
}

function renderSnippets() {
  const builtinHost = document.getElementById('builtin-snippets');
  const userHost = document.getElementById('user-snippets');
  const empty = document.getElementById('no-snippets');
  if (!builtinHost || !userHost) return;

  builtinHost.textContent = '';
  userHost.textContent = '';
  getBuiltinSnippets().forEach(snippet => {
    builtinHost.appendChild(renderSnippetCard(snippet, true));
  });
  snippets.forEach(snippet => {
    userHost.appendChild(renderSnippetCard(snippet, false));
  });
  if (empty) empty.classList.toggle('hidden', snippets.length > 0);
}

function renderSnippetCard(snippet, builtin) {
  const card = document.createElement('article');
  card.className = 'snippet-card';
  card.dataset.snippetId = snippet.id;

  const title = document.createElement('h4');
  title.textContent = snippet.name || snippet.id;

  const idLine = document.createElement('p');
  idLine.className = 'snippet-id';
  idLine.textContent = snippet.id;

  const desc = document.createElement('p');
  desc.className = 'snippet-desc';
  desc.textContent = snippet.description || '';

  const actions = document.createElement('div');
  actions.className = 'snippet-card-actions';

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'btn btn-secondary btn-small';
  previewBtn.textContent = 'Preview';
  previewBtn.addEventListener('click', () => openSnippetEditor('preview', snippet));
  actions.appendChild(previewBtn);

  if (builtin) {
    const cloneBtn = document.createElement('button');
    cloneBtn.type = 'button';
    cloneBtn.className = 'btn btn-primary btn-small';
    cloneBtn.textContent = 'Clone';
    cloneBtn.addEventListener('click', () => openSnippetEditor('clone', snippet));
    actions.appendChild(cloneBtn);
  } else {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary btn-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openSnippetEditor('edit', snippet));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger btn-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteUserSnippet(snippet));
    actions.append(editBtn, deleteBtn);
  }

  card.append(title, idLine, desc, actions);
  return card;
}

function ensureSnippetEditor() {
  if (snippetAce) return snippetAce;
  if (typeof ace === 'undefined') {
    throw new Error('ACE editor failed to load');
  }
  ace.config.set('basePath', 'vendor/ace');
  ace.config.set('modePath', 'vendor/ace');
  ace.config.set('themePath', 'vendor/ace');
  const editor = ace.edit('snippet-ace');
  // useWorker starts a blob worker that pulls in JSHint via eval. Keep it off:
  // syntax is checked with the vendored Acorn parser on save, and extension
  // pages cannot use eval.
  editor.setOption('useWorker', false);
  editor.setTheme('ace/theme/one_dark');
  editor.session.setMode('ace/mode/javascript');
  editor.session.setUseWorker(false);
  editor.setOptions({
    showPrintMargin: false,
    tabSize: 2,
    useSoftTabs: true,
    wrap: true,
    fontSize: 13
  });
  snippetAce = editor;
  return editor;
}

function showSnippetEditorError(message) {
  const el = document.getElementById('snippet-editor-error');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
}

function closeSnippetEditor() {
  const dialog = document.getElementById('snippet-editor-dialog');
  if (dialog && dialog.open) dialog.close();
}

function openSnippetEditor(mode, source) {
  const dialog = document.getElementById('snippet-editor-dialog');
  const title = document.getElementById('snippet-editor-title');
  const idLine = document.getElementById('snippet-editor-id');
  const nameInput = document.getElementById('snippet-editor-name');
  const descInput = document.getElementById('snippet-editor-description');
  const saveBtn = document.getElementById('snippet-editor-save');
  const cancelBtn = document.getElementById('snippet-editor-cancel');
  const readOnly = mode === 'preview';
  const titles = {
    preview: 'Preview snippet',
    edit: 'Edit snippet',
    clone: 'Clone snippet',
    create: 'New snippet'
  };

  snippetEditorState = { mode, source: source || null };
  title.textContent = titles[mode] || 'Snippet';
  idLine.textContent = mode === 'create' ? '' : (source && source.id) || '';
  nameInput.value = mode === 'clone' && source
    ? `${source.name} copy`
    : (source && source.name) || '';
  descInput.value = (source && source.description) || '';
  nameInput.readOnly = readOnly;
  descInput.readOnly = readOnly;
  saveBtn.hidden = readOnly;
  cancelBtn.textContent = readOnly ? 'Close' : 'Cancel';
  showSnippetEditorError('');

  if (typeof dialog.showModal === 'function' && !dialog.open) {
    dialog.showModal();
  }

  let editor;
  try {
    editor = ensureSnippetEditor();
  } catch (e) {
    showSnippetEditorError(e.message);
    return;
  }
  editor.setValue(source && source.code ? source.code : '', -1);
  editor.setReadOnly(readOnly);
  editor.session.setUseWorker(false);
  const undo = editor.session.getUndoManager();
  if (undo && typeof undo.reset === 'function') undo.reset();
  requestAnimationFrame(() => {
    editor.resize();
    if (readOnly) editor.blur();
    else nameInput.focus();
  });
}

function setupSnippetTab() {
  const dialog = document.getElementById('snippet-editor-dialog');
  const form = document.getElementById('snippet-editor-form');
  const cancelBtn = document.getElementById('snippet-editor-cancel');
  const saveBtn = document.getElementById('snippet-editor-save');
  const addBtn = document.getElementById('add-snippet');

  if (cancelBtn) cancelBtn.addEventListener('click', closeSnippetEditor);
  if (saveBtn) saveBtn.addEventListener('click', saveSnippetFromEditor);
  if (addBtn) addBtn.addEventListener('click', () => openSnippetEditor('create', null));
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (snippetEditorState && snippetEditorState.mode !== 'preview') {
        saveSnippetFromEditor();
      }
    });
  }
  if (dialog) {
    dialog.addEventListener('close', () => {
      snippetEditorState = null;
    });
  }
}

async function saveSnippetFromEditor() {
  const state = snippetEditorState;
  if (!state || state.mode === 'preview') return;

  const name = document.getElementById('snippet-editor-name').value.trim();
  const description = document.getElementById('snippet-editor-description').value.trim();
  const code = snippetAce ? snippetAce.getValue() : '';

  if (!name) {
    showSnippetEditorError('Name is required.');
    return;
  }
  if (!code.trim()) {
    showSnippetEditorError('Code is required.');
    return;
  }
  const bytes = new TextEncoder().encode(code).length;
  if (bytes > SNIPPET_CODE_MAX_BYTES) {
    showSnippetEditorError(
      `This snippet's code is ${bytes} bytes. The limit is 6KB (6144 bytes) so a snippet stays within Firefox Sync's storage quota.`
    );
    return;
  }
  const check = validateActionScript(code);
  if (!check.valid) {
    const pos = check.line ? ` (line ${check.line}, column ${(check.column ?? 0) + 1})` : '';
    showSnippetEditorError(`Syntax error${pos}: ${check.error}`);
    return;
  }

  const now = Date.now();
  const previous = snippets.map(item => ({ ...item }));
  let statusMessage = 'Snippet created';

  if (state.mode === 'edit') {
    const existing = snippets.find(item => item.id === state.source.id);
    if (!existing) {
      showSnippetEditorError('This snippet is no longer in the library.');
      return;
    }
    existing.name = name;
    existing.description = description;
    existing.code = code;
    existing.updatedAt = now;
    statusMessage = 'Snippet saved';
  } else {
    snippets = [...snippets, normalizeUserSnippet({
      id: newUserSnippetId(),
      name,
      description,
      code,
      clonedFrom: state.mode === 'clone' && state.source ? state.source.id : null,
      builtinVersion: state.mode === 'clone' ? (extensionVersion || null) : null,
      createdAt: now,
      updatedAt: now
    })];
    statusMessage = state.mode === 'clone' ? 'Snippet cloned' : 'Snippet created';
  }

  const saved = await saveUserSnippets();
  if (!saved) {
    snippets = previous;
    const status = document.getElementById('snippet-status');
    showSnippetEditorError(status && status.textContent
      ? status.textContent
      : 'Failed to save snippet');
    return;
  }
  closeSnippetEditor();
  renderSnippets();
  refreshRuleSnippetSelects();
  showSnippetStatus(statusMessage, false);
}

async function deleteUserSnippet(snippet) {
  const refs = rules.filter(rule => rule.snippetId === snippet.id);
  let message = `Delete snippet "${snippet.name}"?`;
  if (refs.length) {
    const names = refs.map(rule => rule.name || String(rule.id)).join(', ');
    const label = refs.length === 1 ? 'rule' : 'rules';
    message = `"${snippet.name}" is used by ${label}: ${names}.\n\nDelete it anyway? Those rules will keep the reference.`;
  }
  if (!confirm(message)) return;

  const previous = snippets.slice();
  snippets = snippets.filter(item => item.id !== snippet.id);
  const saved = await saveUserSnippets();
  if (!saved) {
    snippets = previous;
    return;
  }
  renderSnippets();
  refreshRuleSnippetSelects();
  showSnippetStatus(`Deleted "${snippet.name}"`, false);
}
