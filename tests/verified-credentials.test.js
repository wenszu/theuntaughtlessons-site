const assert = require('node:assert/strict');
const fs = require('node:fs');

const functions = fs.readFileSync('functions-admin/index.js', 'utf8');
const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const certificate = fs.readFileSync('certificate/index.html', 'utf8');
const verification = fs.readFileSync('verify/index.html', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');

assert.match(functions, /exports\.issueVerifiedCredential = onCall/, 'credentials must be issued by a trusted server function');
assert.match(functions, /"UTL-TSA-" \+ suffix/, 'credential IDs should use the approved UTL-TSA nomenclature');
assert.match(functions, /crypto\.randomBytes\(12\)/, 'credential IDs should be non-sequential and cryptographically random');
assert.match(functions, /REQUIRED_EXERCISES\.filter/, 'issuance should verify all required exercise completion records');
assert.match(functions, /collection\("credential_issuance"\)/, 'private issuance evidence should be stored separately');
assert.match(functions, /collection\("public_credentials"\)/, 'public verification data should have a dedicated collection');
assert.doesNotMatch(functions.match(/const publicCredential = \{[\s\S]*?\n  \};/)[0], /email|userId/, 'public records must not disclose account identifiers');
assert.match(rules, /match \/public_credentials\/{credentialId} \{\s*allow read: if true;\s*allow write: if false;/, 'public records should be readable but server-write-only');
assert.match(rules, /match \/credential_issuance\/{issuanceId} \{\s*allow read, write: if false;/, 'private issuance records should not be client accessible');
assert.match(firebase, /httpsCallable\(functions, "issueVerifiedCredential"\)/, 'the member certificate should use callable issuance');
assert.match(certificate, /certId=\$\{encodeURIComponent\(credential\.credentialId\)\}/, 'LinkedIn sharing should include the credential ID');
assert.match(certificate, /certUrl=\$\{encodeURIComponent\(verificationUrl\)\}/, 'LinkedIn sharing should link to the public verification record');
assert.match(certificate, /id="certQr"/, 'the certificate view should provide QR verification');
assert.match(verification, /Official credential verification/, 'the public page should present an official verification identity');
assert.match(verification, /No learner email, score or private account information is displayed/, 'the public page should state its privacy boundary');
assert.match(verification, /Credential not active/, 'revoked credentials should have an explicit public state');
assert.match(admin, /id="engCredentialLookup"/, 'administrators should be able to look up credentials');
assert.match(admin, /data-credential-action/, 'administrators should be able to revoke or reactivate credentials');
assert.match(functions, /action === "reissue"/, 'administrators should be able to replace a compromised or incorrect ID');
assert.match(functions, /action === "update-name"/, 'administrators should be able to correct the public recipient name');

console.log('verified credential contracts passed');
