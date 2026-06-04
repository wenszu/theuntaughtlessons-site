/**
 * UTL Sort & Bucket — Score Bands Configuration
 * The Untaught Lessons™
 *
 * Drop this into /data/ or inline into your scoring JS.
 * Reference: scoreBands array, ordered highest to lowest.
 * Usage: find the first band where score >= min.
 */

const scoreBands = [
  {
    id: "executive",
    label: "Executive clarity",
    min: 90,
    max: 100,
    color: "teal",
    description: "This is genuinely rare. Your thinking is precise, decisive, and effortlessly organized — the kind of clarity that makes everyone in the room trust your judgment immediately. You are already operating at an executive standard on this dimension."
  },
  {
    id: "sharp",
    label: "Sharp instinct",
    min: 70,
    max: 89,
    color: "green",
    description: "Your thinking is structured and decisive. You categorize clearly, name ideas with precision, and commit to a framework without second-guessing yourself. That is a genuine strength — and one that becomes even more powerful when paired with deliberate technique."
  },
  {
    id: "solid",
    label: "Solid foundation",
    min: 50,
    max: 69,
    color: "blue",
    description: "You have real structural instincts and they show. The thinking is mostly there — but it softens under ambiguity or when the right categories are not immediately obvious. A cleaner framework will sharpen what you already do well."
  },
  {
    id: "building",
    label: "Building the muscle",
    min: 30,
    max: 49,
    color: "amber",
    description: "You can see what matters — but translating that into a clean, committed structure is still inconsistent. That gap is exactly where most professionals live, and it is one of the most impactful things you can close. The instinct is there; the technique just needs to catch up."
  },
  {
    id: "starting",
    label: "Great starting point",
    min: 0,
    max: 29,
    color: "coral",
    description: "Organizing complex information into clear, decisive categories is not yet second nature — and that is completely normal before you have a repeatable structure to work with. The good news is that this is one of the most learnable skills there is, and the delta between where you are now and where you can get to is significant."
  }
];

/**
 * Returns the matching band object for a given score (0–100).
 * @param {number} score
 * @returns {object} band
 */
function getBand(score) {
  return scoreBands.find(band => score >= band.min && score <= band.max);
}


/**
 * UTL Sort & Bucket — Scoring Engine
 * The Untaught Lessons™
 *
 * Core scoring logic. Requires the exercise JSON with concept_map,
 * concept fields on items, and dual_concept where applicable.
 *
 * SCORING BREAKDOWN (always totals to 100):
 *   Labels    — 30 pts (10 per bucket)
 *   Placement — 60 pts (5 per item, 2.5 for defensible adjacent)
 *   Precision — 10 pts bonus for all 12 correct (no half-credit items)
 *
 * LABEL SCORING RULES:
 *   10 pts — selected label maps to the correct concept via concept_map
 *    5 pts — selected label is in the word bank but maps to a different concept
 *             (participant understood the dimension but chose a loose synonym)
 *    0 pts — two labels map to the same concept (structural thinking failure)
 *
 * PLACEMENT SCORING RULES:
 *   5.0 pts — item placed in bucket whose chosen label maps to item's concept
 *   5.0 pts — dual_concept item placed in bucket matching either valid concept
 *   2.5 pts — item placed in an adjacent/defensible bucket (not clearly wrong)
 *   0.0 pts — item placed in a clearly wrong bucket
 */

/**
 * Score a participant's label selections.
 * @param {string[]} chosenLabels — array of 3 label strings chosen from dropdown
 * @param {object} conceptMap — exercise.concept_map
 * @returns {object} { score, breakdown }
 */
