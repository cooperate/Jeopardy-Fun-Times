'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { streamObject } = require('stream-json/streamers/stream-object.js');
const config = require('./config');

const DEFAULT_PACK_URL =
	'https://github.com/howardchung/j-archive-parser/raw/release/jeopardy.json.gz';

/** In-memory decade subsets only (never the full ~95MB pack). */
var cachedDecadePromise = null;
var cachedDecadeKey = null;

/**
 * Load the gzipped j-archive-parser JSON (same family of data as
 * https://github.com/howardchung/jeopardy/blob/master/server/jData.ts).
 *
 * IMPORTANT: Never JSON.parse the full pack in this process. On small hosts
 * (e.g. Render free 512MB) that peaks near ~600MB RSS and OOM-kills Node,
 * wiping in-memory game rooms. We stream-download to disk, then stream-extract
 * only the requested decade into a smaller cache (~160MB peak for 2020s).
 */
function packUrl() {
	return (
		(config.jeopardyPackUrl && String(config.jeopardyPackUrl).trim()) ||
		DEFAULT_PACK_URL
	);
}

function decadeCacheDir() {
	return (
		(config.paths && config.paths.jarchiveCacheDir) ||
		path.join(config.root, 'data', 'jarchive-cache')
	);
}

function decadeCachePath(decade) {
	return path.join(decadeCacheDir(), String(decade || '20s') + '.json.gz');
}

function fullPackTempPath() {
	return path.join(decadeCacheDir(), '_full-pack.json.gz');
}

function clearJeopardyPackCache() {
	cachedDecadePromise = null;
	cachedDecadeKey = null;
}

function ensureCacheDir() {
	return fsp.mkdir(decadeCacheDir(), { recursive: true });
}

function readDecadeCacheFile(decade) {
	var file = decadeCachePath(decade);
	return fsp
		.readFile(file)
		.then(function (gz) {
			var json = zlib.gunzipSync(gz).toString('utf8');
			return JSON.parse(json);
		})
		.catch(function (err) {
			if (err && err.code === 'ENOENT') {
				return null;
			}
			throw err;
		});
}

function writeDecadeCacheFile(decade, subset) {
	var file = decadeCachePath(decade);
	var gz = zlib.gzipSync(Buffer.from(JSON.stringify(subset), 'utf8'), {
		level: 6,
	});
	return fsp.writeFile(file, gz);
}

/**
 * Stream download the full pack to disk (low memory). Reuses existing temp file
 * when present and non-empty.
 */
function downloadFullPackToDisk() {
	var dest = fullPackTempPath();
	return ensureCacheDir().then(function () {
		return fsp.stat(dest).then(
			function (st) {
				if (st.isFile() && st.size > 1000000) {
					return dest;
				}
				return fetchAndWritePack(dest);
			},
			function () {
				return fetchAndWritePack(dest);
			}
		);
	});
}

function fetchAndWritePack(dest) {
	var url = packUrl();
	var controller = new AbortController();
	var timeout = setTimeout(function () {
		controller.abort();
	}, 120000);
	var partial = dest + '.partial';
	return fetch(url, { signal: controller.signal })
		.then(function (res) {
			if (!res.ok) {
				throw new Error(
					'Jeopardy pack HTTP ' + res.status + ' ' + res.statusText
				);
			}
			if (!res.body) {
				throw new Error('Jeopardy pack response missing body');
			}
			return new Promise(function (resolve, reject) {
				var out = fs.createWriteStream(partial);
				var nodeStream = require('node:stream').Readable.fromWeb(res.body);
				nodeStream.pipe(out);
				nodeStream.on('error', reject);
				out.on('error', reject);
				out.on('finish', function () {
					resolve();
				});
			});
		})
		.then(function () {
			clearTimeout(timeout);
			return fsp.rename(partial, dest).then(function () {
				return dest;
			});
		})
		.catch(function (err) {
			clearTimeout(timeout);
			return fsp.unlink(partial).catch(function () {}).then(function () {
				throw err;
			});
		});
}

/**
 * Stream-gunzip the on-disk pack and keep only episodes for one decade.
 */
function extractDecadeFromPackFile(gzPath, decade) {
	var prefix = decadeAirdatePrefix(decade);
	var subset = {};
	return new Promise(function (resolve, reject) {
		var pipeline = chain([
			fs.createReadStream(gzPath),
			zlib.createGunzip(),
			parser(),
			streamObject(),
		]);
		pipeline.on('data', function (row) {
			var ep = row && row.value;
			if (ep && String(ep.airDate || '').indexOf(prefix) === 0) {
				subset[row.key] = ep;
			}
		});
		pipeline.on('error', reject);
		pipeline.on('end', function () {
			resolve(subset);
		});
	});
}

