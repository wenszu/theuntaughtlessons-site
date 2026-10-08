// This app's whole nav bar, built to match the member portal's own focused
// exercise header (member-login/content-config.js: navHtml()'s .ws-nav /
// .ws-focused-nav-context / .ws-avatar / .ws-profile-menu) rather than a
// simplified approximation of it. See site-nav.css for the ported CSS.
import { auth, db, doc, getDoc, getMyEsStatus, getMyWorkspaces, onAuthStateChanged, signOut } from '../../../assets/firebase.js';
import { readAccountRecord } from './account-record.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function initials(name, email) {
  const source = (name || '').trim() || (email || '').trim();
  if (!source) return '?';
  const parts = source.includes('@') ? [source.split('@')[0]] : source.split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

// Mirrors how member-login/content-config.js renders its own avatar: the
// sign-in provider's photo when there is one, initials otherwise. This page
// has no custom avatar-icon picker of its own (that lives in TSA's Account
// page, stored on authorized_members, which this ES-only script must not
// depend on), so the provider photo is the one thing worth matching here.
function avatarMarkup(name, email, photoURL) {
  const fallback = escapeHtml(initials(name, email));
  if (!photoURL) return fallback;
  // Sized inline, not just via site-nav.css, so a stale cached stylesheet (this
  // file has no cache-busting query string) can never make the photo render
  // at its native, unconstrained size again.
  return `<img src="${escapeHtml(photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.hidden=true;this.parentNode.textContent='${fallback}'">`;
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
// resultsHref: relative path from this page to apps/executive-signature/my-results/.
// homeHref: relative path from this page to apps/executive-signature/home/.
// When set, a signed-in visitor's first backLink (normally "Back to the
// site") points here instead, since a returning participant has somewhere
// more useful to land than the public homepage. Omit this on the home page
// itself. There, and on any page without homeHref, a signed-in TSA member's
// "Back to the site" (href "/") instead points to "/member-login/", their
// actual starting point, rather than the public marketing site they likely
// never visited to get here. Signed-out visitors always keep the original
// href, since none of this applies to them.
// titleId/linksId: only index.html's internal admin/plan preview needs these
// exact element ids, to keep swapping their content/visibility the way it
// already did before this nav was rebuilt.
export function initReadinessNav({ mount, title, backLinks = [], secondaryLinks = [], resultsHref, homeHref, titleId, linksId }) {
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

  const firstBackLink = host.querySelector('.ra-nav-links a');

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (firstBackLink) firstBackLink.href = backLinks[0]?.href || '/';
      userMount.innerHTML = '';
      userMount.hidden = true;
      window.__raAccountIdentity = null;
      window.__raAccountReadiness = null;
      window.__raIsTsaMember = null;
      window.dispatchEvent(new CustomEvent('ra:account-readiness'));
      return;
    }
    // The user doc read (client SDK, direct to Firestore) and the workspaces
    // check (a Cloud Function call, typically the slower of the two) don't
    // depend on each other, so they run together instead of one after the
    // other — this is on the critical path of every single Executive
    // Signature page load, since nothing above renders until both resolve.
    const [userSnapResult, workspacesResult] = await Promise.all([
      // With a Supabase only session there is no users/{uid} document (it is keyed by the Firebase uid): see account-record.js.
      readAccountRecord({ user, readUserDoc: (uid) => getDoc(doc(db, 'users', uid)), getMyEsStatus }),
      getMyWorkspaces().catch(() => null)
    ]);
    let products = null;
    let name = '';
    if (userSnapResult && userSnapResult.exists()) {
      const data = userSnapResult.data() || {};
      products = data.products || null;
      name = data.name || '';
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
    // TSA access authority is authorized_members, not a field on the users doc,
    // so this asks the same getMyWorkspaces callable the member portal's own
    // nav uses to decide whether to show its Executive Signature workspace link.
    // Resolved before the readiness event fires, so a listener reading
    // window.__raIsTsaMember synchronously on that event always sees the
    // current value rather than a stale one from the previous signed-in user.
    const isTsaMember = Boolean(workspacesResult && (workspacesResult.workspaces || []).some((workspace) => workspace && workspace.programId === 'tsa'));
    window.__raIsTsaMember = isTsaMember;
    // A TSA member's "Back to the site" exit (backLinks[0].href === '/') should
    // return them to their member portal, not the public marketing homepage
    // they most likely never visited to get here. homeHref (the ES workspace
    // page itself) still takes priority where it is configured, since that is
    // a more specific, more useful landing than either fallback.
    if (firstBackLink) {
      if (homeHref) {
        firstBackLink.href = homeHref;
      } else {
        const fallback = backLinks[0]?.href || '/';
        firstBackLink.href = fallback === '/' && isTsaMember ? '/member-login/' : fallback;
      }
    }
    window.dispatchEvent(new CustomEvent('ra:account-readiness'));
    const email = user.email || '';
    const avatar = avatarMarkup(name, email, user.photoURL || '');
    userMount.hidden = false;
    userMount.innerHTML = `
      <span class="ra-nav-email">${escapeHtml(email)}</span>
      <button class="ra-avatar" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">${avatar}</button>
      <div class="ra-profile-menu" hidden>
        <div class="ra-profile-head">
          <span class="ra-profile-avatar">${avatar}</span>
          <div><p class="ra-profile-name">${escapeHtml(name || email)}</p><p class="ra-profile-role">Participant</p></div>
        </div>
        <div class="ra-profile-section">
          <span class="ra-profile-section-label">Your Executive Signature workspace</span>
          <a href="${resultsHref}">My results</a>
        </div>
        ${isTsaMember ? `<div class="ra-profile-section">
          <span class="ra-profile-section-label">Workspaces</span>
          <a href="/member-login/">Think, Speak, Act</a>
        </div>` : ''}
        <div class="ra-profile-section">
          <button type="button" data-ra-sign-out>Log out</button>
        </div>
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
