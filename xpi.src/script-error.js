const promptId = decodeURIComponent((location.hash || '').replace(/^#/, ''));

const ruleNameEl = document.getElementById('rule-name');
const destUrlEl = document.getElementById('dest-url');
const errorTextEl = document.getElementById('error-text');
const btnReload = document.getElementById('btn-reload');
const btnNewTab = document.getElementById('btn-newtab');
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
      choosing = false;
      setButtonsEnabled(true);
    }
    // On success the background closes this window.
  } catch (e) {
    errorTextEl.textContent = e.message || String(e);
    choosing = false;
    setButtonsEnabled(true);
  }
}

function setButtonsEnabled(enabled) {
  btnReload.disabled = !enabled;
  btnNewTab.disabled = !enabled;
  btnCancel.disabled = !enabled;
}

btnReload.addEventListener('click', () => choose('reload'));
btnNewTab.addEventListener('click', () => choose('newTab'));
btnCancel.addEventListener('click', () => choose('cancel'));

document.addEventListener('keydown', (e) => {
  if (choosing) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    choose('cancel');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose('reload');
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    choose('newTab');
  }
});

async function init() {
  if (!promptId) {
    ruleNameEl.textContent = '(missing)';
    errorTextEl.textContent = 'Stale prompt — no id. You can close this window.';
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
      setButtonsEnabled(false);
      setTimeout(() => window.close(), 1500);
      return;
    }
    ruleNameEl.textContent = data.ruleName || '(unnamed)';
    destUrlEl.textContent = data.destUrl || '';
    destUrlEl.title = data.destUrl || '';
    errorTextEl.textContent = data.error || 'Unknown error';
    btnReload.focus();
  } catch (e) {
    errorTextEl.textContent = e.message || String(e);
    setButtonsEnabled(false);
  }
}

init();
