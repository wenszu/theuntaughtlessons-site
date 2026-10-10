const WAITLIST_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec';

async function sendWaitlistPayload(payload) {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const queued = navigator.sendBeacon(WAITLIST_ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
    if (queued) return;
  }
  await fetch(WAITLIST_ENDPOINT, {
    method: 'POST',
    mode: 'no-cors',
    keepalive: true,
    body
  });
}

// The same submission also goes to Supabase through the public submit_lead function, in the same way as
// apps/find-your-level/index.html and assets/feedback-widget.js. The URL and the publishable key are public
// configuration (same values as assets/firebase.js). The Apps Script post above is still the one that
// decides what the visitor sees; this copy never throws, never shows an error and never blocks the form.
const SUPABASE_URL = 'https://czljyikfavtjgqcibdda.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW';
const PENDING_INBOX_KEY = 'utl_pending_inbox';
const PENDING_INBOX_MAX = 20;
const PENDING_INBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INBOX_TIMEOUT_MS = 8000;

// Retry queue shared with apps/find-your-level/index.html and assets/feedback-widget.js (same key and item shape).
function readPendingInbox() {
  try {
    const items = JSON.parse(localStorage.getItem(PENDING_INBOX_KEY) || '[]');
    if (!Array.isArray(items)) return [];
    const now = Date.now();
    return items.filter((item) => item && (item.type === 'lead' || item.type === 'feedback') &&
      item.payload && typeof item.payload === 'object' &&
      Number.isFinite(item.created) && now - item.created < PENDING_INBOX_TTL_MS);
  } catch (error) {
    return [];
  }
}

function writePendingInbox(items) {
  try {
    const kept = items.slice(-PENDING_INBOX_MAX);
    if (kept.length) localStorage.setItem(PENDING_INBOX_KEY, JSON.stringify(kept));
    else localStorage.removeItem(PENDING_INBOX_KEY);
  } catch (error) {
    // Storage can be blocked; the visitor flow must not depend on it.
  }
}

function queuePendingInbox(type, payload) {
  const created = Date.now();
  const items = readPendingInbox();
  items.push({ id: created + '-' + Math.random().toString(36).slice(2, 8), type, payload, created });
  writePendingInbox(items);
}

