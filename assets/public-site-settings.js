import { getPublicFindLevelSetting, getPublicAssessmentSettings } from './firebase.js';

const FIND_LEVEL_VISIBILITY_KEY = 'utl_public_find_level';
const ES_VISIBILITY_KEY = 'utl_public_es_visible';

function setFindLevelVisibility(visible) {
  document.querySelectorAll('[data-public-find-level]').forEach((element) => {
    element.hidden = !visible;
  });
}

function applyCachedFindLevelVisibility() {
  const cached = localStorage.getItem(FIND_LEVEL_VISIBILITY_KEY);
  if (cached === 'show' || cached === 'hide') {
    setFindLevelVisibility(cached === 'show');
  } else {
    setFindLevelVisibility(false);
  }
}

applyCachedFindLevelVisibility();

getPublicFindLevelSetting()
  .then((visible) => {
    localStorage.setItem(FIND_LEVEL_VISIBILITY_KEY, visible ? 'show' : 'hide');
    setFindLevelVisibility(visible);
  })
  .catch(() => {
    applyCachedFindLevelVisibility();
  });

// Hidden by default in markup (see programs.html / index.html), only
// revealed once confirmed on, so a visitor never briefly sees a link into
// Executive Signature before this settles, and never sees it at all while
// the program is deliberately off.
function setEsVisibility(visible) {
  document.querySelectorAll('[data-es-public-visible]').forEach((element) => {
    element.hidden = !visible;
  });
}

const cachedEsVisible = localStorage.getItem(ES_VISIBILITY_KEY);
if (cachedEsVisible === 'show') setEsVisibility(true);

getPublicAssessmentSettings()
  .then((settings) => {
    const visible = settings.executiveSignatureVisible === true;
    localStorage.setItem(ES_VISIBILITY_KEY, visible ? 'show' : 'hide');
    setEsVisibility(visible);
  })
  .catch(() => {
    setEsVisibility(false);
  });
