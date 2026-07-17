//TODO: buzzing in immediately when question opens causes question timer to go down/question repeat
//ipads getting blocked out of answering

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const namor = require('namor');
const config = require('./lib/config');
const { ensureGameHighScoreFile } = require('./lib/ensureDataFiles');
const { Player, Question } = require('./lib/models');
const { parseMediaType, parseAnswer } = require('./lib/parsers');
const { evaluateAnswer } = require('./lib/evaluateAnswer');
const { searchCommonsImage } = require('./lib/wikimediaImageSearch');
const {
	validateDailyDoubleWager,
	validateFinalJeopardyWager,
	isValidAnswer,
} = require('./lib/gameRules');
const {
	createGameRoom,
	normalizeRoomCode: normRoom,
	generateUniqueRoomCode,
	normalizeGameMode,
	ROUND_TIME,
	OPTIONS_VOTE_TIMEOUT_MS,
} = require('./lib/gameRoom');
const jarchiveDynamic = require('./lib/jarchiveDynamicGame');

ensureGameHighScoreFile(config.paths.gameHighScore);

/** code (uppercase) -> per-room game state */
var gameRooms = new Map();

/** How long players have to submit a Final Jeopardy wager before defaults are applied. */
var FINAL_JEOPARDY_WAGER_TIMEOUT_MS = 45000;
var FINAL_JEOPARDY_ANSWER_TIMEOUT_MS = 32500;
var ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000;

function createHostToken() {
	return crypto.randomBytes(32).toString('base64url');
}

