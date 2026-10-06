(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.READINESS_FORMS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FREE_ITEMS = [
    ['mini_e1', 'Am the life of the party.', 'Extraversion', '+'],
    ['mini_a1', "Sympathize with others' feelings.", 'Agreeableness', '+'],
    ['mini_c1', 'Get chores done right away.', 'Conscientiousness', '+'],
    ['mini_n1', 'Have frequent mood swings.', 'Neuroticism', '+'],
    ['mini_i1', 'Have a vivid imagination.', 'Intellect', '+'],
    ['mini_e2', "Don't talk a lot.", 'Extraversion', '-'],
    ['mini_a2', "Am not interested in other people's problems.", 'Agreeableness', '-'],
    ['mini_c2', 'Often forget to put things back in their proper place.', 'Conscientiousness', '-'],
    ['mini_n2', 'Am relaxed most of the time.', 'Neuroticism', '-'],
    ['mini_i2', 'Am not interested in abstract ideas.', 'Intellect', '-'],
    ['mini_e3', 'Talk to a lot of different people at parties.', 'Extraversion', '+'],
    ['mini_a3', "Feel others' emotions.", 'Agreeableness', '+'],
    ['mini_c3', 'Like order.', 'Conscientiousness', '+'],
    ['mini_n3', 'Get upset easily.', 'Neuroticism', '+'],
    ['mini_i3', 'Have difficulty understanding abstract ideas.', 'Intellect', '-'],
    ['mini_e4', 'Keep in the background.', 'Extraversion', '-'],
    ['mini_a4', 'Am not really interested in others.', 'Agreeableness', '-'],
    ['mini_c4', 'Make a mess of things.', 'Conscientiousness', '-'],
    ['mini_n4', 'Seldom feel blue.', 'Neuroticism', '-'],
    ['mini_i4', 'Do not have a good imagination.', 'Intellect', '-']
  ];

  const FULL_GROUPS = [
    ['Achievement-Striving', [['Go straight for the goal.', '+'], ['Work hard.', '+'], ['Do just enough work to get by.', '-'], ['Put little time and effort into my work.', '-']]],
    ['Self-Discipline', [['Start tasks right away.', '+'], ['Carry out my plans.', '+'], ['Waste my time.', '-'], ['Need a push to get started.', '-']]],
    ['Orderliness', [['Like to tidy up.', '+'], ['Do things according to a plan.', '+'], ['Leave my belongings around.', '-'], ['Am not bothered by disorder.', '-']]],
    ['Intellect', [['Like to solve complex problems.', '+'], ['Can handle a lot of information.', '+'], ['Avoid philosophical discussions.', '-'], ['Am not interested in theoretical discussions.', '-']]],
    ['Anxiety', [['Worry about things.', '+'], ['Get stressed out easily.', '+'], ['Am not easily bothered by things.', '-'], ['Am not easily disturbed by events.', '-']]],
    ['Self-Consciousness', [['Am easily intimidated.', '+'], ['Find it difficult to approach others.', '+'], ['Am comfortable in unfamiliar situations.', '-'], ['Am able to stand up for myself.', '-']]],
    ['Assertiveness', [['Take charge.', '+'], ['Try to lead others.', '+'], ['Wait for others to lead the way.', '-'], ['Hold back my opinions.', '-']]],
    ['Activity Level', [['Am always busy.', '+'], ['Can manage many things at the same time.', '+'], ['Like to take it easy.', '-'], ['Like a leisurely lifestyle.', '-']]],
    ['Cooperation', [['Am easy to satisfy.', '+'], ['Hate to seem pushy.', '+'], ['Love a good fight.', '-'], ['Get back at others.', '-']]],
    ['Altruism', [['Love to help others.', '+'], ['Anticipate the needs of others.', '+'], ['Am indifferent to the feelings of others.', '-'], ['Take no time for others.', '-']]]
  ];

  const asItems = rows => rows.map((row, index) => Object.freeze({
    id: row[0], text: row[1], area: row[2], direction: row[3], orderInForm: index + 1
  }));
  const fullRows = [];
  FULL_GROUPS.forEach(([area, items], groupIndex) => items.forEach(([text, direction], itemIndex) => {
    fullRows.push([`neo_${String(groupIndex + 1).padStart(2, '0')}_${itemIndex + 1}`, text, area, direction]);
  }));

  const forms = Object.freeze({
    'readiness-free@1.0.0': Object.freeze({
      id: 'readiness-free', tier: 'free', version: '1.0.0', formVersion: 'readiness-free@1.0.0',
      status: 'published', publishedAt: '2026-09-28T00:00:00.000Z', items: Object.freeze(asItems(FREE_ITEMS))
    }),
    'readiness-full@1.0.0': Object.freeze({
      id: 'readiness-full', tier: 'full', version: '1.0.0', formVersion: 'readiness-full@1.0.0',
      status: 'published', publishedAt: '2026-09-28T00:00:00.000Z', items: Object.freeze(asItems(fullRows))
    })
  });

  function getForm(formVersion) {
    const form = forms[formVersion];
    if (!form) throw new Error(`Unknown readiness form version: ${formVersion}`);
    return form;
  }

  function shuffleItemIds(items, random) {
    const rng = typeof random === 'function' ? random : Math.random;
    const ids = items.map(item => item.id);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  function createAttempt(options) {
    const input = options || {};
    const form = getForm(input.formVersion);
    return {
      id: input.id || `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      formVersion: form.formVersion,
      tier: form.tier,
      status: input.status || 'in_progress',
      itemOrder: shuffleItemIds(form.items, input.random),
      answers: input.answers || {},
      startedAt: input.startedAt || new Date().toISOString()
    };
  }

  function validateAttempt(attempt) {
    const form = getForm(attempt.formVersion);
    const expected = new Set(form.items.map(item => item.id));
    return Array.isArray(attempt.itemOrder) && attempt.itemOrder.length === expected.size &&
      attempt.itemOrder.every(id => expected.has(id)) && new Set(attempt.itemOrder).size === expected.size;
  }

  function getOrderedItems(attempt) {
    if (!validateAttempt(attempt)) throw new Error('Attempt itemOrder does not match its locked form version.');
    const byId = new Map(getForm(attempt.formVersion).items.map(item => [item.id, item]));
    return attempt.itemOrder.map(id => byId.get(id));
  }

  function csvEscape(value) {
    const text = String(value == null ? '' : value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv(form) {
    const selected = typeof form === 'string' ? getForm(form) : form;
    const rows = [['ID', 'Text', 'Area or facet', 'Scoring direction', 'Order in form']];
    selected.items.forEach(item => rows.push([item.id, item.text, item.area, item.direction, item.orderInForm]));
    return rows.map(row => row.map(csvEscape).join(',')).join('\n');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted && char === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { row.push(value); value = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        row.push(value); if (row.some(cell => cell.trim())) rows.push(row); row = []; value = '';
      } else value += char;
    }
    row.push(value); if (row.some(cell => cell.trim())) rows.push(row);
    if (rows.length < 2) throw new Error('The spreadsheet needs a header and at least one item.');
    return rows.slice(1).map((cells, index) => ({
      id: (cells[0] || '').trim(), text: (cells[1] || '').trim(), area: (cells[2] || '').trim(),
      direction: (cells[3] || '').trim(), orderInForm: Number(cells[4]) || index + 1
    })).sort((a, b) => a.orderInForm - b.orderInForm);
  }

  return { forms, getForm, createAttempt, getOrderedItems, validateAttempt, shuffleItemIds, exportCsv, parseCsv };
});
