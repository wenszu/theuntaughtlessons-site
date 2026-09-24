/**
 * Apps Script email action routes for The Untaught Lessons.
 *
 * Paste these helpers into the deployed Apps Script web app that owns:
 * https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec
 *
 * IMPORTANT:
 * Your current doPost(e) already parses `data` and handles WelcomeEmail.
 * Add this before the sheet/contact-form logging branch:
 *
 *   if (action === 'TestEmailTemplate') return handleTemplateEmail(data, true);
 *   if (action === 'WelcomeEmail') return handleTemplateEmail(data, false);
 *   if (action === 'RemovedMember') return handleRemovedMemberLog(data);
 *   if (action === 'AddGoogleGroupMember') return handleGoogleGroupMember(data, 'add');
 *   if (action === 'RemoveGoogleGroupMember') return handleGoogleGroupMember(data, 'remove');
 *   if (action === 'WeeklyOrgReport') return handleTemplateEmail(data, false);
 *
 * Then replace the old handleWelcomeEmail(data) with handleTemplateEmail(data, false)
 * or keep handleWelcomeEmail as a wrapper around handleTemplateEmail.
 *
 * WeeklyOrgReport (Cloud Functions: exports.sendWeeklyOrganizationReports, a scheduled
 * function that runs Tuesdays at 8am Asia/Manila) sends an organization's weekly stats to
 * its contact email, for organizations an admin has opted in from the Organization access
 * panel. It needs no handler of its own; it reuses handleTemplateEmail exactly like
 * WelcomeEmail, since it sends the same recipient/subject/plainBody/emailFormat shape.
 *
 * Google Group automation requires Apps Script Advanced Google services:
 *   Services (+) -> Admin Directory API -> Add
 * and the Google Cloud project must have Admin SDK API enabled.
 */

var UTL_GOOGLE_GROUP_EMAIL = 'utl-members@googlegroups.com';

function handleTemplateEmail(data, isTest) {
  if (!isValidAdminRelay_(data)) return ContentService.createTextOutput('unauthorized');
  var recipient = String(data.recipient || data.to || data.email || '').trim();
  if (!recipient) {
    return ContentService.createTextOutput('missing recipient');
  }

  var templateData = data.templateData || {};
  var subject = String(templateData.subject || data.subject || 'Welcome to The Untaught Lessons').trim();
  if (isTest && subject.indexOf('[TEST]') !== 0) {
    subject = '[TEST] ' + subject;
  }

  var emailFormat = String(data.emailFormat || templateData.emailFormat || 'branded').toLowerCase() === 'simple' ? 'simple' : 'branded';
  var plainBody = String(data.plainBody || '').trim();
  var htmlBody = String(data.renderedHtml || '').trim();
  if (!plainBody) plainBody = htmlBody ? stripHtml_(htmlBody) : 'Welcome to The Untaught Lessons.';

  var message = {
    to: recipient,
    subject: subject,
    body: plainBody,
    name: typeof SENDER_NAME !== 'undefined' ? SENDER_NAME : 'The Untaught Lessons',
    replyTo: typeof EMAIL_TO !== 'undefined' ? EMAIL_TO : 'wenszu.lin@gmail.com'
  };
  if (emailFormat === 'branded' && htmlBody) message.htmlBody = htmlBody;
  MailApp.sendEmail(message);

  return ContentService.createTextOutput('ok');
}

function handleWelcomeEmail(data) {
  return handleTemplateEmail(data, false);
}