/**
 * Returns a decade-filtered episode map (object keyed like the upstream pack).
 */
function loadDecadePack(decade) {
	var dec = String(decade || '20s');
	var url = packUrl();
	var cacheKey = url + '|' + dec;
	if (cachedDecadePromise && cachedDecadeKey === cacheKey) {
		return cachedDecadePromise;
	}
	cachedDecadeKey = cacheKey;
	cachedDecadePromise = readDecadeCacheFile(dec)
		.then(function (cached) {
			if (cached && typeof cached === 'object') {
				return cached;
			}
			console.log(
				'Jeopardy pack: building decade cache for ' +
					dec +
					' (stream extract; avoids loading full pack into RAM)…'
			);
			return downloadFullPackToDisk().then(function (gzPath) {
				return extractDecadeFromPackFile(gzPath, dec).then(function (subset) {
					return writeDecadeCacheFile(dec, subset).then(function () {
						console.log(
							'Jeopardy pack: cached ' +
								Object.keys(subset).length +
								' episodes for decade ' +
								dec
						);
						return subset;
					});
				});
			});
		})
		.catch(function (err) {
			cachedDecadePromise = null;
			cachedDecadeKey = null;
			throw err;
		});
	return cachedDecadePromise;
}

/** @deprecated Prefer loadDecadePack — kept for tests/tools that expect the name. */
function loadJeopardyPack() {
	return loadDecadePack('20s');
}

function decadeAirdatePrefix(decade) {
	switch (decade) {
		case '80s':
			return '198';
		case '90s':
			return '199';
		case '00s':
			return '200';
		case '10s':
			return '201';
		case '20s':
			return '202';
		default:
			return '202';
	}
}

function episodeKeyFromEpisode(ep) {
	var num = ep.epNum != null ? String(ep.epNum) : '';
	var ad = ep.airDate || '';
	return num + '|' + ad;
}

