# The switchboard: moving every browser with one setting

Status (2026-10-08): written and tested locally. Not applied to the database, not deployed. Nothing changes for anyone until the migration is applied AND a flag is flipped.

## What it is, in plain words

The move from Firebase to Supabase is controlled by eight switches (the last two, `es_submit` and `mail`, come with migration 2360; see below). Today each switch lives in one browser only (the browser's local storage), so turning something on for everyone would mean visiting every browser. The switchboard is one small public setting in the database that holds the switches for everyone. When a page loads, the site reads that setting and copies each switch into the browser, but only where the person has not set that switch by hand.

With every switch on `firebase` (the starting state) the site behaves exactly as it does today and writes nothing into any browser.

## The eight switches

| Name in the setting | What it moves | Allowed words |
|---|---|---|
| `data_source` | Learner progress and rewards (Supabase copy next to Firestore) | `firebase`, `supabase` |
| `server_reads` | Admin and member read screens | `firebase`, `supabase`, `shadow` |
| `server_writes` | Admin console changes | `firebase`, `supabase`, `shadow` |
| `auth` | Sign in (Supabase Auth instead of Firebase Auth) | `firebase`, `supabase` |
| `payments` | Checkout (Stripe through Supabase) | `firebase`, `supabase` |
| `ai` | AI scoring (Explain to Aiko and the TSA diagnostic pages) | `firebase`, `supabase` |
| `es_submit` | The public Executive Signature submission and its "send me my results link" step (migration 2360) | `firebase`, `supabase` |
| `mail` | The result emails and the emails the admin console sends (migration 2360) | `firebase`, `supabase` |

The browser switch behind each name: `es_submit` is `utl_es` and `mail` is `utl_mail`; the other six are in `assets/switchboard.js`. Two more things now follow the existing flags (see `docs/SUPABASE_BROWSER_WIRING.md`): the member's certificate button follows `server_writes` (only the value `supabase` moves it, `shadow` leaves it on Firebase because that function has no dry run), and the sponsor page and the organization address check follow `server_reads`.

`firebase` means "no change from today". `supabase` means "use Supabase". `shadow` (reads and writes only) means "Firebase still answers, and Supabase is asked quietly in the background so the two answers can be compared in the browser console".

The database refuses any other name and any other word, so a typing mistake cannot be saved and no secret can be stored here.

**Migration 2360 (`supabase/migrations/20261008002360_switchboard_more_flags.sql`, written, not applied)** adds `es_submit` and `mail`: it replaces the shape check with a version that allows the two names (words `firebase` and `supabase`, no `shadow`) and adds both to the row as `firebase`, only where they are not there yet, so running it again never resets a flag you flipped. Undo: `supabase/rollbacks/20261008002360_switchboard_more_flags_down.sql` (takes the two flags out of the row, puts the check back). Until 2360 is applied the site file already understands the two names, and a row without them counts as `firebase`, so nothing changes. Flip them like the others:

```sql
update public.app_settings
set value = jsonb_set(value, '{es_submit}', '"supabase"')
where key = 'switchboard';
```

## Before you can use it

1. The migration `supabase/migrations/20261008002300_switchboard.sql` is applied (Claude shows it to you first and applies it only after you approve; the undo is `supabase/rollbacks/20261008002300_switchboard_down.sql`). It adds the setting with every switch on `firebase`.
2. The site files `assets/switchboard.js` and `assets/firebase.js` are deployed.
3. The thing you are about to switch is actually ready. Flipping a switch does not make Supabase ready; it only tells every browser to use it. In particular, `auth` for everyone must wait until the accounts are provisioned (docs/SUPABASE_PROVISION_AUTH.md) and the server functions accept Supabase sign in (docs/SUPABASE_PLAN_SIGNIN.md, section 15.2). Ask Claude before flipping `auth`, `server_writes` or `payments`.

## How to flip one switch (Supabase SQL editor)

Open the Supabase dashboard for project `utl-core`, then "SQL Editor", paste ONE statement, and run it.

Turn one switch on, for example `ai`:

```sql
update public.app_settings
set value = jsonb_set(value, '{ai}', '"supabase"')
where key = 'switchboard';
```

Change `ai` to the name you want and `"supabase"` to the word you want (keep the double quotes inside the single quotes). For a quiet comparison run of the read screens:

```sql
update public.app_settings
set value = jsonb_set(value, '{server_reads}', '"shadow"')
where key = 'switchboard';
```

The editor should answer "Success. 1 row affected" (or similar). If it shows an error that mentions an unknown flag or a value that is not allowed, nothing was saved; check the spelling.

## How to put one switch back (rollback)

Run the same statement with the word `firebase`:

```sql
update public.app_settings
set value = jsonb_set(value, '{ai}', '"firebase"')
where key = 'switchboard';
```

To put ALL back at once (after migration 2360; before it, leave out `es_submit` and `mail`):

```sql
update public.app_settings
set value = '{"data_source":"firebase","server_reads":"firebase","server_writes":"firebase","auth":"firebase","payments":"firebase","ai":"firebase","es_submit":"firebase","mail":"firebase"}'::jsonb
where key = 'switchboard';
```

## See the current state and the history

```sql
select value from public.app_settings where key = 'switchboard';
```

Every change writes one history row (what it was, what it became, and when):

```sql
select created_at, detail from public.audit_events where action = 'switchboard.changed' order by id desc limit 20;
```

## How fast it reaches people

- A page asks for the setting at most once every 5 minutes per browser session, so a change reaches an open tab within about 5 minutes (at its next page load, not in the middle of a page) and a fresh visit gets it at once.
- The first page of a brand new session fetches the setting while it loads, so a few reads on that very first page can still use the old value. Every page after it uses the new one.
- Taking a switch back works the same way: within about 5 minutes the browser switch is removed again.

## Who is not moved (on purpose)

- A person who set a switch by hand in their browser (for testing, in the console) keeps their own value. This includes an explicit `firebase`. The switchboard never overwrites a value it did not write itself.
- `data_source`: the existing sign in gate already decides this per member (opt out is the field `supabaseOptOut` on the member record). A browser the gate has already decided keeps its value. The switchboard only reaches browsers that have no value yet.
- To see what a browser holds, open the browser tools console and enter: `Object.entries(localStorage).filter(([k]) => k.startsWith('utl_'))`.
- To clear a switch you set by hand: `localStorage.removeItem('utl_auth')` (change the name), then reload. If the switchboard says `supabase` for it, the next page load applies that value again; to stay out of it, set your own `firebase` by hand: `localStorage.setItem('utl_auth', 'firebase')`.

## If the setting cannot be read

If the network, the database or the setting is unavailable, the site changes nothing: browsers keep whatever they had. If the migration is rolled back, the setting disappears and the switches the switchboard wrote are removed again at the next page load.

## What changed in the site files

- `assets/switchboard.js` is new. It reads the setting with the public (publishable) key only and never writes to the database.
- `assets/firebase.js` has one new line near the top that loads the switchboard in the background (a missing file or a failure cannot stop a page), and three one line additions so that the browser switches for reads and writes also understand `shadow`.
- Tests: `tests/supabase-switchboard.test.js` and `supabase/switchboard-test.mjs`.

## Two things to know
- To opt a browser out of a flag that the switchboard turned on, set its switch to the value `firebase`. Clearing the switch does not stick, because the switchboard fills an empty switch again at the next page load.
- After you roll a flag back, open tabs and new sessions can take up to 5 minutes to pick it up.
