const assert = require('assert');
const fs = require('fs');
const path = require('path');

// An admin progress reset clears browser storage except a list of preserved prefixes. The data source switch
// (utl_data_source, set by ?utl_data=supabase) must be on every such list, or a reset would silently put a
// tester's browser back on Firebase.
const source = fs.readFileSync(path.resolve(__dirname, '..', 'member-login', 'content-config.js'), 'utf8');
const lists = source.match(/var preservedPrefixes = \[[\s\S]*?\];/g) || [];
assert.ok(lists.length >= 2, 'expected the preserved prefix lists in member-login/content-config.js');
lists.forEach((list, index) => {
  assert.ok(list.includes('"utl_data_source"'), `preserved prefix list ${index + 1} must keep utl_data_source`);
});

console.log('data-source-preserved tests passed');
