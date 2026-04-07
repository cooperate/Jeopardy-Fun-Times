const fs = require('fs');
const path = require('path');

function ensureGameHighScoreFile(filePath) {
  if (!fs.existsSync(filePath)) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, 'PLAYER,SCORE\nNobody,0\n', 'utf8');
  }
}

module.exports = { ensureGameHighScoreFile };
