const assert = require('assert');
const { compareMember, formatResults, formatValue, exitCodeFor } = require('../scripts/supabase-shadow-compare');

// Synthetic data only. Every identifying string below is checked against the printed output at the end.
const EMAIL = 'zed.member@example.test';
const IDS = [
  EMAIL, 'uid-zed-9', 'person-uuid-1', 'enr-uuid-1', 'cohort-uuid-1', 'org-uuid-1', 'Example Org', 'Batch Z',
  'led-a', 'led-b', 'sub-1', 'sub-2', 'attempt-doc-1', 'Zed Member', 'secret answer text'
];

// A member whose Supabase copy matches Firestore exactly. Uses the real catalog: grocery-list is an alias of p1-e1.
function matchingMember() {
  const firestore = {
    users: [{
      id: 'uid-zed-9',
      data: {
        email: EMAIL,
        displayName: 'Zed Member',
        signInProviders: ['google.com', 'emailLink'],
        lastSignInProvider: 'google.com',
        rewards: {
          mpTotal: 30, streakDays: 4, tokens: 2,
          // led-a appears twice: the import keeps one.
          ledger: [{ id: 'led-a', mpEarned: 10 }, { id: 'led-b', mpEarned: 20 }, { id: 'led-a', mpEarned: 10 }]
        },
        workspaceProgress: {
          exercises: { 'grocery-list': { completed: true, completedAt: '2026-01-02T00:00:00Z' }, 'p1-e3': { visited: true } },
          lessons: {}, contexts: {}
        }
      }
    }],
    authorized_members: [{ id: EMAIL, data: { email: EMAIL, name: 'Zed Member', status: 'active', cohort: 'Batch Z', expiryDate: '2027-01-01T00:00:00Z' } }],
    customers: [{ id: 'cust-zed', data: { primaryEmail: EMAIL } }],
    // Two documents for the same activity p1-e1 (alias and id), plus a legacy completion for p1-e2.
    completed_exercises: [
      { id: 'grocery-list', data: { status: 'done', savedPayload: { completed_at: '2026-01-02T00:00:00Z', answer: 'secret answer text' } } },
      { id: 'p1-e2', data: { status: 'done', savedPayload: { completed_at: '2026-01-05T00:00:00Z' } } }
    ],
    exercise_submissions: [
      { id: 'sub-1', data: { exerciseId: 'p1-e1', completedAtClient: '2026-01-02T00:00:00Z' } },
      { id: 'sub-2', data: { exerciseId: 'p1-e1', completedAtClient: '2026-01-03T00:00:00Z' } }
    ],
    exercise_attempts: [
      { id: 'attempt-doc-1', data: { exerciseId: 'p1-e1' } },
      { id: 'attempt-doc-2', data: { exerciseId: 'p1-e1' } }
    ],
    exercise_work: [
      { id: 'p1-e3', data: { exerciseId: 'p1-e3' } },
      { id: 'grocery-list', data: {} }
    ],
    analytics_sessions: [{ id: 's1', data: {} }, { id: 's2', data: {} }],
    analytics_activity_sessions: [{ id: 'a1', data: {} }, { id: 'a2', data: {} }, { id: 'a3', data: {} }],
    stability_events: [
      { id: 'e1', data: { eventType: 'javascript_error' } },
      { id: 'e2', data: { eventType: 'sync_error' } },
      { id: 'e3', data: { eventType: 'not_an_allowed_type' } } // the import skips this one
    ]
  };
  const supabase = {
    people: [{ id: 'person-uuid-1' }],
    person_profiles: [{ person_id: 'person-uuid-1', sign_in_providers: ['google.com', 'emailLink'], last_sign_in_provider: 'google.com' }],
    enrollments: [{ id: 'enr-uuid-1', program_id: 'tsa', status: 'active', cohort_id: 'cohort-uuid-1', valid_until: '2027-01-01T00:00:00.000Z', sponsor_organization_id: null }],
    organizations: [{ id: 'org-uuid-1', name: 'Example Org' }],
    activity_progress: [
      { activity_id: 'p1-e1', status: 'completed' },
      { activity_id: 'p1-e2', status: 'completed' },
      { activity_id: 'p1-e3', status: 'visited' },
      { activity_id: 'orientation', status: 'completed' } // not an exercise, not counted
    ],
    // p1-e1 twice (sub-1, sub-2), p1-e2 once (the legacy completion). The legacy p1-e1 one is folded into sub-1.
    activity_submissions: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
    activity_attempts: [{ id: 'u4' }, { id: 'u5' }],
    activity_drafts: [{ activity_id: 'p1-e3' }, { activity_id: 'p1-e1' }],
    reward_ledger: [{ id: 'u6', points: 10 }, { id: 'u7', points: 20 }],
    reward_state: [{ program_id: 'tsa', streak_days: 4, tokens: 2 }],
    engagement_sessions: [
      { id: 'u8', kind: 'session' }, { id: 'u9', kind: 'session' },
      { id: 'u10', kind: 'activity' }, { id: 'u11', kind: 'activity' }, { id: 'u12', kind: 'activity' }
    ],
    stability_events: [{ id: 'u13' }, { id: 'u14' }]
  };
  return { firestore, supabase };
}

