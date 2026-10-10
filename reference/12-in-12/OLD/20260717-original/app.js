(function () {
  const STORAGE_KEY = '12in12_data';
  const LEGACY_KEY = 'utl-12-in-12-data';
  const STATUSES = ['done', 'partial', 'missed'];

  const LIBRARY = {
    Body: {
      description: 'physical habits (sleep, movement, food, stretching)',
      templates: [
        ['Stretch for 15 minutes each day', 'A short daily practice to stay loose and present'],
        ['Walk 8,000 steps every day', 'Build movement into the rhythm of your day'],
        ['Sleep by 10:30 PM each night', 'Protect your recovery and your mornings'],
        ['Eat one fully home-cooked meal a day', 'Slow down and nourish deliberately'],
        ['No alcohol for 30 days', 'A clean reset for body and clarity']
      ]
    },
    Mind: {
      description: 'reflection and awareness (journaling, meditation, gratitude)',
      templates: [
        ["Write 3 things I'm grateful for", 'End each day with what went right'],
        ['Meditate for 10 minutes each morning', 'Start the day before the noise begins'],
        ['One page of journaling before bed', 'Process the day, clear the mind'],
        ['No phone for the first 30 minutes after waking', 'Reclaim your mornings'],
        ['Spend 5 minutes in silence each day', 'Practice stillness on purpose']
      ]
    },
    Focus: {
      description: 'attention and deep work (no phone, reading, time blocking)',
      templates: [
        ['No social media before noon', 'Protect your best hours for real work'],
        ['Read for 20 minutes before bed', 'Replace scrolling with something that compounds'],
        ['One deep work block of 90 minutes daily', 'Uninterrupted, single-task focus'],
        ['Plan tomorrow the night before', 'End the day with intention for the next'],
        ['No screen time after 9 PM', 'Wind down without the feed']
      ]
    },
    Social: {
      description: 'connection and relationships (reach out daily, acts of kindness)',
      templates: [
        ['Reach out to one person each day', 'A message, a call, a moment of connection'],
        ['One act of kindness daily', 'Small and deliberate'],
        ['Eat one meal with someone else each day', 'No phones, just presence'],
        ['Write a note of appreciation to someone each week', 'Four people in a month']
      ]
    },
    Learning: {
      description: 'skills and creative practice (language, writing, instrument)',
      templates: [
        ['Practice a new language for 15 minutes', 'Consistency over intensity'],
        ['Write 200 words of anything each day', 'Build the habit of putting words down'],
        ['Learn one new thing and write it down', 'Curiosity as a daily practice'],
        ['Practice an instrument for 20 minutes', "Show up even when it's imperfect"],
        ['Study one concept from a book each day', 'Slow reading, deep retention']
      ]
    }
  };

  const els = {};
  let data = { activeChallenge: null, log: {} };
  let currentView = 'today';
  let viewedMonth = firstOfMonth(new Date());
  let selectedCalendarDate = isoDate(new Date());
  let onboardingStep = 1;
  let onboardingCategory = 'Body';
  let selectedTemplateName = '';
  let expandedBrowseCategory = '';
  let pendingResetAction = null;

  function $(id) {
    return document.getElementById(id);
  }

  function isoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseIsoDate(value) {
    const parts = String(value || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const parsed = new Date(parts[0], parts[1] - 1, parts[2]);
    return isoDate(parsed) === value ? parsed : null;
  }

  function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function daysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function currentMonth() {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  }

  function formatLongDate(value) {
    const date = parseIsoDate(value);
    if (!date) return '';
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatMonth(date) {
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function titleCaseStatus(status) {
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : '';
  }

  function normalizeData(candidate) {
    const empty = { activeChallenge: null, log: {} };
    if (!candidate || typeof candidate !== 'object') return empty;
    const active = candidate.activeChallenge && typeof candidate.activeChallenge === 'object'
      ? candidate.activeChallenge
      : null;
    const normalized = { activeChallenge: null, log: {} };

    if (active) {
      const name = typeof active.name === 'string' ? active.name.trim() : '';
      const category = LIBRARY[active.category] ? active.category : 'Body';
      const month = Number(active.month);
      const year = Number(active.year);
      if (name && month >= 1 && month <= 12 && year >= 2000) {
        normalized.activeChallenge = { name, category, month, year };
      }
    }

    if (candidate.log && typeof candidate.log === 'object') {
      Object.keys(candidate.log).forEach((dateKey) => {
        const value = candidate.log[dateKey];
        if (parseIsoDate(dateKey) && STATUSES.includes(value)) {
          normalized.log[dateKey] = value;
        }
      });
    }
    return normalized;
  }

  function migrateLegacy(candidate) {
    if (!candidate || typeof candidate !== 'object' || !candidate.goal) return null;
    const startDate = parseIsoDate(candidate.startDate) || new Date();
    const activeChallenge = {
      name: String(candidate.goal || '').trim(),
      category: LIBRARY[candidate.category] ? candidate.category : 'Body',
      month: startDate.getMonth() + 1,
      year: startDate.getFullYear()
    };
    const log = {};
    if (candidate.entries && typeof candidate.entries === 'object') {
      Object.keys(candidate.entries).forEach((dateKey) => {
        const entry = candidate.entries[dateKey];
        if (parseIsoDate(dateKey) && entry && STATUSES.includes(entry.status)) {
          log[dateKey] = entry.status;
        }
      });
    }
    return normalizeData({ activeChallenge, log });
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return rollMonthIfNeeded(normalizeData(JSON.parse(raw)));
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      if (!legacyRaw) return { activeChallenge: null, log: {} };
      const migrated = migrateLegacy(JSON.parse(legacyRaw));
      return rollMonthIfNeeded(migrated || { activeChallenge: null, log: {} });
    } catch (error) {
      return { activeChallenge: null, log: {} };
    }
  }

  function rollMonthIfNeeded(candidate) {
    const current = currentMonth();
    if (
      candidate.activeChallenge &&
      (candidate.activeChallenge.month !== current.month || candidate.activeChallenge.year !== current.year)
    ) {
      candidate.activeChallenge = null;
      candidate.log = {};
    }
    return candidate;
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function hasActiveChallenge() {
    const current = currentMonth();
    return Boolean(
      data.activeChallenge &&
      data.activeChallenge.month === current.month &&
      data.activeChallenge.year === current.year
    );
  }

  function currentMonthLogKeys() {
    const key = monthKey(new Date());
    return Object.keys(data.log).filter((dateKey) => dateKey.startsWith(key));
  }

  function hasCurrentMonthLog() {
    return currentMonthLogKeys().length > 0;
  }

  function setEntry(dateKey, status) {
    if (!hasActiveChallenge() || !STATUSES.includes(status)) return;
    data.log[dateKey] = status;
    saveData();
    render();
  }

  function clearCurrentMonthLog() {
    const key = monthKey(new Date());
    Object.keys(data.log).forEach((dateKey) => {
      if (dateKey.startsWith(key)) delete data.log[dateKey];
    });
  }

  function startChallenge(name, category, shouldReset) {
    const current = currentMonth();
    data.activeChallenge = {
      name: String(name || '').trim(),
      category: LIBRARY[category] ? category : 'Body',
      month: current.month,
      year: current.year
    };
    if (shouldReset) clearCurrentMonthLog();
    saveData();
    closeOnboarding();
    switchView('today');
    render();
  }

  function renderBanner(prefix) {
    const key = prefix ? `${prefix}Banner` : 'banner';
    const kicker = els[`${key}Kicker`];
    const title = els[`${key}Title`];
    const category = els[`${key}Category`];
    const pick = els[`${key}PickBtn`];
    if (!hasActiveChallenge()) {
      kicker.textContent = '';
      title.textContent = 'No challenge set for this month';
      category.classList.add('hidden');
      pick.classList.remove('hidden');
      return;
    }
    const active = data.activeChallenge;
    const date = new Date(active.year, active.month - 1, 1);
    kicker.textContent = `${formatMonth(date)} · Your challenge`;
    title.textContent = active.name;
    category.textContent = active.category;
    category.classList.remove('hidden');
    pick.classList.add('hidden');
  }

  function doneCountForMonth(date) {
    const key = monthKey(date);
    return Object.keys(data.log).filter((entryDate) => (
      entryDate.startsWith(key) && data.log[entryDate] === 'done'
    )).length;
  }

  function renderCountsOnly() {
    const today = new Date();
    const todayDone = doneCountForMonth(today);
    const todayTotal = daysInMonth(today);
    els.todayMonthCount.textContent = `${todayDone} / ${todayTotal} days completed`;
    els.todayProgressBar.style.width = `${Math.round((todayDone / todayTotal) * 100)}%`;

    const calendarDone = doneCountForMonth(viewedMonth);
    const calendarTotal = daysInMonth(viewedMonth);
    els.calendarCount.textContent = `${calendarDone} / ${calendarTotal} days completed`;
    els.calendarProgressBar.style.width = `${Math.round((calendarDone / calendarTotal) * 100)}%`;

    const entry = data.log[isoDate(today)];
    els.todayReinforcement.textContent = entry ? `You've completed ${todayDone} days this month` : '';
  }

  function renderToday() {
    const todayKey = isoDate(new Date());
    const entry = data.log[todayKey];
    renderBanner('');
    els.todayTitle.textContent = hasActiveChallenge() ? data.activeChallenge.name : 'Choose a challenge to begin';
    els.todayDate.textContent = formatLongDate(todayKey);

    document.querySelectorAll('[data-status]').forEach((button) => {
      button.disabled = !hasActiveChallenge();
      button.classList.toggle('active', Boolean(entry && entry === button.dataset.status));
    });

    els.todayNotePanel.classList.add('hidden');
    renderCountsOnly();
  }

  function renderCalendar() {
    const todayKey = isoDate(new Date());
    const selectedEntry = data.log[selectedCalendarDate];
    const firstWeekday = viewedMonth.getDay();

    renderBanner('calendar');
    els.calendarTitle.textContent = formatMonth(viewedMonth);
    els.calendarGrid.innerHTML = '';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((day) => {
      const label = document.createElement('div');
      label.className = 'weekday';
      label.textContent = day;
      els.calendarGrid.appendChild(label);
    });

    for (let i = 0; i < firstWeekday; i += 1) {
      const spacer = document.createElement('button');
      spacer.className = 'day empty';
      spacer.type = 'button';
      spacer.tabIndex = -1;
      els.calendarGrid.appendChild(spacer);
    }

    for (let day = 1; day <= daysInMonth(viewedMonth); day += 1) {
      const date = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth(), day);
      const dateKey = isoDate(date);
      const entry = data.log[dateKey];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'day';
      button.textContent = String(day);
      if (entry) button.classList.add(entry);
      if (dateKey > todayKey && !entry) button.classList.add('future');
      if (dateKey === todayKey) button.classList.add('today');
      if (dateKey === selectedCalendarDate) button.classList.add('selected');
      button.setAttribute('aria-label', `${formatLongDate(dateKey)}${entry ? `, ${titleCaseStatus(entry)}` : ''}`);
      button.addEventListener('click', () => {
        selectedCalendarDate = dateKey;
        renderCalendar();
      });
      els.calendarGrid.appendChild(button);
    }

    renderCountsOnly();
    els.editSheet.classList.toggle('hidden', monthKey(parseIsoDate(selectedCalendarDate)) !== monthKey(viewedMonth));
    els.editDateTitle.textContent = formatLongDate(selectedCalendarDate);
    document.querySelectorAll('[data-edit-status]').forEach((button) => {
      button.disabled = !hasActiveChallenge();
      button.classList.toggle('active', Boolean(selectedEntry && selectedEntry === button.dataset.editStatus));
    });
    els.editNoteWrap.classList.add('hidden');
  }

  function renderSettings() {
    els.settingsGoal.value = hasActiveChallenge() ? data.activeChallenge.name : '';
    els.settingsCategory.value = hasActiveChallenge() ? data.activeChallenge.category : 'Body';
  }

  function categoryButton(category, handler) {
    const button = document.createElement('button');
    button.className = 'category-card';
    button.type = 'button';
    button.innerHTML = `
      <span>
        <span class="card-title">${category}</span>
        <span class="card-copy">${LIBRARY[category].description}</span>
      </span>
      <span class="arrow" aria-hidden="true">&rarr;</span>
    `;
    button.addEventListener('click', () => handler(category));
    return button;
  }

  function templateButton(template, category, handler, isSelected) {
    const [name, description] = template;
    const button = document.createElement('button');
    button.className = `template-card${isSelected ? ' selected' : ''}`;
    button.type = 'button';
    button.innerHTML = `
      <span class="template-head">
        <span>
          <span class="card-title">${name}</span>
          <span class="card-copy">${description}</span>
        </span>
        ${isSelected ? '<span class="checkmark" aria-hidden="true">✓</span>' : ''}
      </span>
    `;
    button.addEventListener('click', () => handler(name, category));
    return button;
  }

  function renderBrowse() {
    els.browseList.innerHTML = '';
    Object.keys(LIBRARY).forEach((category) => {
      const wrap = document.createElement('div');
      wrap.className = 'browse-category';
      wrap.appendChild(categoryButton(category, (selected) => {
        expandedBrowseCategory = expandedBrowseCategory === selected ? '' : selected;
        renderBrowse();
      }));

      if (expandedBrowseCategory === category) {
        const templates = document.createElement('div');
        templates.className = 'browse-templates';
        LIBRARY[category].templates.forEach(([name, description]) => {
          const card = document.createElement('div');
          card.className = 'template-card';
          card.innerHTML = `
            <span class="card-title">${name}</span>
            <span class="card-copy">${description}</span>
          `;
          const useButton = document.createElement('button');
          useButton.className = 'use-template';
          useButton.type = 'button';
          useButton.textContent = 'Use this challenge';
          useButton.addEventListener('click', () => requestChallengeChange(name, category));
          card.appendChild(useButton);
          templates.appendChild(card);
        });
        wrap.appendChild(templates);
      }
      els.browseList.appendChild(wrap);
    });
  }

  function switchView(view) {
    currentView = view;
    const titles = {
      today: ['Today', 'A quick check-in for the day in front of you.'],
      calendar: ['Calendar', 'A calm view of what happened this month.'],
      browse: ['Browse', 'Find your next experiment.'],
      settings: ['Settings', 'Keep your challenge simple and portable.']
    };
    els.appTitle.textContent = titles[view][0];
    els.screenSubtext.textContent = titles[view][1];
    els.todayView.classList.toggle('active', view === 'today');
    els.calendarView.classList.toggle('active', view === 'calendar');
    els.browseView.classList.toggle('active', view === 'browse');
    els.settingsView.classList.toggle('active', view === 'settings');
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    render();
  }

  function render() {
    els.setupScreen.classList.remove('active');
    els.appScreen.classList.add('active');
    els.bottomNav.classList.toggle('hidden', !els.onboardingOverlay.classList.contains('hidden'));
    if (currentView === 'today') renderToday();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'browse') renderBrowse();
    if (currentView === 'settings') renderSettings();
  }

  function setOnboardingStep(step) {
    onboardingStep = step;
    els.onboardingStep.textContent = `Step ${step} of 3`;
    els.onboardingBack.classList.toggle('hidden', step === 1);
    els.onboardingWelcome.classList.toggle('hidden', step !== 1);
    els.onboardingCategories.classList.toggle('hidden', step !== 2);
    els.onboardingTemplates.classList.toggle('hidden', step !== 3);
  }

  function openOnboarding(step) {
    setOnboardingStep(step || 1);
    els.onboardingOverlay.classList.remove('hidden');
    els.bottomNav.classList.add('hidden');
  }

  function closeOnboarding() {
    els.onboardingOverlay.classList.add('hidden');
    els.bottomNav.classList.remove('hidden');
  }

  function renderOnboardingCategories() {
    els.onboardingCategoryList.innerHTML = '';
    Object.keys(LIBRARY).forEach((category) => {
      els.onboardingCategoryList.appendChild(categoryButton(category, (selected) => {
        onboardingCategory = selected;
        selectedTemplateName = LIBRARY[selected].templates[0][0];
        els.customChallengeInput.value = selectedTemplateName;
        renderOnboardingTemplates();
        setOnboardingStep(3);
      }));
    });
  }

  function renderOnboardingTemplates() {
    els.templateStepTitle.textContent = `${onboardingCategory} challenges`;
    els.onboardingTemplateList.innerHTML = '';
    LIBRARY[onboardingCategory].templates.forEach((template) => {
      els.onboardingTemplateList.appendChild(templateButton(
        template,
        onboardingCategory,
        (name) => {
          selectedTemplateName = name;
          els.customChallengeInput.value = name;
          renderOnboardingTemplates();
        },
        template[0] === selectedTemplateName
      ));
    });
  }

  function requestChallengeChange(name, category) {
    const action = () => startChallenge(name, category, true);
    if (hasCurrentMonthLog()) {
      pendingResetAction = action;
      els.warningModal.classList.remove('hidden');
      return;
    }
    action();
  }

  function saveSettings() {
    const name = els.settingsGoal.value.trim();
    const category = els.settingsCategory.value;
    if (!name) {
      els.settingsMessage.textContent = 'Add a challenge name before saving.';
      return;
    }
    const action = () => {
      startChallenge(name, category, hasCurrentMonthLog());
      switchView('settings');
      els.settingsMessage.textContent = 'Saved.';
    };
    if (hasCurrentMonthLog()) {
      pendingResetAction = action;
      els.warningModal.classList.remove('hidden');
      return;
    }
    action();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `utl-12-in-12-${isoDate(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    els.settingsMessage.textContent = 'Export ready.';
  }

  function importData() {
    try {
      data = rollMonthIfNeeded(normalizeData(JSON.parse(els.importText.value)));
      saveData();
      els.importText.value = '';
      els.importBox.classList.add('hidden');
      els.settingsMessage.textContent = 'Imported.';
      if (!hasActiveChallenge()) openOnboarding(1);
      render();
    } catch (error) {
      els.settingsMessage.textContent = 'That JSON could not be read.';
    }
  }

  function clearData() {
    const confirmed = window.confirm('Clear this challenge and all saved check-ins?');
    if (!confirmed) return;
    data = { activeChallenge: null, log: {} };
    saveData();
    currentView = 'today';
    openOnboarding(1);
    render();
  }

  function wireEvents() {
    document.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', () => setEntry(isoDate(new Date()), button.dataset.status));
    });

    document.querySelectorAll('[data-edit-status]').forEach((button) => {
      button.addEventListener('click', () => setEntry(selectedCalendarDate, button.dataset.editStatus));
    });

    els.prevMonthBtn.addEventListener('click', () => {
      viewedMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() - 1, 1);
      selectedCalendarDate = isoDate(viewedMonth);
      render();
    });

    els.nextMonthBtn.addEventListener('click', () => {
      viewedMonth = new Date(viewedMonth.getFullYear(), viewedMonth.getMonth() + 1, 1);
      selectedCalendarDate = isoDate(viewedMonth);
      render();
    });

    document.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => switchView(button.dataset.view));
    });

    els.bannerPickBtn.addEventListener('click', () => openOnboarding(1));
    els.calendarBannerPickBtn.addEventListener('click', () => openOnboarding(1));
    els.startOnboardingBtn.addEventListener('click', () => setOnboardingStep(2));
    els.onboardingBack.addEventListener('click', () => setOnboardingStep(Math.max(1, onboardingStep - 1)));
    els.confirmChallengeBtn.addEventListener('click', () => {
      const name = els.customChallengeInput.value.trim();
      if (!name) return;
      startChallenge(name, onboardingCategory, true);
    });

    els.saveSettingsBtn.addEventListener('click', saveSettings);
    els.exportBtn.addEventListener('click', exportData);
    els.showImportBtn.addEventListener('click', () => {
      els.importBox.classList.toggle('hidden');
      els.settingsMessage.textContent = '';
    });
    els.importBtn.addEventListener('click', importData);
    els.clearDataBtn.addEventListener('click', clearData);

    els.cancelWarningBtn.addEventListener('click', () => {
      pendingResetAction = null;
      els.warningModal.classList.add('hidden');
    });
    els.confirmWarningBtn.addEventListener('click', () => {
      const action = pendingResetAction;
      pendingResetAction = null;
      els.warningModal.classList.add('hidden');
      if (action) action();
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  function boot() {
    [
      'setupScreen', 'appScreen', 'bottomNav', 'appTitle', 'screenSubtext', 'todayView',
      'calendarView', 'browseView', 'settingsView', 'challengeBanner', 'bannerKicker',
      'bannerTitle', 'bannerCategory', 'bannerPickBtn', 'calendarChallengeBanner',
      'calendarBannerKicker', 'calendarBannerTitle', 'calendarBannerCategory',
      'calendarBannerPickBtn', 'todayTitle', 'todayDate',
      'todayReinforcement', 'todayNotePanel', 'todayMicrocopy', 'todayNote',
      'todayMonthCount', 'todayProgressBar', 'calendarTitle', 'calendarCount',
      'calendarProgressBar', 'calendarGrid', 'prevMonthBtn', 'nextMonthBtn',
      'editSheet', 'editDateTitle', 'editNoteWrap', 'editNote', 'settingsGoal',
      'settingsCategory', 'saveSettingsBtn', 'exportBtn', 'showImportBtn',
      'clearDataBtn', 'importBox', 'importText', 'importBtn', 'settingsMessage',
      'browseList', 'onboardingOverlay', 'onboardingBack', 'onboardingStep',
      'onboardingWelcome', 'onboardingCategories', 'onboardingTemplates',
      'startOnboardingBtn', 'onboardingCategoryList', 'templateStepTitle',
      'onboardingTemplateList', 'customChallengeInput', 'confirmChallengeBtn',
      'warningModal', 'cancelWarningBtn', 'confirmWarningBtn'
    ].forEach((id) => {
      els[id] = $(id);
    });

    Object.keys(LIBRARY).forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      els.settingsCategory.appendChild(option);
    });

    data = loadData();
    saveData();
    selectedTemplateName = LIBRARY.Body.templates[0][0];
    els.customChallengeInput.value = selectedTemplateName;
    renderOnboardingCategories();
    renderOnboardingTemplates();
    wireEvents();
    registerServiceWorker();
    switchView('today');
    if (!hasActiveChallenge()) openOnboarding(1);
    render();
  }

  boot();
})();
