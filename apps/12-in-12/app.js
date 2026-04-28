(function () {
  const STORAGE_KEY = 'utl-12-in-12-data';
  const CATEGORIES = [
    'Health',
    'Learning',
    'Work',
    'Relationships',
    'Personal discipline',
    'Creative',
    'Other'
  ];
  const STATUSES = ['done', 'partial', 'missed'];

  const els = {};
  let data = null;
  let selectedType = 'monthly';
  let currentView = 'today';
  let viewedMonth = firstOfMonth(new Date());
  let selectedCalendarDate = isoDate(new Date());

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

  function normalizeType(value) {
    return value === '12-in-12' ? '12-in-12' : 'monthly';
  }

  function normalizeNote(value) {
    return String(value || '').replace(/\r\n/g, '\n').split('\n').slice(0, 2).join('\n').slice(0, 180);
  }

  function normalizeEntry(entry) {
    if (!entry || !STATUSES.includes(entry.status)) return null;
    return {
      status: entry.status,
      note: entry.status === 'done' ? '' : normalizeNote(entry.note)
    };
  }

  function validateData(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    const startDate = parseIsoDate(candidate.startDate);
    const goal = typeof candidate.goal === 'string' ? candidate.goal.trim() : '';
    const category = CATEGORIES.includes(candidate.category) ? candidate.category : '';
    if (!goal || !category || !startDate) return null;

    const entries = {};
    if (candidate.entries && typeof candidate.entries === 'object') {
      Object.keys(candidate.entries).forEach((dateKey) => {
        if (!parseIsoDate(dateKey)) return;
        const normalized = normalizeEntry(candidate.entries[dateKey]);
        if (normalized) entries[dateKey] = normalized;
      });
    }

    return {
      version: 1,
      challengeType: normalizeType(candidate.challengeType),
      goal,
      category,
      startDate: isoDate(startDate),
      entries
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return validateData(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function saveData() {
    if (!data) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function populateSelect(select) {
    select.innerHTML = '';
    CATEGORIES.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
  }

  function setScreen(hasData) {
    els.setupScreen.classList.toggle('active', !hasData);
    els.appScreen.classList.toggle('active', hasData);
    els.bottomNav.classList.toggle('hidden', !hasData);
  }

  function setType(type) {
    selectedType = normalizeType(type);
    els.typeMonthly.classList.toggle('active', selectedType === 'monthly');
    els.typeTwelve.classList.toggle('active', selectedType === '12-in-12');
  }

  function getEntry(dateKey) {
    return data && data.entries ? data.entries[dateKey] : undefined;
  }

  function setEntry(dateKey, status, note) {
    if (!data || !STATUSES.includes(status)) return;
    const existing = getEntry(dateKey) || { note: '' };
    data.entries[dateKey] = {
      status,
      note: status === 'done' ? '' : normalizeNote(typeof note === 'string' ? note : existing.note)
    };
    saveData();
    render();
  }

  function setNote(dateKey, note) {
    if (!data) return;
    const entry = getEntry(dateKey);
    if (!entry) return;
    const normalized = normalizeNote(note);
    data.entries[dateKey] = {
      status: entry.status,
      note: entry.status === 'done' ? '' : normalized
    };
    saveData();
    renderCountsOnly();
    return normalized;
  }

  function monthDates(date) {
    const total = daysInMonth(date);
    const dates = [];
    for (let day = 1; day <= total; day += 1) {
      dates.push(new Date(date.getFullYear(), date.getMonth(), day));
    }
    return dates;
  }

  function doneCountForMonth(date) {
    const key = monthKey(date);
    return Object.keys(data.entries).filter((entryDate) => (
      entryDate.startsWith(key) && data.entries[entryDate].status === 'done'
    )).length;
  }

  function renderCountsOnly() {
    if (!data) return;
    const today = new Date();
    const todayDone = doneCountForMonth(today);
    const todayTotal = daysInMonth(today);
    els.todayMonthCount.textContent = `${todayDone} / ${todayTotal} days completed`;
    els.todayProgressBar.style.width = `${Math.round((todayDone / todayTotal) * 100)}%`;

    const calendarDone = doneCountForMonth(viewedMonth);
    const calendarTotal = daysInMonth(viewedMonth);
    els.calendarCount.textContent = `${calendarDone} / ${calendarTotal} days completed`;
    els.calendarProgressBar.style.width = `${Math.round((calendarDone / calendarTotal) * 100)}%`;

    const entry = getEntry(isoDate(today));
    els.todayReinforcement.textContent = entry
      ? `You've completed ${todayDone} days this month`
      : '';
  }

  function renderToday() {
    const todayKey = isoDate(new Date());
    const entry = getEntry(todayKey);
    els.todayTitle.textContent = data.goal;
    els.todayCategory.textContent = data.category;
    els.todayType.textContent = data.challengeType === '12-in-12' ? '12 in 12' : 'Monthly';
    els.todayDate.textContent = formatLongDate(todayKey);

    document.querySelectorAll('[data-status]').forEach((button) => {
      button.classList.toggle('active', Boolean(entry && entry.status === button.dataset.status));
    });

    const shouldShowNote = entry && (entry.status === 'partial' || entry.status === 'missed');
    els.todayNotePanel.classList.toggle('hidden', !shouldShowNote);
    els.todayMicrocopy.classList.toggle('hidden', !(entry && entry.status === 'partial'));
    els.todayNote.value = shouldShowNote ? entry.note || '' : '';
    renderCountsOnly();
  }

  function renderCalendar() {
    const todayKey = isoDate(new Date());
    const selectedEntry = getEntry(selectedCalendarDate);
    const firstWeekday = viewedMonth.getDay();

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

    monthDates(viewedMonth).forEach((date) => {
      const dateKey = isoDate(date);
      const entry = getEntry(dateKey);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'day';
      button.textContent = String(date.getDate());
      button.dataset.date = dateKey;
      if (entry) button.classList.add(entry.status);
      if (dateKey > todayKey && !entry) button.classList.add('future');
      if (dateKey === todayKey) button.classList.add('today');
      if (dateKey === selectedCalendarDate) button.classList.add('selected');
      if (entry && entry.note) button.classList.add('has-note');
      button.setAttribute('aria-label', `${formatLongDate(dateKey)}${entry ? `, ${titleCaseStatus(entry.status)}` : ''}`);
      button.addEventListener('click', () => {
        selectedCalendarDate = dateKey;
        renderCalendar();
      });
      els.calendarGrid.appendChild(button);
    });

    renderCountsOnly();
    els.editSheet.classList.toggle('hidden', monthKey(parseIsoDate(selectedCalendarDate)) !== monthKey(viewedMonth));
    els.editDateTitle.textContent = formatLongDate(selectedCalendarDate);
    document.querySelectorAll('[data-edit-status]').forEach((button) => {
      button.classList.toggle('active', Boolean(selectedEntry && selectedEntry.status === button.dataset.editStatus));
    });
    const shouldShowNote = selectedEntry && (selectedEntry.status === 'partial' || selectedEntry.status === 'missed');
    els.editNoteWrap.classList.toggle('hidden', !shouldShowNote);
    els.editNote.value = shouldShowNote ? selectedEntry.note || '' : '';
  }

  function renderSettings() {
    els.settingsGoal.value = data.goal;
    els.settingsCategory.value = data.category;
  }

  function switchView(view) {
    currentView = view;
    const titles = {
      today: ['Today', 'A quick check-in for the day in front of you.'],
      calendar: ['Calendar', 'A calm view of what happened this month.'],
      settings: ['Settings', 'Keep your challenge simple and portable.']
    };
    els.appTitle.textContent = titles[view][0];
    els.screenSubtext.textContent = titles[view][1];
    els.todayView.classList.toggle('active', view === 'today');
    els.calendarView.classList.toggle('active', view === 'calendar');
    els.settingsView.classList.toggle('active', view === 'settings');
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    render();
  }

  function render() {
    if (!data) {
      setScreen(false);
      return;
    }
    setScreen(true);
    if (currentView === 'today') renderToday();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'settings') renderSettings();
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
      const imported = validateData(JSON.parse(els.importText.value));
      if (!imported) {
        els.settingsMessage.textContent = 'That JSON does not match this tracker.';
        return;
      }
      data = imported;
      selectedCalendarDate = isoDate(new Date());
      viewedMonth = firstOfMonth(new Date());
      saveData();
      els.importText.value = '';
      els.importBox.classList.add('hidden');
      els.settingsMessage.textContent = 'Imported.';
      render();
    } catch (error) {
      els.settingsMessage.textContent = 'That JSON could not be read.';
    }
  }

  function clearData() {
    const confirmed = window.confirm('Clear this challenge and all saved check-ins?');
    if (!confirmed) return;
    localStorage.removeItem(STORAGE_KEY);
    data = null;
    currentView = 'today';
    setType('monthly');
    els.setupGoal.value = '';
    els.setupCategory.value = CATEGORIES[0];
    els.setupStartDate.value = isoDate(new Date());
    render();
  }

  function wireEvents() {
    document.querySelectorAll('[data-type]').forEach((button) => {
      button.addEventListener('click', () => setType(button.dataset.type));
    });

    els.setupForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const candidate = validateData({
        version: 1,
        challengeType: selectedType,
        goal: els.setupGoal.value,
        category: els.setupCategory.value,
        startDate: els.setupStartDate.value,
        entries: {}
      });
      if (!candidate) {
        els.setupMessage.textContent = 'Add a challenge name, category, and start date.';
        return;
      }
      data = candidate;
      saveData();
      switchView('today');
    });

    document.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', () => setEntry(isoDate(new Date()), button.dataset.status));
    });

    els.todayNote.addEventListener('input', () => {
      const normalized = setNote(isoDate(new Date()), els.todayNote.value);
      if (normalized !== undefined && els.todayNote.value !== normalized) {
        els.todayNote.value = normalized;
      }
    });

    document.querySelectorAll('[data-edit-status]').forEach((button) => {
      button.addEventListener('click', () => setEntry(selectedCalendarDate, button.dataset.editStatus));
    });

    els.editNote.addEventListener('input', () => {
      const normalized = setNote(selectedCalendarDate, els.editNote.value);
      if (normalized !== undefined && els.editNote.value !== normalized) {
        els.editNote.value = normalized;
      }
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

    els.settingsGoal.addEventListener('input', () => {
      const goal = els.settingsGoal.value.trim();
      if (!goal) return;
      data.goal = goal;
      saveData();
      renderCountsOnly();
    });

    els.settingsCategory.addEventListener('change', () => {
      data.category = els.settingsCategory.value;
      saveData();
      renderCountsOnly();
    });

    els.exportBtn.addEventListener('click', exportData);
    els.showImportBtn.addEventListener('click', () => {
      els.importBox.classList.toggle('hidden');
      els.settingsMessage.textContent = '';
    });
    els.importBtn.addEventListener('click', importData);
    els.clearDataBtn.addEventListener('click', clearData);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  function boot() {
    [
      'setupScreen', 'appScreen', 'bottomNav', 'setupForm', 'setupGoal', 'setupCategory',
      'setupStartDate', 'setupMessage', 'typeMonthly', 'typeTwelve', 'appTitle',
      'screenSubtext', 'todayView', 'calendarView', 'settingsView', 'todayTitle',
      'todayCategory', 'todayType', 'todayDate', 'todayReinforcement', 'todayNotePanel',
      'todayMicrocopy', 'todayNote', 'todayMonthCount', 'todayProgressBar',
      'calendarTitle', 'calendarCount', 'calendarProgressBar', 'calendarGrid',
      'prevMonthBtn', 'nextMonthBtn', 'editSheet', 'editDateTitle', 'editNoteWrap',
      'editNote', 'settingsGoal', 'settingsCategory', 'exportBtn', 'showImportBtn',
      'clearDataBtn', 'importBox', 'importText', 'importBtn', 'settingsMessage'
    ].forEach((id) => {
      els[id] = $(id);
    });

    populateSelect(els.setupCategory);
    populateSelect(els.settingsCategory);
    els.setupStartDate.value = isoDate(new Date());
    setType('monthly');
    data = loadData();
    wireEvents();
    registerServiceWorker();
    switchView('today');
    render();
  }

  boot();
})();