const byCheck = (results, fragment) => {
  const found = results.filter((r) => r.check.includes(fragment));
  assert.equal(found.length, 1, `expected one check containing "${fragment}", got ${found.length}`);
  return found[0];
};

// A matching member passes every check, and the exit code is 0.
{
  const { firestore, supabase } = matchingMember();
  const results = compareMember(firestore, supabase);
  assert.ok(results.length >= 20);
  results.forEach((r) => assert.equal(r.status, 'PASS', `${r.check}: firestore ${r.firestore}, supabase ${r.supabase}`));
  assert.equal(exitCodeFor(results), 0);
  assert.match(formatResults(results), /All \d+ checks pass\.$/);
  // Counts the later tests rely on.
  assert.equal(byCheck(results, 'completed exercises').firestore, 2);
  assert.equal(byCheck(results, 'activity_submissions').firestore, 3);
  assert.equal(byCheck(results, 'ledger entries').firestore, 2);
  assert.equal(byCheck(results, 'exercise_work').firestore, 2);
  assert.equal(byCheck(results, 'stability_events').firestore, 2);
}

// A missing submission is one DIFF with the right counts, and the exit code is 1.
{
  const { firestore, supabase } = matchingMember();
  supabase.activity_submissions.pop();
  const results = compareMember(firestore, supabase);
  const diffs = results.filter((r) => r.status === 'DIFF');
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].check, 'submissions plus legacy completions vs activity_submissions');
  assert.equal(diffs[0].firestore, 3);
  assert.equal(diffs[0].supabase, 2);
  assert.equal(exitCodeFor(results), 1);
  assert.match(formatResults(results), /^DIFF {2}submissions plus legacy completions vs activity_submissions {2}\(firestore 3, supabase 2\)$/m);
  assert.match(formatResults(results), /1 of \d+ checks differ\.$/);
}

// Legacy completions are not double counted. The legacy p1-e1 completion (through its alias) has the same time as
// sub-1, so it is folded in. A legacy completion with a different time, or for another activity, is a row of its own.
{
  const { firestore, supabase } = matchingMember();
  assert.equal(byCheck(compareMember(firestore, supabase), 'activity_submissions').firestore, 3);
  firestore.completed_exercises[0].data.savedPayload.completed_at = '2026-02-01T00:00:00Z';
  supabase.activity_submissions.push({ id: 'u15' });
  const moved = byCheck(compareMember(firestore, supabase), 'activity_submissions');
  assert.equal(moved.firestore, 4);
  assert.equal(moved.supabase, 4);
  assert.equal(moved.status, 'PASS');
  // A completion that is not done adds nothing.
  firestore.completed_exercises[0].data.status = 'in_progress';
  assert.equal(byCheck(compareMember(firestore, supabase), 'activity_submissions').firestore, 3);
}

// A legacy completion with no submission still marks the exercise completed.
{
  const { firestore, supabase } = matchingMember();
  firestore.exercise_submissions = [];
  firestore.users[0].data.workspaceProgress.exercises = {};
  supabase.activity_submissions = [{ id: 'u1' }, { id: 'u2' }];
  const results = compareMember(firestore, supabase);
  assert.equal(byCheck(results, 'activity_submissions').firestore, 2);
  assert.equal(byCheck(results, 'completed exercises').firestore, 2);
  assert.equal(byCheck(results, 'completed exercises').status, 'PASS');
}

// A ledger mismatch is reported: entries, points sum and the stored total all differ.
{
  const { firestore, supabase } = matchingMember();
  supabase.reward_ledger.pop();
  const results = compareMember(firestore, supabase);
  const entries = byCheck(results, 'ledger entries');
  assert.deepStrictEqual([entries.status, entries.firestore, entries.supabase], ['DIFF', 2, 1]);
  const points = byCheck(results, 'ledger points sum vs');
  assert.deepStrictEqual([points.status, points.firestore, points.supabase], ['DIFF', 30, 10]);
  const total = byCheck(results, 'stored mpTotal');
  assert.deepStrictEqual([total.status, total.firestore, total.supabase], ['DIFF', 30, 10]);
  assert.equal(results.filter((r) => r.status === 'DIFF').length, 3);
}

// Streak and tokens are compared with reward_state, and a missing state row shows up.
{
  const { firestore, supabase } = matchingMember();
  supabase.reward_state[0].streak_days = 5;
  supabase.reward_state[0].tokens = 0;
  let results = compareMember(firestore, supabase);
  assert.deepStrictEqual([byCheck(results, 'streak days').firestore, byCheck(results, 'streak days').supabase], [4, 5]);
  assert.equal(byCheck(results, 'tokens').status, 'DIFF');
  supabase.reward_state = [];
  results = compareMember(firestore, supabase);
  assert.equal(byCheck(results, 'reward state row').status, 'DIFF');
}

