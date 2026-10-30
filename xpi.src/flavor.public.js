// Public (AMO) flavor — written into the package as flavor.js by build.sh.
// Custom JavaScript, snippet cloning, and non-allowlisted builtins are off.

var StickyTabSZFlavor = {
  name: 'public',
  allowCustomJavaScript: false,
  allowSnippetClone: false,
  allowedBuiltinIds: ['sys-salesforce-lightning-link-grabber']
};

function stickyTabSZAllowsCustomJavaScript() {
  return !StickyTabSZFlavor || StickyTabSZFlavor.allowCustomJavaScript !== false;
}

function stickyTabSZAllowsSnippetClone() {
  return stickyTabSZAllowsCustomJavaScript() &&
    (!StickyTabSZFlavor || StickyTabSZFlavor.allowSnippetClone !== false);
}

function stickyTabSZFilterBuiltins(list) {
  const source = Array.isArray(list) ? list : [];
  const allowed = StickyTabSZFlavor && StickyTabSZFlavor.allowedBuiltinIds;
  if (!allowed || !allowed.length) return source.slice();
  const allow = new Set(allowed);
  return source.filter(snippet => snippet && allow.has(snippet.id));
}

function stickyTabSZSnippetIdAllowed(snippetId) {
  if (!snippetId || typeof snippetId !== 'string') return false;
  if (snippetId.startsWith('usr-')) {
    return stickyTabSZAllowsCustomJavaScript();
  }
  const allowed = StickyTabSZFlavor && StickyTabSZFlavor.allowedBuiltinIds;
  if (!allowed || !allowed.length) return true;
  return allowed.indexOf(snippetId) !== -1;
}

if (typeof window !== 'undefined') {
  window.StickyTabSZFlavor = StickyTabSZFlavor;
}
