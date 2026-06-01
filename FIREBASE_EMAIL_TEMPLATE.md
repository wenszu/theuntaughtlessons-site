# Firebase Auth Email Template

Firebase's built-in "send sign-in link" email is controlled in the Firebase Console, not in this static website code. The Admin Console can trigger the email, but the wording and layout come from Firebase Authentication templates.

Use this for the Firebase **Sign-in link** template.

## Where To Edit

1. Open Firebase Console.
2. Go to **Authentication**.
3. Open **Templates**.
4. Choose **Sign-in link**.
5. Update sender name, subject, and message.
6. Save/publish the template.

## Sender Name

```text
Wen-Szu — The Untaught Lessons
```

## Subject

```text
Your one-click sign-in link for The Untaught Lessons
```

## Message

```text
Hi,

Here is your one-click sign-in link for the Think, speak, and act like an executive™ program.

Use this link only with the email address where you received it. It will take you directly to your member workspace.

%LINK%

For your security, this link expires automatically. If it no longer works, ask Wen-Szu to send a fresh sign-in link from the Admin Console.

Once you are in:
1. Sign in to your workspace with the same Google account tied to your membership.
2. Complete the orientation.
3. Start Phase 1 when you are ready.

If anything does not work as expected, reply to your welcome email and we will help you get set up.

Wen-Szu
The Untaught Lessons
```

## Important Limitation

Firebase Auth templates are much more limited than the custom welcome email in the Admin Console. They cannot fully match the branded HTML card unless a server-side sender generates the sign-in link and sends it through a custom email service. For now, keep this Firebase email functional and clear, and use the Admin Console welcome email for the polished branded onboarding message.