function extractMedia(html) {
	if (!html || typeof html !== 'string') {
		return '';
	}
	var abs = html.match(
		/https?:\/\/[^"'\s>]+\.(?:jpe?g|png|gif|webp|bmp|mp3|wav|aiff|m4a|ogg|mp4|webm|mov|wmv)(?:\?[^"'\s>]*)?/i
	);
	if (abs) {
		return abs[0].trim();
	}
	var attr = html.match(
		/(?:src|href)=["']([^"']+\.(?:jpe?g|png|gif|webp|bmp|mp3|wav|aiff|m4a|ogg|mp4|webm|mov|wmv)[^"']*)["']/i
	);
	if (attr && attr[1]) {
		var u = attr[1].trim();
		if (/^https?:\/\//i.test(u)) {
			return u;
		}
		if (u.indexOf('//') === 0) {
			return 'https:' + u;
		}
		u = u.replace(/^\//, '');
		if (/^media\//i.test(u) || /j-archive\.com/i.test(u)) {
			return 'https://www.j-archive.com/' + u.replace(/^https?:\/\/[^/]+\//i, '');
		}
		return 'https://www.j-archive.com/' + u;
	}
	return '';
}

function normalizeValue(v) {
	if (typeof v === 'number' && !isNaN(v)) {
		return v;
	}
	if (typeof v === 'string') {
		var n = parseInt(String(v).replace(/,/g, ''), 10);
		return isNaN(n) ? 0 : n;
	}
	return 0;
}

/**
 * Rows: $200 left-to-right, then $400, etc. Matches setGameDataNew in app.js, which maps
 * consecutive clue ids to J_col_row in that order. Column-major order (x then y) scrambles categories.
 */
function sortGridRowMajor(items) {
	return items.slice().sort(function (a, b) {
		var ay = a.y || 0;
		var by = b.y || 0;
		if (ay !== by) {
			return ay - by;
		}
		var ax = a.x || 0;
		var bx = b.x || 0;
		return ax - bx;
	});
}

function shuffleInPlace(arr) {
	var i = arr.length;
	while (i > 1) {
		i--;
		var j = Math.floor(Math.random() * (i + 1));
		var t = arr[i];
		arr[i] = arr[j];
		arr[j] = t;
	}
	return arr;
}

/** Build list of pack keys for episodes that match decade + tournament filter and full board. */
function listCandidateKeys(jData, decade, infoFilter) {
	var prefix = decadeAirdatePrefix(decade);
	var keys = Object.keys(jData || {});
	var out = [];
	for (var i = 0; i < keys.length; i++) {
		var ep = jData[keys[i]];
		if (!ep || !ep.airDate) {
			continue;
		}
		if (String(ep.airDate).indexOf(prefix) !== 0) {
			continue;
		}
		if (infoFilter && infoFilter !== 'any' && ep.info !== infoFilter) {
			continue;
		}
		var lj = (ep.jeopardy || []).length;
		var ld = (ep.double || []).length + (ep.triple || []).length;
		var lf = (ep.final || []).length;
		if (lj < 30 || ld < 30 || lf < 1) {
			continue;
		}
		out.push(keys[i]);
	}
	return out;
}

function flattenEpisode(ep) {
	var j = sortGridRowMajor((ep.jeopardy || []).slice(0, 30));
	var mergedDouble = (ep.double || []).concat(ep.triple || []);
	var d = sortGridRowMajor(mergedDouble.slice(0, 30));
	var fArr = ep.final || [];
	if (j.length < 30 || d.length < 30 || fArr.length < 1) {
		return null;
	}
	var fj = fArr[0];
	var flat = [];
	var idx;
	for (idx = 0; idx < j.length; idx++) {
		var cj = j[idx];
		flat.push({
			round: 1,
			category: cj.cat || '',
			clue: cj.q || '',
			answer: cj.a || '',
			media: extractMedia(cj.q || ''),
			value: normalizeValue(cj.val),
		});
	}
	for (idx = 0; idx < d.length; idx++) {
		var cd = d[idx];
		flat.push({
			round: 2,
			category: cd.cat || '',
			clue: cd.q || '',
			answer: cd.a || '',
			media: extractMedia(cd.q || ''),
			value: normalizeValue(cd.val),
		});
	}
	flat.push({
		round: 3,
		category: fj.cat || 'FINAL JEOPARDY',
		clue: fj.q || '',
		answer: fj.a || '',
		media: extractMedia(fj.q || ''),
		value: 0,
	});
	return flat.length === 61 ? flat : null;
}

function ensureJarchiveGamesTable(db, cb) {
	db.run(
		'CREATE TABLE IF NOT EXISTS jarchive_games (\n' +
			'\tepisode_key TEXT PRIMARY KEY NOT NULL,\n' +
			'\tgame INTEGER NOT NULL UNIQUE,\n' +
			"\timported_at TEXT DEFAULT (datetime('now'))\n" +
			')',
		cb
	);
}

function getOrCreateCategoryId(db, categoryName, cb) {
	var name = String(categoryName || '').trim() || 'GENERAL';
	db.get('SELECT id FROM categories WHERE category = ?', [name], function (err, row) {
		if (err) {
			return cb(err);
		}
		if (row) {
			return cb(null, row.id);
		}
		db.run('INSERT INTO categories (category) VALUES (?)', [name], function (insErr) {
			if (insErr) {
				return cb(insErr);
			}
			cb(null, this.lastID);
		});
	});
}

function importFlatClues(db, flat, airdate, episodeKey, cb) {
	db.get(
		'SELECT COALESCE(MAX(game), 0) + 1 AS g FROM airdates',
		function (err, row) {
			if (err) {
				return cb(err);
			}
			var gameId = row.g;
			var clueIndex = 0;

			function rollbackAndCb(origErr) {
				db.run('ROLLBACK', function () {
					cb(origErr);
				});
			}

			db.run('BEGIN', function (begErr) {
				if (begErr) {
					return cb(begErr);
				}
				db.run(
					'INSERT INTO airdates (game, airdate) VALUES (?, ?)',
					[gameId, airdate],
					function (adErr) {
						if (adErr) {
							return rollbackAndCb(adErr);
						}

						function insertOne() {
							if (clueIndex >= flat.length) {
								db.run(
									'INSERT INTO jarchive_games (episode_key, game) VALUES (?, ?)',
									[episodeKey, gameId],
									function (jkErr) {
										if (jkErr) {
											return rollbackAndCb(jkErr);
										}
										db.run('COMMIT', function (comErr) {
											if (comErr) {
												return cb(comErr);
											}
											cb(null, { game: gameId, airdate: airdate });
										});
									}
								);
								return;
							}

							var row = flat[clueIndex];
							db.run(
								'INSERT INTO documents (clue, answer, media) VALUES (?, ?, ?)',
								[row.clue, row.answer, row.media],
								function (docErr) {
									if (docErr) {
										return rollbackAndCb(docErr);
									}
									var clueId = this.lastID;
									db.run(
										'INSERT INTO clues (id, game, round, value) VALUES (?, ?, ?, ?)',
										[clueId, gameId, row.round, row.value],
										function (clErr) {
											if (clErr) {
												return rollbackAndCb(clErr);
											}
											getOrCreateCategoryId(db, row.category, function (catErr, catId) {
												if (catErr) {
													return rollbackAndCb(catErr);
												}
												db.run(
													'INSERT INTO classifications (clue_id, category_id) VALUES (?, ?)',
													[clueId, catId],
													function (cfErr) {
														if (cfErr) {
															return rollbackAndCb(cfErr);
														}
														clueIndex++;
														insertOne();
													}
												);
											});
										}
									);
								}
							);
						}

						insertOne();
					}
				);
			});
		}
	);
}

/**
 * If episode already imported, returns existing game id; otherwise inserts 61 rows.
 */
function ensureEpisodeInDb(db, ep, episodeKey, cb) {
	ensureJarchiveGamesTable(db, function (tErr) {
		if (tErr) {
			return cb(tErr);
		}
		db.get(
			'SELECT game FROM jarchive_games WHERE episode_key = ?',
			[episodeKey],
			function (err, row) {
				if (err) {
					return cb(err);
				}
				if (row) {
					db.get(
						'SELECT airdate FROM airdates WHERE game = ?',
						[row.game],
						function (e2, ar) {
							if (e2) {
								return cb(e2);
							}
							cb(null, {
								game: row.game,
								airdate: ar && ar.airdate ? ar.airdate : ep.airDate,
							});
						}
					);
					return;
				}
				var flat = flattenEpisode(ep);
				if (!flat) {
					return cb(new Error('episode_not_flattenable'));
				}
				importFlatClues(db, flat, ep.airDate, episodeKey, cb);
			}
		);
	});
}

/**
 * Pick an episode from the pack (decade + optional info filter), reuse DB row if present,
 * import if missing. Skips games whose numeric id is in playedGameIds.
 */
function selectPackEpisodeIntoDb(db, decade, infoFilter, playedGameIds, cb) {
	ensureJarchiveGamesTable(db, function (tableErr) {
		if (tableErr) {
			return cb(tableErr);
		}
		loadDecadePack(decade)
			.then(function (jData) {
				var keys = listCandidateKeys(jData, decade, infoFilter);
				if (!keys.length) {
					return cb(null, null);
				}
				shuffleInPlace(keys);
				var playedSet = {};
				var played = playedGameIds || [];
				for (var p = 0; p < played.length; p++) {
					playedSet[String(played[p])] = true;
				}

				var i = 0;
				function tryNext() {
					if (i >= keys.length) {
						return cb(null, null);
					}
					var k = keys[i++];
					var ep = jData[k];
					if (!ep) {
						return tryNext();
					}
					var ek = episodeKeyFromEpisode(ep);
					db.get(
						'SELECT game FROM jarchive_games WHERE episode_key = ?',
						[ek],
						function (err, row) {
							if (err) {
								return cb(err);
							}
							if (row && playedSet[String(row.game)]) {
								return tryNext();
							}
							if (row) {
								return db.get(
									'SELECT airdate FROM airdates WHERE game = ?',
									[row.game],
									function (e2, ar) {
										if (e2) {
											return cb(e2);
										}
										cb(null, {
											game: row.game,
											airdate: ar && ar.airdate ? ar.airdate : ep.airDate,
										});
									}
								);
							}
							ensureEpisodeInDb(db, ep, ek, function (impErr, res) {
								if (impErr) {
									console.warn(
										'j-archive import failed for',
										ek,
										impErr.message || impErr
									);
									return tryNext();
								}
								cb(null, res);
							});
						}
					);
				}
				tryNext();
			})
			.catch(function (e) {
				cb(e);
			});
	});
}

module.exports = {
	loadJeopardyPack,
	loadDecadePack,
	clearJeopardyPackCache,
	DEFAULT_PACK_URL,
	decadeAirdatePrefix,
	listCandidateKeys,
	selectPackEpisodeIntoDb,
	ensureJarchiveGamesTable,
	decadeCachePath,
	extractDecadeFromPackFile,
};
