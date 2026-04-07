/**
 * Uses OpenAI chat completions to judge whether a contestant response is
 * acceptable for Jeopardy (spelling, nicknames, equivalent phrasing).
 */

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

  const system = `You are an expert Jeopardy! judge. The game uses short official answers in ALL CAPS (articles and parentheticals may already be stripped). Decide if the contestant's response would be accepted on the show: allow minor spelling errors, spoken variants, common nicknames, and equivalent names (e.g. "USA" vs "United States") when they clearly refer to the same thing. Reject wrong entities, vague guesses, or answers that miss the key fact. Respond with ONLY valid JSON: {"correct":true|false,"reason":"one short sentence"}`;

  const user = JSON.stringify({
    clue: clueText || '',
    officialAnswer: officialShortAnswer || '',
    contestantResponse: contestantResponse || '',
  });

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      correct: false,
      error: 'openai_http_error',
      status: res.status,
      body: text.slice(0, 500),
    };
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message;
  const raw = content ? content.content : '';
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
