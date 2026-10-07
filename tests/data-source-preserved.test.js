const assert = require('assert');
const fs = require('fs');
const path = require('path');

// An admin progress reset and an account change both clear browser storage except a list of preserved
// prefixes. The data source switch (utl_data_source, made active by the tester gate in saveUserProfile)
// and the pending request (utl_data_pending, written by ?utl_data=supabase) must be on every such list,
// or a reset would silently put a tester's browser back on Firebase or lose their request.
// One prefix covers every data source key: utl_data_source, utl_data_pending, utl_data_gate_v and utl_data_gate_last.
const REQUIRED_KEYS = ['utl_data_'];
const source = fs.readFileSync(path.resolve(__dirname, '..', 'member-login', 'content-config.js'), 'utf8');
const lists = source.match(/var preservedPrefixes = \[[\s\S]*?\];/g) || [];
assert.ok(lists.length >= 2, 'expected the preserved prefix lists in member-login/content-config.js');
lists.forEach((list, index) => {
  REQUIRED_KEYS.forEach((key) => {
    assert.ok(list.includes(`"${key}"`), `preserved prefix list ${index + 1} must keep ${key}`);
  });
});

// assets/firebase.js must use exactly these key names.
const firebase = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'firebase.js'), 'utf8');
assert.match(firebase, /const DATA_SOURCE_KEY = "utl_data_source"/);
assert.match(firebase, /const DATA_SOURCE_PENDING_KEY = "utl_data_pending"/);
assert.match(firebase, /const DATA_SOURCE_GATE_VERSION_KEY = "utl_data_gate_v"/);
assert.match(firebase, /const DATA_SOURCE_GATE_LOG_KEY = "utl_data_gate_last"/);

console.log('data-source-preserved tests passed');
