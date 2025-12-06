document.getElementById('open-settings').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});

