# Creating the Supabase sign in accounts (provisioning)

Status (2026-10-08): the script is written and tested with a fake service. It has never been run against the real project.

## What it does, in plain words

Every active person who has an email address and no Supabase account gets one, and the two are linked. The accounts are created already confirmed, with no password, and NO email is sent to anyone. The person signs in later with an email link or Google, and the account is already waiting and tied to their record.

For each person the script does this:
1. Looks for an existing Supabase account with the same email address. If it exists and is confirmed, it is used. If it exists but was never confirmed (someone may have created it by hand or by sign up), it is NOT linked and is counted, so a stranger can never be tied to a member's record.
2. If there is none, creates it through the Auth admin service.
3. Writes the account id into the person's record, only if that field is still empty.

It never creates a person, never changes anyone who is archived, restricted or already linked, and never changes anything except that one field. Running it again is safe: people already linked are skipped, and if a run stopped half way the next run picks up where it stopped.

## Before you run it

1. In the Supabase dashboard open "Authentication", "Sign In / Providers", "Email" and make sure "Allow new users to sign up" is OFF. The script asks the service and refuses to write while sign up is on. Reason: while sign up is on, a stranger could create an account with a member's address before this script does.
2. Decide which addresses to leave out with `--exclude-email`:
   - The test member was created by hand. If that person has a record, the script finds the account by address and only links it. You may leave the address out to avoid touching it at all.
   - Your own owner account: it will be provisioned like everyone else (it needs an account to sign in with Supabase). Do not use it for tests. If you want it done last or by hand, leave it out now and run again later.
3. Node 18 or newer (this computer has it).

## Create the secret key (once, for this run only)

1. Supabase dashboard, project `utl-core`, "Project Settings", "API Keys".
2. Choose "Create new secret key", name it `provisioning`, create it, and copy the value. Do not paste it into a chat, a file, or an email.
3. In a terminal inside this project folder, enter the next line, paste the key when asked (nothing shows while you paste), and press Return. This keeps the key out of your command history:

```
read -s "SUPABASE_SECRET_KEY?Paste the key, then press Return: "; export SUPABASE_SECRET_KEY
```

## Step 1: dry run (writes nothing)

```
node scripts/supabase-provision-auth.js
```

It prints counts only: people with an active account, how many are already linked, how many are eligible, how many accounts it would create, how many exist already (only a link would be made), and how many it would skip (left out by you, over the limit, or an existing account that is unusable). No email address appears on the screen. If it warns that sign up is on, fix that first.

## Step 2: a small first run

```
node scripts/supabase-provision-auth.js --apply --limit 3 --exclude-email owner@example.com
```

Replace the address with the one(s) you want left out (repeat `--exclude-email` or separate addresses with commas). It prints the same counts, then asks you to type `APPLY`. Anything else cancels and nothing is written.

Then do the checks below. If they look right, run the same command without `--limit`.

## Step 3: the rest

```
node scripts/supabase-provision-auth.js --apply --exclude-email owner@example.com
```

## If it stops

The first error from the Auth service stops the run with a plain message (the status and the service's own words, with addresses and keys removed). People done before that stay done. Run the same command again to continue. If the message says the key was refused, check that you pasted a secret key of project `utl-core`.

## What to check afterwards (read only, in the Supabase SQL editor)

```sql
-- Accounts and linked people (the two numbers should be close; the difference is people left out or without an email)
select (select count(*) from auth.users) as auth_users,
       (select count(*) from public.people where account_status = 'active' and supabase_uid is not null) as linked_people,
       (select count(*) from public.people where account_status = 'active' and supabase_uid is null) as not_linked_people;

-- Every link points to a real account (expect 0)
select count(*) from public.people p left join auth.users u on u.id = p.supabase_uid
where p.supabase_uid is not null and u.id is null;

-- The address on the account matches the address on the person (expect 0)
select count(*) from public.people p join auth.users u on u.id = p.supabase_uid
where lower(u.email) <> p.primary_email::text;

-- Accounts this script created that nobody is linked to (expect 0)
select count(*) from auth.users u
where u.raw_user_meta_data ->> 'provisioned_by' = 'utl'
  and not exists (select 1 from public.people p where p.supabase_uid = u.id);

-- The run summaries (counts only)
select created_at, detail from public.audit_events where action = 'auth.provisioned' order by id desc;
```

## When you are done

1. Remove the key from the terminal: `unset SUPABASE_SECRET_KEY`.
2. In the dashboard ("Project Settings", "API Keys") delete the secret key named `provisioning`.
3. Leave "Allow new users to sign up" OFF for good.

## Safety rules (short)

- Sign up OFF before running (the script enforces it for writes).
- The key lives only in your terminal for this run, then it is deleted in the dashboard.
- Nothing is written without typing `APPLY`.
- Run a small batch first (`--limit 3`), check, then the rest.
- Never test with your own owner record. The test member is a separate person.
- No emails are sent by this script. Members hear nothing until you tell them.

## Undo (only if something is clearly wrong)

Ask Claude first. The reference steps: (1) unlink the people it linked:

```sql
update public.people set supabase_uid = null
where supabase_uid in (select id from auth.users where raw_user_meta_data ->> 'provisioned_by' = 'utl');
```

then (2) delete those accounts in the dashboard ("Authentication", "Users"), or ask Claude to do it with the admin service. The audit history rows stay on purpose.

## Files

`scripts/supabase-provision-auth.js` (the script), `tests/supabase-provision-auth.test.js` (the tests).
