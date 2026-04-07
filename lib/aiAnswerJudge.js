/**
 * Uses the official OpenAI SDK (Responses API) to judge whether a contestant
 * response is acceptable for Jeopardy (spelling, nicknames, equivalent phrasing).
 */

const { OpenAI, APIError } = require('openai');

/** Fallback if output_text is missing (defensive). */
function textFromResponsesPayload(data) {
  if (!data || typeof data !== 'object') {
    return '';
  }
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  const parts = [];
  const out = data.output;
  if (!Array.isArray(out)) {
    return '';
  }
  for (const item of out) {
    if (
      item &&
      item.type === 'message' &&
      item.role === 'assistant' &&
      Array.isArray(item.content)
    ) {
      for (const block of item.content) {
        if (block && block.type === 'output_text' && typeof block.text === 'string') {
          parts.push(block.text);
        }
      }
    }
    if (item && item.type === 'output_text' && typeof item.text === 'string') {
      parts.push(item.text);
    }
  }
  return parts.join('');
}

async function judgeWithOpenAI({
  apiKey,
  model,
  clueText,
  officialShortAnswer,
  contestantResponse,
}) {
  if (!apiKey) {
    return { correct: false, error: 'missing_api_key' };
  }

  const instructions = `You are an expert Jeopardy! judge. The game uses short official answers in ALL CAPS (articles and parentheticals may already be stripped). Decide if the contestant's response would be accepted on the show: allow minor spelling errors, spoken variants, common nicknames, and equivalent names (e.g. "USA" vs "United States") when they clearly refer to the same thing. Reject wrong entities, vague guesses, or answers that miss the key fact. Respond with ONLY valid JSON: {"correct":true|false,"reason":"one short sentence"}`;

  const input = JSON.stringify({
    clue: clueText || '',
    officialAnswer: officialShortAnswer || '',
    contestantResponse: contestantResponse || '',
  });

  const client = new OpenAI({ apiKey });

  let response;
  try {
    response = await client.responses.create({
      model,
      instructions,
      input,
      temperature: 0,
    });
  } catch (e) {
    if (e instanceof APIError) {
      return {
        correct: false,
        error: 'openai_http_error',
        status: e.status,
        body: String(e.message || '').slice(0, 500),
      };
    }
    throw e;
  }

  const raw =
    (typeof response.output_text === 'string' && response.output_text) ||
    textFromResponsesPayload(response);

  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch (e2) {
        return { correct: false, error: 'parse_error', raw: raw.slice(0, 300) };
      }
    } else {
      return { correct: false, error: 'parse_error', raw: raw.slice(0, 300) };
    }
  }

  return {
    correct: Boolean(parsed.correct),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

module.exports = { judgeWithOpenAI };