function handleRemovedMemberLog(data) {
  if (!isValidAdminRelay_(data)) return ContentService.createTextOutput('unauthorized');
  if (typeof SHEET_ID === 'undefined' || !SHEET_ID) {
    return ContentService.createTextOutput('missing sheet id');
  }

  var email = String(data.memberEmail || data.email || '').trim().toLowerCase();
  var role = String(data.role || '').trim().toLowerCase();
  if (!email) return ContentService.createTextOutput('missing member email');
  if (role === 'admin' || role === 'owner') {
    return ContentService.createTextOutput('ok: skipped admin/owner');
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheetName = 'Removed members';
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  var headers = [
    'Logged at',
    'Member email',
    'Name',
    'Role',
    'Status before removal',
    'Added at',
    'Added by',
    'Updated at',
    'Expiry date',
    'First login at',
    'Last login at',
    'Google Group added',
    'Google Group sync status',
    'Removed at',
    'Removed by',
    'Source',
    'Notes'
  ];
  ensureSheetHeaders_(sheet, headers);

  sheet.appendRow([
    new Date(),
    safeSheetCell_(email),
    safeSheetCell_(data.name),
    safeSheetCell_(data.role),
    safeSheetCell_(data.status),
    safeSheetCell_(data.addedAt),
    safeSheetCell_(data.addedBy),
    safeSheetCell_(data.updatedAt),
    safeSheetCell_(data.expiryDate),
    safeSheetCell_(data.firstLoginAt),
    safeSheetCell_(data.lastLoginAt),
    data.googleGroupAdded === true ? 'TRUE' : 'FALSE',
    safeSheetCell_(data.googleGroupSyncStatus),
    safeSheetCell_(data.removedAt || new Date().toISOString()),
    safeSheetCell_(data.removedBy),
    safeSheetCell_(data.source || 'admin-member-management'),
    safeSheetCell_(data.notes)
  ]);

  return ContentService.createTextOutput('ok');
}

function ensureSheetHeaders_(sheet, headers) {
  var existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var hasHeaders = existing.some(function (value) { return String(value || '').trim(); });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function handleGoogleGroupMember(data, mode) {
  if (!isValidAdminRelay_(data)) return ContentService.createTextOutput('unauthorized');
  var email = String(data.memberEmail || data.email || data.recipient || data.to || '').trim().toLowerCase();
  var groupEmail = String(data.groupEmail || UTL_GOOGLE_GROUP_EMAIL).trim().toLowerCase();
  if (!email) return ContentService.createTextOutput('missing member email');
  if (!groupEmail) return ContentService.createTextOutput('missing group email');
  if (groupEmail !== String(UTL_GOOGLE_GROUP_EMAIL).trim().toLowerCase()) {
    return ContentService.createTextOutput('group not allowed');
  }

  try {
    if (mode === 'add') {
      try {
        AdminDirectory.Members.get(groupEmail, email);
        return ContentService.createTextOutput('ok: already member');
      } catch (lookupError) {
        // Not already a member, or lookup is not permitted. Try the insert so the real
        // add failure can be reported below.
      }

      AdminDirectory.Members.insert({
        email: email,
        role: 'MEMBER'
      }, groupEmail);

      return ContentService.createTextOutput('ok: added');
    }

    if (mode === 'remove') {
      try {
        AdminDirectory.Members.remove(groupEmail, email);
        return ContentService.createTextOutput('ok: removed');
      } catch (removeError) {
        var msg = String(removeError && removeError.message || removeError || '');
        if (/not.?found|resource.?not.?found|member.?not.?found/i.test(msg)) {
          return ContentService.createTextOutput('ok: not a member');
        }
        throw removeError;
      }
    }

    return ContentService.createTextOutput('unknown group action');
  } catch (error) {
    notifyGroupSyncFailure_(email, groupEmail, mode, error);
    return ContentService.createTextOutput('error: ' + String(error && error.message || error));
  }
}

/**
 * Prevent Google Sheets from interpreting untrusted text as a formula. Apply
 * this helper to every public form or assessment field before appendRow(),
 * setValue(), or setValues() in the deployed doPost implementation as well.
 */
function safeSheetCell_(value) {
  var text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

/**
 * The browser never receives this value. Set UTL_ADMIN_RELAY_SECRET in Apps
 * Script Settings > Script properties to the same random value stored in the
 * Firebase APPS_SCRIPT_ADMIN_RELAY_SECRET function secret.
 */
function isValidAdminRelay_(data) {
  var expected = PropertiesService.getScriptProperties().getProperty('UTL_ADMIN_RELAY_SECRET');
  var supplied = String(data && data.adminRelaySecret || '');
  return !!expected && supplied === expected;
}

function notifyGroupSyncFailure_(email, groupEmail, mode, error) {
  var to = typeof GROUP_SYNC_ALERT_TO !== 'undefined'
    ? GROUP_SYNC_ALERT_TO
    : (typeof EMAIL_TO !== 'undefined' ? EMAIL_TO : '');
  if (!to) return;

  MailApp.sendEmail({
    to: to,
    subject: '[UTL Admin] Google Group sync failed for ' + email,
    body:
      'The Admin Console requested a Google Group ' + mode + ' action, but Apps Script could not complete it.\n\n' +
      'Member: ' + email + '\n' +
      'Group: ' + groupEmail + '\n' +
      'Action: ' + mode + '\n\n' +
      'Error:\n' + String(error && error.message || error) + '\n\n' +
      'Check that Apps Script has the Admin Directory advanced service enabled and that the executing account can manage this group.'
  });
}

/**
 * Blank-field spam guard for the waitlist/contact-form logging branch.
 *
 * The waitlist and contact forms on the public site both validate name,
 * email and message as required fields, so a real visitor cannot submit
 * one empty — the browser blocks it before your endpoint ever sees it.
 * This web app URL is still plainly visible in the page source of every
 * page with a "Join the waitlist" button, though, so it is a public POST
 * endpoint that anyone (or any bot) can hit directly with arbitrary JSON,
 * bypassing the real form and its validation entirely. That is almost
 * always the source of an email with real-looking metadata (a genuine
 * page URL) but blank name/role/message — an automated script that never
 * loaded the actual form.
 *
 * Add this near the top of the sheet/contact-form logging branch, before
 * it appends a row or sends a notification email:
 *
 *   if (shouldRejectContactSubmission_(data)) return ContentService.createTextOutput('ignored');
 *
 * This only guards the generic waitlist/contact branch — it must not gate
 * TestEmailTemplate, WelcomeEmail, RemovedMember or the Google Group
 * actions above, since those are legitimate server-to-server calls from
 * the Admin Console, not visitor form submissions.
 */
function shouldRejectContactSubmission_(data) {
  var name = String((data && data.name) || '').trim();
  var email = String((data && data.email) || '').trim();
  var validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return !name || !validEmail;
}

function stripHtml_(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8594;/g, '->')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
