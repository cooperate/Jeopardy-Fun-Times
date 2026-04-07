'use strict';

const ROUND_TIME = 600;

function createGameRoom(roomCode) {
	return {
		code: roomCode,
		gameData: [],
		players: {},
		questions: {},
		curQuestionId: undefined,
		curActivePlayer: undefined,
		buzzerFlipped: false,
		buzzedInPlayerName: undefined,
		lastPlayerBoardMarkup: '',
		categorySelectOpen: false,
		clueInProgress: false,
		playerBuzzerUnlocked: false,
		roundTimerObject: null,
		roundTimer: ROUND_TIME,
		answerTime: 15,
		decade: '10s',
		airdate: '0',
		gameId: 0,
		questionTimer: null,
		questionTimerCount: 6,
		buzzedInTimer: null,
		buzzedInTimerCount: 15,
		dailyDoubleTimer: null,
		dailyDoubleTimerCount: 15,
		isSecondRound: false,
		finalJeopardyCheck: false,
		finalJeopardyWageringPhase: false,
		finalJeopardyAnswerPhase: false,
		pendingHostForcedNewGame: false,
		/** Same shape as before: { playerName, bet } keyed by player name */
		finalJeopardyBet: {},
		newGameCounter: 0,
		gameState: { active: false },
		playedClueIds: new Set(),
		playerJoinOrder: [],
		hostGameOptionsSelected: false,
		somecounter: 0,
	};
}

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(length, chars) {
	var result = '';
	for (var i = length; i > 0; --i) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
}

function normalizeRoomCode(s) {
	return String(s || '')
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '');
}

function generateUniqueRoomCode(roomsMap) {
	var code;
	var guard = 0;
	do {
		code = randomString(4, ROOM_CODE_CHARS);
		guard++;
		if (guard > 500) {
			code = randomString(6, ROOM_CODE_CHARS);
			break;
		}
	} while (roomsMap.has(code));
	return code;
}

module.exports = {
	createGameRoom,
	normalizeRoomCode,
	generateUniqueRoomCode,
	ROUND_TIME,
	ROOM_CODE_CHARS,
};
