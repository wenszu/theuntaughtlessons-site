/* 12 in 12 core: dates, storage, backup and restore. No DOM access, so node tests can load it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TwelveCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const STORAGE_KEY = '12in12_data';
  const LEGACY_KEY = 'utl-12-in-12-data';
  const STATUSES = ['done', 'partial', 'missed'];
  const CATEGORIES = ['Body', 'Mind', 'Focus', 'Social', 'Learning'];
  const BACKUP_VERSION = 1;
  const BACKUP_MAX_BYTES = 100 * 1024;
  const NAME_MAX = 80;
  const MIN_YEAR = 2000;
  const MAX_YEAR = 2100;
  const MAX_LOG_ENTRIES = 3700;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const BACKUP_KEYS = ['app', 'version', 'exportedAt', 'activeChallenge', 'log'];
  const CHALLENGE_KEYS = ['name', 'category', 'month', 'year'];

  function emptyData() {
    return { activeChallenge: null, log: {} };
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  // Local calendar date, never UTC, so a check-in near midnight lands on the day the person sees.
  function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseIsoDate(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < MIN_YEAR || year > MAX_YEAR) return null;
    const parsed = new Date(year, month - 1, day);
    return isoDate(parsed) === value ? parsed : null;
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }

  function currentMonth(now) {
    const date = now || new Date();
    return { month: date.getMonth() + 1, year: date.getFullYear() };
  }

  function cleanName(value) {
    // Collapse whitespace and drop control characters. The name is only ever shown with textContent.
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  }

  // Lenient clean-up for data already in this browser: drops what it cannot trust and keeps the rest.
  function normalizeData(candidate) {
    const normalized = emptyData();
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return normalized;
    const active = candidate.activeChallenge;
    if (active && typeof active === 'object') {
      const name = cleanName(active.name);
      const category = CATEGORIES.includes(active.category) ? active.category : 'Body';
      const month = Number(active.month);
      const year = Number(active.year);
      if (name && Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR) {
        normalized.activeChallenge = { name, category, month, year };
      }
    }
    if (candidate.log && typeof candidate.log === 'object' && !Array.isArray(candidate.log)) {
      Object.keys(candidate.log).forEach((dateKey) => {
        if (parseIsoDate(dateKey) && STATUSES.includes(candidate.log[dateKey])) {
          normalized.log[dateKey] = candidate.log[dateKey];
        }
      });
    }
    return normalized;
  }

  function migrateLegacy(candidate) {
    if (!candidate || typeof candidate !== 'object' || !candidate.goal) return null;
    const startDate = parseIsoDate(candidate.startDate) || new Date();
    const log = {};
    if (candidate.entries && typeof candidate.entries === 'object') {
      Object.keys(candidate.entries).forEach((dateKey) => {
        const entry = candidate.entries[dateKey];
        if (parseIsoDate(dateKey) && entry && STATUSES.includes(entry.status)) log[dateKey] = entry.status;
      });
    }
    return normalizeData({
      activeChallenge: {
        name: candidate.goal,
        category: candidate.category,
        month: startDate.getMonth() + 1,
        year: startDate.getFullYear()
      },
      log
    });
  }

  // A challenge belongs to one calendar month. In a later month it starts again.
  function rollMonthIfNeeded(candidate, now) {
    const current = currentMonth(now);
    if (
      candidate.activeChallenge &&
      (candidate.activeChallenge.month !== current.month || candidate.activeChallenge.year !== current.year)
    ) {
      return emptyData();
    }
    return candidate;
  }

  function loadData(storage, now) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) return rollMonthIfNeeded(normalizeData(JSON.parse(raw)), now);
      const legacyRaw = storage.getItem(LEGACY_KEY);
      if (!legacyRaw) return emptyData();
      const migrated = migrateLegacy(JSON.parse(legacyRaw));
      return rollMonthIfNeeded(migrated || emptyData(), now);
    } catch (error) {
      return emptyData();
    }
  }

  function saveData(storage, data) {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function buildBackup(data, now) {
    return JSON.stringify({
      app: '12-in-12',
      version: BACKUP_VERSION,
      exportedAt: (now || new Date()).toISOString(),
      activeChallenge: data.activeChallenge,
      log: data.log
    }, null, 2);
  }

  function reject(error) {
    return { ok: false, error };
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  // Strict parser for a pasted backup. Untrusted text in, either clean data or a plain error out.
  // Nothing is repaired or guessed: one bad field rejects the whole backup.
  function parseBackup(text) {
    if (typeof text !== 'string' || !text.trim()) return reject('Paste a backup first.');
    const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length;
    if (bytes > BACKUP_MAX_BYTES) return reject('That backup is too large to be one of ours.');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return reject('That backup could not be read.');
    }
    if (!isPlainObject(parsed)) return reject('That backup is not in the expected shape.');
    if (!Object.keys(parsed).every((key) => BACKUP_KEYS.includes(key))) return reject('That backup has unexpected fields.');
    if ('app' in parsed && parsed.app !== '12-in-12') return reject('That backup is not from 12 in 12.');
    if ('version' in parsed && parsed.version !== BACKUP_VERSION) return reject('That backup is from a version this page does not know.');
    if ('exportedAt' in parsed && (typeof parsed.exportedAt !== 'string' || parsed.exportedAt.length > 40)) {
      return reject('That backup is not in the expected shape.');
    }

    let activeChallenge = null;
    const active = parsed.activeChallenge;
    if (active !== null && active !== undefined) {
      if (!isPlainObject(active) || !Object.keys(active).every((key) => CHALLENGE_KEYS.includes(key))) {
        return reject('That backup has a challenge this page cannot read.');
      }
      const name = typeof active.name === 'string' ? cleanName(active.name) : '';
      if (!name || active.name.length > NAME_MAX * 2) return reject('That backup has an unreadable challenge name.');
      if (!CATEGORIES.includes(active.category)) return reject('That backup has an unknown category.');
      if (!Number.isInteger(active.month) || active.month < 1 || active.month > 12) return reject('That backup has an invalid month.');
      if (!Number.isInteger(active.year) || active.year < MIN_YEAR || active.year > MAX_YEAR) return reject('That backup has an invalid year.');
      activeChallenge = { name, category: active.category, month: active.month, year: active.year };
    }

    const log = {};
    const rawLog = parsed.log === undefined ? {} : parsed.log;
    if (!isPlainObject(rawLog)) return reject('That backup has a log this page cannot read.');
    const dateKeys = Object.keys(rawLog);
    if (dateKeys.length > MAX_LOG_ENTRIES) return reject('That backup has too many entries.');
    for (const dateKey of dateKeys) {
      if (!parseIsoDate(dateKey)) return reject('That backup has an invalid date.');
      if (!STATUSES.includes(rawLog[dateKey])) return reject('That backup has an unknown status.');
      log[dateKey] = rawLog[dateKey];
    }
    if (!activeChallenge && dateKeys.length > 0) return reject('That backup has check-ins but no challenge.');
    return { ok: true, data: { activeChallenge, log } };
  }

  function statusCounts(log, year, month) {
    const prefix = `${year}-${pad(month)}-`;
    const counts = { done: 0, partial: 0, missed: 0 };
    Object.keys(log).forEach((dateKey) => {
      if (dateKey.startsWith(prefix) && counts[log[dateKey]] !== undefined) counts[log[dateKey]] += 1;
    });
    return counts;
  }

  return {
    STORAGE_KEY, LEGACY_KEY, STATUSES, CATEGORIES, BACKUP_VERSION, BACKUP_MAX_BYTES, NAME_MAX,
    emptyData, isoDate, parseIsoDate, daysInMonth, monthKey, currentMonth, cleanName,
    normalizeData, migrateLegacy, rollMonthIfNeeded, loadData, saveData,
    buildBackup, parseBackup, statusCounts
  };
});
