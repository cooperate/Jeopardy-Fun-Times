'use strict';

const zlib = require('node:zlib');
const config = require('./config');

const DEFAULT_PACK_URL =
	'https://github.com/howardchung/j-archive-parser/raw/release/jeopardy.json.gz';

let cachedPackPromise = null;
let cachedPackUrl = null;

/**
 * Load the gzipped j-archive-parser JSON (same family of data as
 * https://github.com/howardchung/jeopardy/blob/master/server/jData.ts).
 */
function loadJeopardyPack() {
	var url =
		(config.jeopardyPackUrl && String(config.jeopardyPackUrl).trim()) ||
		DEFAULT_PACK_URL;
	if (cachedPackPromise && cachedPackUrl === url) {
		return cachedPackPromise;
	}
	cachedPackUrl = url;
	cachedPackPromise = fetch(url)
		.then(function (res) {
			if (!res.ok) {
				throw new Error('Jeopardy pack HTTP ' + res.status + ' ' + res.statusText);
			}
			return res.arrayBuffer();
		})
		.then(function (buf) {
			var json = zlib.gunzipSync(Buffer.from(buf)).toString('utf8');
			return JSON.parse(json);
		});
	return cachedPackPromise;
}

function clearJeopardyPackCache() {
	cachedPackPromise = null;
	cachedPackUrl = null;
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
	var m = html.match(/https?:\/\/[^"'\s>]+/i);
	return m ? m[0].trim() : '';
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
	loadJeopardyPack()
		.then(function (jData) {
			var keys = listCandidateKeys(jData, decade, infoFilter);
			if (!keys.length) {
				return cb(null, null);
			}
			shuffleInPlace(keys);
			var playedSet = {};
			for (var p = 0; p < playedGameIds.length; p++) {
				playedSet[String(playedGameIds[p])] = true;
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
								console.warn('j-archive import failed for', ek, impErr.message || impErr);
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
	clearJeopardyPackCache,
	DEFAULT_PACK_URL,
	decadeAirdatePrefix,
	selectPackEpisodeIntoDb,
	ensureJarchiveGamesTable,
};
