'use strict';

const ROUND_TIME = 480;
const MIN_PLAYERS_TO_START = 3;
/** How long players have to cast setup votes before the room tallies what it has. */
const OPTIONS_VOTE_TIMEOUT_MS = 30000;
const GAME_MODES = {
	standard: {
		id: 'standard',
		label: 'STANDARD JEOPARDY',
		minContestants: 3,
		maxContestants: 3,
		maxMembersPerContestant: 1,
	},
	team: {
		id: 'team',
		label: 'TEAM JEOPARDY',
		minContestants: 3,
		maxContestants: 3,
		maxMembersPerContestant: 2,
	},
	open: {
		id: 'open',
		label: 'OPEN JEOPARDY',
		minContestants: 3,
		maxContestants: 12,
		maxMembersPerContestant: 1,
	},
};
const MAX_PLAYERS_PER_ROOM = 12;

function normalizeGameMode(mode) {
	var key = String(mode || '').trim().toLowerCase();
	return GAME_MODES[key] ? key : 'standard';
}

function createGameRoom(roomCode, mode, hostToken) {
	var gameMode = normalizeGameMode(mode);
	return {
		code: roomCode,
		hostToken: String(hostToken || ''),
		hostSocketId: null,
		createdAt: Date.now(),
		lastActivityAt: Date.now(),
		mode: gameMode,
		modeConfig: GAME_MODES[gameMode],
		gameData: [],
		/** Scoreboard contestants, keyed by individual name or team name. */
		players: {},
		/** Connected identities per contestant: { [contestantName]: { [clientId]: memberName } }. */
		contestantMembers: {},
		/** Currently connected devices, keyed by persistent client id. */
		onlineClientIds: {},
		questions: {},
		curQuestionId: undefined,
		curActivePlayer: undefined,
		buzzerFlipped: false,
		buzzedInPlayerName: undefined,
		buzzedInMemberName: undefined,
		buzzedInClientId: undefined,
		lastPlayerBoardMarkup: '',
		categorySelectOpen: false,
		categoryAutoPickTimer: null,
		pendingGainedBoardOnCorrect: false,
		clueInProgress: false,
		playerBuzzerUnlocked: false,
		answerEvaluationInProgress: false,
		roundTimerObject: null,
		roundTimer: ROUND_TIME,
		answerTime: 15,
		decade: '20s',
		episodeFilter: 'any',
		airdate: '0',
		gameId: 0,
		questionTimer: null,
		questionTimerCount: 6,
		buzzedInTimer: null,
		buzzedInTimerCount: 15,
		dailyDoubleTimer: null,
		dailyDoubleTimerCount: 15,
		dailyDoubleResponderClientId: undefined,
		isSecondRound: false,
		finalJeopardyCheck: false,
		finalJeopardyWageringPhase: false,
		finalJeopardyAnswerPhase: false,
		finalJeopardyWagerTimer: null,
		finalJeopardyAnswerTimer: null,
		finalJeopardyAnswerEndsAt: 0,
		finalJeopardyAllWagersEmitted: false,
		finalJeopardyAnswerSubmitted: {},
		finalJeopardyResults: {},
		pendingHostForcedNewGame: false,
		/** Same shape as before: { playerName, bet } keyed by player name */
		finalJeopardyBet: {},
		newGameCounter: 0,
		gameState: { active: false },
		phase: 'lobby',
		playedClueIds: new Set(),
		playerJoinOrder: [],
		/** { [playerName]: { answerTime, decade, episodeFilter } } while voting */
		optionVotes: {},
		optionsVoteTimer: null,
		optionsVoteTickTimer: null,
		optionsVoteEndsAt: 0,
		/** Standard starts at three; Team/Open wait for the host to close registration. */
		setupVotingOpen: gameMode === 'standard',
		registrationClosed: false,
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
	normalizeGameMode,
	ROUND_TIME,
	OPTIONS_VOTE_TIMEOUT_MS,
	ROOM_CODE_CHARS,
	MIN_PLAYERS_TO_START,
	MAX_PLAYERS_PER_ROOM,
	GAME_MODES,
};
