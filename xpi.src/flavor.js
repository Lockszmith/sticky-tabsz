// Build flavor flags for Sticky TabSZ.
//
// Source / temporary about:debugging loads match the unlisted feature set.
// `build.sh --flavor public` overwrites this file in the package so the AMO
// build cannot create, clone, or run custom JavaScript — only the reviewed
// Salesforce Lightning Link Grabber builtin may be selected as a script action.

var StickyTabSZFlavor = {
  name: 'unlisted',
  allowCustomJavaScript: true,
  allowSnippetClone: true,
  // null = every bundled builtin is available
  allowedBuiltinIds: null
};

function stickyTabSZAllowsCustomJavaScript() {
  return !StickyTabSZFlavor || StickyTabSZFlavor.allowCustomJavaScript !== false;
}

function stickyTabSZAllowsSnippetClone() {
  return stickyTabSZAllowsCustomJavaScript() &&
    (!StickyTabSZFlavor || StickyTabSZFlavor.allowSnippetClone !== false);
}

/**
 * Filter predefined snippets for the active flavor.
 * Public builds only expose allowlisted builtins (Salesforce Link Grabber).
 */
function stickyTabSZFilterBuiltins(list) {
  const source = Array.isArray(list) ? list : [];
  const allowed = StickyTabSZFlavor && StickyTabSZFlavor.allowedBuiltinIds;
  if (!allowed || !allowed.length) return source.slice();
  const allow = new Set(allowed);
  return source.filter(snippet => snippet && allow.has(snippet.id));
}

/**
 * True when this snippet id may run (or be selected) under the active flavor.
 */
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
