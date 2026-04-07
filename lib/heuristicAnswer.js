const {
  normalizeAnswerPhrase,
  tokenizeContent,
  expectedCoveredByPlayer,
  sortedBagJoin,
  levenshtein,
  maxPhraseTypos,
  tokensMatch,
} = require('./answerHelpers');

/**
 * Stricter local match than the old word-overlap heuristic: avoids false positives
 * from unrelated shared words (e.g. matching two tokens inside a long wrong phrase).
 * OpenAI (when configured) still handles harder cases.
 *
 * @param {string} rawPlayerAnswer
 * @param {string} canonicalExpected - parseAnswer-normalized official string (DB)
 * @param {string} _lastNameFilePath - unused; kept for API compatibility
 * @returns {boolean}
 */
function matchHeuristic(
  rawPlayerAnswer,
  canonicalExpected,
  _lastNameFilePath
) {
  const expNorm = normalizeAnswerPhrase(canonicalExpected);
  const playNorm = normalizeAnswerPhrase(rawPlayerAnswer);

  if (!expNorm || !playNorm) {
    return false;
  }

  if (expNorm === playNorm) {
    return true;
  }

  const expTokens = tokenizeContent(expNorm);
  const playTokens = tokenizeContent(playNorm);

  if (expTokens.length === 0 || playTokens.length === 0) {
    return false;
  }

  // Order-independent: "WASHINGTON GEORGE" vs "GEORGE WASHINGTON"
  if (sortedBagJoin(expTokens) === sortedBagJoin(playTokens)) {
    return true;
  }

  // Whole-phrase near match (spacing / light typos)
  const maxDist = maxPhraseTypos(Math.max(expNorm.length, playNorm.length));
  if (levenshtein(expNorm, playNorm) <= maxDist) {
    return true;
  }

  // Core rule: every official token must match some player token (one-to-one).
  // Player may add at most 2 extra tokens (fillers like DR, JR, SAINT).
  const maxExtra = 2;
  if (playTokens.length > expTokens.length + maxExtra) {
    return false;
  }

  if (expectedCoveredByPlayer(expTokens, playTokens)) {
    return true;
  }

  // Last-name-only (and similar): official has 2+ tokens, player gives one token
  // that matches the last official token only (typo-tolerant).
  if (
    expTokens.length >= 2 &&
    playTokens.length === 1 &&
    tokensMatch(expTokens[expTokens.length - 1], playTokens[0])
  ) {
    return true;
  }

  // Single-token official: already handled by equality / Levenshtein above;
  // reject loose partial multi-word player answers against one-token expected.
  return false;
}

module.exports = { matchHeuristic };
