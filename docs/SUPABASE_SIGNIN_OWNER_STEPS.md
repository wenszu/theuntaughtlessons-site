# Sign in on Supabase: the owner steps, in order

Written 2026-10-08 for the owner. About 75 minutes of your time in total, plus a short wait if Google or Resend needs a moment. No coding. Nothing here changes what members see: the site keeps signing in with Firebase until a switch is turned on, and that switch stays off until you and Claude agree (step 24).

Rules for the whole guide:
- Never paste a key, a secret or a password into the chat. You paste them only into the Supabase or Google page named in the step.
- Menu names change over time. If a name differs, search the page for the words in quotes.
- Tags: **[Claude checks]** means Claude can confirm the step afterwards with a read only check (no changes). **[You check]** means only you can see it (a dashboard screen or your inbox).
- Never use your own member account for the tests. Use the test member (step 17).

## Do this first (2 minutes)

As of this morning the public settings of the project say that sign up is still ON. While it is on, anyone who knows the public key can create an account with a member's address. Turn it off now.

1. Open https://supabase.com/dashboard and choose the project `utl-core`.
2. In the left menu choose "Authentication", then "Sign In / Providers" (it may be called "Providers").
3. Find "User Signups" (or the switch "Allow new users to sign up"). Turn it OFF. Choose "Save changes" if the page shows that button.
   - You will never turn it on again. Accounts are made only with "Add user" in the dashboard or by Claude's provisioning script, and both still work with sign up off.
   - **[Claude checks]** Claude asks the public settings page of the project. It must say sign up is disabled.

## Part A. Where the sign in emails come from (Resend, about 10 minutes)

The Resend domain `theuntaughtlessons.com` is already verified and the sender `hello@theuntaughtlessons.com` is already in use for other emails. You only add one more key.

4. Open https://resend.com/api-keys and sign in.
5. Choose "Create API Key". Name: `supabase-auth`. Permission: "Sending access". Domain: `theuntaughtlessons.com`. Choose "Add".
6. Copy the key (it starts with `re_`). Resend shows it only once. Keep it open in this tab, or store it in your password manager. You paste it in step 11.
7. Open https://resend.com/domains, open `theuntaughtlessons.com`, and check that "Click tracking" and "Open tracking" are both OFF. Click tracking rewrites the link in the email and the link would stop working.
   - **[You check]**
8. Check that mail sent to `hello@theuntaughtlessons.com` reaches a mailbox you read (a member may reply to a sign in email). If it does not, tell Claude and the sender is changed to another address on the same domain.
   - **[You check]**

## Part B. Supabase settings (about 25 minutes)

9. Authentication, "URL Configuration".
   - "Site URL": `https://theuntaughtlessons.com`
   - "Redirect URLs": choose "Add URL" and add these two, one at a time:
     - `https://theuntaughtlessons.com/**`
     - `https://www.theuntaughtlessons.com/**`
   - These two cover every page that the code returns to after sign in: `https://theuntaughtlessons.com/member-login/` (email link and Google), `https://theuntaughtlessons.com/apps/executive-signature/my-results/` (the Executive Signature results link) and `https://theuntaughtlessons.com/admin/` (the admin console).
   - Only while you test on your own computer, also add `http://localhost:8082/**`. Remove it again when the tests are done (step 22).
   - Choose "Save changes".
   - **[You check]** The Site URL and both addresses appear in the list.
10. Authentication, "Sign In / Providers", open "Email".
    - "Enable Email provider": ON. "Confirm email": ON.
    - "Email OTP Expiration": `1800` (seconds, that is 30 minutes).
    - Leave everything else as it is. Choose "Save".
    - **[Claude checks]** The public settings page shows the email provider as enabled and that new accounts are not confirmed automatically.
11. Authentication, "Emails" (it may sit under "Notifications"), tab "SMTP Settings". Turn on "Enable custom SMTP" and enter exactly:
    - Sender email: `hello@theuntaughtlessons.com`
    - Sender name: `The Untaught Lessons`
    - Host: `smtp.resend.com`
    - Port number: `465`
    - Minimum interval between emails being sent: `60` seconds
    - Username: `resend`
    - Password: the Resend key from step 6
    - Choose "Save". If the page asks for a test, ignore it. The real test is step 18.
    - **[You check]** The page shows the settings saved. Claude cannot read them. Claude confirms that the emails arrive (step 18) and reads the sign in log for errors from the mail server.
