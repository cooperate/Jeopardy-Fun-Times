const fs = require('fs');
const Papa = require('papaparse');

function removeSpecialCharacters(word) {
  let newWord = word;
  const specialCharacters = [
    '-',
    ':',
    ',',
    '.',
    ';',
    '!',
    '[',
    ']',
    '(',
    ')',
    '\\',
    '/',
    '$',
    '%',
    '&',
    '+',
    '{',
    '}',
    "'",
    '`',
    '_',
    '|',
  ];

  for (let i = 0; i < specialCharacters.length; i++) {
    const ch = specialCharacters[i];
    if (newWord.includes(ch)) {
      const re = new RegExp(`\\${ch}`, 'gi');
      if (ch === "'") {
        newWord = newWord.replace(re, '');
      } else {
        newWord = newWord.replace(re, ' ');
      }
    }
  }

  return newWord;
}

const DIGIT_TO_WORD = {
  '0': 'ZERO',
  '1': 'ONE',
  '2': 'TWO',
  '3': 'THREE',
  '4': 'FOUR',
  '5': 'FIVE',
  '6': 'SIX',
  '7': 'SEVEN',
  '8': 'EIGHT',
  '9': 'NINE',
  '10': 'TEN',
};

const WORD_TO_DIGIT = Object.fromEntries(
  Object.entries(DIGIT_TO_WORD).map(([d, w]) => [w, d])
);

/**
 * Levenshtein distance; small strings only (answers are short).
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[n];
}

/**
 * Max allowed edit distance for typo tolerance (scales slightly with length).
 */
function maxTyposForToken(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  if (len <= 12) return 2;
  return 2;
}

function pluralPair(shorter, longer) {
  if (!shorter || !longer) return false;
  if (longer.length !== shorter.length + 1) return false;
  return longer.endsWith('S') && longer.slice(0, -1) === shorter;
}

/**
 * Two tokens match: exact, digit/word, mild plural, or bounded Levenshtein.
 */
function tokensMatch(expectedTok, playerTok) {
  if (expectedTok === playerTok) return true;

  if (DIGIT_TO_WORD[expectedTok] === playerTok) return true;
  if (DIGIT_TO_WORD[playerTok] === expectedTok) return true;
  if (WORD_TO_DIGIT[expectedTok] === playerTok) return true;
  if (WORD_TO_DIGIT[playerTok] === expectedTok) return true;

  const e = expectedTok;
  const p = playerTok;
  if (pluralPair(e, p) || pluralPair(p, e)) return true;

  const maxLen = Math.max(e.length, p.length);
  const maxDist = maxTyposForToken(maxLen);
  if (maxDist === 0) return false;
  const dist = levenshtein(e, p);
  if (dist > maxDist) return false;
  /* Distance 2 with different first letters is usually a different word (LEECHES vs
     BEACHES), not a speech-to-text slip. Distance-1 still allows one wrong char
     anywhere (e.g. NIGHT vs RIGHT). */
  if (
    dist === 2 &&
    Math.min(e.length, p.length) >= 5 &&
    e[0] !== p[0]
  ) {
    return false;
  }
  return true;
}

/**
 * Strip leading articles (whole word) repeatedly.
 */
function stripLeadingArticles(phrase) {
  let s = phrase.trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/^(THE|A|AN)\s+/i, '').trim();
  } while (s !== prev);
  return s;
}

const RESPONSE_PREFIX = /^\s*(WHAT|WHO)\s+(IS|ARE)\s+((A|AN)\s+)?/i;

function normalizeAnswerPhrase(raw) {
  let s = String(raw || '')
    .toUpperCase()
    .trim();
  s = s.replace(RESPONSE_PREFIX, '');
  s = s.replace(/^\s*LIKE\s+A\s+/i, '');
  s = s.replace(/^\s*LIKE\s+/i, '');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/&/g, 'AND');
  s = removeSpecialCharacters(s);
  s = s.replace(/\s+/g, ' ').trim();
  s = stripLeadingArticles(s);
  return s;
}

function tokenizeContent(phrase) {
  if (!phrase) return [];
  return phrase.split(/\s+/).filter(Boolean);
}

/**
 * Every expected token must pair to a distinct player token (one-to-one).
 */
function expectedCoveredByPlayer(expectedTokens, playerTokens) {
  if (expectedTokens.length === 0) return false;
  const pool = playerTokens.slice();
  for (const e of expectedTokens) {
    let idx = -1;
    for (let i = 0; i < pool.length; i++) {
      if (tokensMatch(e, pool[i])) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return false;
    pool.splice(idx, 1);
  }
  return true;
}

function sortedBagJoin(tokens) {
  return [...tokens].slice().sort().join(' ');
}

/**
 * Max Levenshtein on full normalized phrase (phrase-level typos / small omissions).
 */
function maxPhraseTypos(len) {
  if (len <= 6) return 1;
  if (len <= 20) return 2;
  return 3;
}

function checkIfName(playerNameToCheck, lastNameFilePath) {
  const lastNameSend = fs.readFileSync(lastNameFilePath, {
    encoding: 'utf8',
  });
  const parsedLastName = Papa.parse(lastNameSend);
  const rowsLastName = parsedLastName.data;

  for (let row in rowsLastName) {
    if (playerNameToCheck === rowsLastName[row][0]) {
      return true;
    }
  }
  return false;
}

/** @deprecated kept for any external require; prefer tokensMatch */
function equateNumberLiterals(numberArr) {
  const n = [...numberArr];
  if (n[0] != null && DIGIT_TO_WORD[n[0]]) {
    n[0] = DIGIT_TO_WORD[n[0]];
  }
  return n;
}

/** @deprecated prefer tokensMatch plural handling */
function checkForPlural(playerAnswer, actualAnswer) {
  return {
    playerAnswer: [...playerAnswer],
    actualAnswer: [...actualAnswer],
  };
}

function closeEnough(playerAnswerStr, actualAnswerStr) {
  const actualAnswerArray = actualAnswerStr.split(' ').filter(Boolean);
  const playerAnswerArray = playerAnswerStr.split(' ').filter(Boolean);
  const actualAnswerLength = actualAnswerArray.length;

  const answerArray = [actualAnswerArray, playerAnswerArray];
  const result = answerArray.shift().filter(function (v) {
    return answerArray.every(function (a) {
      return a.indexOf(v) !== -1;
    });
  });

  if (actualAnswerLength <= 2) {
    if (result.length > 1 && result.length <= 3) {
      return result;
    }
    return false;
  }
  if (result.length >= actualAnswerLength - 1) {
    return result;
  }
  return false;
}

module.exports = {
  removeSpecialCharacters,
  equateNumberLiterals,
  checkForPlural,
  closeEnough,
  checkIfName,
  levenshtein,
  tokensMatch,
  normalizeAnswerPhrase,
  tokenizeContent,
  expectedCoveredByPlayer,
  sortedBagJoin,
  maxPhraseTypos,
};
