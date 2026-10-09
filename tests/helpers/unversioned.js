// The site references its own JavaScript with a ?v=<version> cache-busting query that scripts/sync-cache-versions.js
// rewrites on every deploy. Tests that assert on the shape of an import (not on the version) read the source through
// this helper so they do not depend on the current version string. tests/module-imports-versioned.test.js covers
// the version itself.
module.exports = function unversioned(text) {
  return String(text).replace(/(\.m?js)\?v=[\w.-]+/g, '$1');
};
