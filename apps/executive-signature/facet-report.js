// The Executive Signature full facet report, drawn again from the scores the server stored.
//
// The server (functions-admin/assessment-persistence-service.js) scores every completed attempt and keeps overall
// score, band, profile label and area_scores on the attempt. For the full assessment area_scores holds all ten facet
// scores in the direction the report shows them (Anxiety and Self-Consciousness already flipped), rounded to three
// decimals. The report on screen is a pure function of those ten numbers, so a member can open it again after the tab
// that showed it is gone. This file does that: no network, no storage, no DOM. The page passes in the stored area
// scores, window.READINESS_CONTENT and an escape function.
//
// The rules below are the ones in apps/executive-signature/index.html (scoreFull) and in
// functions-admin/executive-signature-versions.js (scoreVersion). tests/executive-signature-facet-report.test.js
// checks that the two agree on random answers.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.READINESS_FACET_REPORT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const READINESS_FACETS = ['Achievement-Striving', 'Self-Discipline', 'Orderliness', 'Intellect', 'Anxiety', 'Self-Consciousness'];
  const STYLE_FACETS = ['Assertiveness', 'Activity Level', 'Cooperation', 'Altruism'];
  const ALL_FACETS = READINESS_FACETS.concat(STYLE_FACETS);
  const SETTINGS = Object.freeze({ levelLow: 40, levelHigh: 60, voiceLow: 40, voiceHigh: 60, closeGap: 10 });
  const DEFAULT_BANDS = Object.freeze([
    { label: 'Emerging', min: 0 }, { label: 'Developing', min: 40 }, { label: 'Strong', min: 60 }, { label: 'Exceptional', min: 80 }
  ]);
  const PROFILES = Object.freeze({
    'Reserved|Achievement-driven': 'Quiet achiever',
    'Reserved|Connection-driven': 'Steady supporter',
    'Balanced|Achievement-driven': 'Go-getter',
    'Balanced|Connection-driven': 'Team player',
    'Vocal|Achievement-driven': 'Natural leader',
    'Vocal|Connection-driven': 'People person'
  });
  // The five areas the report groups the ten facets into.
  const AREAS = Object.freeze([
    { label: 'Follow-through', kind: 'readiness', facets: ['Achievement-Striving', 'Self-Discipline', 'Orderliness'] },
    { label: 'Steadiness', kind: 'readiness', facets: ['Anxiety', 'Self-Consciousness'] },
    { label: 'Curiosity', kind: 'readiness', facets: ['Intellect'] },
    { label: 'Social energy', kind: 'style', facets: ['Assertiveness', 'Activity Level'] },
    { label: 'Warmth', kind: 'style', facets: ['Altruism', 'Cooperation'] }
  ]);

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value) {
    return Math.max(0, Math.min(100, value));
  }

  // True when the stored scores hold all ten facets as numbers, which is what a full assessment attempt stores. A quick
  // check stores five areas instead and has no facet report.
  function hasFacetScores(areaScores) {
    if (!areaScores || typeof areaScores !== 'object') return false;
    return ALL_FACETS.every((facet) => finite(areaScores[facet]) !== null);
  }

  function bandFor(score, bands) {
    const list = (Array.isArray(bands) && bands.length ? bands : DEFAULT_BANDS)
      .map((band) => (Array.isArray(band) ? { label: band[0], min: band[1] } : { label: band.label, min: band.min }))
      .sort((a, b) => a.min - b.min);
    let label = list[0].label;
    list.forEach((band) => { if (score >= band.min) label = band.label; });
    return label;
  }

  // The reading of one full assessment from its stored area scores. Returns null when the ten facets are not all there.
  //   options.bands: the content bands (window.READINESS_CONTENT.bands); options.settings: the thresholds.
  function readingFromAreaScores(areaScores, options) {
    if (!hasFacetScores(areaScores)) return null;
    const settings = Object.assign({}, SETTINGS, (options && options.settings) || {});
    const shown = {};
    ALL_FACETS.forEach((facet) => { shown[facet] = clamp(finite(areaScores[facet])); });
    const readiness = Math.round(READINESS_FACETS.reduce((sum, facet) => sum + shown[facet], 0) / READINESS_FACETS.length);
    const voiceValue = shown.Assertiveness;
    const voice = voiceValue < settings.voiceLow ? 'Reserved' : voiceValue > settings.voiceHigh ? 'Vocal' : 'Balanced';
    const achievement = shown['Achievement-Striving'];
    const connection = shown.Altruism;
    const drive = achievement >= connection ? 'Achievement-driven' : 'Connection-driven';
    // The page ranks the rounded values; a stable sort keeps the facet order for equal values.
    const ranked = READINESS_FACETS.map((facet) => [facet, Math.round(shown[facet])]).sort((a, b) => b[1] - a[1]);
    const level = (value) => (value < settings.levelLow ? 'Low' : value > settings.levelHigh ? 'High' : 'Mid');
    const areas = AREAS.map((area) => {
      const value = area.facets.reduce((sum, facet) => sum + shown[facet], 0) / area.facets.length;
      return { label: area.label, kind: area.kind, facets: area.facets.slice(), value, level: level(Math.round(value)) };
    });
    return {
      shown,
      readiness,
      band: bandFor(readiness, options && options.bands),
      voice,
      drive,
      driveCloseCall: Math.abs(achievement - connection) < settings.closeGap,
      profile: PROFILES[`${voice}|${drive}`],
      ranked,
      strengths: ranked.slice(0, 2).map((entry) => entry[0]),
      growthEdges: ranked.slice(-2).reverse().map((entry) => entry[0]),
      areas,
      level
    };
  }

  const nbh = (text) => String(text).replace(/-/g, '‑');

  function barHtml(value) {
    const width = Math.round(clamp(value));
    return `<div class="facet-bar-track mini"><span class="facet-bar-fill" style="width:${width}%"></span><span class="facet-bar-dot" style="left:${width}%"></span></div>`;
  }

  // The report as HTML: the score, band and profile, the two strongest and the two most open readiness facets, and the
  // five areas with every facet. Text for strengths, growth edges and style levels comes from window.READINESS_CONTENT
  // (content.facets); a missing entry simply leaves that sentence out. profileLabel and band, when the server stored
  // them, are shown as stored.
  function renderHtml(reading, options) {
    if (!reading) return '';
    const esc = options && typeof options.escape === 'function' ? options.escape : (value) => String(value);
    const content = (options && options.content && options.content.facets) || {};
    const profileLabel = (options && options.profileLabel) || reading.profile;
    const band = (options && options.band) || reading.band;
    // The headline score is the one the server stored when there is one; the mean of the six readiness facets is only the fallback.
    const stored = options && options.overallScore !== null && options.overallScore !== undefined && options.overallScore !== '' ? Number(options.overallScore) : NaN;
    const headline = Number.isFinite(stored) ? Math.round(clamp(stored)) : reading.readiness;
    const sentence = (facet, key) => (content[facet] && content[facet][key] ? `<p>${esc(content[facet][key])}</p>` : '');
    const facetCard = (facet, key, title) =>
      `<article class="facet-report-item"><div class="facet-report-item-head"><b>${esc(nbh(facet))}</b><span class="num">${Math.round(reading.shown[facet])}</span></div>${barHtml(reading.shown[facet])}${sentence(facet, key)}</article>`;
    const areaBlock = (area) => {
      const rows = area.facets.map((facet) =>
        `<div class="area-facet-row"><div class="area-facet-head"><span>${esc(nbh(facet))}</span><span class="num">${Math.round(reading.shown[facet])}</span></div>${barHtml(reading.shown[facet])}</div>`
      ).join('');
      return `<div class="area-detail-block"><div class="area-detail-head"><b>${esc(nbh(area.label))}</b><span class="area-detail-level">${esc(area.level)}</span><span class="num">${Math.round(area.value)}</span></div>${barHtml(area.value)}<div class="area-facets">${rows}</div></div>`;
    };
    const styleLines = STYLE_FACETS.map((facet) => {
      const text = content[facet] && content[facet].levels && content[facet].levels[reading.level(Math.round(reading.shown[facet]))];
      return text ? `<li><b>${esc(nbh(facet))}:</b> ${esc(text)}</li>` : '';
    }).join('');
    return [
      '<div class="facet-report" data-facet-report>',
      '<p class="eyebrow">Full facet-level report</p>',
      `<h2>${esc(headline)} out of 100, ${esc(band)} range</h2>`,
      `<p class="muted">Profile: ${esc(profileLabel)}. This report is drawn from the scores stored with your full assessment. You do not need to answer the questions again to see it.</p>`,
      '<h3>Your top strengths</h3>',
      `<div class="facet-report-grid">${reading.strengths.map((facet) => facetCard(facet, 'strength')).join('')}</div>`,
      '<h3>Your growth edges</h3>',
      `<div class="facet-report-grid">${reading.growthEdges.map((facet) => facetCard(facet, 'growthEdge')).join('')}</div>`,
      '<h3>Your five areas in detail</h3>',
      reading.areas.map(areaBlock).join(''),
      styleLines ? `<h3>Your working style</h3><ul class="facet-report-style">${styleLines}</ul>` : '',
      '</div>'
    ].join('');
  }

  return {
    READINESS_FACETS,
    STYLE_FACETS,
    ALL_FACETS,
    AREAS,
    PROFILES,
    SETTINGS,
    hasFacetScores,
    readingFromAreaScores,
    renderHtml
  };
});
