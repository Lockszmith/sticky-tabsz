// Sticky TabSZ Options Page

const RULE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

let rules = [];
let ruleIdCounter = 0;

// DOM Elements
const rulesContainer = document.getElementById('rules-container');
const noRulesMessage = document.getElementById('no-rules');
const addRuleBtn = document.getElementById('add-rule');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const ruleTemplate = document.getElementById('rule-template');
const patternTemplate = document.getElementById('pattern-template');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadRules();
  renderRules();
  setupEventListeners();
});

// Load rules from storage
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

// Save rules to storage
async function saveRules() {
  try {
    // Validate before saving
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

// Validate all rules
function validateRules() {
  for (const rule of rules) {
    if (!rule.name || !RULE_NAME_PATTERN.test(rule.name)) {
      return { valid: false, error: `Invalid rule name: "${rule.name}". Use only alphanumeric, dash, underscore.` };
    }
    if (!rule.stickyPatterns || rule.stickyPatterns.length === 0) {
      return { valid: false, error: `Rule "${rule.name}" must have at least one sticky pattern.` };
    }
    // Validate regex patterns
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

// Show save status message
function showSaveStatus(message, isError) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle('error', isError);
  saveStatus.classList.add('visible');
  setTimeout(() => {
    saveStatus.classList.remove('visible');
  }, 3000);
}

// Render all rules
function renderRules() {
  rulesContainer.innerHTML = '';
  
  if (rules.length === 0) {
    noRulesMessage.classList.remove('hidden');
  } else {
    noRulesMessage.classList.add('hidden');
    rules.forEach(rule => renderRule(rule));
  }
}

// Render a single rule
function renderRule(rule) {
  const template = ruleTemplate.content.cloneNode(true);
  const card = template.querySelector('.rule-card');
  
  card.dataset.ruleId = rule.id;
  card.classList.toggle('disabled', !rule.enabled);
  
  // Set values
  card.querySelector('.rule-enabled').checked = rule.enabled;
  card.querySelector('.rule-name').value = rule.name;
  card.querySelector('.container-separation').checked = rule.containerSeparation;
  card.querySelector('.rule-description').value = rule.description || '';
  
  // Render patterns
  const stickyPatternsContainer = card.querySelector('.sticky-patterns');
  const matchPatternsContainer = card.querySelector('.match-patterns');
  
  (rule.stickyPatterns || []).forEach(pattern => {
    stickyPatternsContainer.appendChild(createPatternInput(pattern));
  });
  
  (rule.matchPatterns || []).forEach(pattern => {
    matchPatternsContainer.appendChild(createPatternInput(pattern));
  });
  
  // Event listeners for this card
  setupCardEventListeners(card, rule);
  
  rulesContainer.appendChild(card);
}

// Create a pattern input element
function createPatternInput(value = '') {
  const template = patternTemplate.content.cloneNode(true);
  const input = template.querySelector('.pattern-value');
  input.value = value;
  return template;
}

// Setup event listeners for a rule card
function setupCardEventListeners(card, rule) {
  // Enable/disable toggle
  card.querySelector('.rule-enabled').addEventListener('change', (e) => {
    rule.enabled = e.target.checked;
    card.classList.toggle('disabled', !rule.enabled);
  });
  
  // Rule name
  card.querySelector('.rule-name').addEventListener('input', (e) => {
    const input = e.target;
    const isValid = RULE_NAME_PATTERN.test(input.value) || input.value === '';
    input.classList.toggle('invalid', !isValid && input.value !== '');
    rule.name = input.value;
  });
  
  // Container separation
  card.querySelector('.container-separation').addEventListener('change', (e) => {
    rule.containerSeparation = e.target.checked;
  });
  
  // Description
  card.querySelector('.rule-description').addEventListener('input', (e) => {
    rule.description = e.target.value;
  });
  
  // Delete rule
  card.querySelector('.delete-rule').addEventListener('click', () => {
    deleteRule(rule.id);
  });
  
  // Add sticky pattern
  card.querySelector('.add-sticky-pattern').addEventListener('click', () => {
    const container = card.querySelector('.sticky-patterns');
    container.appendChild(createPatternInput());
    updatePatternsFromDOM(card, rule);
    setupPatternListeners(card, rule);
  });
  
  // Add match pattern
  card.querySelector('.add-match-pattern').addEventListener('click', () => {
    const container = card.querySelector('.match-patterns');
    container.appendChild(createPatternInput());
    updatePatternsFromDOM(card, rule);
    setupPatternListeners(card, rule);
  });
  
  // Pattern listeners
  setupPatternListeners(card, rule);
}

// Setup listeners for pattern inputs
function setupPatternListeners(card, rule) {
  // Remove pattern buttons
  card.querySelectorAll('.remove-pattern').forEach(btn => {
    btn.onclick = (e) => {
      e.target.closest('.pattern-input').remove();
      updatePatternsFromDOM(card, rule);
    };
  });
  
  // Pattern value changes
  card.querySelectorAll('.pattern-value').forEach(input => {
    input.oninput = () => {
      updatePatternsFromDOM(card, rule);
    };
  });
}

// Update rule patterns from DOM
function updatePatternsFromDOM(card, rule) {
  rule.stickyPatterns = Array.from(card.querySelectorAll('.sticky-patterns .pattern-value'))
    .map(input => input.value)
    .filter(v => v.trim() !== '');
  
  rule.matchPatterns = Array.from(card.querySelectorAll('.match-patterns .pattern-value'))
    .map(input => input.value)
    .filter(v => v.trim() !== '');
}

// Add a new rule
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
  
  // Focus the name input of the new rule
  const newCard = rulesContainer.querySelector(`[data-rule-id="${newRule.id}"]`);
  if (newCard) {
    newCard.querySelector('.rule-name').focus();
  }
}

// Delete a rule
function deleteRule(ruleId) {
  rules = rules.filter(r => r.id !== ruleId);
  renderRules();
}

// Setup global event listeners
function setupEventListeners() {
  addRuleBtn.addEventListener('click', addRule);
  saveBtn.addEventListener('click', saveRules);
  
  // Keyboard shortcut: Ctrl+S to save
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveRules();
    }
  });
}

