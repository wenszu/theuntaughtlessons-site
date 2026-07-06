(function () {
  const TYPES = {
    scored: {
      label: 'Scored exercise',
      active: 'Scored',
      copy: 'Submit your work to get a score and feedback based on the structure.'
    },
    reflection: {
      label: 'Reflection check',
      active: 'Reflection',
      copy: 'Write or paste your thinking so the system can check clarity and specificity.'
    },
    completion: {
      label: 'Completion check',
      active: 'Completion',
      copy: 'Finish the AI or practice activity, sometimes by pasting what you tried.'
    }
  };

  const PAGE_TYPES = {
    'grocery-list': 'scored',
    'messy-notes': 'scored',
    'rushed-voice-memo': 'scored',
    'chalkboard-notes': 'scored',
    'issue-tree-builder': 'scored',
    'scqa-builder': 'scored',
    'grocery-list-ai': 'completion',
    'rushed-voice-memo-ai': 'completion',
    'advisory-board': 'completion',
    'write-to-aiko': 'completion',
    'explain-to-aiko': 'completion',
    'explain-to-aiko-60': 'completion',
    'eisenhower-matrix': 'completion',
    'i-have-bad-news': 'completion',
    'lets-switch-hats': 'completion',
    'speak-like-obama': 'completion'
  };

  const CARDS = [
    ['scored', 'Scored', 'Submit your work to get a score and feedback based on the structure.'],
    ['reflection', 'Reflection', 'Write or paste your thinking so the system can check clarity and specificity.'],
    ['completion', 'Completion', 'Finish the AI or practice activity, sometimes by pasting what you tried.']
  ];

  function slug() {
    const match = window.location.pathname.match(/\/apps\/([^/]+)\//);
    return match ? match[1] : '';
  }

  function injectStyles() {
    if (document.getElementById('utl-scoring-intro-style')) return;
    const style = document.createElement('style');
    style.id = 'utl-scoring-intro-style';
    style.textContent = `
      .utl-scoring-intro {
        margin: 0 0 16px;
        border: 1px solid rgba(0, 51, 102, .16);
        border-radius: 8px;
        background: #fff;
        padding: 14px 16px;
      }
      .utl-scoring-intro-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .utl-scoring-intro h2 {
        margin: 0;
        color: var(--navy, var(--ab-navy, var(--eisenhower-navy, #003366)));
        font-family: 'Playfair Display', Georgia, serif;
        font-size: 1.25rem;
        line-height: 1.15;
      }
      .utl-score-type-pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        background: #EAF5ED;
        color: #2C7A4B;
        padding: 6px 9px;
        font-family: 'Roboto Mono', monospace;
        font-size: .72rem;
        font-weight: 700;
        letter-spacing: .06em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .utl-score-type-list {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 0;
      }
      .utl-score-type-card {
        border: 1px solid rgba(232, 223, 209, .72);
        border-radius: 8px;
        background: #FAF9F6;
        padding: 10px 12px;
        color: #8A8379;
        font-size: .9rem;
        line-height: 1.35;
        opacity: .68;
      }
      .utl-score-type-card strong {
        display: block;
        color: #7B756D;
        margin-bottom: 3px;
      }
      .utl-score-type-card.is-active {
        border-color: rgba(44, 122, 75, .42);
        background: #F1FAF3;
        box-shadow: inset 4px 0 0 #2C7A4B;
        color: var(--charcoal, #4A4A4A);
        opacity: 1;
      }
      .utl-score-type-card.is-active strong {
        color: #2C7A4B;
      }
      @media (max-width: 768px) {
        .utl-scoring-intro-head,
        .utl-score-type-list {
          grid-template-columns: 1fr;
        }
        .utl-scoring-intro-head {
          align-items: flex-start;
          flex-direction: column;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildIntro(typeKey) {
    const type = TYPES[typeKey] || TYPES.completion;
    const section = document.createElement('section');
    section.className = 'utl-scoring-intro';
    section.setAttribute('aria-label', 'How exercises are checked');
    section.innerHTML = `
      <div class="utl-scoring-intro-head">
        <h2>How this exercise is checked</h2>
        <span class="utl-score-type-pill">${type.label}</span>
      </div>
      <div class="utl-score-type-list">
        ${CARDS.map(([key, title, copy]) => `
          <div class="utl-score-type-card ${key === typeKey ? 'is-active' : ''}">
            <strong>${title}</strong>${key === typeKey ? type.copy : copy}
          </div>
        `).join('')}
      </div>
    `;
    return section;
  }

  function insertionTarget(main) {
    const preferred = main.querySelector(':scope > #hero, :scope > .hero, :scope > .header, :scope > .ab-hero, :scope > .bad-news-hero, :scope > .lsh-hero, :scope > .slo-hero, :scope > .write-to-aiko-hero, :scope > .eisenhower-hero');
    return preferred;
  }

  function ensureIntro() {
    const typeKey = PAGE_TYPES[slug()];
    if (!typeKey) return;
    const main = document.querySelector('main');
    if (!main || main.querySelector(':scope > .utl-scoring-intro')) return;
    const target = insertionTarget(main);
    if (!target && !main.firstElementChild) return;
    injectStyles();
    if (target) target.insertAdjacentElement('afterend', buildIntro(typeKey));
    else main.insertAdjacentElement('afterbegin', buildIntro(typeKey));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureIntro);
  } else {
    ensureIntro();
  }

  const observer = new MutationObserver(ensureIntro);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
