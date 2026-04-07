function parseMediaType(media) {
  const urlLink = media;
  let mediaType = 'none';

  if (urlLink) {
    const extension = urlLink.replace(/^.*\./, '').toLowerCase();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
      case 'png':
        mediaType = 'image';
        break;
      case 'wmv':
        mediaType = 'video_wmv';
        break;
      case 'mp4':
        mediaType = 'video_mp4';
        break;
      case 'mp3':
      case 'wav':
      case 'aiff':
        mediaType = 'audio';
        break;
      default:
        mediaType = 'none';
    }
  }

  return mediaType;
}

function parseAnswer(answer) {
  let newAnswer = answer.replace(/ *\([^)]*\) */g, '');
  newAnswer = newAnswer.toUpperCase();

  let head = newAnswer.substring(0, 1);
  let tail = newAnswer.substring(newAnswer.length - 1, newAnswer.length);

  if (head === '"' && tail === '"') {
    newAnswer = newAnswer.substring(1, newAnswer.length - 1);
  }

  head = newAnswer.substring(0, 2);
  if (head === 'A ') {
    newAnswer = newAnswer.substring(2, newAnswer.length);
    newAnswer = newAnswer.trim();
  }

  head = newAnswer.substring(0, 3);
  if (head === 'AN ') {
    newAnswer = newAnswer.substring(3, newAnswer.length);
    newAnswer = newAnswer.trim();
  }

  if (head === 'THE') {
    newAnswer = newAnswer.substring(3, newAnswer.length);
    newAnswer = newAnswer.trim();
  }

  return newAnswer;
}

module.exports = { parseMediaType, parseAnswer };
