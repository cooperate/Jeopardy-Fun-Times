'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	createGameRoom,
	normalizeRoomCode,
	normalizeGameMode,
	ROUND_TIME,
} = require('../lib/gameRoom');
const { parseAnswer, parseMediaType } = require('../lib/parsers');

test('room creation keeps host ownership and authoritative defaults', function () {
	var room = createGameRoom('AB12', 'open', 'secret-token');
	assert.equal(room.code, 'AB12');
	assert.equal(room.hostToken, 'secret-token');
	assert.equal(room.hostSocketId, null);
	assert.equal(room.roundTimer, ROUND_TIME);
	assert.equal(room.phase, 'lobby');
	assert.equal(room.modeConfig.maxContestants, 12);
});

test('room and mode normalization reject unsupported characters and modes', function () {
	assert.equal(normalizeRoomCode(' ab-12! '), 'AB12');
	assert.equal(normalizeGameMode('TEAM'), 'team');
	assert.equal(normalizeGameMode('unsupported'), 'standard');
});

test('answer parser is total over null and strips common wrappers', function () {
	assert.equal(parseAnswer(null), '');
	assert.equal(parseAnswer('"The Eiffel Tower"'), 'EIFFEL TOWER');
	assert.equal(parseAnswer('An apple (fruit)'), 'APPLE');
});

test('media parser recognizes supported browser formats', function () {
	assert.equal(parseMediaType('https://example.test/image.webp?x=1'), 'image');
	assert.equal(parseMediaType('/media/clip.mp4'), 'video_mp4');
	assert.equal(parseMediaType('/media/clip.ogg'), 'audio');
	assert.equal(parseMediaType(''), 'none');
});
