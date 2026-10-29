const promptId = decodeURIComponent((location.hash || '').replace(/^#/, ''));

const ruleNameEl = document.getElementById('rule-name');
const destUrlEl = document.getElementById('dest-url');
const errorTextEl = document.getElementById('error-text');
const errorDetailsEl = document.getElementById('error-details');
const errorMetaEl = document.getElementById('error-meta');
const errorStackEl = document.getElementById('error-stack');
const btnReload = document.getElementById('btn-reload');
const btnNewTab = document.getElementById('btn-newtab');
const btnDeactivate = document.getElementById('btn-deactivate');
const btnCancel = document.getElementById('btn-cancel');

let choosing = false;

async function choose(choice) {
  if (choosing) return;
  choosing = true;
  setButtonsEnabled(false);
  try {
    const result = await browser.runtime.sendMessage({
      type: 'scriptErrorChoice',
      promptId,
      choice
    });
    if (!result || !result.ok) {
      errorTextEl.textContent = (result && result.error) || 'Prompt is no longer active.';
      hideErrorDetails();
      choosing = false;
      setButtonsEnabled(true);
    }
    // On success the background closes this window.
  } catch (e) {
    errorTextEl.textContent = e.message || String(e);
    hideErrorDetails();
    choosing = false;
    setButtonsEnabled(true);
  }
}

function setButtonsEnabled(enabled) {
  btnReload.disabled = !enabled;
  btnNewTab.disabled = !enabled;
  btnDeactivate.disabled = !enabled;
  btnCancel.disabled = !enabled;
}

function hideErrorDetails() {
  errorDetailsEl.hidden = true;
  errorDetailsEl.open = false;
  errorMetaEl.hidden = true;
  errorMetaEl.textContent = '';
  errorStackEl.textContent = '';
}

/**
 * Render structured errorDetail into the expandable panel.
 * Hides the panel when there is no stack (or detail object).
 */
function renderErrorDetails(detail) {
  if (!detail || typeof detail !== 'object') {
    hideErrorDetails();
    return;
  }
  const stack = detail.stack ? String(detail.stack) : '';
  if (!stack) {
    hideErrorDetails();
    return;
  }

  errorMetaEl.textContent = '';
  const fields = [
    ['Name', detail.name],
    ['Message', detail.message]
  ];
  let hasMeta = false;
  for (const [label, value] of fields) {
    if (value == null || value === '') continue;
    hasMeta = true;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    errorMetaEl.appendChild(dt);
    errorMetaEl.appendChild(dd);
  }
  errorMetaEl.hidden = !hasMeta;
  errorStackEl.textContent = stack;
  errorDetailsEl.hidden = false;
  errorDetailsEl.open = false;
}

btnReload.addEventListener('click', () => choose('reload'));
btnNewTab.addEventListener('click', () => choose('newTab'));
btnDeactivate.addEventListener('click', () => choose('deactivate'));
btnCancel.addEventListener('click', () => choose('cancel'));

document.addEventListener('keydown', (e) => {
  if (choosing) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    choose('cancel');
    return;
  }
  // Let <summary> use Enter/Space for native expand/collapse.
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'SUMMARY') return;

  if (e.key === 'Enter') {
    e.preventDefault();
    choose('reload');
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    choose('newTab');
  } else if (e.key === 'd' || e.key === 'D') {
    e.preventDefault();
    choose('deactivate');
  }
});

async function init() {
  if (!promptId) {
    ruleNameEl.textContent = '(missing)';
    errorTextEl.textContent = 'Stale prompt — no id. You can close this window.';
    hideErrorDetails();
    setButtonsEnabled(false);
    return;
  }
  try {
    const data = await browser.runtime.sendMessage({
      type: 'getScriptErrorPrompt',
      promptId
    });
    if (!data || !data.ok) {
      ruleNameEl.textContent = '(stale)';
      errorTextEl.textContent = 'This prompt is no longer active. You can close this window.';
      hideErrorDetails();
      setButtonsEnabled(false);
      setTimeout(() => window.close(), 1500);
      return;
    }
    ruleNameEl.textContent = data.ruleName || '(unnamed)';
    destUrlEl.textContent = data.destUrl || '';
    destUrlEl.title = data.destUrl || '';
    errorTextEl.textContent = data.error || 'Unknown error';
    renderErrorDetails(data.errorDetail);
    btnReload.focus();
  } catch (e) {
    errorTextEl.textContent = e.message || String(e);
    hideErrorDetails();
    setButtonsEnabled(false);
  }
}

init();
