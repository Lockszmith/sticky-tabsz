// Predefined Sticky TabSZ snippets — PUBLIC (AMO) flavor only.
//
// `build.sh --flavor public` replaces snippets/builtin.js with this file so
// the reviewed package ships a single JavaScript action: Salesforce Lightning
// Link Grabber. Unlisted builds keep the full snippets/builtin.js library.

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
  }
];

if (typeof window !== 'undefined') {
  window.StickyTabSZBuiltins = StickyTabSZBuiltins;
}
