// Predefined Sticky TabSZ snippets.
//
// Loaded as a classic script on the options page and as a background script
// (before background.js). These objects are never written to storage, so an
// extension update can replace them.
//
// Snippet `code` runs inside the async IIFE built by buildScriptWrapper:
//   - `url` is the destination URL
//   - the wrapper is sloppy-mode (no 'use strict') on purpose
//   - page globals are in scope via `with (window.wrappedJSObject)`, which is
//     how Firefox exposes Xray-protected objects such as Salesforce `$A`.
//     Inside that block, a bare `$A` is the page global. The name `window`
//     resolves to the page window, which does not have `wrappedJSObject`.

var StickyTabSZBuiltins = [
  {
    id: 'sys-salesforce-lightning-link-grabber',
    name: 'Salesforce Lightning Link Grabber',
    description: 'Navigates a Salesforce Lightning sticky tab via an Aura event instead of reloading. If $A is not available on the page, the snippet logs a warning and returns.',
    builtin: true,
    code: [
      'if (!url) return;',
      'var aura = (typeof $A !== "undefined" && $A && typeof $A.getEvt === "function") ? $A : null;',
      'if (!aura) {',
      '  console.warn("[Sticky TabSZ] Salesforce $A is not available on this page");',
      '  return;',
      '}',
      'u = url;',
      'try {',
      '  var x = new URL(u);',
      '  u = x.pathname + x.search + x.hash;',
      '} catch (e) {',
      '}',
      'var ev = aura.getEvt("markup://force:navigateToURL");',
      'ev.setParam("url", u);',
      'ev.fire();'
    ].join('\n')
  },
  {
    id: 'sys-log-url',
    name: 'Log destination URL',
    description: 'Logs the destination URL to the sticky tab console. The tab is not reloaded.',
    builtin: true,
    code: "console.log('[Sticky TabSZ] destination:', url);"
  },
  {
    id: 'sys-log-url-and-load',
    name: 'Log destination URL and Load',
    description: 'Logs the destination URL, then loads it in the sticky tab from inside the script.',
    builtin: true,
    code: [
      "console.log('[Sticky TabSZ] destination:', url);",
      'location.href = url;'
    ].join('\n')
  },
  {
    id: 'sys-copy-url',
    name: 'Copy destination URL',
    description: 'Copies the destination URL to the clipboard. Clipboard writes can fail without a user gesture (for example when the sticky tab is in the background).',
    builtin: true,
    code: [
      'try {',
      '  await navigator.clipboard.writeText(url);',
      '} catch (e) {',
      "  console.warn('[Sticky TabSZ] Could not copy the destination URL. Clipboard writes can fail without a user gesture.', e);",
      '}'
    ].join('\n')
  }
];

if (typeof window !== 'undefined') {
  window.StickyTabSZBuiltins = StickyTabSZBuiltins;
}
