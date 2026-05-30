import { getPublicFindLevelSetting } from './firebase.js';

const FIND_LEVEL_VISIBILITY_KEY = 'utl_public_find_level';

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
