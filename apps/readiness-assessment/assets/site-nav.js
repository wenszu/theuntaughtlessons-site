// This app's whole nav bar, built to match the member portal's own focused
// exercise header (member-login/content-config.js: navHtml()'s .ws-nav /
// .ws-focused-nav-context / .ws-avatar / .ws-profile-menu) rather than a
// simplified approximation of it. See site-nav.css for the ported CSS.
import { auth, db, doc, getDoc, onAuthStateChanged, signOut } from '../../../assets/firebase.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function initials(name, email) {
  const source = (name || '').trim() || (email || '').trim();
  if (!source) return '?';
  const parts = source.includes('@') ? [source.split('@')[0]] : source.split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

// While testing against local emulators, ?emulators=true has to survive every
// click or the next page silently talks to production Firebase instead —
// which looks exactly like "my account disappeared" even though nothing is
// actually wrong. This keeps the flag attached to this app's own internal
// links for the length of a local testing session; it does nothing in
// production, where the query param is never present to begin with.
function propagateEmulatorFlag() {
  if (!/(?:^|[?&])emulators=true(?:&|$)/.test(location.search)) return;
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (!href || /^(https?:)?\/\//.test(href) || href.startsWith('#') || href.startsWith('mailto:')) return;
    if (/(?:^|[?&])emulators=true(?:&|$)/.test(href)) return;
    a.setAttribute('href', href + (href.includes('?') ? '&' : '?') + 'emulators=true');
  });
}

// mount: an empty element to render the whole nav into.
// title: this page's name, shown as the bold title next to the kicker.
// backLinks: [{ label, href }] shown under the kicker/title (the "<- Back to
// X" line). secondaryLinks: [{ label, href }] shown on the right, before the
// signed-in avatar (or where it would go, signed out).
// resultsHref: relative path from this page to apps/readiness-assessment/my-results/.
// titleId/linksId: only index.html's internal admin/plan preview needs these
// exact element ids, to keep swapping their content/visibility the way it
// already did before this nav was rebuilt.
export function initReadinessNav({ mount, title, backLinks = [], secondaryLinks = [], resultsHref, titleId, linksId }) {
  const host = document.querySelector(mount);
  if (!host) return;

  const backLinksHtml = backLinks
    .map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
    .join('<span class="ra-nav-sep">&middot;</span>');
  const secondaryLinksHtml = secondaryLinks
    .map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
    .join('<span class="ra-nav-sep">&middot;</span>');

  host.innerHTML = `
    <div class="ra-nav-inner">
      <div class="ra-nav-brand">
        <a class="ra-nav-logo-link" href="/" aria-label="The Untaught Lessons home">
          <img class="ra-nav-logo" src="/assets/utl-logo-nav-white.png" alt="The Untaught Lessons">
        </a>
      </div>
      <div class="ra-nav-context">
        <span class="ra-nav-kicker">Executive Signature&trade;</span>
        <strong class="ra-nav-title"${titleId ? ` id="${escapeHtml(titleId)}"` : ''}>${escapeHtml(title)}</strong>
        <nav class="ra-nav-links" aria-label="Assessment navigation">${backLinksHtml}</nav>
      </div>
      <div class="ra-nav-right">
        <nav class="ra-nav-secondary"${linksId ? ` id="${escapeHtml(linksId)}"` : ''} aria-label="More assessment pages">${secondaryLinksHtml}</nav>
        <div class="ra-nav-user" id="raUserMount" hidden></div>
      </div>
    </div>`;

  propagateEmulatorFlag();

  const userMount = host.querySelector('#raUserMount');

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      userMount.innerHTML = '';
      userMount.hidden = true;
      window.__raAccountIdentity = null;
      window.__raAccountReadiness = null;
      window.dispatchEvent(new CustomEvent('ra:account-readiness'));
      return;
    }
    let products = null;
    let name = '';
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const data = snap.data() || {};
        products = data.products || null;
        name = data.name || '';
      }
    } catch (error) {
      products = null;
    }
    // Shaped as { free?: {...}, full?: {...} } — the quick check and the full
    // report are stored separately, since completing one does not imply the
    // other. Either can carry a summary only (band, profile), never the raw
    // answers, which stay in the browser — so this is never enough to redraw
    // the full report's facet-level shape. Pages that check this should point
    // a returning visitor at my-results/ rather than try to fake a full render.
    window.__raAccountReadiness = (products && products.readinessAssessment) || null;
    window.__raAccountIdentity = {
      email: user.email || '',
      name: name || user.displayName || ''
    };
    window.dispatchEvent(new CustomEvent('ra:account-readiness'));
    const isTsaMember = Boolean(products && products.tsa);
    const email = user.email || '';
    userMount.hidden = false;
    userMount.innerHTML = `
      <span class="ra-nav-email">${escapeHtml(email)}</span>
      <button class="ra-avatar" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">${escapeHtml(initials(name, email))}</button>
      <div class="ra-profile-menu" hidden>
        <a href="${resultsHref}">My results</a>
        ${isTsaMember ? '<a href="/member-login/">Back to your portal</a>' : ''}
        <button type="button" data-ra-sign-out>Log out</button>
      </div>`;
    propagateEmulatorFlag();

    const avatarBtn = userMount.querySelector('.ra-avatar');
    const menu = userMount.querySelector('.ra-profile-menu');
    avatarBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = !menu.hidden;
      menu.hidden = isOpen;
      avatarBtn.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', () => { menu.hidden = true; avatarBtn.setAttribute('aria-expanded', 'false'); });
    menu.querySelector('[data-ra-sign-out]').addEventListener('click', () => signOut(auth));
  });
}
