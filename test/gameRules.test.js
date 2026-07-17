'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	getDailyDoubleMax,
	validateDailyDoubleWager,
	getFinalJeopardyMax,
	validateFinalJeopardyWager,
	isValidAnswer,
} = require('../lib/gameRules');

test('Daily Double maximum follows the round and score', function () {
	assert.equal(getDailyDoubleMax(200, 'J_0_0'), 1000);
	assert.equal(getDailyDoubleMax(200, 'DJ_0_0'), 2000);
	assert.equal(getDailyDoubleMax(3200, 'DJ_0_0'), 3200);
});

test('Daily Double wager requires a bounded whole number', function () {
	assert.equal(validateDailyDoubleWager(5, 0, 'J_0_0').valid, true);
	assert.equal(validateDailyDoubleWager(2000, 100, 'DJ_0_0').valid, true);
	assert.equal(validateDailyDoubleWager(4, 100, 'J_0_0').valid, false);
	assert.equal(validateDailyDoubleWager(1001, 100, 'J_0_0').valid, false);
	assert.equal(validateDailyDoubleWager('10.5', 100, 'J_0_0').valid, false);
});

test('Final Jeopardy maximum never exceeds a positive score', function () {
	assert.equal(getFinalJeopardyMax(2400), 2400);
	assert.equal(getFinalJeopardyMax(0), 0);
	assert.equal(getFinalJeopardyMax(-200), 0);
	assert.equal(validateFinalJeopardyWager(2401, 2400).valid, false);
	assert.equal(validateFinalJeopardyWager(0, -200).valid, true);
});

test('answers must be non-empty bounded strings', function () {
	assert.equal(isValidAnswer('What is Paris?'), true);
	assert.equal(isValidAnswer('   '), false);
	assert.equal(isValidAnswer({ answer: 'Paris' }), false);
	assert.equal(isValidAnswer('x'.repeat(501)), false);
});
