# Google Group Setup — The Untaught Lessons

This guide explains how to set up the Google Group used to share the UTL Drive folder
with all members, and how the `googleGroupAdded` field in the admin Members panel connects
to it.

---

## 1. Create the Google Group

1. Go to [groups.google.com](https://groups.google.com) and sign in as the UTL admin account.
2. Click **Create group**.
3. Set the group name: e.g. `UTL Members` and choose a group email such as
   `utl-members@googlegroups.com`.
4. Under **Group settings**, configure:
   - **Who can join**: Invited users only (do not allow open or public sign-up)
   - **Who can post**: Group managers and owners only
   - **Who can view conversations**: Group members
5. Click **Create group**.

---

## 2. Share the UTL Drive folder with the group

1. Open [drive.google.com](https://drive.google.com) and locate the master UTL content folder.
2. Right-click the folder → **Share**.
3. In the "Add people and groups" field, paste the group email (e.g. `utl-members@googlegroups.com`).
4. Set the role to **Viewer** (members should be able to watch videos, not edit files).
5. Uncheck "Notify people" if you prefer a silent share, or leave it on to send a welcome email.
6. Click **Share**.

From this point on, anyone added to the Google Group will automatically gain view access to
the entire Drive folder. Removing them from the group revokes access immediately.

---

## 3. Add a member to the group

1. Go to [groups.google.com](https://groups.google.com) and open the UTL Members group.
2. Click **Members** → **Add members**.
3. Enter the member's Google email address and click **Add**.
4. Return to the admin Members tab at `theuntaughtlessons.com/admin/`.
5. Find the member's row, click **Edit**, tick **Google Group Added → Yes**, and save.

The `googleGroupAdded` field is a manual flag — it is your record that you have completed
this step. It can also be updated automatically by the Apps Script route below.

---

## 3A. Automated group sync from the Admin Console

The Admin Console now sends Apps Script actions when members are added, marked inactive,
manually toggled in the Google Group field, or removed:

- `AddGoogleGroupMember`
- `RemoveGoogleGroupMember`

To activate this automation in the deployed Apps Script:

1. Paste the latest helpers from `scripts/apps-script-email-actions.gs` into the deployed
   Apps Script web app.
2. In `doPost(e)`, route these actions before the default contact-form/sheet logging branch:

   ```js
   if (action === 'AddGoogleGroupMember') return handleGoogleGroupMember(data, 'add');
   if (action === 'RemoveGoogleGroupMember') return handleGoogleGroupMember(data, 'remove');
   ```

3. In Apps Script, enable **Services (+)** → **Admin Directory API**.
4. In the linked Google Cloud project, enable the **Admin SDK API** if Apps Script asks for it.
5. Deploy a new web app version.

The Apps Script must run as an account that can manage `utl-members@googlegroups.com`.
If the group is a consumer `@googlegroups.com` group rather than a Workspace/Cloud Identity
managed group, the Admin Directory API may not be able to add/remove members. In that case,
the script sends a failure email to the admin address and the member must be managed manually.

The Firestore/Cloud Functions migration is being added in parallel so the Admin Console can
eventually show confirmed/failed Google Group sync status. Track that rollout in
`GOOGLE_GROUP_SYNC_MIGRATION.md`. Until the checklist there is complete, keep the Apps Script
fallback active.

---

## 3B. Member-facing video access guidance

The member workspace shows an expandable **Video not opening?** guide under protected
Google Drive videos and slides. This is intentional:

- The site cannot reliably detect the Google Drive "request access" screen inside an
  embedded iframe because Google Drive is cross-origin.
- Members should not request access on individual videos. Access should be solved once
  through membership in `utl-members@googlegroups.com`.
- The guide tells members to sign into Google with the same email used for the workspace,
  open `https://groups.google.com/g/utl-members`, join if the group allows it, or reply to
  their welcome email if Google says an invitation is required.

If you want members to fully self-serve, change the Google Group setting from **Invited
users only** to a moderated join/request setting. If you keep **Invited users only**, the
admin must add them manually before videos will unlock.

---

## 4. Removing a member from the group

1. In groups.google.com, open the UTL Members group → **Members**.
2. Find the member, click the three-dot menu → **Remove from group**.
3. In the admin Members tab, set `googleGroupAdded → No` and optionally set Status to
   `inactive` or click **Remove** to delete the record entirely.

---

## 5. Future automation (planned)

A Firebase Cloud Function will eventually automate group membership sync:

- On `authorized_members` write: if `googleGroupAdded` is set to `true` and the member
  does not already exist in the Google Group, the function will call the Google Groups API
  to add them.
- On `authorized_members` delete or `status = inactive`: the function will remove the member
  from the group.
- The `googleGroupAdded` field will switch to a read-only computed value once automation
  is live.

Until then, the manual workflow above is the source of truth.
