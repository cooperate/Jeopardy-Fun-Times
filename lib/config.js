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
  paths: {
    cluesDb: process.env.CLUES_DB_PATH || path.join(root, 'data', 'clues.db'),
    lastNameFile: path.join(root, 'data', 'last_name_stripped.csv'),
    gameHistory: path.join(root, 'data', 'games_played.csv'),
    gameHighScore: path.join(root, 'data', 'game_high_score.csv'),
  },
};
