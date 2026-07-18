'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const jarchive = require('../lib/jarchiveDynamicGame');

function makeFullBoardRound(catPrefix) {
	var items = [];
	var y;
	var x;
	for (y = 0; y < 5; y++) {
		for (x = 0; x < 6; x++) {
			items.push({
				x: x,
				y: y,
				cat: catPrefix + ' ' + x,
				q: 'Q ' + catPrefix + ' ' + x + ' ' + y,
				a: 'A ' + x + ' ' + y,
				val: (y + 1) * 200,
			});
		}
	}
	return items;
}

describe('jarchiveDynamicGame pack loading', function () {
	var tmpDir;
	var packGz;

	before(function () {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarchive-test-'));
		packGz = path.join(tmpDir, 'pack.json.gz');
		var pack = {
			'1': {
				epNum: 1,
				airDate: '2019-01-01',
				jeopardy: makeFullBoardRound('J19'),
				double: makeFullBoardRound('D19'),
				final: [{ cat: 'FJ', q: 'fq', a: 'fa' }],
			},
			'2': {
				epNum: 2,
				airDate: '2021-06-15',
				jeopardy: makeFullBoardRound('J21'),
				double: makeFullBoardRound('D21'),
				final: [{ cat: 'FJ', q: 'fq', a: 'fa' }],
			},
			'3': {
				epNum: 3,
				airDate: '2022-03-01',
				info: 'Teen Tournament',
				jeopardy: makeFullBoardRound('J22'),
				double: makeFullBoardRound('D22'),
				final: [{ cat: 'FJ', q: 'fq', a: 'fa' }],
			},
		};
		fs.writeFileSync(packGz, zlib.gzipSync(JSON.stringify(pack)));
	});

	after(function () {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		jarchive.clearJeopardyPackCache();
	});

	it('extractDecadeFromPackFile keeps only the requested decade', async function () {
		var subset = await jarchive.extractDecadeFromPackFile(packGz, '20s');
		assert.equal(Object.keys(subset).length, 2);
		assert.ok(subset['2']);
		assert.ok(subset['3']);
		assert.equal(subset['1'], undefined);
	});

	it('listCandidateKeys filters by decade and tournament info', function () {
		var data = {
			a: {
				airDate: '2021-01-01',
				jeopardy: makeFullBoardRound('J'),
				double: makeFullBoardRound('D'),
				final: [{ cat: 'FJ', q: 'q', a: 'a' }],
			},
			b: {
				airDate: '2021-01-02',
				info: 'Teen Tournament',
				jeopardy: makeFullBoardRound('J'),
				double: makeFullBoardRound('D'),
				final: [{ cat: 'FJ', q: 'q', a: 'a' }],
			},
			c: {
				airDate: '2011-01-01',
				jeopardy: makeFullBoardRound('J'),
				double: makeFullBoardRound('D'),
				final: [{ cat: 'FJ', q: 'q', a: 'a' }],
			},
		};
		assert.deepEqual(jarchive.listCandidateKeys(data, '20s', 'any').sort(), [
			'a',
			'b',
		]);
		assert.deepEqual(jarchive.listCandidateKeys(data, '20s', 'Teen Tournament'), [
			'b',
		]);
		assert.deepEqual(jarchive.listCandidateKeys(data, '10s', 'any'), ['c']);
	});
});
