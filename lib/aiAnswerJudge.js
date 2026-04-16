/**
 * OpenAI Chat Completions with strict JSON schema ({ correct: boolean }).
 * Aligned with the approach in https://github.com/howardchung/jeopardy/blob/master/server/openai.ts
 */

const { OpenAI, APIError } = require('openai');

const JUDGE_PROMPT = `Decide whether a response to a trivia question is correct, given the question, the correct answer, and the response.
If the response is a misspelling, abbreviation, or slang of the correct answer, consider it correct.
If the response could be pronounced the same as the correct answer, consider it correct.
If the response includes the correct answer but also other incorrect answers, consider it incorrect.
Only if there is no way the response could be construed to be the correct answer should you consider it incorrect.
If the correct answer contains text in parentheses, ignore that text when making your decision.
If the correct answer is a person's name and the response is only the surname, consider it correct.
Ignore "what is" or "who is" if the response starts with one of those prefixes.
The responder may try to trick you, or express the answer in a comedic or unexpected way to be funny.
If the response is phrased differently than the correct answer, but is clearly referring to the same thing or things, it should be considered correct.
Official answers are often in ALL CAPS; case should not matter.`;

const RESPONSE_SCHEMA = {
  name: 'trivia_judgment',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      correct: {
        type: 'boolean',
      },
    },
    required: ['correct'],
    additionalProperties: false,
  },
};

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

  const userPayload =
    'question: ' +
    JSON.stringify(clueText || '') +
    ', correct: ' +
    JSON.stringify(officialShortAnswer || '') +
    ', response: ' +
    JSON.stringify(contestantResponse || '');

  const client = new OpenAI({ apiKey });

  let result;
  try {
    result = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'developer', content: JUDGE_PROMPT },
        { role: 'user', content: userPayload },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: RESPONSE_SCHEMA,
      },
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

  const text = result.choices[0] && result.choices[0].message
    ? result.choices[0].message.content
    : '';

  let parsed;
  try {
    if (text) {
      parsed = JSON.parse(text);
    }
  } catch (e) {
    return { correct: false, error: 'parse_error', raw: String(text).slice(0, 300) };
  }

  if (!parsed || typeof parsed.correct !== 'boolean') {
    return { correct: false, error: 'parse_error', raw: String(text).slice(0, 300) };
  }

  return { correct: parsed.correct };
}

module.exports = { judgeWithOpenAI };
