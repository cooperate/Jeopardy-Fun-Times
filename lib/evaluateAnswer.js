const { matchHeuristic } = require('./heuristicAnswer');
const { judgeWithOpenAI } = require('./aiAnswerJudge');

/**
 * @param {object} opts
 * @param {string} opts.playerAnswer
 * @param {string} opts.canonicalAnswer - stored normalized answer
 * @param {string} [opts.clueText]
 * @param {string} opts.lastNameFilePath
 * @param {boolean} opts.aiEnabled
 * @param {string} [opts.openaiApiKey]
 * @param {string} [opts.openaiModel]
 * @param {function (): void} [opts.onAiJudgingStart] — called right before the OpenAI request (heuristic already failed).
 */
async function evaluateAnswer(opts) {
  const heuristic = matchHeuristic(
    opts.playerAnswer,
    opts.canonicalAnswer,
    opts.lastNameFilePath
  );

  if (heuristic) {
    return { correct: true, source: 'heuristic' };
  }

  if (
    !opts.aiEnabled ||
    !opts.openaiApiKey ||
    String(opts.openaiApiKey).trim() === ''
  ) {
    return { correct: false, source: 'heuristic' };
  }

  if (typeof opts.onAiJudgingStart === 'function') {
    opts.onAiJudgingStart();
  }

  try {
    const ai = await judgeWithOpenAI({
      apiKey: opts.openaiApiKey,
      model: opts.openaiModel || 'gpt-4o-mini',
      clueText: opts.clueText || '',
      officialShortAnswer: opts.canonicalAnswer,
      contestantResponse: opts.playerAnswer,
    });

    if (ai.error) {
      return { correct: false, source: 'heuristic_fallback', aiError: ai };
    }

    return {
      correct: ai.correct,
      source: 'openai',
    };
  } catch (e) {
    return {
      correct: false,
      source: 'heuristic_fallback',
      aiError: { error: String(e.message || e) },
    };
  }
}

module.exports = { evaluateAnswer };
