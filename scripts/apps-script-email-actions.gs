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
 *
 * Then replace the old handleWelcomeEmail(data) with handleTemplateEmail(data, false)
 * or keep handleWelcomeEmail as a wrapper around handleTemplateEmail.
 */

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