12. Authentication, "Emails", tab "Templates", open "Magic Link".
    - Subject: `Your sign in link for The Untaught Lessons`
    - Message body: delete everything and paste this text:

    ```
    <p>Hello,</p>
    <p>Thank you for learning with The Untaught Lessons. Select the link below to sign in to your workspace.</p>
    <p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email">Sign in to my workspace</a></p>
    <p>The page that opens asks you to enter your email address once more. Enter the same address that received this message, then select Sign in.</p>
    <p>This link works one time and stays valid for 30 minutes. If it no longer works, return to the sign in page and request a new link.</p>
    <p>If you did not ask for this message, you may ignore it. No one can sign in without this link.</p>
    <p>With appreciation,<br>The Untaught Lessons</p>
    ```
    - Choose "Save". Leave the other templates as they are: they are not used, because new accounts are never created by sign up.
    - **[You check]** Claude checks the wording when you forward the test email in step 18.
13. Authentication, "Rate Limits". Find "Rate limit for sending emails". With the custom sender on it can be changed. Set it to `100` per hour. Leave the other limits as they are.
    - **[You check]** One number only. Claude cannot read it.
14. Project Settings, "JWT Keys" (it may be called "JWT Signing Keys"). Write down which of these you see: "ECC (P-256)", "RSA", or only "Legacy JWT secret". Tell Claude the words. No change is needed. Claude uses the answer to choose how the server functions check a sign in later.
15. Authentication, "Third-Party Auth". Leave "Firebase" in place. Removing it would sign out everyone who is signed in with Firebase today. It is removed only at the very end, two weeks after the switch (Claude reminds you).

## Part C. Google (about 25 minutes)

Use the Google Cloud project that already holds your Firebase sign in: `the-untaught-lessons`. A new key for Supabase is created beside the Firebase one, so each can be removed alone later.

16. Open https://console.cloud.google.com and choose the project `the-untaught-lessons` at the top.
    1. Left menu, "APIs & Services", "Credentials". Choose "Create credentials", then "OAuth client ID".
    2. Application type: "Web application". Name: `UTL Supabase sign in`.
    3. "Authorized JavaScript origins": choose "Add URI" and enter `https://theuntaughtlessons.com`.
    4. "Authorized redirect URIs": choose "Add URI" and enter exactly `https://czljyikfavtjgqcibdda.supabase.co/auth/v1/callback`
    5. Choose "Create". A window shows the "Client ID" and the "Client secret". Copy both into a safe place (your password manager). Do not paste them into the chat.
    6. Still in Google Cloud, open the consent screen (left menu "Google Auth Platform", or "OAuth consent screen"). Check three things: the publishing status says "In production" (not "Testing"; if it says Testing, choose "Publish app"); the only scopes are `openid`, `email` and `profile`; and `theuntaughtlessons.com` is listed as an authorized domain.
       - **[You check]**
    7. Back in Supabase: Authentication, "Sign In / Providers", open "Google". Turn "Enable Sign in with Google" ON. Paste the Client ID and the Client secret. Leave "Skip nonce check" OFF and "Allow users without an email" OFF. Check that the "Callback URL (for OAuth)" shown on the page is exactly the address in item 4. Choose "Save".
       - **[Claude checks]** The public settings page shows Google as enabled. Claude also asks the sign in address for Google and reads where it sends the browser (it must be Google, with the client ID you created, and the return page `https://theuntaughtlessons.com/member-login/`). This creates nothing.
    - Leave "Azure" (Microsoft) and "Facebook" OFF. They are turned on only if the sign in counts show that members use them (Claude produces the counts on request).

## Part D. The test member and the first tests (about 30 minutes)

17. Pick the test member. It must be a person you control, never your own owner account. Two things are needed:
    - The person exists as a member (in the admin console, Members). Its address is the Gmail address of a second Google account of yours, so you can test both the email link and the Google button.
    - In Supabase: Authentication, "Users", "Add user", "Create new user". Enter that address, a long random password (you never need it again), and tick "Auto Confirm User". Choose "Create user". No email is sent.
    - **[Claude checks]** Claude reads (read only) that this one account exists and is confirmed. When the test member signs in the first time the site links the account to the member by address (migration 2270 is already applied).
18. Try the email link. Use a private browser window.
    1. Open `https://theuntaughtlessons.com/member-login/`. Open the browser tools console (Cmd+Option+J in Chrome) and enter `localStorage.setItem("utl_auth", "supabase")`, then reload the page. This switches only this one browser.
    2. Choose the email option, enter the test member's address, and send the link.
    3. The email arrives in the inbox within one minute, not in spam. The sender shows "The Untaught Lessons", the subject and the text match step 12.
    4. Select the link. The page asks you to enter the address once more. Enter it and select Sign in. You arrive signed in.
    - **[You check]** Forward the email to Claude only if something looks wrong. **[Claude checks]** Claude reads the sign in log for mail server errors and reads that the test account now has a last sign in time and a linked member record.