// Returns 'ok', 'invalid' (the server will never accept it) or 'failed' (network, error or rate limited).
async function postLead(payload) {
  let timer = null;
  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    timer = setTimeout(() => { if (controller) controller.abort(); }, INBOX_TIMEOUT_MS);
    const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/submit_lead', {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_lead: payload }),
      keepalive: true,
      signal: controller ? controller.signal : undefined
    });
    if (!response || !response.ok) return 'failed';
    const answer = await response.json();
    if (answer && answer.ok === true) return 'ok';
    if (answer && answer.error === 'invalid') return 'invalid';
    return 'failed';
  } catch (error) {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

// Sends a lead; on failure it is kept in the local retry queue. Never throws.
async function submitLead(payload) {
  try {
    const outcome = await postLead(payload);
    if (outcome === 'failed') queuePendingInbox('lead', payload);
    return outcome;
  } catch (error) {
    return 'failed';
  }
}

// One attempt per queued lead per page load. Only leads are retried here; queued feedback needs the
// member sign in token that only the feedback widget has, so it is left in the queue.
async function flushPendingLeads() {
  try {
    if (window.__utlLeadsFlushed) return;
    window.__utlLeadsFlushed = true;
    const items = readPendingInbox().filter((item) => item.type === 'lead');
    if (!items.length) return;
    const done = new Set();
    for (const item of items) {
      const outcome = await postLead(item.payload);
      if (outcome !== 'failed') done.add(item.id || (item.created + ':' + item.type));
    }
    writePendingInbox(readPendingInbox().filter((item) => !done.has(item.id || (item.created + ':' + item.type))));
  } catch (error) {
    // Best effort only.
  }
}

// Where the visitor came from. Only the referring site name and the campaign tags (utm_source, utm_medium,
// utm_campaign) are kept. They stay in this tab's session storage and are sent with a lead only when the visitor
// submits the form. Nothing is sent otherwise, and no cookie is set.
const ATTRIBUTION_KEY = 'utl_attribution';
function cleanTag(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
}
function captureAttribution() {
  try {
    if (sessionStorage.getItem(ATTRIBUTION_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const found = {
      ref: '',
      utm_source: cleanTag(params.get('utm_source')),
      utm_medium: cleanTag(params.get('utm_medium')),
      utm_campaign: cleanTag(params.get('utm_campaign'))
    };
    if (document.referrer) {
      const host = new URL(document.referrer).hostname.replace(/^www\./, '');
      if (host && host !== window.location.hostname.replace(/^www\./, '')) found.ref = cleanTag(host);
    }
    sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(found));
  } catch (error) {
    // Attribution is optional. A blocked storage or a bad referrer never affects the form.
  }
}
function attributionLabel() {
  try {
    const found = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || '{}');
    const parts = [];
    if (found.ref) parts.push('ref=' + cleanTag(found.ref));
    ['utm_source', 'utm_medium', 'utm_campaign'].forEach((key) => { if (found[key]) parts.push(key + '=' + cleanTag(found[key])); });
    return parts.length ? ' | ' + parts.join(' ') : '';
  } catch (error) {
    return '';
  }
}
captureAttribution();

// Builds the submit_lead payload from the waitlist form values.
function buildLeadPayload(values, formStartedAt) {
  const organization = String(values.organization || '').trim();
  const message = String(values.message || '').trim();
  return {
    kind: 'gate',
    name: values.name,
    email: values.email,
    role: values.role,
    message: organization ? (message ? message + '\n' : '') + 'Organization: ' + organization : message,
    page: String(values.page || '').split('#')[0].split('?')[0],
    source: ('waitlist-form' + attributionLabel()).slice(0, 200),
    website: String(values.website || ''),
    form_started_at: formStartedAt
  };
}

function waitlistMarkup() {
  return `
    <div class="lead-modal" id="waitlistModal" aria-hidden="true">
      <div class="lead-modal-overlay" data-close-waitlist></div>
      <div class="lead-modal-card waitlist-modal-card" role="dialog" aria-modal="true" aria-labelledby="waitlistModalTitle">
        <button class="lead-modal-close" type="button" aria-label="Close waitlist form" data-close-waitlist>&times;</button>
        <div class="lead-modal-content" data-waitlist-content>
          <p class="waitlist-eyebrow">Join the waitlist</p>
          <h2 id="waitlistModalTitle">Tell us what you are looking for.</h2>
          <p class="waitlist-intro">Join for yourself or tell us about the team you represent.</p>
          <form class="lead-form" data-waitlist-form>
            <fieldset class="waitlist-audience">
              <legend>I am interested for</legend>
              <label class="waitlist-choice">
                <input name="audience" type="radio" value="Myself" checked>
                <span><strong>Myself</strong><small>I want to join as an individual.</small></span>
              </label>
              <label class="waitlist-choice">
                <input name="audience" type="radio" value="My organization">
                <span><strong>My organization</strong><small>I am exploring training for a team.</small></span>
              </label>
            </fieldset>

            <label for="waitlistName">Name</label>
            <input id="waitlistName" name="name" type="text" autocomplete="name" placeholder="Your full name" required>

            <label for="waitlistEmail">Email</label>
            <input id="waitlistEmail" name="email" type="email" autocomplete="email" placeholder="Your email address" required>

            <div class="waitlist-organization" data-waitlist-organization hidden>
              <label for="waitlistOrganization">Organization name</label>
              <input id="waitlistOrganization" name="organization" type="text" autocomplete="organization" placeholder="Your organization">
            </div>

            <label for="waitlistGoal">What are you hoping to work on?</label>
            <textarea id="waitlistGoal" name="message" rows="4" placeholder="Tell us what you would like to handle better" required></textarea>

            <div class="waitlist-hp" aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;">
              <input id="waitlistWebsite" name="website" type="text" tabindex="-1" autocomplete="off" value="">
            </div>

            <button class="lead-submit waitlist-submit" type="submit">Join the waitlist</button>
            <p class="waitlist-followup">We'll reach out to find a time to talk.</p>
            <p class="lead-error" role="alert">We could not add you right now. Please try again or contact us.</p>
          </form>
        </div>
      </div>
    </div>`;
}

function initWaitlist() {
  document.body.insertAdjacentHTML('beforeend', waitlistMarkup());
  const modal = document.getElementById('waitlistModal');
  const content = modal.querySelector('[data-waitlist-content]');
  const initialContent = content.innerHTML;
  let returnFocus = null;
  let formShownAt = Date.now();

  function close() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    returnFocus?.focus();
  }

  function open(event) {
    event?.preventDefault();
    returnFocus = event?.currentTarget || document.activeElement;
    content.innerHTML = initialContent;
    formShownAt = Date.now();
    const requestedAudience = event?.currentTarget?.dataset.waitlistAudience;
    if (requestedAudience) {
      const audienceChoice = Array.from(content.querySelectorAll('input[name="audience"]'))
        .find((input) => input.value === requestedAudience);
      if (audienceChoice) {
        audienceChoice.checked = true;
        audienceChoice.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    content.querySelector('#waitlistName')?.focus();
  }

  document.querySelectorAll('[data-waitlist-cta]').forEach((button) => button.addEventListener('click', open));
  modal.addEventListener('click', (event) => {
    if (event.target.matches('[data-close-waitlist]')) close();
  });
  modal.addEventListener('change', (event) => {
    if (event.target.name !== 'audience') return;
    const form = event.target.form;
    const organizationWrap = form.querySelector('[data-waitlist-organization]');
    const organizationInput = form.elements.organization;
    const goal = form.elements.message;
    const isOrganization = event.target.value === 'My organization';
    organizationWrap.hidden = !isOrganization;
    organizationInput.required = isOrganization;
    if (!isOrganization) organizationInput.value = '';
    goal.placeholder = isOrganization
      ? 'What would you like your team to handle better?'
      : 'Tell us what you would like to handle better';
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) close();
  });

  modal.addEventListener('submit', async (event) => {
    if (!event.target.matches('[data-waitlist-form]')) return;
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('button[type="submit"]');
    const error = form.querySelector('.lead-error');
    const payload = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      message: form.elements.message.value.trim(),
      help: 'Join the waitlist',
      role: form.elements.audience.value,
      organization: form.elements.organization.value.trim(),
      tab: 'Contacts',
      page: window.location.href,
      source: 'waitlist-form'
    };

    submit.disabled = true;
    submit.textContent = 'Joining…';
    error.classList.remove('is-visible');

    try {
      await sendWaitlistPayload(payload);
      // Second copy to Supabase. Started only after the Apps Script post was queued, not awaited, so it
      // can never delay or break the success state; submitLead never throws and queues its own retry.
      try {
        submitLead(buildLeadPayload({
          name: payload.name,
          email: payload.email,
          role: payload.role,
          message: payload.message,
          organization: payload.organization,
          page: payload.page,
          website: form.elements.website ? form.elements.website.value : ''
        }, formShownAt)).catch(() => {});
      } catch (leadError) {
        // Never surfaces to the visitor.
      }
      content.innerHTML = `
        <div class="lead-success" role="status">
          <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <circle cx="24" cy="24" r="22" fill="none" stroke="#EEA320" stroke-width="3"></circle>
            <path d="M14 24.5l6.5 6.5L34.5 17" fill="none" stroke="#EEA320" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
          <h2>You are on the waitlist.</h2>
          <p>We'll reach out to find a time to talk.</p>
          <button class="waitlist-close-success" type="button" data-close-waitlist>Close</button>
        </div>`;
    } catch (requestError) {
      error.classList.add('is-visible');
      submit.disabled = false;
      submit.textContent = 'Join the waitlist';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWaitlist);
} else {
  initWaitlist();
}
flushPendingLeads();