function safeTokenEqual(expected, actual) {
	var a = Buffer.from(String(expected || ''));
	var b = Buffer.from(String(actual || ''));
	return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function touchRoom(room) {
	if (room) {
		room.lastActivityAt = Date.now();
	}
}

function clearFinalJeopardyWagerTimer(room) {
	if (room && room.finalJeopardyWagerTimer) {
		clearTimeout(room.finalJeopardyWagerTimer);
		room.finalJeopardyWagerTimer = null;
	}
}

function allPlayersHaveFinalJeopardyBet(room) {
	for (var playerName in room.players) {
		if (!room.finalJeopardyBet[playerName]) {
			return false;
		}
	}
	return Object.keys(room.players).length > 0;
}

function collectFinalJeopardyBetsPayload(room) {
	var bets = [];
	var playerName;
	for (playerName in room.finalJeopardyBet) {
		if (!Object.prototype.hasOwnProperty.call(room.finalJeopardyBet, playerName)) {
			continue;
		}
		bets.push({
			playerName: playerName,
			bet: room.finalJeopardyBet[playerName].bet,
		});
	}
	return bets;
}

function maybeEmitAllFinalJeopardyWagersReady(room, force) {
	if (!room.finalJeopardyWageringPhase || room.finalJeopardyAnswerPhase) {
		return false;
	}
	if (!allPlayersHaveFinalJeopardyBet(room)) {
		return false;
	}
	if (room.finalJeopardyAllWagersEmitted && !force) {
		return false;
	}
	room.finalJeopardyAllWagersEmitted = true;
	clearFinalJeopardyWagerTimer(room);
	var bets = collectFinalJeopardyBetsPayload(room);
	emitGame(room.code, 'final jeopardy all wagers ready', { bets: bets });
	emitPlayers(room.code, 'final jeopardy all wagers ready');
	return true;
}

function syncFinalJeopardyWagersToHost(room) {
	var bets = collectFinalJeopardyBetsPayload(room);
	if (bets.length) {
		emitGame(room.code, 'final jeopardy wagers sync', { bets: bets });
	}
	maybeEmitAllFinalJeopardyWagersReady(room, true);
}

function defaultMissingFinalJeopardyWagers(room) {
	room.finalJeopardyWagerTimer = null;
	if (!room.finalJeopardyWageringPhase || room.finalJeopardyAnswerPhase) {
		return;
	}
	var missing = false;
	for (var playerName in room.players) {
		if (room.finalJeopardyBet[playerName]) {
			continue;
		}
		missing = true;
		room.finalJeopardyBet[playerName] = {
			playerName: playerName,
			bet: 0,
			autoDefaulted: true,
		};
		emitGame(room.code, 'final jeopardy response', {
			playerName: playerName,
			bet: 0,
		});
	}
	if (missing) {
		emitPlayers(room.code, 'final jeopardy wager timed out');
	}
	maybeEmitAllFinalJeopardyWagersReady(room, true);
}

function scoreMissingFinalJeopardyAnswer(room, playerName) {
	var fb = room.finalJeopardyBet[playerName];
	var player = room.players[playerName];
	if (!fb || !player || fb.scored || room.finalJeopardyAnswerSubmitted[playerName]) {
		return false;
	}
	fb.scored = true;
	var bet = parseInt(fb.bet, 10);
	if (isNaN(bet)) {
		bet = 0;
	}
	player.score -= bet;
	var result = {
		playerName: playerName,
		score: player.score,
		correct: false,
		answer: '',
		buzzedInFJ: false,
	};
	room.finalJeopardyResults[playerName] = result;
	emitGame(room.code, 'score update final jeopardy buzzed out', result);
	emitPlayers(room.code, 'score update', {
		score: player.score,
		playerName: playerName,
		correct: false,
		finalJeopardy: true,
	});
	return true;
}

function finishFinalJeopardyAnswerPhase(room) {
	if (!room || (!room.finalJeopardyAnswerPhase && room.phase !== 'final-answer')) {
		return;
	}
	if (room.finalJeopardyAnswerTimer) {
		clearTimeout(room.finalJeopardyAnswerTimer);
		room.finalJeopardyAnswerTimer = null;
	}
	room.finalJeopardyAnswerEndsAt = 0;
	room.finalJeopardyAnswerPhase = false;
	room.phase = 'final-scoring';
	for (var playerName in room.players) {
		scoreMissingFinalJeopardyAnswer(room, playerName);
	}
	emitPlayers(room.code, 'final jeopardy time out');
	emitGame(room.code, 'final jeopardy scoring ready');
}

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

// Browsers request /favicon.ico by default; serve project SVG so there is no 404.
app.get('/favicon.ico', function (req, res) {
	res.type('image/svg+xml');
	res.sendFile(path.join(__dirname, 'favicon.svg'));
});

app.use('/css', express.static(path.join(__dirname, 'css'), { dotfiles: 'deny' }));
app.use(
	'/javascript',
	express.static(path.join(__dirname, 'javascript'), { dotfiles: 'deny' })
);
app.use(
	'/game-media',
	express.static(path.join(__dirname, 'game-media'), { dotfiles: 'deny' })
);
app.use(
	'/temp-media',
	express.static(path.join(__dirname, 'temp-media'), { dotfiles: 'deny' })
);
app.get('/favicon.svg', function (req, res) {
	res.type('image/svg+xml');
	res.sendFile(path.join(__dirname, 'favicon.svg'));
});

app.get('/', function (req, res) {
	res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/korinna-fonts.css">
  <title>Jeopardy — start here</title>
  <style>
    body { font-family: 'Korinna', sans-serif; text-shadow: none; max-width: 32rem; margin: 2.5rem auto; padding: 0 1.25rem; line-height: 1.55; color: #1a1a1a; }
    h1 { font-size: 1.35rem; font-weight: 700; }
    ul { padding-left: 1.1rem; }
    li { margin: 0.6rem 0; }
    a { color: #0d47a1; }
    code { background: #f0f0f0; padding: 0.1rem 0.35rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Jeopardy</h1>
  <p>Open these URLs in the browser (same machine or same LAN, depending on how you run the server).</p>
  <ul>
    <li><strong>Host</strong>: <a href="/game"><code>/game</code></a> — create a room or enter a code; you are sent to <code>/game/ROOM</code> for the board.</li>
    <li><strong>Players</strong>: <a href="/home"><code>/home</code></a> to enter the room code, or open <code>/player?room=ROOM</code> directly. Standard supports 3 players, Team supports 3 teams of up to 2, and Open supports 3–12 players.</li>
  </ul>
  <p>Start the server with <code>npm start</code> (or <code>node app.js</code>), then use the links above.</p>
</body>
</html>`);
});

app.get('/home', function(req, res){
  	//res.sendFile(__dirname + '/index.html');
  	res.sendFile(__dirname + '/html/game_select.html');
});

app.get('/game', function (req, res) {
	res.sendFile(__dirname + '/html/game_host_lobby.html');
});

app.get('/game/:roomCode', function (req, res) {
	var code = normRoom(req.params.roomCode);
	if (!code || !gameRooms.has(code)) {
		return res.redirect('/game');
	}
	res.sendFile(__dirname + '/html/index.html');
});

var roomCreationWindows = new Map();
app.post('/api/rooms/new', function (req, res) {
	var ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
	var now = Date.now();
	var recent = (roomCreationWindows.get(ip) || []).filter(function (time) {
		return now - time < 60000;
	});
	if (recent.length >= 10) {
		return res.status(429).json({ error: 'Too many rooms created. Try again shortly.' });
	}
	recent.push(now);
	roomCreationWindows.set(ip, recent);
	var code = generateUniqueRoomCode(gameRooms);
	var mode = normalizeGameMode(req.query.mode);
	var hostToken = createHostToken();
	gameRooms.set(code, createGameRoom(code, mode, hostToken));
	res.set('Cache-Control', 'no-store');
	res.json({ roomCode: code, mode: mode, hostToken: hostToken });
});

app.get('/player', function (req, res) {
	res.sendFile(__dirname + '/html/player_field.html');
});


//select socket
var playerSelect = io.of('/home');

//game socket
var gameSpc = io.of('/game');

//player socket
var playerSpc = io.of('/player');

function ioRoomName(code) {
	return 'jr-' + code;
}
function emitGame(code, event, data) {
	gameSpc.to(ioRoomName(code)).emit(event, data);
}
function emitPlayers(code, event, data) {
	playerSpc.to(ioRoomName(code)).emit(event, data);
}
function publicBaseUrlForSocket(socket) {
	if (config.publicBaseUrl) {
		return String(config.publicBaseUrl).replace(/\/+$/, '');
	}
	var headers = (socket && socket.handshake && socket.handshake.headers) || {};
	var host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
	var proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim();
	if (!proto) {
		proto = socket && socket.handshake && socket.handshake.secure ? 'https' : 'http';
	}
	if (!host) {
		host = 'localhost:' + config.port;
	}
	return proto + '://' + host;
}
function buildTeamSelectionState(room) {
	if (!room || room.mode !== 'team') {
		return { teams: [], registrationClosed: true };
	}
	return {
		teams: room.playerJoinOrder
			.filter(function (name) {
				return !!room.players[name];
			})
			.map(function (name) {
				var memberCount = Object.keys(room.contestantMembers[name] || {}).length;
				return {
					name: name,
					memberCount: memberCount,
					maxMembers: room.modeConfig.maxMembersPerContestant,
					available: memberCount < room.modeConfig.maxMembersPerContestant,
				};
			}),
		registrationClosed: room.registrationClosed || room.gameState.active === true,
		canCreate:
			!room.registrationClosed &&
			room.gameState.active !== true &&
			objectLength(room.players) < room.modeConfig.maxContestants,
	};
}
function generateUniqueTeamName(room) {
	for (var attempt = 0; attempt < 100; attempt++) {
		var generated = String(namor.generate({ words: 2, separator: '-' }) || '')
			.replace(/-/g, ' ')
			.trim()
			.toUpperCase();
		if (generated && generated.length <= 24 && !room.players[generated]) {
			return generated;
		}
	}
	return 'TEAM ' + (objectLength(room.players) + 1);
}
function normalizeDisplayName(value) {
	return String(value || '')
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase()
		.slice(0, 24);
}
function emitTeamSelectionUpdate(room) {
	if (room && room.mode === 'team') {
		emitPlayers(room.code, 'team selection update', buildTeamSelectionState(room));
	}
}
function isRoomReadyForSetup(room) {
	if (!room || objectLength(room.players) < room.modeConfig.minContestants) {
		return false;
	}
	if (room.mode !== 'team') {
		return true;
	}
	return room.playerJoinOrder
		.filter(function (name) {
			return !!room.players[name];
		})
		.every(function (name) {
			return (
				Object.keys(room.contestantMembers[name] || {}).length >=
				1
			);
		});
}
function getRoomFromSocket(socket) {
	if (!socket || !socket.roomCode) {
		return null;
	}
	var room = gameRooms.get(socket.roomCode) || null;
	if (
		room &&
		socket.nsp &&
		socket.nsp.name === '/game' &&
		room.hostSocketId !== socket.id
	) {
		return null;
	}
	touchRoom(room);
	return room;
}

function clearCategoryAutoPickTimer(room) {
	if (!room || !room.categoryAutoPickTimer) {
		return;
	}
	clearTimeout(room.categoryAutoPickTimer);
	room.categoryAutoPickTimer = null;
}

function clearAllRoomTimers(room) {
	if (!room) {
		return;
	}
	clearCategoryAutoPickTimer(room);
	clearFinalJeopardyWagerTimer(room);
	clearOptionsVoteTimer(room);
	var timerNames = [
		'questionTimer',
		'buzzedInTimer',
		'dailyDoubleTimer',
		'roundTimerObject',
		'finalJeopardyAnswerTimer',
	];
	for (var i = 0; i < timerNames.length; i++) {
		if (room[timerNames[i]]) {
			clearInterval(room[timerNames[i]]);
			room[timerNames[i]] = null;
		}
	}
	room.finalJeopardyAnswerEndsAt = 0;
}

function disposeRoom(room) {
	clearAllRoomTimers(room);
}

setInterval(function () {
	var cutoff = Date.now() - ROOM_IDLE_TTL_MS;
	gameRooms.forEach(function (room, code) {
		if (room.lastActivityAt < cutoff) {
			disposeRoom(room);
			gameRooms.delete(code);
		}
	});
}, 10 * 60 * 1000).unref();

function clueIdMatchesRound(id, isSecondRound) {
	if (id === 'FJ_0_0') {
		return false;
	}
	if (isSecondRound) {
		return id.indexOf('DJ_') === 0;
	}
	/* Jeopardy round: J_0_0 … not DJ_ */
	return id.indexOf('J_') === 0;
}

function pickRandomUnplayedClueId(room) {
	if (!room || !room.questions) {
		return null;
	}
	var isDJ = room.isSecondRound === true;
	var ids = [];
	for (var id in room.questions) {
		if (!Object.prototype.hasOwnProperty.call(room.questions, id)) {
			continue;
		}
		if (!clueIdMatchesRound(id, isDJ)) {
			continue;
		}
		if (room.playedClueIds.has(id)) {
			continue;
		}
		ids.push(id);
	}
	if (!ids.length) {
		return null;
	}
	return ids[Math.floor(Math.random() * ids.length)];
}

function scheduleCategoryAutoPick(room) {
	if (!room) {
		return;
	}
	clearCategoryAutoPickTimer(room);
	room.categoryAutoPickTimer = setTimeout(function () {
		room.categoryAutoPickTimer = null;
		if (
			!room.categorySelectOpen ||
			room.clueInProgress ||
			room.roundTimer <= 0
		) {
			return;
		}
		var qid = pickRandomUnplayedClueId(room);
		if (!qid) {
			return;
		}
		applyQuestionSelection(room, qid);
	}, 12000);
}

function applyQuestionSelection(room, questionId) {
	if (!room || !questionId) {
		return;
	}
	if (!room.questions[questionId]) {
		return;
	}
	if (!room.categorySelectOpen || !clueIdMatchesRound(questionId, room.isSecondRound)) {
		return;
	}
	if (room.clueInProgress) {
		return;
	}
	if (room.playedClueIds.has(questionId)) {
		return;
	}
	if (room.roundTimer <= 0) {
		return;
	}
	clearCategoryAutoPickTimer(room);
	room.questionTimerCount = 6;
	console.log('QUESTION SELECTED ID: ' + questionId);
	room.buzzerFlipped = false;
	room.categorySelectOpen = false;
	room.clueInProgress = true;
	room.playerBuzzerUnlocked = false;
	room.answerEvaluationInProgress = false;
	room.phase = 'clue-reading';
	room.buzzedInPlayerName = undefined;
	room.buzzedInMemberName = undefined;
	room.buzzedInClientId = undefined;
	room.dailyDoubleResponderClientId = undefined;
	stopTimer(room.buzzedInTimer);
	room.buzzedInTimer = null;
	room.buzzedInTimerCount = room.answerTime;
	room.questionTimer = null;
	allPlayersNoAnswer(room);
	room.curQuestionId = questionId;
	room.playedClueIds.add(questionId);
	console.log('Question:' + JSON.stringify(room.questions[questionId]));
	emitPlayers(room.code, 'close category select');
	emitGame(room.code, 'question reveal', {
		question: room.questions[questionId]._question,
		questionId: questionId,
		playerName: getPlayerActive(room),
	});
	emitPlayers(room.code, 'question reveal', {
		question: room.questions[questionId]._question,
		dailyDouble: room.questions[questionId]._dailyDouble,
		questionId: questionId,
		playerName: getPlayerActive(room),
	});
}

//babyparse is deprecated now
var Baby = require('papaparse');
var file = __dirname + '/data/JEOPARDY_CSV_test.csv';
var lastNameFile = config.paths.lastNameFile;
var gameHistory = config.paths.gameHistory;
var gameHighScore = config.paths.gameHighScore;
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(config.paths.cluesDb);



checkForFullGame();

function findRandomPlayerName(room) {
	var names = [];
	for (var p in room.players) {
		names.push(room.players[p].name);
	}
	if (!names.length) {
		return '';
	}
	return names[Math.floor(Math.random() * names.length)];
}

function buildHostSnapshot(room) {
	var keys = Object.keys(room.questions);
	var questionsPlain = {};
	for (var i = 0; i < keys.length; i++) {
		var k = keys[i];
		var q = room.questions[k];
		if (!q) {
			continue;
		}
		questionsPlain[k] = {
			_category: q._category,
			_value: q._value,
			_question: q._question,
			_answer: q._answer,
			_dailyDouble: q._dailyDouble,
			_questionId: q._questionId,
			_mediaLink: q._mediaLink,
			_mediaType: q._mediaType,
			_mediaOriginalUrl: q._mediaOriginalUrl || '',
			_mediaFallback: !!q._mediaFallback,
			_mediaAttribution: q._mediaAttribution || null,
			_round: q._round,
		};
	}
	var boardRound = 'Jeopardy';
	if (room.isSecondRound || room.finalJeopardyCheck) {
		boardRound = 'Double Jeopardy';
	}
	var playersList = [];
	for (var j = 0; j < room.playerJoinOrder.length; j++) {
		var pname = room.playerJoinOrder[j];
		if (!room.players[pname]) {
			continue;
		}
		var memberIds = Object.keys(room.contestantMembers[pname] || {});
		var memberDetails = memberIds.map(function (clientId) {
			return {
				name: room.contestantMembers[pname][clientId],
				online: room.onlineClientIds[clientId] === pname,
			};
		});
		playersList.push({
			name: pname,
			score: room.players[pname].score,
			isActive: room.players[pname].active,
			givenAnswer: room.players[pname].givenAnswer,
			members: memberIds.map(function (clientId) {
				return room.contestantMembers[pname][clientId];
			}),
			memberDetails: memberDetails,
			online: memberDetails.some(function (member) {
				return member.online;
			}),
			onlineCount: memberDetails.filter(function (member) {
				return member.online;
			}).length,
			hasVoted: !!room.optionVotes[pname],
		});
	}
	var ap = getPlayerActive(room);
	return {
		gameActive: room.gameState.active === true,
		mode: room.mode,
		modeConfig: room.modeConfig,
		setupVotingOpen: room.setupVotingOpen,
		airdate: room.airdate,
		answerTime: room.answerTime,
		roundTimer: room.roundTimer,
		isSecondRound: room.isSecondRound,
		finalJeopardyCheck: room.finalJeopardyCheck,
		finalJeopardyWageringPhase: room.finalJeopardyWageringPhase,
		finalJeopardyAnswerPhase: room.finalJeopardyAnswerPhase,
		finalJeopardyAnswerEndsAt: room.finalJeopardyAnswerEndsAt,
		finalJeopardyBets: collectFinalJeopardyBetsPayload(room),
		finalJeopardyResults: Object.keys(room.finalJeopardyResults || {}).map(function (name) {
			return room.finalJeopardyResults[name];
		}),
		activePlayerName: ap == null ? '' : ap,
		clueInProgress: !!room.clueInProgress,
		phase: room.phase,
		buzzedInPlayerName: room.buzzedInPlayerName || '',
		buzzedInMemberName: room.buzzedInMemberName || '',
		curQuestionId: room.curQuestionId == null ? '' : room.curQuestionId,
		questionTimerCount: room.questionTimerCount,
		buzzedInTimerCount: room.buzzedInTimerCount,
		playerBuzzerUnlocked: room.playerBuzzerUnlocked,
		playedQuestionIds: Array.from(room.playedClueIds),
		questions: questionsPlain,
		players: playersList,
		questionCount: keys.length,
		boardRound: boardRound,
	};
}

function checkForFullGame(){
	//TODO COUNT RESULTS FROM DB QUERY

}

/*DOWNLOAD REQUIRED IMAGES (native fetch; no request package)*/
function mediaFilenameFromUrl(mediaLink) {
	var clean = String(mediaLink || '').split('?')[0];
	if (!clean) {
		return '';
	}
	if (clean.indexOf('/media/') !== -1) {
		return clean.split('/media/').pop() || '';
	}
	var base = path.basename(clean);
	return base && base !== '/' && base !== '.' ? base : '';
}

function download(uri, filename, callback, type) {
	var destDir = path.join(__dirname, 'temp-media', type || 'none');
	console.log('DOWNLOAD: ' + filename);
	console.log('TYPE: ' + type);
	console.log('URI: ' + uri);
	fs.mkdirSync(destDir, { recursive: true });
	var destPath = path.join(destDir, filename);
	var urlsToTry = [uri];
	if (/^http:\/\//i.test(uri)) {
		urlsToTry.push(uri.replace(/^http:\/\//i, 'https://'));
	}
	function tryNext(i) {
		if (i >= urlsToTry.length) {
			console.error('DOWNLOAD failed for all URL variants:', uri);
			callback(false);
			return;
		}
		var controller = new AbortController();
		var timeout = setTimeout(function () {
			controller.abort();
		}, 8000);
		fetch(urlsToTry[i], { signal: controller.signal })
			.then(function (res) {
				if (!res.ok) {
					throw new Error('HTTP ' + res.status + ' ' + res.statusText);
				}
				var contentType = String(res.headers.get('content-type') || '').toLowerCase();
				var contentLength = parseInt(res.headers.get('content-length'), 10);
				console.log('content-type:', contentType);
				console.log('content-length:', contentLength);
				if (type === 'image' && contentType && contentType.indexOf('image/') !== 0) {
					throw new Error('Expected image, received ' + contentType);
				}
				if (!isNaN(contentLength) && contentLength > 10 * 1024 * 1024) {
					throw new Error('Media exceeds 10 MB limit');
				}
				return res.arrayBuffer();
			})
			.then(function (buf) {
				if (buf.byteLength > 10 * 1024 * 1024) {
					throw new Error('Media exceeds 10 MB limit');
				}
				clearTimeout(timeout);
				fs.writeFileSync(destPath, Buffer.from(buf));
				callback(true);
			})
			.catch(function (err) {
				clearTimeout(timeout);
				console.error(
					'DOWNLOAD failed:',
					urlsToTry[i],
					err.message || err
				);
				tryNext(i + 1);
			});
	}
	tryNext(0);
}

playerSelect.on('connection', function(socket){
	socket.on('room code sent', function(roomCode){
		var _roomCode = normRoom(roomCode);
		console.log('ROOM CODE SENT ' + _roomCode);
		if (_roomCode && gameRooms.has(_roomCode)){
			socket.emit('room code validated', true);
			var base = publicBaseUrlForSocket(socket);
			socket.emit('send to room', base + '/player?room=' + encodeURIComponent(_roomCode));
		}
		else{
			socket.emit('room code validated', false);
		}
	});
	socket.on('disconnect', function () {
  		console.log('A user disconnected');
  	});
});

gameSpc.on('connection', function (socket) {
	var q = socket.handshake.query || {};
	var code = normRoom(q.room);
	if (!code || !gameRooms.has(code)) {
		socket.emit('host room error', {
			message: 'Unknown or missing room. Open /game to create a game or enter a code.',
		});
		socket.disconnect(true);
		return;
	}
	var requestedRoom = gameRooms.get(code);
	if (!safeTokenEqual(requestedRoom.hostToken, q.hostToken)) {
		socket.emit('host room error', {
			message: 'This browser does not have the host key for that room.',
		});
		socket.disconnect(true);
		return;
	}
	socket.roomCode = code;
	socket.join(ioRoomName(code));
	var room = requestedRoom;
	room.hostSocketId = socket.id;
	touchRoom(room);

	socket.emit('host room code', { code: room.code });
	try {
		socket.emit('host state snapshot', buildHostSnapshot(room));
		if (!room.gameState.active && Object.keys(room.questions).length) {
			Object.keys(room.questions).forEach(function (questionId) {
				emitQuestionDataToSocket(socket, room.questions[questionId]);
			});
		}
	} catch (err) {
		console.error('buildHostSnapshot failed', err);
		socket.emit('host state snapshot', { gameActive: false });
	}

	socket.on('host start setup', function () {
		var r = getRoomFromSocket(socket);
		if (
			!r ||
			r.gameState.active ||
			r.hostGameOptionsSelected ||
			!isRoomReadyForSetup(r)
		) {
			return;
		}
		r.setupVotingOpen = true;
		r.registrationClosed = true;
		startOptionsVoteTimer(r);
		emitPlayers(r.code, 'option select new');
		emitPlayers(r.code, 'game options vote progress', {
			received: objectLength(r.optionVotes),
			needed: objectLength(r.players),
		});
		emitOptionsVoteTimer(r);
	});

	socket.on('host remove contestant', function (contestantName) {
		var r = getRoomFromSocket(socket);
		contestantName = String(contestantName || '').trim().toUpperCase();
		if (
			!r ||
			!contestantName ||
			r.gameState.active ||
			r.hostGameOptionsSelected ||
			r.optionsVoteEndsAt ||
			!r.players[contestantName]
		) {
			return;
		}
		var memberIds = Object.keys(r.contestantMembers[contestantName] || {});
		for (var mi = 0; mi < memberIds.length; mi++) {
			delete r.onlineClientIds[memberIds[mi]];
		}
		delete r.players[contestantName];
		delete r.contestantMembers[contestantName];
		delete r.optionVotes[contestantName];
		r.playerJoinOrder = r.playerJoinOrder.filter(function (name) {
			return name !== contestantName;
		});
		emitPlayers(r.code, 'contestant removed', contestantName);
		emitTeamSelectionUpdate(r);
		emitGame(r.code, 'roster update', buildHostSnapshot(r).players);
	});

	socket.on('host request new game', function () {
		var r = getRoomFromSocket(socket);
		if (!r || r.phase === 'resetting' || r.phase === 'loading') {
			return;
		}
		console.log('host request new game');
		clearAllRoomTimers(r);
		r.pendingHostForcedNewGame = true;
		r.newGameCounter = 0;
		r.finalJeopardyWageringPhase = false;
		r.finalJeopardyAnswerPhase = false;
		r.finalJeopardyAllWagersEmitted = false;
		r.phase = 'resetting';
		emitPlayers(r.code, 'new game');
		emitGame(r.code, 'new game', r.gameData);
	});

	//buzzers on/off
	socket.on('open buzzer', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		openTheBuzzer(r);
	});

	socket.on('close buzzer', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		r.playerBuzzerUnlocked = false;
		emitPlayers(r.code, 'close buzzer');
	});

	socket.on('open response final jeopardy', function () {
		var r = getRoomFromSocket(socket);
		if (!r || !r.finalJeopardyWageringPhase || !r.questions.FJ_0_0) {
			return;
		}
		clearFinalJeopardyWagerTimer(r);
		r.finalJeopardyAnswerPhase = true;
		r.finalJeopardyWageringPhase = false;
		r.phase = 'final-answer';
		r.finalJeopardyAnswerEndsAt = Date.now() + FINAL_JEOPARDY_ANSWER_TIMEOUT_MS;
		if (r.finalJeopardyAnswerTimer) {
			clearTimeout(r.finalJeopardyAnswerTimer);
		}
		r.finalJeopardyAnswerTimer = setTimeout(function () {
			finishFinalJeopardyAnswerPhase(r);
		}, FINAL_JEOPARDY_ANSWER_TIMEOUT_MS);
		emitPlayers(r.code, 'open response final jeopardy', r.questions['FJ_0_0']._question);
	});

	socket.on('second round started', function (content) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		clearAllRoomTimers(r);
		r.lastPlayerBoardMarkup = typeof content === 'string' ? content : r.lastPlayerBoardMarkup;
		r.categorySelectOpen = false;
		r.clueInProgress = false;
		emitPlayers(r.code, 'second round started', content);
	});

	socket.on('open question category new round', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		r.categorySelectOpen = true;
		emitPlayers(r.code, 'open question category new round', getPlayerActive(r));
		scheduleCategoryAutoPick(r);
	});

	socket.on('open question category', function (playerNameActive) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		playerNameActive = getPlayerActive(r);
		if (!playerNameActive || !r.players[playerNameActive]) {
			return;
		}
		console.log('Showing Category Select');
		r.categorySelectOpen = true;
		emitPlayers(r.code, 'open question category', playerNameActive);
		scheduleCategoryAutoPick(r);
	});

	socket.on('next round started', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		changeActivePlayerNewRound(r);
		emitGame(r.code, 'next round start confirmed', getPlayerActive(r));
		emitPlayers(r.code, 'next round start confirmed', getPlayerActive(r));
	});

	socket.on('disconnect', function () {
		console.log('A user disconnected');
		var disconnectedRoom = gameRooms.get(socket.roomCode);
		if (disconnectedRoom && disconnectedRoom.hostSocketId === socket.id) {
			disconnectedRoom.hostSocketId = null;
		}
	});

	socket.on('question timer out', function () {
		var r = getRoomFromSocket(socket);
		if (!r || !r.clueInProgress || r.questionTimerCount > 0) {
			return;
		}
		questionTimesUp(r);
	});

	socket.on('player random', function (data) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		var playerActive = r.players[findRandomPlayerName(r)];
		r.gameState.active = true;
		playerActive.isActive = true;
		if (data && typeof data.gameMarkup === 'string') {
			r.lastPlayerBoardMarkup = data.gameMarkup;
		}
		r.categorySelectOpen = false;
		r.clueInProgress = false;
		r.playerBuzzerUnlocked = false;
		emitPlayers(r.code, 'active player', {
			playerName: getPlayerActive(r),
			gameMarkup: data.gameMarkup,
			newGame: 'new game',
			airdate: r.airdate,
		});
		emitGame(r.code, 'active player', {
			playerName: getPlayerActive(r),
			newGame: 'new game',
			airdate: r.airdate,
		});
	});

	socket.on('final jeopardy started', function () {
		var r = getRoomFromSocket(socket);
		if (!r || !r.finalJeopardyCheck || !r.questions.FJ_0_0) {
			return;
		}
		r.phase = 'final-intro';
		emitPlayers(r.code, 'final jeopardy started');
	});

	socket.on('final jeopardy bid', function () {
		var r = getRoomFromSocket(socket);
		if (!r || !r.finalJeopardyCheck || !r.questions.FJ_0_0) {
			return;
		}
		r.finalJeopardyWageringPhase = true;
		r.finalJeopardyAnswerPhase = false;
		r.finalJeopardyAllWagersEmitted = false;
		r.phase = 'final-wager';
		clearFinalJeopardyWagerTimer(r);
		r.finalJeopardyWagerTimer = setTimeout(function () {
			defaultMissingFinalJeopardyWagers(r);
		}, FINAL_JEOPARDY_WAGER_TIMEOUT_MS);
		emitPlayers(r.code, 'final jeopardy bid', r.questions['FJ_0_0']._category);
	});

	socket.on('final jeopardy time out', function () {
		var r = getRoomFromSocket(socket);
		if (
			!r ||
			(r.finalJeopardyAnswerEndsAt &&
				Date.now() + 100 < r.finalJeopardyAnswerEndsAt)
		) {
			return;
		}
		finishFinalJeopardyAnswerPhase(r);
	});

	socket.on('final jeopardy reveal player', function (data) {
		var r = getRoomFromSocket(socket);
		var playerName = data && String(data.playerName || '');
		var result = r && r.finalJeopardyResults[playerName];
		if (!result) {
			return;
		}
		emitPlayers(r.code, 'final jeopardy reveal player', {
			playerName: playerName,
			correct: !!result.correct,
			score: result.score,
			answer: result.answer || '',
			bet: r.finalJeopardyBet[playerName]
				? r.finalJeopardyBet[playerName].bet
				: 0,
		});
	});

	socket.on('game over', function (winningPlayerData) {
		var r = getRoomFromSocket(socket);
		if (!r || r.phase === 'game-over') {
			return;
		}
		r.phase = 'game-over';
		var winnerNames = [];
		var winningScore = 0;
		if (winningPlayerData && Array.isArray(winningPlayerData.winningPlayerNames)) {
			winnerNames = winningPlayerData.winningPlayerNames.slice();
			winningScore = parseInt(winningPlayerData.winningPlayerScore, 10) || 0;
		} else if (winningPlayerData && winningPlayerData.winningPlayerName) {
			winnerNames = [winningPlayerData.winningPlayerName];
			winningScore = parseInt(winningPlayerData.winningPlayerScore, 10) || 0;
		}
		var wi;
		for (wi = 0; wi < winnerNames.length; wi++) {
			fs.appendFileSync(
				gameHighScore,
				'\n' + winnerNames[wi] + ',' + winningScore
			);
		}
		emitPlayers(r.code, 'game over', {
			winningPlayerName: winnerNames[0] || '',
			winningPlayerNames: winnerNames,
			winningPlayerScore: winningScore,
			isTie: winnerNames.length > 1,
			standings: Array.isArray(winningPlayerData.standings)
				? winningPlayerData.standings
				: [],
		});
	});

	socket.on('fetch high scores', function () {
		var highScores = findHighScores();
		socket.emit('high scores', highScores);
	});

    function findHighScores(){
    	var gameHighScoreSend = fs.readFileSync(gameHighScore, {
  			encoding: 'binary'
		});
		// pass in the contents of a csv file
		var parsedHighScore = Baby.parse(gameHighScoreSend);
	// voila
		return parsedHighScore.data
			.map(function (row) {
				return {
					name: String((row && row[0]) || '').trim(),
					score: parseInt(row && row[1], 10),
				};
			})
			.filter(function (entry) {
				return entry.name && Number.isFinite(entry.score);
			})
			.sort(function (a, b) {
				return b.score - a.score;
			});
    }

	console.log('Master Screen Connected');

	socket.on('begin round timer', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		stopTimer(r.roundTimerObject);
		r.roundTimerObject = null;
		r.roundTimer = ROUND_TIME;
		setRoundTimer(r);
	});

	socket.on('start countdown', function (questionId) {
		var r = getRoomFromSocket(socket);
		if (!r || !r.clueInProgress || questionId !== r.curQuestionId) {
			return;
		}
		r.curQuestionId = questionId;
		r.phase = 'countdown';
		questionBeginCountdown(r);
		emitGame(r.code, 'countdown', { timerCount: r.questionTimerCount, questionId: questionId });
		emitPlayers(r.code, 'expose question');
	});

	socket.on('continue countdown', function (questionId) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		questionContinueCountdown(r);
		emitGame(r.code, 'countdown', { timerCount: r.questionTimerCount, questionId: questionId });
	});

	socket.on('open submit dd', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		r.dailyDoubleTimerCount = r.answerTime;
		r.dailyDoubleTimer = null;
		emitPlayers(r.code, 'daily double question finished being read');
		dailyDoubleBeginCountdown(r);
	});

	socket.on('finished all messages dd', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('finished all messages dd');
		returnToBoardPickerState(r);
		emitPlayers(r.code, 'active player', {
			playerName: getPlayerActive(r),
			correct: false,
			newGame: 'no',
		});
		emitGame(r.code, 'active player', { playerName: getPlayerActive(r), correct: false });
	});

	socket.on('all messages done score update correct', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('Next player should be going...');
		returnToBoardPickerState(r);
		var gained = !!r.pendingGainedBoardOnCorrect;
		r.pendingGainedBoardOnCorrect = false;
		var activeName = getPlayerActive(r);
		emitPlayers(r.code, 'active player', {
			playerName: activeName,
			correct: true,
			newGame: 'no',
			gainedBoardControl: gained,
		});
		emitGame(r.code, 'active player', {
			playerName: activeName,
			correct: true,
			gainedBoardControl: gained,
		});
	});

	socket.on('all messages done score update', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('Next player should be going...');
		returnToBoardPickerState(r);
		emitPlayers(r.code, 'active player', {
			playerName: getPlayerActive(r),
			correct: false,
			newGame: 'no',
		});
		emitGame(r.code, 'active player', { playerName: getPlayerActive(r), correct: false });
	});

	socket.on('all messages done buzzed in time out', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('all messages done buzzed in time out');
		if (checkIfAllPlayersAnswered(r)) {
			returnToBoardPickerState(r);
			emitPlayers(r.code, 'active player', {
				playerName: getPlayerActive(r),
				correct: false,
				newGame: 'no',
			});
			emitGame(r.code, 'active player', { playerName: getPlayerActive(r), correct: false });
		}
	});

	socket.on('new game ready game board', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		clearAllRoomTimers(r);
		emitGame(r.code, 'host game load status', {
			phase: 'loading',
			message: 'Loading a new episode…',
		});
		selectGameForRoom(r, function (returnValue) {
			if (!returnValue || returnValue.game == null) {
				console.error('selectGameForRoom (new game board): no game row returned');
				emitGame(r.code, 'host game load status', {
					phase: 'error',
					message:
						'Could not load a new episode. Try again or change decade / episode type.',
				});
				return;
			}
			r.pendingGainedBoardOnCorrect = false;
			r.pendingHostForcedNewGame = false;
			r.newGameCounter = 0;
			r.buzzerFlipped = false;
			r.somecounter = 0;
			r.gameData = [];
			r.questions = {};
			r.playedClueIds.clear();
			r.finalJeopardyCheck = false;
			r.finalJeopardyWageringPhase = false;
			r.finalJeopardyAnswerPhase = false;
			r.finalJeopardyAnswerEndsAt = 0;
			r.finalJeopardyAllWagersEmitted = false;
			r.finalJeopardyBet = {};
			r.finalJeopardyAnswerSubmitted = {};
			r.finalJeopardyResults = {};
			r.isSecondRound = false;
			r.roundTimer = ROUND_TIME;
			r.lastPlayerBoardMarkup = '';
			r.categorySelectOpen = false;
			r.clueInProgress = false;
			r.playerBuzzerUnlocked = false;
			r.answerEvaluationInProgress = false;
			r.phase = 'loading';
			for (var player in r.players) {
				r.players[player].score = 0;
				r.players[player].givenAnswer = false;
				r.players[player].isActive = false;
			}
			r.gameId = returnValue.game;
			r.airdate = returnValue.airdate;
			var tempDateNg = new Date(r.airdate);
			r.airdate = formatPlayerOptionDate(tempDateNg);
			console.log('NEW GAME BOARD GAME_ID: ' + r.gameId + ' AIRDATE ' + r.airdate);
			setGameDataNew(r, function (loadErr) {
				if (loadErr) {
					console.error('new game board load failed', loadErr);
					r.phase = 'load-error';
					emitGame(r.code, 'host game load status', {
						phase: 'error',
						message: 'The selected episode could not build a complete board.',
					});
					emitPlayers(r.code, 'game setup failed', {
						message: 'The new board could not be loaded. Ask the host to try again.',
					});
					return;
				}
				appendPlayedGameIdToDisk(r.gameId);
				emitGame(r.code, 'host game load status', {
					phase: 'done',
					message: '',
				});
			});
		});
	});

	socket.on('buzzer pressed confirmed', function (nameData) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		emitPlayers(r.code, 'buzzer pressed', {
			playerName: nameData.playerName,
			memberName: nameData.memberName || nameData.playerName,
			clientId: nameData.clientId,
			questionId: nameData.questionId,
		});
	});
});

var playerConnectionBySocketId = {};

playerSpc.on('connection', function (socket) {
	var q = socket.handshake.query || {};
	var code = normRoom(q.room);
	if (!code || !gameRooms.has(code)) {
		socket.emit('player room error', {
			message: 'Missing or unknown room. Use /home with a code from the host, or open /player?room=CODE.',
		});
		socket.disconnect(true);
		return;
	}
	socket.roomCode = code;
	socket.join(ioRoomName(code));
	var room = gameRooms.get(code);
	touchRoom(room);

	console.log('player connected.');
	socket.suggestedTeamName = room.mode === 'team' ? generateUniqueTeamName(room) : '';
	socket.emit('room configuration', {
		code: room.code,
		mode: room.mode,
		label: room.modeConfig.label,
		minContestants: room.modeConfig.minContestants,
		maxContestants: room.modeConfig.maxContestants,
		maxMembersPerContestant: room.modeConfig.maxMembersPerContestant,
		teamSelection: buildTeamSelectionState(room),
		suggestedTeamName: socket.suggestedTeamName,
	});

	socket.on('login name', function (login) {
		var legacyName = typeof login === 'string' ? login : '';
		login = login && typeof login === 'object' ? login : {};
		var memberName = normalizeDisplayName(login.memberName || legacyName);
		var createTeam = room.mode === 'team' && login.createTeam === true;
		var contestantName =
			room.mode === 'team'
				? createTeam
					? socket.suggestedTeamName
					: normalizeDisplayName(login.teamName)
				: memberName;
		var clientId = String(login.clientId || socket.id).trim().slice(0, 80);
		if (!memberName || !contestantName || !clientId) {
			socket.emit('player login rejected', {
				message: room.mode === 'team' ? 'Enter both your name and a team name.' : 'Enter your name.',
			});
			return;
		}
		console.log('PLAYER LOGIN: ' + memberName + ' AS ' + contestantName);
		socket.username = contestantName;
		socket.contestantName = contestantName;
		socket.memberName = memberName;
		socket.clientId = clientId;

		if (createTeam && (!contestantName || room.players[contestantName])) {
			contestantName = generateUniqueTeamName(room);
			socket.suggestedTeamName = contestantName;
		}
		var existing = room.players[contestantName];
		var members = room.contestantMembers[contestantName] || {};
		if (room.mode === 'team' && !createTeam && !existing) {
			socket.emit('player login rejected', {
				message: 'That team is no longer available. Choose an existing team or create a new one.',
			});
			emitTeamSelectionUpdate(room);
			return;
		}
		if (existing) {
			var isKnownDevice = Object.prototype.hasOwnProperty.call(members, clientId);
			if (
				room.mode === 'team' &&
				!isKnownDevice &&
				Object.keys(members).length >= room.modeConfig.maxMembersPerContestant
			) {
				socket.emit('player login rejected', {
					message: contestantName + ' already has two connected players.',
				});
				return;
			}
			if ((room.gameState.active === true || room.registrationClosed) && !isKnownDevice) {
				socket.emit('player login rejected', {
					message: 'This game has already started. Only previously joined devices can reconnect.',
				});
				return;
			}
			members[clientId] = memberName;
			room.contestantMembers[contestantName] = members;
			room.onlineClientIds[clientId] = contestantName;
			playerConnectionBySocketId[socket.id] = {
				username: contestantName,
				memberName: memberName,
				clientId: clientId,
				roomCode: code,
			};
			socket.emit('player login accepted', {
				contestantName: contestantName,
				memberName: memberName,
			});
			emitTeamSelectionUpdate(room);
			emitGame(room.code, 'roster update', buildHostSnapshot(room).players);
			console.log('PLAYER RECONNECT/JOIN TEAM: ' + contestantName);
			if (room.gameState.active === true) {
				sendPlayerReconnectState(socket, contestantName, room);
				if (room.finalJeopardyCheck && room.finalJeopardyWageringPhase) {
					syncFinalJeopardyWagersToHost(room);
				}
				return;
			}
			if (
				room.setupVotingOpen &&
				isRoomReadyForSetup(room) &&
				!room.hostGameOptionsSelected
			) {
				var teamVoteProgressPayload = {
					received: objectLength(room.optionVotes),
					needed: objectLength(room.players),
				};
				if (!room.optionsVoteTimer && !room.optionsVoteEndsAt) {
					startOptionsVoteTimer(room);
					emitPlayers(room.code, 'option select new');
					emitPlayers(room.code, 'game options vote progress', teamVoteProgressPayload);
				} else {
					socket.emit('option select new');
					socket.emit('game options vote progress', teamVoteProgressPayload);
				}
				emitOptionsVoteTimer(room);
			} else {
				socket.emit('wait for start game', contestantName);
			}
			return;
		}

		if (room.gameState.active === true) {
			socket.emit('player room error', {
				message:
					'This game has already started. Ask the host to start a new room.',
			});
			return;
		}
		if (room.registrationClosed) {
			socket.emit('player login rejected', {
				message: 'The host has started game setup, so this room is no longer accepting players.',
			});
			return;
		}
		if (objectLength(room.players) >= room.modeConfig.maxContestants) {
			socket.emit('player room error', {
				message:
					'This room already has the maximum of ' +
					room.modeConfig.maxContestants +
					(room.mode === 'team' ? ' teams.' : ' players.'),
			});
			return;
		}

		if (room.playerJoinOrder.indexOf(contestantName) === -1) {
			room.playerJoinOrder.push(contestantName);
		}
		room.players[contestantName] = new Player(contestantName);
		room.contestantMembers[contestantName] = {};
		room.contestantMembers[contestantName][clientId] = memberName;
		room.onlineClientIds[clientId] = contestantName;
		playerConnectionBySocketId[socket.id] = {
			username: contestantName,
			memberName: memberName,
			clientId: clientId,
			roomCode: code,
		};
		socket.emit('player login accepted', {
			contestantName: contestantName,
			memberName: memberName,
		});
		emitTeamSelectionUpdate(room);
		emitGame(room.code, 'roster update', buildHostSnapshot(room).players);
		console.log(room.players);
		var playerTotal = objectLength(room.players);
		var voteProgressPayload = {
			received: objectLength(room.optionVotes),
			needed: playerTotal,
		};
		if (
			room.setupVotingOpen &&
			isRoomReadyForSetup(room) &&
			!room.hostGameOptionsSelected
		) {
			startOptionsVoteTimer(room);
			emitPlayers(room.code, 'option select new');
			emitPlayers(room.code, 'game options vote progress', voteProgressPayload);
			emitOptionsVoteTimer(room);
		} else {
			socket.emit('wait for start game', contestantName);
		}
	});	

  	//TESTS
  	socket.on('buzzer press test', function(playerNameBuzzed){
  		console.log("THIS PLAYER JUST BUZZED IN: " + playerNameBuzzed);
  	});

  	socket.on('expose question test', function(playerNameExposed){
  		console.log("PLAYER NAMED EXPOSED QUESTION " + playerNameExposed);
  	});

	socket.on('option select new', function (optionArray) {
		var r = getRoomFromSocket(socket);
		if (!r || !r.setupVotingOpen || r.hostGameOptionsSelected) {
			return;
		}
		if (!socket.username) {
			return;
		}
		if (!Array.isArray(optionArray) || optionArray.length < 3) {
			return;
		}
		console.log('option vote', socket.username, optionArray);
		r.optionVotes = r.optionVotes || {};
		r.optionVotes[socket.username] = {
			answerTime: normalizeOptionAnswerTime(optionArray[0]),
			decade: normalizeOptionDecade(optionArray[1]),
			episodeFilter: normalizeEpisodeFilterOption(optionArray[2]),
		};
		emitPlayers(r.code, 'contestant option vote recorded', socket.username);
		emitGame(r.code, 'roster update', buildHostSnapshot(r).players);
		var needed = objectLength(r.players);
		var received = objectLength(r.optionVotes);
		emitPlayers(r.code, 'game options vote progress', {
			received: received,
			needed: needed,
		});
		emitOptionsVoteTimer(r);
		if (received < needed) {
			return;
		}
		finalizeGameOptionsVotes(r, 'complete');
	});

	socket.on('new game', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		emitGame(r.code, 'player new game requested', {
			playerName: socket.contestantName || '',
		});
	});

	socket.on('new game ready', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		if (r.pendingHostForcedNewGame) {
			return;
		}
		console.log('NEW GAME COUNTER: ' + r.newGameCounter);
		r.newGameCounter += 1;
		if (r.newGameCounter >= objectLength(r.players)) {
			emitGame(r.code, 'new game', r.gameData);
		}
	});

	socket.on('question selected', function (questionId) {
		var r = getRoomFromSocket(socket);
		if (
			!r ||
			!r.categorySelectOpen ||
			socket.contestantName !== getPlayerActive(r) ||
			!clueIdMatchesRound(String(questionId || ''), r.isSecondRound)
		) {
			return;
		}
		applyQuestionSelection(r, questionId);
	});

	socket.on('buzzer pressed', function (playerName) {
		var r = getRoomFromSocket(socket);
		if (!r || !socket.contestantName || !r.players[socket.contestantName]) {
			return;
		}
		playerName = socket.contestantName;
		console.log('BUZZER PRESSED BY: ' + playerName);
		if (
			!r.clueInProgress ||
			!r.playerBuzzerUnlocked ||
			r.questionTimerCount <= 0 ||
			r.finalJeopardyCheck ||
			!r.questions[r.curQuestionId] ||
			r.questions[r.curQuestionId]._dailyDouble
		) {
			return;
		}
		if (!r.buzzerFlipped && r.players[playerName].givenAnswer !== true) {
			console.log('buzzer pressed inside buzzerflip check: ' + playerName);
			r.buzzerFlipped = true;
			r.playerBuzzerUnlocked = false;
			stopTimer(r.questionTimer);
			r.buzzedInPlayerName = playerName;
			r.buzzedInMemberName = socket.memberName || playerName;
			r.buzzedInClientId = socket.clientId || socket.id;
			r.phase = 'answering';
			emitGame(r.code, 'buzzer pressed', {
				playerName: playerName,
				memberName: r.buzzedInMemberName,
				clientId: r.buzzedInClientId,
				questionId: r.curQuestionId,
			});
			r.players[playerName].givenAnswer = true;
			r.buzzedInTimerCount = Number(r.answerTime);
			buzzedInBeginCountdown(r);
		}
	});

	socket.on('buzzers opened', function () {
		var r = getRoomFromSocket(socket);
		if (
			!r ||
			!r.clueInProgress ||
			!r.playerBuzzerUnlocked ||
			r.questionTimerCount <= 0
		) {
			return;
		}
		console.log('buzzers opened');
		if (r.questionTimer == null) {
			console.log('should be initiating timer');
			r.questionTimer = setInterval(function () {
				r.questionTimerCount--;
				emitPlayers(r.code, 'update interval', r.questionTimerCount);
				emitGame(r.code, 'update interval', r.questionTimerCount);
				if (r.questionTimerCount <= 0) {
					console.log('stopping timer.');
					stopTimer(r.questionTimer);
					r.questionTimer = null;
				}
			}, 1000);
		}
	});

	socket.on('player no answer final jeopardy', function (playerName) {
		var r = getRoomFromSocket(socket);
		if (
			!r ||
			!socket.contestantName ||
			!r.finalJeopardyAnswerPhase ||
			(r.finalJeopardyAnswerEndsAt &&
				Date.now() + 100 < r.finalJeopardyAnswerEndsAt) ||
			r.finalJeopardyAnswerSubmitted[socket.contestantName]
		) {
			return;
		}
		playerName = socket.contestantName;
		scoreMissingFinalJeopardyAnswer(r, playerName);
	});

	socket.on('answer selection', function (answer) {
		var r = getRoomFromSocket(socket);
		if (
			!r ||
			!answer ||
			typeof answer !== 'object' ||
			!socket.contestantName ||
			!isValidAnswer(answer.answer)
		) {
			return;
		}
		answer.playerName = socket.contestantName;
		if (answer.finalJeopardyCheck) {
			if (
				!r.finalJeopardyCheck ||
				!r.finalJeopardyAnswerPhase ||
				!r.questions.FJ_0_0 ||
				!r.finalJeopardyBet[answer.playerName]
			) {
				return;
			}
			if (r.finalJeopardyAnswerSubmitted[answer.playerName]) {
				return;
			}
			r.finalJeopardyAnswerSubmitted[answer.playerName] = socket.clientId;
			emitPlayers(r.code, 'final jeopardy contestant answer locked', {
				playerName: answer.playerName,
				clientId: socket.clientId,
			});
		}
		if (answer.finalJeopardyCheck) {
			checkAnswerAsync(r, answer.answer, answer.questionId, answer.playerName, answer.finalJeopardyCheck);
			return;
		}
		var currentQuestion = r.questions[r.curQuestionId];
		if (
			!r.clueInProgress ||
			!currentQuestion ||
			answer.questionId !== r.curQuestionId ||
			r.answerEvaluationInProgress
		) {
			return;
		}
		if (currentQuestion._dailyDouble) {
			if (
				socket.contestantName !== getPlayerActive(r) ||
				socket.clientId !== r.dailyDoubleResponderClientId ||
				r.dailyDoubleTimerCount <= 0
			) {
				return;
			}
		} else if (
			socket.clientId !== r.buzzedInClientId ||
			r.buzzedInTimerCount <= 0
		) {
			return;
		}
		r.answerEvaluationInProgress = true;
		r.buzzerFlipped = false;
		if (currentQuestion._dailyDouble || r.buzzedInTimerCount > 0) {
			stopTimer(r.buzzedInTimer);
			stopTimer(r.dailyDoubleTimer);
			r.buzzedInTimer = null;
			r.dailyDoubleTimer = null;
			checkAnswerAsync(r, answer.answer, answer.questionId, answer.playerName, answer.finalJeopardyCheck);
		}
	});

	socket.on('bet selection', function (bet) {
		var r = getRoomFromSocket(socket);
		if (!r || !bet || typeof bet !== 'object' || !socket.contestantName) {
			return;
		}
		bet.playerName = socket.contestantName;
		if (!bet.finalJeopardyCheck) {
			var ddQuestion = r.questions[r.curQuestionId];
			if (
				!r.clueInProgress ||
				!ddQuestion ||
				!ddQuestion._dailyDouble ||
				bet.questionId !== r.curQuestionId ||
				bet.playerName !== getPlayerActive(r)
			) {
				return;
			}
			if (
				r.dailyDoubleResponderClientId ||
				r.phase === 'daily-double-answer'
			) {
				return;
			}
			var ddValidation = validateDailyDoubleWager(
				bet.betValue,
				r.players[bet.playerName].score,
				r.curQuestionId
			);
			if (!ddValidation.valid) {
				socket.emit('wager rejected', { message: ddValidation.message });
				return;
			}
			r.dailyDoubleResponderClientId = socket.clientId;
			ddQuestion._value = ddValidation.wager;
			r.phase = 'daily-double-answer';
			emitPlayers(r.code, 'daily double response', {
				playerName: bet.playerName,
				memberName: socket.memberName || bet.playerName,
				clientId: socket.clientId,
				questionId: bet.questionId,
				question: r.questions[bet.questionId]._question,
				isDailyDouble: true,
			});
			emitGame(r.code, 'question reveal dd', {
				question: r.questions[bet.questionId]._question,
				questionId: bet.questionId,
				bet: ddValidation.wager,
				playerName: bet.playerName,
				memberName: socket.memberName || bet.playerName,
			});
		} else {
			if (!r.finalJeopardyWageringPhase || r.finalJeopardyAnswerPhase) {
				return;
			}
			if (r.finalJeopardyBet[bet.playerName]) {
				/* Already recorded — re-sync in case the host missed the original emit (reconnect). */
				syncFinalJeopardyWagersToHost(r);
				return;
			}
			var player = r.players[bet.playerName];
			if (!player) {
				return;
			}
			var finalValidation = validateFinalJeopardyWager(bet.betValue, player.score);
			if (!finalValidation.valid) {
				socket.emit('wager rejected', { message: finalValidation.message });
				return;
			}
			r.finalJeopardyBet[bet.playerName] = {
				playerName: bet.playerName,
				bet: finalValidation.wager,
			};
			emitPlayers(r.code, 'final jeopardy contestant wager locked', {
				playerName: bet.playerName,
				clientId: socket.clientId,
				bet: finalValidation.wager,
			});
			emitGame(r.code, 'final jeopardy response', {
				playerName: bet.playerName,
				bet: finalValidation.wager,
			});
			maybeEmitAllFinalJeopardyWagersReady(r);
		}
	});

	socket.on('player field fj time out', function (playerName) {
		// Legacy no-op: unanswered Final Jeopardy scoring is handled by
		// 'player no answer final jeopardy' so scores are not double-subtracted.
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('player field fj time out (ignored for scoring): ' + playerName);
	});

	socket.on('disconnect', function () {
		console.log('A user disconnected');
		var connection = playerConnectionBySocketId[socket.id];
		if (connection) {
			var disconnectRoom = gameRooms.get(connection.roomCode);
			if (disconnectRoom) {
				delete disconnectRoom.onlineClientIds[connection.clientId];
				emitGame(
					disconnectRoom.code,
					'roster update',
					buildHostSnapshot(disconnectRoom).players
				);
			}
		}
		delete playerConnectionBySocketId[socket.id];
	});
});

function formatPlayerOptionDate(date) {
	var monthNames = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December',
	];
	var day = date.getDate();
	var monthIndex = date.getMonth();
	var year = date.getFullYear();
	return monthNames[monthIndex] + ' ' + day + ', ' + year;
}

function checkAnswerAsync(room, answer, questionId, playerName, finalJeopardy) {
	if (finalJeopardy) {
		questionId = 'FJ_0_0';
	}

	var originalPlayerAnswer = answer.toUpperCase();
	var originalActualAnswer = room.questions[questionId]._answer.toUpperCase();
	var score = room.players[playerName].score;
	var value = parseInt(room.questions[questionId]._value, 10);
	var correct = false;

	evaluateAnswer({
		playerAnswer: answer,
		canonicalAnswer: room.questions[questionId]._answer,
		clueText: room.questions[questionId]._question,
		lastNameFilePath: lastNameFile,
		aiEnabled: config.openaiAnswerJudgeEnabled,
		openaiApiKey: config.openaiApiKey,
		openaiModel: config.openaiModel,
		onAiJudgingStart: function () {
			emitGame(room.code, 'answer ai judging', {
				playerName: playerName,
				questionId: questionId,
			});
		},
	})
		.then(function (result) {
			if (!finalJeopardy) {
				room.answerEvaluationInProgress = false;
			}
			correct = result.correct;
			if (result.source === 'openai') {
				console.log(
					'Answer judged by OpenAI: ' + (correct ? 'correct' : 'incorrect')
				);
			}

			if (finalJeopardy) {
				var fbEarly = room.finalJeopardyBet[playerName];
				if (!fbEarly || fbEarly.scored) {
					emitGame(room.code, 'answer ai judging end');
					return;
				}
				value = 0;
			}

			if (correct) {
				score += value;
				if (!finalJeopardy) {
					var prevBoard = getPlayerActive(room);
					room.pendingGainedBoardOnCorrect =
						!prevBoard || prevBoard !== playerName;
				} else {
					room.pendingGainedBoardOnCorrect = false;
				}
				setPlayerActive(room, room.players[playerName]);
			} else {
				score -= value;
				if (!finalJeopardy) {
					room.pendingGainedBoardOnCorrect = false;
				}
			}

			if (finalJeopardy) {
				if (correct) {
					score += parseInt(room.finalJeopardyBet[playerName].bet, 10);
				} else {
					score -= parseInt(room.finalJeopardyBet[playerName].bet, 10);
				}
				if (room.finalJeopardyBet[playerName]) {
					room.finalJeopardyBet[playerName].scored = true;
				}
			}

			room.players[playerName].score = score;

			if (!finalJeopardy) {
				emitGame(room.code, 'score update', {
					score: room.players[playerName].score,
					answer: originalPlayerAnswer,
					playerName: playerName,
					actualAnswer: originalActualAnswer,
					dailyDouble: room.questions[questionId]._dailyDouble,
					dailyDoubleBet: room.questions[questionId]._value,
					questionId: questionId,
					correct: correct,
					allPlayersAnswered: checkIfAllPlayersAnswered(room),
				});
				emitPlayers(room.code, 'score update', {
					score: room.players[playerName].score,
					playerName: playerName,
					questionId: questionId,
					correct: correct,
					dailyDouble: room.questions[questionId]._dailyDouble,
					dailyDoubleBet: room.questions[questionId]._value,
					allPlayersAnswered: checkIfAllPlayersAnswered(room),
				});
			} else {
				var finalResult = {
					score: score,
					answer: originalPlayerAnswer,
					playerName: playerName,
					correct: correct,
					buzzedInFJ: true,
				};
				room.finalJeopardyResults[playerName] = finalResult;
				emitGame(room.code, 'score update final jeopardy', finalResult);
				emitPlayers(room.code, 'score update', {
					score: score,
					playerName: playerName,
					correct: correct,
					finalJeopardy: true,
				});
			}
		})
		.catch(function (err) {
			if (!finalJeopardy) {
				room.answerEvaluationInProgress = false;
			}
			console.error('evaluateAnswer failed', err);
			emitGame(room.code, 'answer ai judging end');
			if (!finalJeopardy) {
				var failedQuestion = room.questions[questionId];
				var failedPlayer = room.players[playerName];
				if (failedQuestion && failedPlayer) {
					var failedValue = parseInt(failedQuestion._value, 10) || 0;
					failedPlayer.score -= failedValue;
					emitGame(room.code, 'score update', {
						score: failedPlayer.score,
						answer: originalPlayerAnswer,
						playerName: playerName,
						actualAnswer: originalActualAnswer,
						dailyDouble: failedQuestion._dailyDouble,
						dailyDoubleBet: failedQuestion._value,
						questionId: questionId,
						correct: false,
						allPlayersAnswered: checkIfAllPlayersAnswered(room),
					});
					emitPlayers(room.code, 'score update', {
						score: failedPlayer.score,
						playerName: playerName,
						questionId: questionId,
						correct: false,
						dailyDouble: failedQuestion._dailyDouble,
						dailyDoubleBet: failedQuestion._value,
						allPlayersAnswered: checkIfAllPlayersAnswered(room),
					});
				}
				return;
			}
			if (finalJeopardy) {
				var fb = room.finalJeopardyBet[playerName];
				if (fb && !fb.scored) {
					fb.scored = true;
					var bet = parseInt(fb.bet, 10);
					if (isNaN(bet)) {
						bet = 0;
					}
					room.players[playerName].score -= bet;
					var failedFinalResult = {
						score: room.players[playerName].score,
						answer: originalPlayerAnswer,
						playerName: playerName,
						correct: false,
						buzzedInFJ: true,
					};
					room.finalJeopardyResults[playerName] = failedFinalResult;
					emitGame(room.code, 'score update final jeopardy', failedFinalResult);
					emitPlayers(room.code, 'score update', {
						score: room.players[playerName].score,
						playerName: playerName,
						correct: false,
						finalJeopardy: true,
					});
				}
			}
		});
}


function setGameDataNew(room, callback) {
	callback = typeof callback === 'function' ? callback : function () {};
	var queryQuestions =
		'SELECT clues.id, clues.game, round, value, category, clue, answer, media\n' +
		'FROM clues\n' +
		'JOIN documents ON clues.id = documents.id\n' +
		'JOIN classifications ON clues.id = classifications.clue_id\n' +
		'JOIN categories ON classifications.category_id = categories.id\n' +
		'WHERE clues.game = ?\n' +
		'ORDER BY clues.id ASC';
	var round1Values = [200, 400, 600, 800, 1000];
	var round2Values = [400, 800, 1200, 1600, 2000];
	var firstRoundDD = Math.floor(Math.random() * 30);
	var secondRoundDDA = Math.floor(Math.random() * 30);
	var secondRoundDDB;
	do {
		secondRoundDDB = Math.floor(Math.random() * 30);
	} while (secondRoundDDB === secondRoundDDA);

	db.all(queryQuestions, [room.gameId], function (err, rows) {
		if (err) {
			return callback(err);
		}
		if (!rows || rows.length !== 61) {
			return callback(
				new Error(
					'Expected 61 joined clue rows for game ' +
						room.gameId +
						', received ' +
						(rows ? rows.length : 0)
				)
			);
		}
		var nextQuestions = {};
		try {
			for (var index = 0; index < rows.length; index++) {
				var row = rows[index];
				var questionId;
				var value;
				var dailyDouble = false;
				if (index < 30) {
					var jRow = Math.floor(index / 6);
					questionId = 'J_' + (index % 6) + '_' + jRow;
					value = round1Values[jRow];
					dailyDouble = index === firstRoundDD;
				} else if (index < 60) {
					var djIndex = index - 30;
					var djRow = Math.floor(djIndex / 6);
					questionId = 'DJ_' + (djIndex % 6) + '_' + djRow;
					value = round2Values[djRow];
					dailyDouble = djIndex === secondRoundDDA || djIndex === secondRoundDDB;
				} else {
					questionId = 'FJ_0_0';
					value = 0;
				}
				var answer = parseAnswer(row.answer);
				if (!String(row.category || '').trim() || !String(row.clue || '').trim() || !answer) {
					throw new Error('Unplayable clue row ' + row.id + ' in game ' + room.gameId);
				}
				var tempQuestion = new Question(
					String(row.category),
					value,
					String(row.clue),
					answer,
					dailyDouble,
					questionId,
					String(row.media || '').trim(),
					row.round
				);
				tempQuestion.mediaType = parseMediaType(tempQuestion.mediaLink);
				nextQuestions[questionId] = tempQuestion;
			}
		} catch (buildErr) {
			return callback(buildErr);
		}
		if (Object.keys(nextQuestions).length !== 61) {
			return callback(new Error('Question mapping did not produce 61 unique clue IDs.'));
		}
		downloadImages(room, nextQuestions, function () {
			room.questions = nextQuestions;
			Object.keys(room.questions).forEach(function (questionId) {
				emitQuestionData(room, room.questions[questionId]);
			});
			room.phase = 'ready';
			callback(null, room.questions);
		});
	});
}

var commonsImageSearchCache = new Map();

function commonsImageExtension(mime) {
	switch (mime) {
		case 'image/png':
			return '.png';
		case 'image/gif':
			return '.gif';
		case 'image/webp':
			return '.webp';
		default:
			return '.jpg';
	}
}

function tryCommonsImageFallback(question, callback) {
	var cacheKey = (
		String(question.answer || '') +
		'|' +
		String(question.category || '')
	)
		.trim()
		.toLowerCase();
	var searchPromise = commonsImageSearchCache.get(cacheKey);
	if (!searchPromise) {
		searchPromise = searchCommonsImage(question, {
			userAgent: config.wikimediaUserAgent,
		}).catch(function (err) {
			console.warn(
				'Wikimedia image search failed for ' + question.questionId + ':',
				err.message || err
			);
			return null;
		});
		commonsImageSearchCache.set(cacheKey, searchPromise);
	}

	searchPromise.then(function (result) {
		if (!result) {
			callback(false);
			return;
		}

		var filename =
			'commons-' +
			crypto.createHash('sha256').update(result.imageUrl).digest('hex').slice(0, 24) +
			commonsImageExtension(result.mime);
		var localPath = '/temp-media/image/' + filename;
		var diskPath = path.join(__dirname, 'temp-media', 'image', filename);
		var alreadyHave = false;
		try {
			alreadyHave = fs.existsSync(diskPath) && fs.statSync(diskPath).size > 0;
		} catch (err) {
			alreadyHave = false;
		}

		function applyResult(ok) {
			if (!ok) {
				callback(false);
				return;
			}
			question.mediaLink = localPath;
			question.mediaType = 'image';
			question._mediaFallback = true;
			question._mediaAttribution = {
				artist: result.artist,
				license: result.license,
				licenseUrl: result.licenseUrl,
				sourceUrl: result.sourceUrl,
			};
			console.log(
				'Using Wikimedia fallback for ' +
					question.questionId +
					' (' +
					result.query +
					')'
			);
			callback(true);
		}

		if (alreadyHave) {
			applyResult(true);
			return;
		}
		download(result.imageUrl, filename, applyResult, 'image');
	});
}

function emitQuestionData(room, question) {
	emitGame(room.code, 'game data', {
		questionID: question.questionId,
		question: question,
	});
}

function emitQuestionDataToSocket(socket, question) {
	socket.emit('game data', {
		questionID: question.questionId,
		question: question,
	});
}

function downloadImages(room, questions, callback) {
	callback = typeof callback === 'function' ? callback : function () {};
	var remaining = Object.keys(questions).length;
	if (!remaining) {
		callback();
		return;
	}
	function finish(question) {
		remaining--;
		if (remaining === 0) {
			callback();
		}
	}
	for (var question in questions) {
		var q = questions[question];
		var mediaLink = String(q.mediaLink || '').trim();
		console.log('MEDIA LINK on question loop: /' + mediaLink + '/');
		if (!mediaLink) {
			finish(q);
			continue;
		}

		var mediaType = q.mediaType;
		if (!mediaType || mediaType === 'none') {
			mediaType = parseMediaType(mediaLink);
			if (mediaType === 'none' && /^https?:\/\//i.test(mediaLink)) {
				mediaType = 'image';
			}
			q.mediaType = mediaType;
		}

		var filename = mediaFilenameFromUrl(mediaLink);
		if (!filename || filename === 'undefined') {
			q._mediaOriginalUrl = mediaLink;
			if (mediaType === 'image') {
				(function (_question, r) {
					tryCommonsImageFallback(_question, function () {
						finish(_question);
					});
				})(q, room);
			} else {
				finish(q);
			}
			continue;
		}

		var destPath = path.join(__dirname, 'temp-media', mediaType, filename);
		var filePath = '/temp-media/' + mediaType + '/' + filename;
		var originalUrl = mediaLink;
		q._mediaOriginalUrl = originalUrl;

		var alreadyHave = false;
		try {
			alreadyHave = fs.existsSync(destPath) && fs.statSync(destPath).size > 0;
		} catch (e) {
			alreadyHave = false;
		}

		if (alreadyHave) {
			console.log("doesn't need download: " + filePath);
			q.mediaLink = filePath;
			finish(q);
			continue;
		}

		(function (_question, _filePath, _filename, _originalUrl, _mediaType, r) {
			console.log('QUESTION inside fs check ' + _question.questionId);
			console.log('URL_IMG_NAME ' + _filename);
			console.log('FILE PATH ' + _filePath);
			download(
				_originalUrl,
				_filename,
				function (ok) {
					console.log('done download ok=' + ok);
					_question._mediaOriginalUrl = _originalUrl;
					if (ok) {
						_question.mediaLink = _filePath;
						finish(_question);
					} else {
						_question.mediaLink = _originalUrl;
						if (_mediaType === 'image') {
							tryCommonsImageFallback(_question, function () {
								finish(_question);
							});
							return;
						}
						finish(_question);
					}
				},
				_mediaType
			);
		})(q, filePath, filename, originalUrl, mediaType, room);
	}
}

function openTheBuzzer(room) {
	if (
		!room ||
		!room.clueInProgress ||
		room.questionTimerCount <= 0 ||
		!room.questions[room.curQuestionId] ||
		room.questions[room.curQuestionId]._dailyDouble
	) {
		return;
	}
	console.log('should be continuing countdown');
	room.playerBuzzerUnlocked = true;
	room.phase = 'buzzing';
	emitPlayers(room.code, 'open buzzer');
}

function returnToBoardPickerState(room) {
	clearCategoryAutoPickTimer(room);
	room.clueInProgress = false;
	room.categorySelectOpen = false;
	room.playerBuzzerUnlocked = false;
	room.answerEvaluationInProgress = false;
	room.phase = 'between-clues';
}

function sendPlayerReconnectState(socket, name, room) {
	var p = room.players[name];
	var score = p ? p.score : 0;
	var activeName = getPlayerActive(room);
	var fjq = room.questions['FJ_0_0'];
	var fjBetEntry = room.finalJeopardyBet[name];
	var fjBetRecorded =
		fjBetEntry && fjBetEntry.bet !== undefined && fjBetEntry.bet !== null
			? fjBetEntry.bet
			: null;
	var allFjWagersIn =
		room.finalJeopardyWageringPhase && allPlayersHaveFinalJeopardyBet(room);

	var payload = {
		'player-name': name,
		'player-score': score,
		'active-player-name': activeName == null ? '' : activeName,
		'final-jeopardy-check': room.finalJeopardyCheck,
		'final-jeopardy-wagering':
			room.finalJeopardyCheck &&
			room.finalJeopardyWageringPhase &&
			!room.finalJeopardyAnswerPhase,
		'final-jeopardy-answer':
			room.finalJeopardyCheck && room.finalJeopardyAnswerPhase,
		'final-jeopardy-category': fjq ? fjq._category : '',
		'final-jeopardy-question': fjq ? fjq._question : '',
		'final-jeopardy-player-bet': fjBetRecorded,
		'final-jeopardy-all-wagers-in': allFjWagersIn,
		'final-jeopardy-answer-submitted':
			!!room.finalJeopardyAnswerSubmitted[name],
		'buzzed-in-player-name': room.buzzedInPlayerName,
		'buzzed-in-member-name': room.buzzedInMemberName,
		'buzzed-in-client-id': room.buzzedInClientId,
		'member-name': socket.memberName || name,
		mode: room.mode,
		active: room.gameState.active === true,
		'round-timer': room.roundTimer,
		'answer-time': room.answerTime,
		'game-markup': room.lastPlayerBoardMarkup,
		'category-select-open': room.categorySelectOpen,
		'played-question-ids': Array.from(room.playedClueIds),
	};
	var qReconnect = room.questions[room.curQuestionId];
	var clueOk =
		room.clueInProgress && !!qReconnect && !room.finalJeopardyCheck;
	payload['clue-in-progress'] = clueOk;
	if (clueOk) {
		payload['cur-question-id'] = room.curQuestionId;
		payload['question-text'] = qReconnect._question;
		payload['daily-double'] = !!qReconnect._dailyDouble;
		payload['question-timer-count'] = room.questionTimerCount;
		payload['buzzer-flipped'] = room.buzzerFlipped;
		payload['player-buzzer-unlocked'] = room.playerBuzzerUnlocked;
		payload['buzzed-in-timer-count'] = room.buzzedInTimerCount;
	}
	socket.emit('update-state-reload', payload);
}	

function objectLength( object ) {
    var length = 0;
    for( var key in object ) {
        if( object.hasOwnProperty(key) ) {
            ++length;
        }
    }
    return length;
};

function changeActivePlayerNewRound(room) {
	var lowestScore = Infinity;
	var playerLow;

	for (var player in room.players) {
		if (room.players[player].score < lowestScore) {
			lowestScore = room.players[player].score;
			playerLow = room.players[player];
		}
	}
	console.log('LOWEST SCORING PLAYER: ' + playerLow);
	if (playerLow) {
		setPlayerActive(room, playerLow);
	}
}

function questionBeginCountdown(room) {
	if (room.questionTimer == null) {
		room.questionTimer = setInterval(function () {
			room.questionTimerCount--;
			emitPlayers(room.code, 'update interval', room.questionTimerCount);
			emitGame(room.code, 'update interval', room.questionTimerCount);
			if (room.questionTimerCount <= 0) {
				console.log('stopping timer.');
				stopTimer(room.questionTimer);
				room.questionTimer = null;
			}
		}, 1000);
	}
}

function questionContinueCountdown(room) {
	clearInterval(room.questionTimer);
	room.questionTimer = null;
	openTheBuzzer(room);
}

function questionTimesUp(room) {
	if (!room || !room.clueInProgress) {
		return;
	}
	stopTimer(room.questionTimer);
	room.questionTimer = null;
	emitPlayers(room.code, 'question disappear', room.curQuestionId);
	returnToBoardPickerState(room);
	emitPlayers(room.code, 'active player', {
		playerName: getPlayerActive(room),
		correct: false,
		newGame: 'no',
	});
	emitGame(room.code, 'active player', {
		newGame: false,
		playerName: getPlayerActive(room),
	});
}

function setPlayerActive(room, playerActive) {
	console.log('PLAYER ACTIVE ' + playerActive);
	if (!room || !playerActive) {
		return;
	}
	playerActive.isActive = true;

	for (var player in room.players) {
		if (room.players[player] != playerActive) {
			room.players[player].isActive = false;
		} else {
			room.players[player].isActive = true;
		}
	}
}

function getPlayerActive(room) {
	for (var player in room.players) {
		if (room.players[player].active == true) {
			return room.players[player].name;
		}
	}
}

function checkIfAllPlayersAnswered(room) {
	var increment = 0;

	for (var player in room.players) {
		if (room.players[player].givenAnswer == true) {
			increment++;
		}
	}

	if (increment >= objectLength(room.players)) {
		return true;
	}

	return false;
}

function allPlayersNoAnswer(room) {
	for (var player in room.players) {
		room.players[player].givenAnswer = false;
	}
}

function appendPlayedGameIdToDisk(gameId) {
	if (gameId == null || gameId === '') {
		return;
	}
	var idStr = String(gameId);
	try {
		var dir = path.dirname(gameHistory);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.appendFileSync(gameHistory, '\n' + idStr.replace(/\n/g, ''));
	} catch (e) {
		console.error('appendPlayedGameIdToDisk failed', e);
	}
}

function readPlayedGameIdsFromDisk() {
	try {
		var gameHistorySend = fs.readFileSync(gameHistory, {
			encoding: 'binary',
		});
		var parsedHistory = Baby.parse(gameHistorySend);
		var rowsHistory = parsedHistory.data;
		var historyArray = [];
		for (var rowY in rowsHistory) {
			historyArray.push(rowsHistory[rowY][0]);
		}
		return historyArray.filter(function (id) {
			return id != null && id !== '' && id !== 'undefined';
		});
	} catch (e) {
		return [];
	}
}

var VALID_OPTION_DECADES = {
	'80s': true,
	'90s': true,
	'00s': true,
	'10s': true,
	'20s': true,
};
var VALID_OPTION_ANSWER_TIMES = { '15': true, '20': true, '30': true };
var VALID_EPISODE_FILTERS = {
	any: true,
	kids: true,
	teen: true,
	college: true,
	celebrity: true,
	teacher: true,
	champions: true,
};

function clearOptionsVoteTimer(room) {
	if (!room) {
		return;
	}
	if (room.optionsVoteTimer) {
		clearTimeout(room.optionsVoteTimer);
		room.optionsVoteTimer = null;
	}
	if (room.optionsVoteTickTimer) {
		clearInterval(room.optionsVoteTickTimer);
		room.optionsVoteTickTimer = null;
	}
	room.optionsVoteEndsAt = 0;
}

function getOptionsVoteRemainingSeconds(room) {
	if (!room || !room.optionsVoteEndsAt) {
		return 0;
	}
	return Math.max(0, Math.ceil((room.optionsVoteEndsAt - Date.now()) / 1000));
}

function emitOptionsVoteTimer(room) {
	if (!room) {
		return;
	}
	emitPlayers(room.code, 'game options vote timer', {
		remaining: getOptionsVoteRemainingSeconds(room),
		total: Math.round(OPTIONS_VOTE_TIMEOUT_MS / 1000),
	});
}

function startOptionsVoteTimer(room) {
	if (!room || room.hostGameOptionsSelected || room.optionsVoteTimer) {
		return;
	}
	room.optionsVoteEndsAt = Date.now() + OPTIONS_VOTE_TIMEOUT_MS;
	emitGame(room.code, 'setup voting started');
	emitOptionsVoteTimer(room);
	room.optionsVoteTickTimer = setInterval(function () {
		if (!room || room.hostGameOptionsSelected) {
			clearOptionsVoteTimer(room);
			return;
		}
		emitOptionsVoteTimer(room);
	}, 1000);
	room.optionsVoteTimer = setTimeout(function () {
		room.optionsVoteTimer = null;
		finalizeGameOptionsVotes(room, 'timeout');
	}, OPTIONS_VOTE_TIMEOUT_MS);
}

function finalizeGameOptionsVotes(room, reason) {
	if (!room || room.hostGameOptionsSelected) {
		return;
	}
	clearOptionsVoteTimer(room);
	room.answerTime =
		tallyMajorityOrNull(room.optionVotes, 'answerTime') || '20';
	room.decade = tallyMajorityOrNull(room.optionVotes, 'decade') || '20s';
	room.episodeFilter =
		tallyMajorityOrNull(room.optionVotes, 'episodeFilter') || 'any';
	room.hostGameOptionsSelected = true;
	room.phase = 'loading';
	var received = objectLength(room.optionVotes);
	room.optionVotes = {};
	var loadMsg =
		reason === 'timeout'
			? received
				? 'Vote time is up. Using ' +
				  received +
				  ' vote' +
				  (received === 1 ? '' : 's') +
				  '…'
				: 'Vote time is up. Using default settings…'
			: 'All votes in. Searching for a playable game…';
	emitPlayers(room.code, 'game setup loading', {
		reason: reason || 'complete',
		message: loadMsg,
	});
	emitGame(room.code, 'host game load status', {
		phase: 'loading',
		message: loadMsg,
	});
	selectGameForRoom(room, function (returnValue) {
		if (!returnValue || returnValue.game == null) {
			console.error('selectGameForRoom: no game row returned');
			room.hostGameOptionsSelected = false;
			emitPlayers(room.code, 'game setup failed', {
				message:
					'No full game could be loaded. Try a different decade or set episode type to Any, or add more data to clues.db.',
			});
			emitGame(room.code, 'host game load status', {
				phase: 'error',
				message:
					'No 61-clue game found. Try other votes or expand the database.',
			});
			startOptionsVoteTimer(room);
			return;
		}
		room.gameId = returnValue.game;
		room.airdate = returnValue.airdate;
		var tempDate = new Date(room.airdate);
		room.airdate = formatPlayerOptionDate(tempDate);
		console.log('GAME_ID: ' + room.gameId + ' AIRDATE ' + room.airdate);
		setGameDataNew(room, function (loadErr) {
			if (loadErr) {
				console.error('setGameDataNew failed', loadErr);
				room.hostGameOptionsSelected = false;
				room.phase = 'load-error';
				emitPlayers(room.code, 'game setup failed', {
					message: 'That episode could not build a complete board. Change votes and try again.',
				});
				emitGame(room.code, 'host game load status', {
					phase: 'error',
					message: 'Episode data was incomplete or invalid.',
				});
				startOptionsVoteTimer(room);
				return;
			}
			appendPlayedGameIdToDisk(room.gameId);
			emitGame(room.code, 'host game load status', {
				phase: 'done',
				message: '',
			});
			emitPlayers(room.code, 'answer time data', room.answerTime);
			emitGame(room.code, 'answer time data', room.answerTime);
		});
	});
}

function normalizeOptionDecade(d) {
	var s = String(d || '').trim();
	return VALID_OPTION_DECADES[s] ? s : '20s';
}

function normalizeOptionAnswerTime(t) {
	var s = String(t || '').trim();
	return VALID_OPTION_ANSWER_TIMES[s] ? s : '20';
}

function normalizeEpisodeFilterOption(f) {
	var s = String(f || 'any').trim().toLowerCase();
	return VALID_EPISODE_FILTERS[s] ? s : 'any';
}

/**
 * Strict majority among counted votes: need floor(n/2)+1 for the same value.
 * Returns that value, or null if no option reaches a majority (caller uses defaults).
 */
function tallyMajorityOrNull(votesByPlayer, field) {
	var counts = {};
	var n = 0;
	var p;
	for (p in votesByPlayer) {
		if (!votesByPlayer.hasOwnProperty(p)) {
			continue;
		}
		var row = votesByPlayer[p];
		var v = row && row[field];
		if (v === undefined || v === null || v === '') {
			continue;
		}
		n++;
		var key = String(v);
		counts[key] = (counts[key] || 0) + 1;
	}
	if (n === 0) {
		return null;
	}
	var need = Math.floor(n / 2) + 1;
	var k;
	for (k in counts) {
		if (!counts.hasOwnProperty(k)) {
			continue;
		}
		if (counts[k] >= need) {
			return k;
		}
	}
	return null;
}

function selectGameForRoom(room, callback) {
	var playedGameIds = readPlayedGameIdsFromDisk();
	function hostMsg(msg) {
		emitGame(room.code, 'host game load status', {
			phase: 'loading',
			message: msg || '',
		});
	}
	if (room.episodeFilter && room.episodeFilter !== 'any') {
		hostMsg('Loading tournament episode from pack (if available)…');
		jarchiveDynamic.selectPackEpisodeIntoDb(
			db,
			room.decade,
			room.episodeFilter,
			playedGameIds,
			function (err, ret) {
				if (err) {
					console.warn(
						'Dynamic j-archive pack episode failed:',
						err && err.message ? err.message : err
					);
				}
				if (!ret) {
					hostMsg('No episode matches that decade and episode type.');
					callback(null);
					return;
				}
				hostMsg('Episode found. Building board…');
				callback(ret);
			}
		);
		return;
	}
	/** Episode type Any: only SQLite — unless 2020s, where local DB is usually empty. */
	if (room.decade === '20s') {
		var notIn20 = notInPlayedGamesSqlClause(playedGameIds);
		hostMsg('Searching local library (2020s)…');
		selectRandomFullGameRow('202', notIn20, function (local202) {
			if (local202) {
				console.log('THIS GAME ID: ' + local202.game);
				callback(local202);
				return;
			}
			hostMsg('No 2020s games in database; loading from episode pack…');
			jarchiveDynamic.selectPackEpisodeIntoDb(
				db,
				'20s',
				'any',
				playedGameIds,
				function (packErr, packRet) {
					if (packErr) {
						console.warn(
							'Jeopardy pack (2020s / any) failed; using older decades from local DB:',
							packErr && packErr.message ? packErr.message : packErr
						);
					} else if (!packRet) {
						console.warn(
							'Jeopardy pack had no usable 2020s episode; using older decades from local DB.'
						);
					}
					if (packRet) {
						console.log(
							'Loaded 2020s episode from pack: game ' +
								packRet.game +
								', airdate ' +
								packRet.airdate
						);
						hostMsg('2020s episode loaded. Building board…');
						callback(packRet);
						return;
					}
					hostMsg('Searching local library (1980s–2010s)…');
					selectByAirYearPrefixList(
						['198', '199', '200', '201'],
						playedGameIds,
						callback,
						hostMsg
					);
				}
			);
		});
		return;
	}
	hostMsg('Searching local library by decade…');
	selectByDecadeWithFallbacks(room.decade, playedGameIds, callback, hostMsg);
}

/** Airdate year prefixes to try: chosen decade first, then other eras. */
function decadeAirYearPrefixOrder(decade) {
	var map = {
		'80s': '198',
		'90s': '199',
		'00s': '200',
		'10s': '201',
		'20s': '202',
	};
	var primary = map[decade] || '202';
	var all = ['198', '199', '200', '201', '202'];
	var ordered = [primary];
	var i;
	for (i = 0; i < all.length; i++) {
		if (all[i] !== primary) {
			ordered.push(all[i]);
		}
	}
	return ordered;
}

function notInPlayedGamesSqlClause(playedGameIds) {
	if (!playedGameIds || playedGameIds.length === 0) {
		return '';
	}
	var inner = iterateThroughArraySQLite(playedGameIds);
	if (!inner || inner === '()') {
		return '';
	}
	return ' AND clues.game NOT IN ' + inner;
}

/**
 * Pick a random game with exactly 61 clues. If airYearPrefix3 is null, any airdate.
 */
function selectRandomFullGameRow(airYearPrefix3, notInClause, cb) {
	var whereLine =
		airYearPrefix3 != null
			? "WHERE airdate LIKE '" + airYearPrefix3 + "%'\n"
			: 'WHERE 1=1\n';
	var queryThisGameId =
		'SELECT clues.game, airdate\n' +
		'FROM clues\n' +
		'JOIN airdates ON clues.game = airdates.game\n' +
		whereLine +
		notInClause +
		'\n' +
		'GROUP BY clues.game\n' +
		'HAVING count(id) == 61\n' +
		'ORDER BY RANDOM() LIMIT 1';
	console.log(queryThisGameId);
	db.all(queryThisGameId, function (err, rows) {
		if (err) {
			console.log(err);
			cb(null);
			return;
		}
		if (!rows || !rows[0]) {
			cb(null);
			return;
		}
		cb(rows[0]);
	});
}

function selectByAirYearPrefixList(prefixList, playedGameIds, callback, hostMsg) {
	var notInClause = notInPlayedGamesSqlClause(playedGameIds);
	var prefs = prefixList || [];
	var idx = 0;
	function tryNextPrefix() {
		if (idx >= prefs.length) {
			if (hostMsg) {
				hostMsg('No full board in those decades; trying any available game…');
			}
			selectRandomFullGameRow(null, notInClause, function (row) {
				if (row) {
					console.log('Fallback any-decade game: ' + row.game);
					callback(row);
					return;
				}
				if (notInClause) {
					if (hostMsg) {
						hostMsg('All available episodes were played; allowing a replay…');
					}
					selectRandomFullGameRow(null, '', function (replayRow) {
						callback(replayRow || null);
					});
					return;
				}
				callback(null);
			});
			return;
		}
		var prefix = prefs[idx++];
		selectRandomFullGameRow(prefix, notInClause, function (row) {
			if (row) {
				console.log('THIS GAME ID: ' + row.game);
				callback(row);
			} else {
				tryNextPrefix();
			}
		});
	}
	tryNextPrefix();
}

function selectByDecadeWithFallbacks(decade, playedGameIds, callback, hostMsg) {
	selectByAirYearPrefixList(
		decadeAirYearPrefixOrder(decade),
		playedGameIds,
		callback,
		hostMsg
	);
}

function iterateThroughArraySQLite(arrayIterate){
	var parts = [];
	for (var arrayIndex = 0; arrayIndex < arrayIterate.length; arrayIndex++){
		var id = arrayIterate[arrayIndex];
		if (id == null || id === '') continue;
		parts.push("'" + String(id).replace(/'/g, "''") + "'");
	}
	return '(' + parts.join(', ') + ')';
}

function stopTimer(timer){
	clearInterval(timer);
}


function buzzedInBeginCountdown(room) {
	if (room.buzzedInTimer == null) {
		room.buzzedInTimer = setInterval(function () {
			room.buzzedInTimerCount--;
			emitPlayers(room.code, 'update buzzer interval', {
				buzzedInTimerCount: room.buzzedInTimerCount,
				buzzedInPlayerName: room.buzzedInPlayerName,
				buzzedInMemberName: room.buzzedInMemberName,
				buzzedInClientId: room.buzzedInClientId,
			});
			if (room.buzzedInTimerCount === 0) {
				stopTimer(room.buzzedInTimer);
				room.buzzedInTimer = null;
				buzzedInTimesUp(room);
				if (room.isSecondRound && room.roundTimer <= 0) {
					room.finalJeopardyCheck = true;
					console.log('FINAL JEOPARDY CHECK TRUE');
				}
			}
		}, 1000);
	}
}

function buzzedInTimesUp(room) {
	if (
		!room ||
		!room.clueInProgress ||
		!room.buzzedInPlayerName ||
		!room.players[room.buzzedInPlayerName] ||
		!room.questions[room.curQuestionId] ||
		room.answerEvaluationInProgress
	) {
		return;
	}
	room.buzzerFlipped = false;
	var value = room.questions[room.curQuestionId]._value;
	room.players[room.buzzedInPlayerName].score -= value;

	emitPlayers(room.code, 'buzzed in times up', {
		dailyDouble: room.questions[room.curQuestionId].dailyDouble,
		score: room.players[room.buzzedInPlayerName].score,
		curQuestionId: room.curQuestionId,
		playerName: room.buzzedInPlayerName,
		allPlayersAnswered: checkIfAllPlayersAnswered(room),
	});

	emitGame(room.code, 'buzzed in times up', {
		dailyDouble: room.questions[room.curQuestionId].dailyDouble,
		questionId: room.curQuestionId,
		score: room.players[room.buzzedInPlayerName].score,
		playerName: room.buzzedInPlayerName,
		actualAnswer: room.questions[room.curQuestionId]._answer,
		allPlayersAnswered: checkIfAllPlayersAnswered(room),
	});
}

function dailyDoubleBeginCountdown(room) {
	if (room.dailyDoubleTimer == null) {
		room.dailyDoubleTimer = setInterval(function () {
			room.dailyDoubleTimerCount--;
			emitPlayers(room.code, 'update daily double interval', {
				dailyDoubleTimerCount: room.dailyDoubleTimerCount,
				dailyDoublePlayerName: getPlayerActive(room),
				answerTime: room.answerTime,
			});
			if (room.dailyDoubleTimerCount === 0) {
				stopTimer(room.dailyDoubleTimer);
				room.dailyDoubleTimer = null;
				dailyDoubleTimesUp(room);
				if (room.isSecondRound && room.roundTimer <= 0) {
					room.finalJeopardyCheck = true;
				}
			}
		}, 1000);
	}
}

function dailyDoubleTimesUp(room) {
	if (!room || !room.clueInProgress || !room.questions[room.curQuestionId]) {
		return;
	}
	room.buzzerFlipped = false;
	var value = room.questions[room.curQuestionId]._value;
	var activeName = getPlayerActive(room);
	room.players[activeName].score -= value;

	emitPlayers(room.code, 'buzzed in times up', {
		dailyDouble: true,
		score: room.players[activeName].score,
		curQuestionId: room.curQuestionId,
		playerName: activeName,
		allPlayersAnswered: true,
	});

	emitGame(room.code, 'buzzed in times up', {
		dailyDouble: true,
		questionId: room.curQuestionId,
		score: room.players[activeName].score,
		playerName: activeName,
		actualAnswer: room.questions[room.curQuestionId]._answer,
		allPlayersAnswered: true,
		dailyDoubleWager: room.questions[room.curQuestionId]._value,
	});
}

function setRoundTimer(room) {
	room.roundTimerObject = setInterval(function () {
		emitGame(room.code, 'update round interval', {
			roundTimer: room.roundTimer,
			round: room.isSecondRound,
			activePlayerName: getPlayerActive(room),
		});
		emitPlayers(room.code, 'update round interval', room.roundTimer);

		if (room.roundTimer === 0) {
			clearCategoryAutoPickTimer(room);
			room.categorySelectOpen = false;
			emitPlayers(room.code, 'close category select');
			stopTimer(room.roundTimerObject);
			room.roundTimerObject = null;
			if (room.isSecondRound && room.roundTimer <= 0) {
				room.finalJeopardyCheck = true;
			}
			if (!room.isSecondRound) {
				room.isSecondRound = true;
			}
			return;
		}
		room.roundTimer--;
	}, 1000);
}

http.listen(config.port, function () {
	console.log('listening on *:' + http.address().port);
});
