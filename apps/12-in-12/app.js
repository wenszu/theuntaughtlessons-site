(function () {
  const Core = window.TwelveCore;
  const STATUSES = Core.STATUSES;
  const isoDate = Core.isoDate;
  const parseIsoDate = Core.parseIsoDate;
  const monthKey = Core.monthKey;
  const currentMonth = () => Core.currentMonth(new Date());

  const LIBRARY = {
    Body: {
      description: 'physical habits (sleep, movement, food, stretching)',
      templates: [
        ['Stretch for 15 minutes each day', 'A short daily practice to stay loose and present'],
        ['Walk 8,000 steps every day', 'Fit movement into your day'],
        ['Sleep by 10:30 PM each night', 'Give your evenings a set end'],
        ['Eat one fully home-cooked meal a day', 'Slow down and nourish deliberately'],
        ['No alcohol this month', 'A month off to see how it feels']
      ]
    },
    Mind: {
      description: 'reflection and awareness (journaling, meditation, gratitude)',
      templates: [
        ["Write 3 things I am grateful for", 'End each day with what went right'],
        ['Meditate for 10 minutes each morning', 'Start the day before the noise begins'],
        ['One page of journaling before bed', 'Write down how the day went'],
        ['No phone for the first 30 minutes after waking', 'Reclaim your mornings'],
        ['Spend 5 minutes in silence each day', 'Practice stillness on purpose']
      ]
    },
    Focus: {
      description: 'attention and deep work (no phone, reading, time blocking)',
      templates: [
        ['No social media before noon', 'Protect your best hours for real work'],
        ['Read for 20 minutes before bed', 'Swap scrolling for a few pages'],
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
        ['Practice a new language for 15 minutes', 'A little each day'],
        ['Write 200 words of anything each day', 'Put words down without judging them'],
        ['Learn one new thing and write it down', 'Curiosity as a daily practice'],
        ['Practice an instrument for 20 minutes', "Show up even when it is imperfect"],
        ['Learn one idea from a book each day', 'Read slowly and keep one idea']
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
  let keepCalendarFocus = false;
  let modalReturnFocus = null;

  function $(id) {
    return document.getElementById(id);
  }

  // Builds an element and sets text with textContent only. Nothing here ever parses markup.
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function daysInMonth(date) {
    return Core.daysInMonth(date.getFullYear(), date.getMonth() + 1);
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

  function loadData() {
    try {
      return Core.loadData(localStorage, new Date());
    } catch (error) {
      return Core.emptyData();
    }
  }

  function saveData() {
    try {
      Core.saveData(localStorage, data);
      return true;
    } catch (error) {
      els.settingsMessage.textContent = 'Your browser would not save that. Download a backup so nothing is lost.';
      return false;
    }
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

  function isEditableDate(dateKey) {
    const parsed = parseIsoDate(dateKey);
    return Boolean(parsed) && hasActiveChallenge() && monthKey(parsed) === monthKey(new Date());
  }

  function setEntry(dateKey, status) {
    if (!isEditableDate(dateKey) || !STATUSES.includes(status)) return;
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
      name: Core.cleanName(name),
      category: Core.CATEGORIES.includes(category) ? category : 'Body',
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
    els.todayMonthCount.textContent = `${todayDone} of ${todayTotal} days done`;
    els.todayProgressBar.style.width = `${Math.round((todayDone / todayTotal) * 100)}%`;

    const calendarDone = doneCountForMonth(viewedMonth);
    const calendarTotal = daysInMonth(viewedMonth);
    els.calendarCount.textContent = `${calendarDone} of ${calendarTotal} days done`;
    els.calendarProgressBar.style.width = `${Math.round((calendarDone / calendarTotal) * 100)}%`;

    const entry = data.log[isoDate(today)];
    els.todayReinforcement.textContent = entry ? `You have ${todayDone} done this month` : '';
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
      button.setAttribute('aria-pressed', String(Boolean(entry && entry === button.dataset.status)));
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
    els.calendarGrid.replaceChildren();
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
      button.dataset.date = dateKey;
      button.addEventListener('click', () => {
        selectedCalendarDate = dateKey;
        keepCalendarFocus = true;
        renderCalendar();
      });
      button.addEventListener('keydown', onCalendarKey);
      els.calendarGrid.appendChild(button);
    }

    if (keepCalendarFocus) {
      keepCalendarFocus = false;
      const selected = els.calendarGrid.querySelector('.day.selected');
      if (selected) selected.focus();
    }

    renderCountsOnly();
    els.editSheet.classList.toggle('hidden', monthKey(parseIsoDate(selectedCalendarDate)) !== monthKey(viewedMonth));
    els.editDateTitle.textContent = formatLongDate(selectedCalendarDate);
    document.querySelectorAll('[data-edit-status]').forEach((button) => {
      button.disabled = !isEditableDate(selectedCalendarDate);
      button.classList.toggle('active', Boolean(selectedEntry && selectedEntry === button.dataset.editStatus));
      button.setAttribute('aria-pressed', String(Boolean(selectedEntry && selectedEntry === button.dataset.editStatus)));
    });
    els.editNoteWrap.classList.add('hidden');
  }

  function onCalendarKey(event) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in moves)) return;
    const days = Array.from(els.calendarGrid.querySelectorAll('.day[data-date]'));
    const target = days[days.indexOf(event.currentTarget) + moves[event.key]];
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  function renderSettings() {
    els.settingsGoal.value = hasActiveChallenge() ? data.activeChallenge.name : '';
    els.settingsCategory.value = hasActiveChallenge() ? data.activeChallenge.category : 'Body';
  }

  function categoryButton(category, handler) {
    const button = el('button', 'category-card');
    button.type = 'button';
    const text = el('span');
    text.appendChild(el('span', 'card-title', category));
    text.appendChild(el('span', 'card-copy', LIBRARY[category].description));
    button.appendChild(text);
    const arrow = el('span', 'arrow', '\u2192');
    arrow.setAttribute('aria-hidden', 'true');
    button.appendChild(arrow);
    button.addEventListener('click', () => handler(category));
    return button;
  }

  function templateButton(template, category, handler, isSelected) {
    const [name, description] = template;
    const button = el('button', `template-card${isSelected ? ' selected' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(isSelected));
    const head = el('span', 'template-head');
    const text = el('span');
    text.appendChild(el('span', 'card-title', name));
    text.appendChild(el('span', 'card-copy', description));
    head.appendChild(text);
    if (isSelected) {
      const mark = el('span', 'checkmark', '\u2713');
      mark.setAttribute('aria-hidden', 'true');
      head.appendChild(mark);
    }
    button.appendChild(head);
    button.addEventListener('click', () => handler(name, category));
    return button;
  }

  function renderBrowse() {
    els.browseList.replaceChildren();
    Object.keys(LIBRARY).forEach((category) => {
      const wrap = el('div', 'browse-category');
      const header = categoryButton(category, (selected) => {
        expandedBrowseCategory = expandedBrowseCategory === selected ? '' : selected;
        renderBrowse();
        const again = Array.from(els.browseList.querySelectorAll('.category-card'))
          .find((node) => node.querySelector('.card-title').textContent === selected);
        if (again) again.focus();
      });
      header.setAttribute('aria-expanded', String(expandedBrowseCategory === category));
      wrap.appendChild(header);

      if (expandedBrowseCategory === category) {
        const templates = el('div', 'browse-templates');
        LIBRARY[category].templates.forEach(([name, description]) => {
          const card = el('div', 'template-card');
          card.appendChild(el('span', 'card-title', name));
          card.appendChild(el('span', 'card-copy', description));
          const useButton = el('button', 'use-template', 'Use this challenge');
          useButton.type = 'button';
          useButton.setAttribute('aria-label', `Use this challenge: ${name}`);
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
    if (!els.onboardingOverlay.classList.contains('hidden')) els.onboardingOverlay.focus({ preventScroll: true });
  }

  function openOnboarding(step) {
    setOnboardingStep(step || 1);
    els.onboardingOverlay.classList.remove('hidden');
    els.bottomNav.classList.add('hidden');
    els.onboardingOverlay.focus({ preventScroll: true });
  }

  function closeOnboarding() {
    els.onboardingOverlay.classList.add('hidden');
    els.bottomNav.classList.remove('hidden');
  }

  function renderOnboardingCategories() {
    els.onboardingCategoryList.replaceChildren();
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
    els.onboardingTemplateList.replaceChildren();
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
      openWarning();
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
      openWarning();
      return;
    }
    action();
  }

  function openWarning() {
    modalReturnFocus = document.activeElement;
    els.warningModal.classList.remove('hidden');
    els.cancelWarningBtn.focus();
  }

  function closeWarning() {
    els.warningModal.classList.add('hidden');
    if (modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  // Keeps Tab inside the open dialog and lets Escape close the warning.
  function onDialogKey(event) {
    const warningOpen = !els.warningModal.classList.contains('hidden');
    const onboardingOpen = !els.onboardingOverlay.classList.contains('hidden');
    if (!warningOpen && !onboardingOpen) return;
    const box = warningOpen ? els.warningModal : els.onboardingOverlay;
    if (event.key === 'Escape' && warningOpen) {
      pendingResetAction = null;
      closeWarning();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(box.querySelectorAll('button, input, select, textarea, a[href]'))
      .filter((node) => !node.disabled && node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!box.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function exportData() {
    const blob = new Blob([Core.buildBackup(data, new Date())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `utl-12-in-12-${isoDate(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    els.settingsMessage.textContent = 'Your backup was downloaded.';
  }

  function importData() {
    const result = Core.parseBackup(els.importText.value);
    if (!result.ok) {
      els.settingsMessage.textContent = result.error;
      return;
    }
    const restored = Core.rollMonthIfNeeded(result.data, new Date());
    if (result.data.activeChallenge && !restored.activeChallenge) {
      els.settingsMessage.textContent = 'That backup is from an earlier month. This version only keeps the current month, so nothing was changed.';
      return;
    }
    if (hasActiveChallenge() && !window.confirm('Restoring replaces your current challenge and check-ins. Continue?')) return;
    data = restored;
    if (!saveData()) return;
    els.importText.value = '';
    els.importBox.classList.add('hidden');
    els.settingsMessage.textContent = 'Your backup was restored.';
    if (!hasActiveChallenge()) openOnboarding(1);
    render();
  }

  function clearData() {
    const confirmed = window.confirm('Clear this challenge and all saved check-ins?');
    if (!confirmed) return;
    data = Core.emptyData();
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
      closeWarning();
    });
    els.confirmWarningBtn.addEventListener('click', () => {
      const action = pendingResetAction;
      pendingResetAction = null;
      closeWarning();
      if (action) action();
    });
    document.addEventListener('keydown', onDialogKey);
    document.addEventListener('visibilitychange', refreshForNewDay);
    window.addEventListener('focus', refreshForNewDay);
    els.updateReloadBtn.addEventListener('click', applyUpdate);
  }

  // A page left open past midnight, or past the end of the month, catches up when the person returns to it.
  let shownDay = isoDate(new Date());
  function refreshForNewDay() {
    if (document.visibilityState === 'hidden') return;
    const today = isoDate(new Date());
    if (today === shownDay) return;
    shownDay = today;
    data = Core.rollMonthIfNeeded(data, new Date());
    saveData();
    viewedMonth = firstOfMonth(new Date());
    selectedCalendarDate = today;
    if (!hasActiveChallenge() && els.onboardingOverlay.classList.contains('hidden')) openOnboarding(1);
    render();
  }

  // The worker script is registered with the same ?v= value as every other asset (scripts/sync-cache-versions.js
  // rewrites it). A new deploy means a new worker URL, which waits until the person chooses to reload.
  let waitingWorker = null;
  let updateRequested = false;
  let reloadingForUpdate = false;

  function showUpdatePrompt(worker) {
    waitingWorker = worker;
    els.updateBanner.classList.remove('hidden');
    document.body.classList.add('has-update');
  }

  function applyUpdate() {
    if (!waitingWorker) return;
    updateRequested = true;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=20260925-mobile-v1', { scope: './' }).then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) showUpdatePrompt(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt(installing);
          });
        });
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // The first install takes control without a reload. Only a reload the person asked for happens.
        if (!updateRequested || reloadingForUpdate) return;
        reloadingForUpdate = true;
        window.location.reload();
      });
    });
  }

  function boot() {
    [
      'appScreen', 'bottomNav', 'appTitle', 'screenSubtext', 'todayView',
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
      'warningModal', 'cancelWarningBtn', 'confirmWarningBtn', 'updateBanner', 'updateReloadBtn'
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
