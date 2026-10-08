"use strict";

// Firebase side client for the Supabase send-email Edge Function (Resend).
//
// Nothing here talks to Apps Script. It is a second way to send the same emails, chosen
// with one environment flag:
//   MAIL_TRANSPORT=resend    send through the Supabase send-email function
//   MAIL_TRANSPORT=appscript the existing Apps Script relay (this is the default)
//
// Callers do not change their payloads. postToAdminRelay (index.js) hands the old Apps
// Script payload to sendRelayAsMail(), which turns it into {to, subject, html, text}.
// Nothing here ever logs an address, a subject or a body: only a fixed error code.

const DEFAULT_MAIL_URL = "https://czljyikfavtjgqcibdda.supabase.co/functions/v1/send-email";
const MAIL_TIMEOUT_MS = 20 * 1000;
const SECRET_HEADER = "x-utl-mail-secret";
const MAX_RECIPIENTS = 5;
const MAX_HTML_LENGTH = 200000;
const MAX_TEXT_LENGTH = 100000;
const MAX_SUBJECT_LENGTH = 200;

const MAIL_ACTIONS = Object.freeze({
  WelcomeEmail: "welcome",
  TestEmailTemplate: "test-template",
  WeeklyOrgReport: "weekly-report",
  ResultsEmail: "results"
});

class MailSendError extends Error {
  constructor(code, message) {
    super(message || ("Mail could not be sent: " + code));
    this.name = "MailSendError";
    this.code = code;
  }
}

// The Firebase secret. Declared here so index.js can add it to each function's
// `secrets` list. It is null only if firebase-functions is not installed (never in
// production).
let MAIL_RELAY_SECRET = null;
try {
  MAIL_RELAY_SECRET = require("firebase-functions/params").defineSecret("MAIL_RELAY_SECRET");
} catch (error) {
  MAIL_RELAY_SECRET = null;
}

// The single switch. Anything other than the word "resend" means Apps Script.
function mailTransport(env) {
  const source = env || process.env;
  return String(source.MAIL_TRANSPORT || "").trim().toLowerCase() === "resend" ? "resend" : "appscript";
}

function isMailAction(action) {
  return Object.prototype.hasOwnProperty.call(MAIL_ACTIONS, action);
}

// True when this action should go through the new sender right now. RemovedMember and
// anything else that is not an email always stays on Apps Script.
function useResendFor(action, env) {
  return mailTransport(env) === "resend" && isMailAction(action);
}

function createMailSender(deps) {
  const options = deps || {};
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const env = options.env || process.env;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : MAIL_TIMEOUT_MS;
  const getSecret = options.getSecret || (() => {
    if (MAIL_RELAY_SECRET) {
      try { return MAIL_RELAY_SECRET.value(); } catch (error) { /* fall through to env */ }
    }
    return env.MAIL_RELAY_SECRET;
  });

  // input: { to: string | string[], subject, html, text?, kind?, replyTo? }
  // Resolves { ok: true, id } or throws MailSendError with code one of:
  // not-configured, invalid, unauthorized, provider, timeout, network.
  async function sendMail(input) {
    const message = input && typeof input === "object" ? input : {};
    const to = (Array.isArray(message.to) ? message.to : [message.to]).filter((value) => typeof value === "string" && value.trim());
    if (!to.length || to.length > MAX_RECIPIENTS || typeof message.subject !== "string" || !message.subject.trim() || typeof message.html !== "string" || !message.html.trim()) {
      throw new MailSendError("invalid");
    }

    const secret = String(getSecret() || "").trim();
    const url = String(env.SUPABASE_MAIL_URL || "").trim() || DEFAULT_MAIL_URL;
    if (!secret) throw new MailSendError("not-configured");

    const body = { to, subject: message.subject, html: message.html, kind: message.kind || "unknown" };
    if (typeof message.text === "string" && message.text) body.text = message.text;
    if (typeof message.replyTo === "string" && message.replyTo) body.reply_to = message.replyTo;

    const controller = new AbortController();
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve("timeout"); }, timeoutMs);
    });
    const call = (async () => {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [SECRET_HEADER]: secret },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      let payload = null;
      try { payload = await response.json(); } catch (error) { payload = null; }
      return { status: response.status, ok: response.ok, payload };
    })();
    call.catch(() => {});

    let outcome;
    try {
      outcome = await Promise.race([call, timedOut]);
    } catch (error) {
      throw new MailSendError("network");
    } finally {
      clearTimeout(timer);
    }
    if (outcome === "timeout") throw new MailSendError("timeout");
    if (outcome.ok && outcome.payload && outcome.payload.ok === true) {
      return { ok: true, id: typeof outcome.payload.id === "string" ? outcome.payload.id : null };
    }
    const code = outcome.payload && typeof outcome.payload.error === "string" ? outcome.payload.error : "";
    if (["invalid", "unauthorized", "provider", "timeout", "not-configured"].includes(code)) throw new MailSendError(code);
    throw new MailSendError("provider");
  }

  return { sendMail };
}

