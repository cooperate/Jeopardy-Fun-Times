'use strict';

function toInteger(value) {
	var n = Number(value);
	if (!Number.isFinite(n) || Math.floor(n) !== n) {
		return null;
	}
	return n;
}

function getDailyDoubleMax(score, questionId) {
	var parsedScore = toInteger(score);
	if (parsedScore == null) {
		parsedScore = 0;
	}
	var boardMaximum = String(questionId || '').indexOf('DJ_') === 0 ? 2000 : 1000;
	return Math.max(boardMaximum, parsedScore);
}

function validateDailyDoubleWager(value, score, questionId) {
	var wager = toInteger(value);
	var max = getDailyDoubleMax(score, questionId);
	if (wager == null) {
		return { valid: false, message: 'Wager must be a whole number.', max: max };
	}
	if (wager < 5) {
		return { valid: false, message: 'The minimum Daily Double wager is $5.', max: max };
	}
	if (wager > max) {
		return {
			valid: false,
			message: 'The maximum Daily Double wager is $' + max + '.',
			max: max,
		};
	}
	return { valid: true, wager: wager, max: max };
}

function getFinalJeopardyMax(score) {
	var parsedScore = toInteger(score);
	return parsedScore == null ? 0 : Math.max(0, parsedScore);
}

function validateFinalJeopardyWager(value, score) {
	var wager = toInteger(value);
	var max = getFinalJeopardyMax(score);
	if (wager == null) {
		return { valid: false, message: 'Wager must be a whole number.', max: max };
	}
	if (wager < 0 || wager > max) {
		return {
			valid: false,
			message: 'Final Jeopardy wager must be between $0 and $' + max + '.',
			max: max,
		};
	}
	return { valid: true, wager: wager, max: max };
}

function isValidAnswer(value) {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
}

module.exports = {
	toInteger,
	getDailyDoubleMax,
	validateDailyDoubleWager,
	getFinalJeopardyMax,
	validateFinalJeopardyWager,
	isValidAnswer,
};
