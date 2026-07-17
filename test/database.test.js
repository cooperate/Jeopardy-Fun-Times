'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

function openReadonlyDatabase() {
	return new sqlite3.Database(
		path.join(__dirname, '..', 'data', 'clues.db'),
		sqlite3.OPEN_READONLY
	);
}

function get(db, sql, params) {
	return new Promise(function (resolve, reject) {
		db.get(sql, params || [], function (err, row) {
			if (err) {
				reject(err);
				return;
			}
			resolve(row);
		});
	});
}

test('clue database contains complete playable episodes', async function (t) {
	var db = openReadonlyDatabase();
	t.after(function () {
		db.close();
	});
	var totals = await get(
		db,
		'SELECT COUNT(*) AS games FROM (' +
			'SELECT game FROM clues GROUP BY game HAVING COUNT(id) = 61' +
			')'
	);
	assert.ok(totals.games > 0);
	var sample = await get(
		db,
		'SELECT clues.game, COUNT(*) AS joined_rows ' +
			'FROM clues ' +
			'JOIN documents ON clues.id = documents.id ' +
			'JOIN classifications ON clues.id = classifications.clue_id ' +
			'JOIN categories ON classifications.category_id = categories.id ' +
			'GROUP BY clues.game HAVING COUNT(*) = 61 LIMIT 1'
	);
	assert.ok(sample);
	assert.equal(sample.joined_rows, 61);
});
