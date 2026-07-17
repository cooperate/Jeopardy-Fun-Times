require('dotenv').config();

const path = require('path');
const root = path.join(__dirname, '..');

module.exports = {
  root,
  port: parseInt(process.env.PORT || '3000', 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  openaiAnswerJudgeEnabled:
    String(process.env.OPENAI_ANSWER_JUDGE_ENABLED || 'true').toLowerCase() ===
    'true',
  /** Optional override for gzipped j-archive-parser JSON (default: howardchung release). */
  jeopardyPackUrl: process.env.JEOPARDY_PACK_URL || '',
  wikimediaUserAgent:
    process.env.WIKIMEDIA_USER_AGENT ||
    'JeopardyFunTimes/0.0.1 (Wikimedia image fallback)',
  paths: {
    cluesDb: process.env.CLUES_DB_PATH || path.join(root, 'data', 'clues.db'),
    lastNameFile:
      process.env.LAST_NAME_FILE_PATH ||
      path.join(root, 'data', 'last_name_stripped.csv'),
    gameHistory:
      process.env.GAME_HISTORY_PATH || path.join(root, 'data', 'games_played.csv'),
    gameHighScore:
      process.env.GAME_HIGH_SCORE_PATH ||
      path.join(root, 'data', 'game_high_score.csv'),
  },
};