// Analytics and stability counts are per kind, and a stability event of a type the import rejects is not expected.
{
  const { firestore, supabase } = matchingMember();
  supabase.engagement_sessions.pop();
  const results = compareMember(firestore, supabase);
  assert.equal(byCheck(results, 'analytics_activity_sessions').status, 'DIFF');
  assert.equal(byCheck(results, 'analytics_sessions vs').status, 'PASS');
}

// Aliases and distinct drafts: two exercise_work documents for one activity are one draft row.
{
  const { firestore, supabase } = matchingMember();
  firestore.exercise_work.push({ id: 'grocery-list-copy', data: { exerciseId: 'p1-e1' } });
  const draft = byCheck(compareMember(firestore, supabase), 'exercise_work');
  assert.equal(draft.firestore, 2);
  assert.equal(draft.status, 'PASS');
}

// Membership checks. Status maps through the import's table, AyalaLand stays active with an expiry.
{
  const { firestore, supabase } = matchingMember();
  firestore.authorized_members[0].data.status = 'inactive';
  assert.equal(byCheck(compareMember(firestore, supabase), 'member status').status, 'DIFF');
  supabase.enrollments[0].status = 'expired';
  assert.equal(byCheck(compareMember(firestore, supabase), 'member status').status, 'PASS');

  // AyalaLand: expired on Firestore, active with an expiry on Supabase, even with no expiry date on the member.
  delete firestore.authorized_members[0].data.expiryDate;
  supabase.enrollments[0].status = 'active';
  supabase.enrollments[0].sponsor_organization_id = 'org-uuid-1';
  supabase.organizations = [{ id: 'org-uuid-1', name: 'AyalaLand' }];
  const results = compareMember(firestore, supabase);
  assert.equal(byCheck(results, 'member status').status, 'PASS');
  assert.equal(byCheck(results, 'expiry date').status, 'PASS');

  // Cohort and expiry lost in the copy.
  const lost = matchingMember();
  lost.supabase.enrollments[0].cohort_id = null;
  lost.supabase.enrollments[0].valid_until = null;
  const lostResults = compareMember(lost.firestore, lost.supabase);
  assert.equal(byCheck(lostResults, 'cohort present').status, 'DIFF');
  assert.equal(byCheck(lostResults, 'expiry date').status, 'DIFF');
}

// Sign-in providers: the users document wins, the member document is the fallback.
{
  const { firestore, supabase } = matchingMember();
  supabase.person_profiles[0].sign_in_providers = ['google.com'];
  assert.deepStrictEqual(
    [byCheck(compareMember(firestore, supabase), 'sign-in providers').firestore, byCheck(compareMember(firestore, supabase), 'sign-in providers').supabase],
    [2, 1]
  );
  const fallback = matchingMember();
  fallback.firestore.users[0].data.signInProviders = [];
  fallback.firestore.authorized_members[0].data.signInProviders = ['password'];
  fallback.supabase.person_profiles[0].sign_in_providers = ['password'];
  assert.equal(byCheck(compareMember(fallback.firestore, fallback.supabase), 'sign-in providers').status, 'PASS');
}

// A member that is not in Supabase at all differs on the person check, and an empty Firestore side is not an error.
{
  const { firestore } = matchingMember();
  const results = compareMember(firestore, { people: [] });
  assert.equal(byCheck(results, 'member found').status, 'DIFF');
  assert.equal(exitCodeFor(results), 1);
  const empty = compareMember({}, {});
  assert.ok(empty.every((r) => r.status === 'PASS'));
}

// Nothing printed contains the email or any id from the synthetic data, for a passing and a differing member,
// and the formatter prints only numbers and true/false.
{
  const passing = matchingMember();
  const differing = matchingMember();
  differing.supabase.activity_submissions.pop();
  differing.supabase.reward_ledger.pop();
  differing.supabase.enrollments[0].cohort_id = null;
  [passing, differing].forEach(({ firestore, supabase }) => {
    const printed = formatResults(compareMember(firestore, supabase));
    IDS.forEach((value) => assert.ok(!printed.includes(value), `output must not contain a synthetic value`));
    assert.ok(!/@/.test(printed));
  });
  // Even a string that slipped into a result is replaced.
  assert.equal(formatValue('zed.member@example.test'), '?');
  assert.equal(formatValue(null), '?');
  assert.equal(formatValue(7), '7');
  assert.equal(formatValue(false), 'false');
  const leaky = formatResults([{ check: 'x', firestore: EMAIL, supabase: 'uid-zed-9', status: 'DIFF' }]);
  IDS.forEach((value) => assert.ok(!leaky.includes(value)));
}

console.log('supabase-shadow-compare tests passed');
