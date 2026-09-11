const WAITLIST_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec';

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
      page: window.location.href,
      source: 'waitlist-form'
    };

    submit.disabled = true;
    submit.textContent = 'Joining…';
    error.classList.remove('is-visible');

    try {
      const response = await fetch(WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Waitlist request failed: ${response.status}`);
      const responseText = await response.text();
      if (/\b(?:error|exception|typeerror)\b/i.test(responseText)) {
        throw new Error('The waitlist service returned an error.');
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
