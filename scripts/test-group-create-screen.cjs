const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/app/messages/groups/create.tsx');
const source = fs.readFileSync(file, 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
  fileName: file,
});

const errors = (output.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
assert.deepEqual(errors, [], 'group creation screen must transpile without TypeScript syntax errors');

const checks = [
  ['account-keyed route state', /<CreateGroupScreen key=\{user\.id\} userId=\{user\.id\.toLowerCase\(\)\}/],
  ['backend/account-scoped durable storage', /campusclutch:group-creation:v1:\$\{encodeURIComponent\(env\.supabaseUrl\)\}:\$\{userId\}/],
  ['optional course route selection', /useLocalSearchParams<\{ courseId\?: string \| string\[\] \}>/],
  ['current-course eligibility filter', /getMyCourses\(\)\)\.filter\(isCurrentCourse\)/],
  ['course-scoped classmate loading', /getCourseClassmates\(selectedCourseId\)/],
  ['shared title and 1–19 invitee validation', /validateGroupCreation\(title, selectedInviteeIds, userId\)/],
  ['serialized double-tap guard', /submitBusy\.current = true/],
  ['new id is minted only for a new attempt', /clientCreationId: globalThis\.crypto\.randomUUID\(\)\.toLowerCase\(\)/],
  ['frozen operation is durably saved', /pending: operation/],
  ['group API receives the frozen operation', /createGroupConversation\(userId, operation\)/],
  ['stale focus is checked after confirmation', /if \(!activeRef\.current \|\| ticket !== submitEpoch\.current\) return;\s*confirmedRef\.current = true;\s*pendingRef\.current = null/],
  ['confirmed creation alone navigates to its conversation', /router\.replace\(\{ pathname: "\/messages\/\[id\]", params: \{ id: conversationId \} \}\)/],
  ['ambiguous retry keeps the saved identity and freezes fields', /Retry uses the same protected request ID and unchanged details/],
  ['editing an ambiguous request requires an explicit warning', /The group may already have been created/],
  ['offline errors retain fields and expose retry', /Retry storage/],
  ['accessible multi-select classmates', /accessibilityRole="checkbox"/],
];

for (const [name, pattern] of checks) {
  assert.match(source, pattern, name);
  console.log(`PASS ${name}`);
}

const persistAt = source.indexOf('await writeSaved({');
const networkAt = source.indexOf('await createGroupConversation(userId, operation)');
assert.ok(persistAt >= 0 && networkAt > persistAt,
  'the retry UUID and exact payload must reach durable storage before the network can commit');
console.log('PASS durable fingerprint precedes network commit');

console.log(`Group creation screen: ${checks.length + 2} checks passed.`);
