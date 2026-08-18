/**
 * Score one recorded gap-detection pass against the calibration corpus.
 *
 * The corpus states what was planted. The observation states what a detection
 * pass proposed, and which planted gap each proposal was reviewed as. Scoring
 * is pure so the same numbers appear in the report and in the test.
 */

export class CalibrationError extends Error {}

const CATEGORIES = new Set([
  "ambiguous-rule",
  "document-contradiction",
  "owner-decision",
  "unconfirmed-dependency",
]);

function documentIds(value, label) {
  const ids = value.documents.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new CalibrationError(`${label} repeats a document identifier`);
  }
  return ids;
}

/**
 * Check that the corpus is a usable instrument before scoring anything.
 *
 * A corpus that plants no contradiction, or that has fewer clean documents
 * than planted ones, would report a number nobody should act on.
 */
export function validateCorpus(corpus) {
  const ids = documentIds(corpus, "the corpus");
  const planted = corpus.documents.filter(({ planted }) => planted);
  const clean = corpus.documents.filter(({ planted }) => !planted);
  if (planted.length < 5 || clean.length < 5) {
    throw new CalibrationError(
      "the corpus needs at least five planted and five clean documents",
    );
  }
  const categories = new Set(
    planted.flatMap(({ expected }) => expected.map(({ category }) => category)),
  );
  for (const category of CATEGORIES) {
    if (!categories.has(category)) {
      throw new CalibrationError(`no planted gap covers ${category}`);
    }
  }
  for (const document of corpus.documents) {
    if (document.planted === (document.expected.length === 0)) {
      throw new CalibrationError(
        `${document.id} disagrees with its own planted flag`,
      );
    }
    for (const { category } of document.expected) {
      if (!CATEGORIES.has(category)) {
        throw new CalibrationError(`${document.id} plants an unknown category`);
      }
    }
  }
  const gapIds = corpus.documents.flatMap(({ expected }) =>
    expected.map(({ gapId }) => gapId),
  );
  if (new Set(gapIds).size !== gapIds.length) {
    throw new CalibrationError("the corpus repeats a planted gap identifier");
  }
  return ids;
}

function reviewOne(document, observation) {
  const proposed =
    observation.proposal === null ? [] : observation.proposal.gaps;
  const reviewed = observation.matches;
  if (reviewed.length !== proposed.length) {
    throw new CalibrationError(
      `${document.id} reviewed ${String(reviewed.length)} of ${String(proposed.length)} proposals`,
    );
  }
  const claimed = new Set();
  let found = 0;
  let raised = 0;
  for (const proposal of proposed) {
    const review = reviewed.find(({ gapId }) => gapId === proposal.gapId);
    if (review === undefined) {
      throw new CalibrationError(
        `${document.id} proposed ${proposal.gapId} without a review`,
      );
    }
    if (review.matched === null) {
      raised += 1;
      continue;
    }
    const expected = document.expected.find(
      ({ gapId }) => gapId === review.matched,
    );
    if (expected === undefined) {
      throw new CalibrationError(
        `${document.id} matched ${proposal.gapId} to a gap it never planted`,
      );
    }
    if (expected.category !== proposal.category) {
      throw new CalibrationError(
        `${document.id} matched ${proposal.gapId} to a gap of another category`,
      );
    }
    if (claimed.has(expected.gapId)) {
      throw new CalibrationError(
        `${document.id} matched ${expected.gapId} twice`,
      );
    }
    claimed.add(expected.gapId);
    found += 1;
  }
  return {
    id: document.id,
    planted: document.expected.length,
    found,
    missed: document.expected
      .filter(({ gapId }) => !claimed.has(gapId))
      .map(({ gapId }) => gapId),
    falseGaps: raised,
  };
}

/** The report a reviewer reads before enforce mode is switched on anywhere. */
export function scoreCalibration(corpus, observed) {
  const corpusIds = validateCorpus(corpus);
  const observedIds = documentIds(observed, "the observation");
  if (JSON.stringify(corpusIds) !== JSON.stringify(observedIds)) {
    throw new CalibrationError(
      "the observation does not cover the corpus exactly once each",
    );
  }
  const documents = corpus.documents.map((document, index) =>
    reviewOne(document, observed.documents[index]),
  );
  const planted = documents.reduce((total, one) => total + one.planted, 0);
  const found = documents.reduce((total, one) => total + one.found, 0);
  const falseGaps = corpus.documents.reduce(
    (total, document, index) =>
      document.planted ? total : total + documents[index].falseGaps,
    0,
  );
  return {
    documents,
    planted,
    found,
    missed: planted - found,
    // False gaps are counted where the corpus asserts there is nothing to
    // find. A surplus proposal on a planted document is reported per document
    // rather than folded into this number.
    falseGaps,
    recall: planted === 0 ? 1 : found / planted,
  };
}

export function renderCalibration(report) {
  return [
    `documents: ${String(report.documents.length)}`,
    `planted gaps: ${String(report.planted)}`,
    `planted gaps found: ${String(report.found)}`,
    `planted gaps missed: ${String(report.missed)}`,
    `false gaps on clean documents: ${String(report.falseGaps)}`,
    `recall: ${report.recall.toFixed(2)}`,
  ].join("\n");
}
