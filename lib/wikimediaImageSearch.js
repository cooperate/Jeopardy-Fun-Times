'use strict';

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchQuery(question) {
  var answer = plainText(question && question.answer);
  var category = plainText(question && question.category);
  return [answer, category].filter(Boolean).join(' ').slice(0, 300);
}

function metadataValue(metadata, key) {
  return plainText(metadata && metadata[key] && metadata[key].value);
}

function metadataUrl(metadata, key) {
  var value = metadata && metadata[key] && metadata[key].value;
  return /^https?:\/\//i.test(String(value || '')) ? String(value) : '';
}

function sourceUrlForTitle(title) {
  return (
    'https://commons.wikimedia.org/wiki/' +
    encodeURIComponent(String(title || '').replace(/ /g, '_'))
  );
}

function normalizePage(page) {
  var info = page && page.imageinfo && page.imageinfo[0];
  var effectiveMime = String(
    (info && info.thumbmime) || (info && info.mime) || ''
  ).toLowerCase();
  if (!info || !ALLOWED_MIME_TYPES.has(effectiveMime)) {
    return null;
  }

  var imageUrl = info.thumburl || info.url;
  if (!/^https:\/\//i.test(String(imageUrl || ''))) {
    return null;
  }

  var metadata = info.extmetadata || {};
  return {
    imageUrl: imageUrl,
    mime: effectiveMime,
    sourceUrl: metadataUrl(metadata, 'ImageDescriptionUrl') || sourceUrlForTitle(page.title),
    artist:
      metadataValue(metadata, 'Artist') ||
      metadataValue(metadata, 'Credit') ||
      'Wikimedia Commons contributor',
    license: metadataValue(metadata, 'LicenseShortName') || 'See source for license',
    licenseUrl: metadataUrl(metadata, 'LicenseUrl'),
  };
}

async function searchCommonsImage(question, options) {
  options = options || {};
  var query = buildSearchQuery(question);
  if (!query) {
    return null;
  }

  var params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '1200',
    format: 'json',
    formatversion: '2',
  });
  var controller = new AbortController();
  var timeout = setTimeout(function () {
    controller.abort();
  }, options.timeoutMs || 6000);

  try {
    var response = await fetch(COMMONS_API_URL + '?' + params.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          options.userAgent || 'JeopardyFunTimes/0.0.1 (Wikimedia image fallback)',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error('Wikimedia Commons HTTP ' + response.status);
    }

    var payload = await response.json();
    var pages = (payload && payload.query && payload.query.pages) || [];
    pages.sort(function (a, b) {
      var ai = a.index == null ? Number.MAX_SAFE_INTEGER : a.index;
      var bi = b.index == null ? Number.MAX_SAFE_INTEGER : b.index;
      return ai - bi;
    });
    for (var i = 0; i < pages.length; i++) {
      var result = normalizePage(pages[i]);
      if (result) {
        result.query = query;
        return result;
      }
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  buildSearchQuery,
  searchCommonsImage,
};