// ---- Turning the old Apps Script payloads into mail ----

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"'`]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;", "`": "&#96;"
  }[character]));
}

function oneLine(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function plainTextToHtml(text) {
  return "<!doctype html><html><body style=\"margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#4A4A4A;\">" +
    "<div style=\"white-space:pre-wrap;\">" + escapeHtml(text) + "</div></body></html>";
}

// Mirrors scripts/apps-script-email-actions.gs handleTemplateEmail: same subject default,
// the [TEST] prefix, branded html only when asked for, plain text derived from html.
function templateMail(action, payload) {
  const templateData = payload.templateData && typeof payload.templateData === "object" ? payload.templateData : {};
  let subject = oneLine(templateData.subject || payload.subject || "Welcome to The Untaught Lessons", MAX_SUBJECT_LENGTH - 7);
  if (action === "TestEmailTemplate" && subject.indexOf("[TEST]") !== 0) subject = "[TEST] " + subject;
  const branded = String(payload.emailFormat || templateData.emailFormat || "branded").toLowerCase() !== "simple";
  const renderedHtml = String(payload.renderedHtml || "").trim();
  let text = String(payload.plainBody || "").trim();
  if (!text) text = renderedHtml ? stripHtml(renderedHtml) : "Welcome to The Untaught Lessons.";
  const html = branded && renderedHtml ? renderedHtml : plainTextToHtml(text);
  const recipient = String(payload.recipient || payload.to || payload.email || "").trim();
  return { to: [recipient], subject, html, text };
}

// The My results email. Apps Script used to build this one itself and attach the text as
// a file. Here the results text goes in the body instead, and the verified signed in
// address is the reply address so a reply reaches the person who sent it.
function resultsMail(payload) {
  const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
  const intro = oneLine(payload.email_intro, 400);
  const results = String(payload.results_text || "");
  const sender = oneLine(payload.user_email, 254);
  const footer = sender
    ? "This message was sent from the My results page of The Untaught Lessons by " + sender + "."
    : "This message was sent from the My results page of The Untaught Lessons.";
  const text = (intro ? intro + "\n\n" : "") + results + "\n\n" + footer;
  const html = "<!doctype html><html><body style=\"margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#4A4A4A;\">" +
    (intro ? "<p style=\"margin:0 0 16px;\">" + escapeHtml(intro) + "</p>" : "") +
    "<div style=\"white-space:pre-wrap;\">" + escapeHtml(results) + "</div>" +
    "<p style=\"margin:16px 0 0;font-size:13px;color:#4D7094;\">" + escapeHtml(footer) + "</p></body></html>";
  const mail = { to: recipients, subject: "Your Untaught Lessons results", html, text };
  if (sender) mail.replyTo = sender;
  return mail;
}

// Returns {to, subject, html, text, kind, replyTo?} or null when the action is not an
// email (for example RemovedMember).
function relayPayloadToMail(action, payload) {
  if (!isMailAction(action)) return null;
  const source = payload && typeof payload === "object" ? payload : {};
  const mail = action === "ResultsEmail" ? resultsMail(source) : templateMail(action, source);
  mail.kind = MAIL_ACTIONS[action];
  mail.html = String(mail.html).slice(0, MAX_HTML_LENGTH);
  mail.text = String(mail.text).slice(0, MAX_TEXT_LENGTH);
  return mail;
}

const defaultSender = createMailSender();

async function sendMail(input) {
  return defaultSender.sendMail(input);
}

// Same contract as the Apps Script path: resolves when the email was handed over, throws
// otherwise. Logs only the action and a fixed error code.
async function sendRelayAsMail(action, payload, sender) {
  const mail = relayPayloadToMail(action, payload);
  if (!mail) throw new MailSendError("invalid");
  try {
    return await (sender || defaultSender).sendMail(mail);
  } catch (error) {
    console.error("Mail sender failed", { action, code: error && typeof error.code === "string" ? error.code : "unknown" });
    throw error;
  }
}

module.exports = {
  DEFAULT_MAIL_URL,
  MAIL_TIMEOUT_MS,
  MAIL_ACTIONS,
  MAIL_RELAY_SECRET,
  MailSendError,
  createMailSender,
  isMailAction,
  mailTransport,
  relayPayloadToMail,
  sendMail,
  sendRelayAsMail,
  useResendFor
};
