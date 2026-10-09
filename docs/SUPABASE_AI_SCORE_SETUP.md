# AI scoring on Supabase (ai-score): owner runbook

Written 2026-10-08. For the owner. About 20 minutes of your time in total. Nothing here changes what members see until you switch a browser on.

## Summary

- **What this is:** the two AI scorers that live in Firebase today (Explain to Aiko and the TSA diagnostic) now also exist as one Supabase Edge Function named `ai-score`. The pages send the same information and get the same kind of answer.
- **What is better:** the Firebase scorers only checked which website the request came from, and that can be faked. The new one requires a signed in member, and gives each person at most 30 scoring calls per hour for each exercise, so nobody can spend your Gemini quota by copying the address.
- **What you do:** copy the Gemini key from Firebase to Supabase (Step 1). The assistant does the rest: the small database change, the deploy, the tests, the page change.
- **Risk:** low. The Firebase scorers stay deployed and stay the default. The new path is used only in a browser where the setting `utl_ai` is `supabase`.
- **Cost:** the same Gemini usage as today. It is billed to the Google project that owns the key.

## Order of operations

Do these in this order. Each step is safe on its own, and nobody sees a change until the last one.

1. **Deploy** the function (Step 3). Without the key it answers `{fallback:true}` to a signed in member, so nothing breaks.
2. **Set the key** `GEMINI_API_KEY` in the Supabase secrets (Step 1). Do not skip this: without it every call falls back.
3. **Test** (Step 4), with the test member, before any page is switched.
4. **Flip the `ai` flag** (Step 5, or the `ai` switch in `docs/SUPABASE_SWITCHBOARD.md`) only after the tests pass.

Time limits to know about: the function allows Gemini up to 25 seconds per attempt, but the TSA page waits only 8 seconds for the answer. With the 8 second wait, a slow but successful AI answer is thrown away and the page uses its own rules. Raise the TSA page wait to about 30 seconds before you turn on a TSA GenAI toggle (`settings/tsa_scoring`). Explain to Aiko waits 50 seconds, which is enough.

## Step 1. Copy the Gemini key from Firebase to Supabase

The key already exists. It is the Firebase secret named `GEMINI_API_KEY`. You will copy it to your clipboard without it ever appearing on the screen, then paste it into the Supabase dashboard.

1. Open Terminal and run this single line (it copies the key and prints only a number):

   `cd ~/dev/utl-supabase-core/functions-aiko && firebase functions:secrets:access GEMINI_API_KEY --project the-untaught-lessons | tr -d '\n' | tee >(pbcopy) | wc -c`

2. Read the number it prints. It is the count of characters that were copied. A Google key normally has 39 characters. If the number is 0, or a small number such as under 20, the copy failed (for example you are not signed in to Firebase). Do not paste anything; tell the assistant what the number was and what the Terminal said.
3. Open the Supabase dashboard, project `utl-core`, then Edge Functions, then Secrets. The menu name may differ a little; it is the place where Edge Function secrets are added.
4. Add a new secret. Name: `GEMINI_API_KEY` (exactly, capital letters). Value: paste with Command+V. Save.
5. Clear the clipboard by copying any ordinary word, and close the Terminal window.
6. Tell the assistant "key set".

Notes:
- Do not paste the key into the chat.
- If the key is not set (or is empty), the function does not fail. After the sign in check passes it answers `200` with `{fallback:true}`, so the page uses its own rules, exactly as when the AI service is down. It is not a `503`. This also means a missing key shows up as "AI feedback is unavailable", not as an error: do Step 4 only after the key is set.
- The old key stays in Firebase and keeps working. Nothing is removed. The plan (task 3 in `docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md`) prefers a fresh key in a Google project you keep, and revoking the old one at the close of the migration. That can be done later by repeating this step with the new key.

## Step 2. The assistant applies the database change (needs your go in chat)

Migration `20261008002280_ai_score_limits.sql` adds one small table (counts of calls per person per hour, closed to browsers) and two functions. It touches no existing data. You tell the assistant "go" in chat, as for earlier migrations. The undo file is `supabase/rollbacks/20261008002280_ai_score_limits_down.sql`.

