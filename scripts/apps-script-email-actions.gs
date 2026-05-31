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
 *   if (action === 'AddGoogleGroupMember') return handleGoogleGroupMember(data, 'add');
 *   if (action === 'RemoveGoogleGroupMember') return handleGoogleGroupMember(data, 'remove');
 *
 * Then replace the old handleWelcomeEmail(data) with handleTemplateEmail(data, false)
 * or keep handleWelcomeEmail as a wrapper around handleTemplateEmail.
 *
 * Google Group automation requires Apps Script Advanced Google services:
 *   Services (+) -> Admin Directory API -> Add
 * and the Google Cloud project must have Admin SDK API enabled.
 */

var UTL_GOOGLE_GROUP_EMAIL = 'utl-members@googlegroups.com';

function handleTemplateEmail(data, isTest) {
  var recipient = String(data.recipient || data.to || data.email || '').trim();
  if (!recipient) {
    return ContentService.createTextOutput('missing recipient');
  }

  var templateData = data.templateData || {};
  var subject = String(templateData.subject || data.subject || 'Welcome to The Untaught Lessons').trim();
  if (isTest && subject.indexOf('[TEST]') !== 0) {
    subject = '[TEST] ' + subject;
  }

  var htmlBody = String(data.renderedHtml || '').trim();
  if (!htmlBody) {
    htmlBody = '<p>Welcome to The Untaught Lessons.</p>';
  }

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: stripHtml_(htmlBody),
    htmlBody: htmlBody,
    name: typeof SENDER_NAME !== 'undefined' ? SENDER_NAME : 'The Untaught Lessons',
    replyTo: typeof EMAIL_TO !== 'undefined' ? EMAIL_TO : 'wenszu.lin@gmail.com'
  });

  return ContentService.createTextOutput('ok');
}

function handleWelcomeEmail(data) {
  return handleTemplateEmail(data, false);
}

function handleGoogleGroupMember(data, mode) {
  var email = String(data.memberEmail || data.email || data.recipient || data.to || '').trim().toLowerCase();
  var groupEmail = String(data.groupEmail || UTL_GOOGLE_GROUP_EMAIL).trim().toLowerCase();
  if (!email) return ContentService.createTextOutput('missing member email');
  if (!groupEmail) return ContentService.createTextOutput('missing group email');

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
