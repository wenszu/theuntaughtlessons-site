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
this step. It does not automatically add or remove anyone from the group.

---

## 3A. Member-facing video access guidance

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