## Step 3. The assistant deploys the function

The assistant deploys `ai-score` with its Supabase tool. The function is deployed with the gateway sign in check off. This is deliberate and safe: the browser's pre-flight check carries no token, and the member token is a Supabase session token now (a Firebase token also works). The function does its own, stricter check before it reads anything or calls Gemini: it asks the database who the token belongs to, and refuses everyone else.

If you ever need to deploy by hand: `supabase functions deploy ai-score --no-verify-jwt --project-ref czljyikfavtjgqcibdda`

Optional secret `AIKO_STORE_ATTEMPT`: leave it unset. If it is set to the exact text `on`, the function also records each scored Explain to Aiko attempt in the database. Without it, the page saves the attempt itself, as it does today.

## Step 4. Test (before any page is switched)

Use the test member, not your own account (your real record would get a test attempt).

1. **A stranger is refused.** In Terminal:

   `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://czljyikfavtjgqcibdda.supabase.co/functions/v1/ai-score/explain-to-aiko -H "Content-Type: application/json" -d '{"transcript":"one two three four five six"}'`

   Expected: `401`. Anything else, tell the assistant.
2. **A signed in member is answered.** Sign in to the site as the test member. Open the browser developer console on any member page and run:

   `localStorage.setItem('utl_ai','supabase'); const m = await import('/assets/ai-score-client.js'); await m.scoreExplainToAiko({ mode: '120', transcript: 'The Olympics is losing impact because it peaks only every four years, attention is split across platforms, and athlete stories are weaker. My next step is a short meeting with you on Friday.', durationSeconds: 60, wpm: 130, fillerCount: 1 })`

   Expected: an object with `total`, six `criteria` and `fallback: false`. If it shows `fallback: true`, ask the assistant to read the function log (it holds only the route, the status, the time taken and a short reason, never any text you wrote).
3. **The limit works.** Ask the assistant to run the limit check on the test member. It makes 31 real scoring calls and expects the 31st to be refused with a "wait" answer. This uses a small amount of Gemini quota.
4. **Compare with Firebase.** Run the same text with `localStorage.removeItem('utl_ai')` and compare. The model varies a little between runs, so totals within about 3 points are normal; exactly equal is not expected.

## Step 5. Switch pages

The assistant makes a two line change in each of the two pages so they call `assets/ai-score-client.js`. The pages keep using Firebase until the setting is changed in that browser:

- Use the new scorers in one browser: `localStorage.setItem('utl_ai','supabase')`
- Go back to Firebase in that browser: `localStorage.removeItem('utl_ai')`

Nobody else is affected by what you set in your own browser. When the comparison looks good, the assistant changes the default in the client file so everyone uses Supabase (one word, one deploy of the site).

## If something goes wrong

- A single browser: remove the setting (above). That browser is back on Firebase immediately.
- Everyone, after the default has been changed: the assistant changes the default back and publishes. The Firebase scorers stay deployed until the migration closes, so this works at any time before then.
- A member who sees "AI feedback is unavailable": the page found no answer and used its fallback, as it does today when the AI service is down. The reasons on the new path are: not signed in, more than 30 calls in the hour, or the service was unreachable.
- To remove the database change: the undo file named in Step 2. Do this only after the pages are back on Firebase, because without it the new function refuses every call.

## Two things that differ from Firebase

- **Sign in is required.** A page opened without a signed in member (for example a preview with no sign in) gets the fallback from the new path.
- **The TSA diagnostic scorer now actually returns scores.** The Firebase version rejected every well formed answer from the AI and always returned the fallback, so the TSA page always used its own rules. The new one accepts the AI answer. If the TSA setting that turns AI scoring on (`settings/tsa_scoring`) is on, switching the TSA page to the new path will start using AI scores for Speak and Act. Check that setting with the assistant before you switch the TSA page. The TSA page also waits only 8 seconds for the AI while the function allows 25 seconds, which is often too short: raise the page wait to about 30 seconds before you turn on a TSA GenAI toggle (the assistant will normally do this when it switches the page).