function scoreLabels(chosenLabels, conceptMap) {
  const assignedConcepts = [];
  const breakdown = [];

  chosenLabels.forEach((label, index) => {
    let matchedConcept = null;
    for (const [concept, labels] of Object.entries(conceptMap)) {
      if (labels.map(l => l.toLowerCase()).includes(label.toLowerCase())) {
        matchedConcept = concept;
        break;
      }
    }
    assignedConcepts.push(matchedConcept);
    breakdown.push({ bucketIndex: index, label, concept: matchedConcept });
  });

  const uniqueConcepts = new Set(assignedConcepts.filter(Boolean));
  let score = 0;

  if (uniqueConcepts.size === 3) {
    score = 30;
  } else if (uniqueConcepts.size === 2) {
    score = 20;
  } else {
    score = 10;
  }

  return { score, breakdown, assignedConcepts };
}

/**
 * Score a participant's item placements.
 * @param {object[]} items — exercise.items array
 * @param {object} placements — { item_id: bucketIndex (0,1,2) }
 * @param {string[]} assignedConcepts — from scoreLabels, maps bucketIndex → concept
 * @param {string[]} dual_bucket_items — exercise.dual_bucket_items (item text)
 * @returns {object} { score, breakdown, perfect }
 */
function scorePlacements(items, placements, assignedConcepts, dualBucketItems, tier2Pairs) {
  let score = 0;
  let perfectCount = 0;
  const breakdown = [];
  const dualItems = dualBucketItems || [];

  // Build adjacency set from tier_2_adjacent_pairs — only explicitly defined pairs get half credit
  const adjacentPairs = new Set();
  (tier2Pairs || []).forEach(p => {
    adjacentPairs.add(`${p.concept_a}|${p.concept_b}`);
    adjacentPairs.add(`${p.concept_b}|${p.concept_a}`);
  });

  items.forEach(item => {
    const placedBucketIndex = placements[item.item_id];
    if (placedBucketIndex === undefined) {
      breakdown.push({ item_id: item.item_id, pts: 0, reason: "not placed" });
      return;
    }

    const placedConcept = assignedConcepts[placedBucketIndex];
    const isDualBucket = Boolean(item.dual_concept) || dualItems.includes(item.text);
    const validConcepts = isDualBucket && item.dual_concept
      ? [item.concept, item.dual_concept]
      : [item.concept];

    if (validConcepts.includes(placedConcept)) {
      score += 5;
      perfectCount++;
      breakdown.push({ item_id: item.item_id, pts: 5, reason: "correct concept" });
    } else {
      const isAdjacent = validConcepts.some(v =>
        placedConcept && adjacentPairs.has(`${v}|${placedConcept}`)
      );
      if (isAdjacent) {
        score += 2.5;
        breakdown.push({ item_id: item.item_id, pts: 2.5, reason: "adjacent concept — partial credit" });
      } else {
        breakdown.push({ item_id: item.item_id, pts: 0, reason: "incorrect" });
      }
    }
  });

  const perfect = perfectCount === items.length;
  if (perfect) score += 10;

  return { score, breakdown, perfect };
}

/**
 * Master scoring function.
 * @param {object} exercise — full exercise JSON object
 * @param {string[]} chosenLabels — 3 labels chosen from dropdown
 * @param {object} placements — { item_id: bucketIndex }
 * @returns {object} { total, labelScore, placementScore, perfectBonus, band, breakdown }
 */
function scoreExercise(exercise, chosenLabels, placements) {
  const labelResult = scoreLabels(chosenLabels, exercise.concept_map);
  const placementResult = scorePlacements(
    exercise.items,
    placements,
    labelResult.assignedConcepts,
    exercise.dual_bucket_items || exercise.tier_1_items || [],
    exercise.tier_2_adjacent_pairs || []
  );

  const total = Math.round(labelResult.score + placementResult.score);
  const band = getBand(total);

  return {
    total,
    labelScore: labelResult.score,
    placementScore: Math.round(placementResult.score),
    perfectBonus: placementResult.perfect ? 10 : 0,
    band,
    breakdown: {
      labels: labelResult.breakdown,
      placements: placementResult.breakdown
    }
  };
}

export { scoreBands, getBand, scoreLabels, scorePlacements, scoreExercise };