19. Try the link a second time (the same email, opened again). The page says the link has expired or was already used and offers a new one. That is correct.
20. Try Google. Sign out, choose the Google button, choose the test member's Google account. You arrive signed in.
    - **[Claude checks]** Claude reads that the test account now shows a Google sign in method and that there is still one account for that address, not two.
21. Try a stranger. Sign out. Enter an address that is not a member and ask for a link. The page says the email was sent (it never says whether the address is a member) and no email arrives and no new account appears.
    - **[Claude checks]** The count of accounts in Authentication, "Users" has not changed.
22. Clean up the test: in the same console enter `localStorage.removeItem("utl_auth")` and reload (the site is back to Firebase sign in), and remove `http://localhost:8082/**` from the redirect list if you added it.

Note for the tests: with the switch on in one browser, the pages that still read Firebase data (most of the workspace) cannot load for a person who has only a Supabase sign in. The test passes when the sign in itself works, as described above. This is expected until the server functions move (docs/SUPABASE_PLAN_SIGNIN.md, section 15.2).

## Part E. Accounts for everyone, then the switch (later, with Claude)

23. Accounts for all members, in this order. Each step is explained in `docs/SUPABASE_PROVISION_AUTH.md`:
    1. Sign up is OFF (step 3). The script refuses to write while it is on.
    2. In the dashboard: Project Settings, "API Keys", "Create new secret key" named `provisioning`. Copy it into the terminal as the document shows. Never into a chat.
    3. Dry run: `node scripts/supabase-provision-auth.js`. It writes nothing and prints counts only.
    4. A small run: `node scripts/supabase-provision-auth.js --apply --limit 3 --exclude-email <your owner address>`. Type `APPLY` when asked.
    5. Claude runs the read only checks from the document (accounts and linked members agree, every link points to a real account).
    6. The rest: the same command without `--limit`.
    7. Delete the `provisioning` key in the dashboard and run `unset SUPABASE_SECRET_KEY` in the terminal.
    - **[Claude checks]** Every query in "What to check afterwards" of the provisioning document is read only, and Claude runs them for you. Members hear nothing: no email is sent by the script.
24. The switch. `docs/SUPABASE_SWITCHBOARD.md` describes the setting that moves every browser at once. The sign in switch (`auth`) stays on `firebase` until three things are true: the server functions accept a Supabase sign in, the admin console no longer needs a Firebase session, and the tests above passed again on the live site. Claude reminds you and shows you the one statement to run. **[Claude checks]** Claude reads the current switch values at any time (read only).
25. Two weeks after the switch: remove the Firebase provider ("Third-Party Auth"), delete the secret keys you no longer need, and remove any test address from the redirect list. Claude lists these on the day.

## The ten line test plan (test member only, never the owner account)

1. Sign up is OFF in the public settings. **[Claude checks]**
2. A private window, `utl_auth` set to `supabase`, email link requested for the test member: "email sent".
3. The email is in the inbox, not in spam, with the right sender, subject and wording.
4. The link opens the sign in page; entering the address and selecting Sign in works.
5. The same link a second time shows the "expired or already used" message with a new link offered.
6. A link opened in a second browser (without pressing anything) does not use it up; the first browser still signs in with it.
7. The Google button with the test member's Google account signs in; still one account for that address. **[Claude checks]**
8. A non member address gets the same "email sent" message, no email arrives, no account appears. **[Claude checks]**
9. Sign out, then the next page load asks for sign in again. After `localStorage.removeItem("utl_auth")` the site signs in with Firebase as before.
10. Claude's read only look afterwards: the test account is linked to the test member, the sign in log shows no mail server errors, the account count equals what you expect. **[Claude checks]**

## What can go wrong, in one line each

- The email does not arrive: the Resend key is wrong or the domain is not verified (Resend page "Logs"), or the sender address is not on the verified domain. Claude reads the sign in log for the exact refusal.
- The email arrives in spam: tell Claude which mailbox provider; Resend "Domains" shows whether the three DNS records are verified.
- The link goes to the wrong page or the home page: the return address is missing from step 9 (Supabase then falls back to the Site URL).
- Google says "redirect_uri_mismatch": the address in step 16, item 4 is not exactly the Supabase callback address.
- Resend Free allows 100 emails a day for the whole domain, welcome emails included. Before a day when a whole cohort signs in, move Resend to the Pro plan for that month (see `docs/SUPABASE_EMAIL_SETUP.md`).
- Anything unclear: stop and ask Claude. Nothing in this guide is hard to undo: every setting can be changed back, and the site keeps using Firebase until the switch.
