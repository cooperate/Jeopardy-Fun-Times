//TODO: buzzing in immediately when question opens causes question timer to go down/question repeat
//ipads getting blocked out of answering

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const { ensureGameHighScoreFile } = require('./lib/ensureDataFiles');
const { Player, Question } = require('./lib/models');
const { parseMediaType, parseAnswer } = require('./lib/parsers');
const { evaluateAnswer } = require('./lib/evaluateAnswer');
const {
	createGameRoom,
	normalizeRoomCode: normRoom,
	generateUniqueRoomCode,
	ROUND_TIME,
} = require('./lib/gameRoom');

ensureGameHighScoreFile(config.paths.gameHighScore);

/** code (uppercase) -> per-room game state */
var gameRooms = new Map();

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

// Browsers request /favicon.ico by default; serve project SVG so there is no 404.
app.get('/favicon.ico', function (req, res) {
	res.type('image/svg+xml');
	res.sendFile(path.join(__dirname, 'favicon.svg'));
});

app.use(express.static(__dirname + '/'));

app.get('/', function (req, res) {
	res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/zain-fonts.css">
  <title>Jeopardy — start here</title>
  <style>
    body { font-family: 'Zain', system-ui, sans-serif; max-width: 32rem; margin: 2.5rem auto; padding: 0 1.25rem; line-height: 1.55; color: #1a1a1a; }
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
    <li><strong>Players</strong>: <a href="/home"><code>/home</code></a> to enter the room code, or open <code>/player?room=ROOM</code> directly.</li>
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

app.get('/api/rooms/new', function (req, res) {
	var code = generateUniqueRoomCode(gameRooms);
	gameRooms.set(code, createGameRoom(code));
	res.json({ roomCode: code });
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
function getRoomFromSocket(socket) {
	if (!socket || !socket.roomCode) {
		return null;
	}
	return gameRooms.get(socket.roomCode) || null;
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
		playersList.push({
			name: pname,
			score: room.players[pname].score,
			isActive: room.players[pname].active,
			givenAnswer: room.players[pname].givenAnswer,
		});
	}
	var ap = getPlayerActive(room);
	return {
		gameActive: room.gameState.active === true,
		airdate: room.airdate,
		answerTime: room.answerTime,
		roundTimer: room.roundTimer,
		isSecondRound: room.isSecondRound,
		finalJeopardyCheck: room.finalJeopardyCheck,
		finalJeopardyWageringPhase: room.finalJeopardyWageringPhase,
		finalJeopardyAnswerPhase: room.finalJeopardyAnswerPhase,
		activePlayerName: ap == null ? '' : ap,
		curQuestionId: room.curQuestionId == null ? '' : room.curQuestionId,
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
function download(uri, filename, callback, type) {
	var destDir = path.join(__dirname, 'temp-media', type);
	console.log('DOWNLOAD: ' + filename);
	console.log('TYPE: ' + type);
	console.log('URI: ' + uri);
	fs.mkdirSync(destDir, { recursive: true });
	var destPath = path.join(destDir, filename);
	fetch(uri)
		.then(function (res) {
			if (!res.ok) {
				throw new Error('HTTP ' + res.status + ' ' + res.statusText);
			}
			console.log('content-type:', res.headers.get('content-type'));
			console.log('content-length:', res.headers.get('content-length'));
			return res.arrayBuffer();
		})
		.then(function (buf) {
			fs.writeFileSync(destPath, Buffer.from(buf));
			callback();
		})
		.catch(function (err) {
			console.error('DOWNLOAD failed:', uri, err.message || err);
			callback();
		});
}

playerSelect.on('connection', function(socket){
	socket.on('room code sent', function(roomCode){
		var _roomCode = normRoom(roomCode);
		console.log('ROOM CODE SENT ' + _roomCode);
		if (_roomCode && gameRooms.has(_roomCode)){
			socket.emit('room code validated', true);
			var base = config.publicBaseUrl || ('http://localhost:' + config.port);
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
	socket.roomCode = code;
	socket.join(ioRoomName(code));
	var room = gameRooms.get(code);

	socket.emit('host room code', { code: room.code });
	try {
		socket.emit('host state snapshot', buildHostSnapshot(room));
	} catch (err) {
		console.error('buildHostSnapshot failed', err);
		socket.emit('host state snapshot', { gameActive: false });
	}

	socket.on('host request new game', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('host request new game');
		r.pendingHostForcedNewGame = true;
		r.newGameCounter = 0;
		r.finalJeopardyWageringPhase = false;
		r.finalJeopardyAnswerPhase = false;
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
		if (!r) {
			return;
		}
		r.finalJeopardyAnswerPhase = true;
		r.finalJeopardyWageringPhase = false;
		emitPlayers(r.code, 'open response final jeopardy', r.questions['FJ_0_0']._question);
	});

	socket.on('second round started', function (content) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
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
	});

	socket.on('open question category', function (playerNameActive) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('Showing Category Select');
		r.categorySelectOpen = true;
		setPlayerActive(r, r.players[playerNameActive]);
		emitPlayers(r.code, 'open question category', playerNameActive);
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
	});

	socket.on('question timer out', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
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
		if (!r) {
			return;
		}
		emitPlayers(r.code, 'final jeopardy started');
	});

	socket.on('final jeopardy bid', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		r.finalJeopardyWageringPhase = true;
		emitPlayers(r.code, 'final jeopardy bid', r.questions['FJ_0_0']._category);
	});

	socket.on('final jeopardy time out', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		emitPlayers(r.code, 'final jeopardy time out');
	});

	socket.on('game over', function (winningPlayerData) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		fs.appendFileSync(gameHistory, '\n' + r.gameId);
		fs.appendFileSync(
			gameHighScore,
			'\n' + winningPlayerData.winningPlayerName + ',' + winningPlayerData.winningPlayerScore
		);
		emitPlayers(r.code, 'game over', winningPlayerData.winningPlayerName);
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
		var rowsHighScore = parsedHighScore.data;

		var highScoreArray = new Array();

		for(var row in rowsHighScore){
			var score=rowsHighScore[row][1];
			var name=rowsHighScore[row][0];
			if (row==0){
				highScoreArray.push({name: name, score: score});
				
			}else{
				if(score<highScoreArray[0].score){
					highScoreArray.unshift({name: name, score:score});
				}else{			
					var indexCounter = highScoreArray.length - 1;	
					while(score<highScoreArray[indexCounter].score){
						indexCounter--;
					}
					highScoreArray.splice( indexCounter, 0, {name:name, score:score});
				}
			}
		}
		
		highScoreArray.reverse();

		return highScoreArray;
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
		if (!r) {
			return;
		}
		r.curQuestionId = questionId;
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
		emitPlayers(r.code, 'active player', {
			playerName: getPlayerActive(r),
			correct: true,
			newGame: 'no',
		});
		emitGame(r.code, 'active player', { playerName: getPlayerActive(r), correct: true });
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
		r.finalJeopardyBet = {};
		r.isSecondRound = false;
		r.roundTimer = ROUND_TIME;
		r.lastPlayerBoardMarkup = '';
		r.categorySelectOpen = false;
		r.clueInProgress = false;
		r.playerBuzzerUnlocked = false;
		for (var player in r.players) {
			r.players[player].score = 0;
			r.players[player].givenAnswer = false;
			r.players[player].isActive = false;
		}
		console.log(r.gameData);
		setGameDataNew(r);
	});

	socket.on('buzzer pressed confirmed', function (nameData) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		emitPlayers(r.code, 'buzzer pressed', {
			playerName: nameData.playerName,
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

	console.log('player connected.');

	socket.on('login name', function (name) {
		name = String(name || '').trim().toUpperCase();
		if (!name) {
			return;
		}
		console.log('PLAYER LOGIN: ' + name);
		socket.username = name;
		playerConnectionBySocketId[socket.id] = { username: name, roomCode: code };

		var existing = room.players[name];
		if (existing) {
			console.log('PLAYER RECONNECT: ' + name);
			if (room.gameState.active === true) {
				sendPlayerReconnectState(socket, name, room);
				return;
			}
			var thirdPlayer = room.playerJoinOrder.length >= 3 ? room.playerJoinOrder[2] : null;
			if (objectLength(room.players) === 3 && name === thirdPlayer && !room.hostGameOptionsSelected) {
				socket.emit('option select new', name);
			} else {
				socket.emit('wait for start game', name);
			}
			return;
		}

		emitGame(room.code, 'login name', name);
		if (room.playerJoinOrder.indexOf(name) === -1) {
			room.playerJoinOrder.push(name);
		}
		room.players[name] = new Player(name);
		console.log(room.players);
		if (objectLength(room.players) === 3) {
			socket.emit('option select new', name);
		} else {
			socket.emit('wait for start game', name);
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
		if (!r) {
			return;
		}
		console.log(optionArray);
		r.hostGameOptionsSelected = true;
		r.answerTime = optionArray[0];
		r.decade = optionArray[1];
		emitPlayers(r.code, 'answer time data', r.answerTime);
		emitGame(r.code, 'answer time data', r.answerTime);
		selectByDecade(r.decade, function (returnValue) {
			r.gameId = returnValue.game;
			r.airdate = returnValue.airdate;
			var tempDate = new Date(r.airdate);
			r.airdate = formatPlayerOptionDate(tempDate);
			console.log('GAME_ID: ' + r.gameId + ' AIRDATE ' + r.airdate);
			setGameDataNew(r);
		});
	});

	socket.on('new game', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		emitPlayers(r.code, 'new game');
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
		if (r.newGameCounter == 3) {
			emitGame(r.code, 'new game', r.gameData);
		}
	});

	socket.on('question selected', function (questionId) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		r.questionTimerCount = 6;
		console.log('QUESTION SELECTED ID: ' + questionId);
		r.buzzerFlipped = false;
		if (r.roundTimer > 0) {
			r.categorySelectOpen = false;
			r.clueInProgress = true;
			r.playerBuzzerUnlocked = false;
			r.buzzedInPlayerName = undefined;
			stopTimer(r.buzzedInTimer);
			r.buzzedInTimer = null;
			r.buzzedInTimerCount = r.answerTime;
			r.questionTimer = null;
			allPlayersNoAnswer(r);
			r.curQuestionId = questionId;
			r.playedClueIds.add(questionId);
			console.log('Question:' + JSON.stringify(r.questions[questionId]));
			emitGame(r.code, 'question reveal', {
				question: r.questions[questionId]._question,
				questionId: questionId,
				playerName: getPlayerActive(r),
			});
			emitPlayers(r.code, 'question reveal', {
				question: r.questions[questionId]._question,
				dailyDouble: r.questions[questionId]._dailyDouble,
				questionId: questionId,
				playerName: getPlayerActive(r),
			});
		}
	});

	socket.on('buzzer pressed', function (playerName) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('BUZZER PRESSED BY: ' + playerName);
		if (!r.buzzerFlipped) {
			console.log('buzzer pressed inside buzzerflip check: ' + playerName);
			r.buzzerFlipped = true;
			r.playerBuzzerUnlocked = false;
			stopTimer(r.questionTimer);
			if (r.questionTimerCount > 0) {
				r.buzzedInPlayerName = playerName;
				emitGame(r.code, 'buzzer pressed', {
					playerName: playerName,
					questionId: r.curQuestionId,
				});
				r.players[playerName].givenAnswer = true;
				r.buzzedInTimerCount = r.answerTime;
				buzzedInBeginCountdown(r);
			}
		}
	});

	socket.on('buzzers opened', function () {
		var r = getRoomFromSocket(socket);
		if (!r) {
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
		if (!r) {
			return;
		}
		var fb = r.finalJeopardyBet[playerName];
		if (fb && fb.bet !== undefined) {
			r.players[playerName].score -= fb.bet;
		}
	});

	socket.on('answer selection', function (answer) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		r.buzzerFlipped = false;
		if (answer.finalJeopardyCheck) {
			checkAnswerAsync(r, answer.answer, answer.questionId, answer.playerName, answer.finalJeopardyCheck);
		} else if (r.buzzedInTimerCount > 0) {
			stopTimer(r.buzzedInTimer);
			stopTimer(r.dailyDoubleTimer);
			r.buzzedInTimer = null;
			r.dailyDoubleTimer = null;
			checkAnswerAsync(r, answer.answer, answer.questionId, answer.playerName, answer.finalJeopardyCheck);
		}
	});

	socket.on('bet selection', function (bet) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		if (!bet.finalJeopardyCheck) {
			r.questions[bet.questionId]._value = bet.betValue;
			emitPlayers(r.code, 'daily double response', {
				playerName: bet.playerName,
				questionId: bet.questionId,
				question: r.questions[bet.questionId]._question,
				isDailyDouble: true,
			});
			emitGame(r.code, 'question reveal dd', {
				question: r.questions[bet.questionId]._question,
				questionId: bet.questionId,
				bet: bet.betValue,
			});
		} else {
			r.finalJeopardyBet[bet.playerName] = { playerName: bet.playerName, bet: bet.betValue };
			emitGame(r.code, 'final jeopardy response', {
				playerName: bet.playerName,
				bet: bet.betValue,
			});
		}
	});

	socket.on('player field fj time out', function (playerName) {
		var r = getRoomFromSocket(socket);
		if (!r) {
			return;
		}
		console.log('sending data: score  ' + r.players[playerName].score + 'name ' + playerName);
		var timeOutScore = parseInt(r.players[playerName].score, 10);
		timeOutScore -= parseInt(r.finalJeopardyBet[playerName].bet, 10);
		emitGame(r.code, 'score update final jeopardy buzzed out', {
			playerName: playerName,
			score: timeOutScore,
			correct: false,
			answer: '',
			buzzedInFJ: false,
		});
	});

	socket.on('disconnect', function () {
		console.log('A user disconnected');
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
			correct = result.correct;
			if (result.source === 'openai') {
				console.log(
					'Answer judged by OpenAI: ' +
						(correct ? 'correct' : 'incorrect') +
						(result.aiReason ? ' — ' + result.aiReason : '')
				);
			}

			if (finalJeopardy) {
				value = 0;
			}

			if (correct) {
				score += value;
				setPlayerActive(room, room.players[playerName]);
			} else {
				score -= value;
			}

			if (finalJeopardy) {
				if (correct) {
					score += parseInt(room.finalJeopardyBet[playerName].bet, 10);
				} else {
					score -= parseInt(room.finalJeopardyBet[playerName].bet, 10);
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
				emitGame(room.code, 'score update final jeopardy', {
					score: score,
					answer: originalPlayerAnswer,
					playerName: playerName,
					correct: correct,
					buzzedInFJ: true,
				});
			}
		})
		.catch(function (err) {
			console.error('evaluateAnswer failed', err);
			emitGame(room.code, 'answer ai judging end');
		});
}


function setGameDataNew(room) {
		var last_clue_id = 0;
		var first_clue_id;
		var question_object_ids = {};
		var gid = room.gameId;
		var queryQuestions =
			'SELECT clues.id, clues.game, round, value, category, clue, answer, media \n' +
			'FROM clues\n' +
			'JOIN documents ON clues.id = documents.id\n' +
			'JOIN classifications ON clues.id = classifications.clue_id\n' +
			'JOIN categories ON classifications.category_id = categories.id\n' +
			"WHERE clues.game = '" +
			gid +
			"'";

		var queryQuestionsOrder =
			'SELECT id\n' + 'FROM clues\n' + "WHERE game = '" + gid + "'\n" + 'ORDER BY id DESC';

	
		var round_1_values = [
			200,
			400,
			600,
			800,
			1000
		];

		var round_2_values = [
					400,
					800,
					1200,
					1600,
					2000
		];
		
		//check if this question is a Daily Double!
		
		var firstRoundDD = Math.floor((Math.random() * 30));

		var secondRoundDD_A = Math.floor((Math.random() * 30));

		var secondRoundDD_B = (function(otherNum){
			var randomNum = Math.floor((Math.random() * 30));
			while(randomNum == otherNum){
				randomNum = Math.floor((Math.random() * 30));
			}
			return randomNum;
		})(secondRoundDD_A);

		db.serialize(function() {
			db.all(queryQuestionsOrder, function(err, rows){
				if(err){
					console.log(err);
				}else{
					//calculate question id's for appropriate format
					last_clue_id = rows[0].id; 
					first_clue_id = last_clue_id - 60;
					for (var index = first_clue_id; index<last_clue_id; index++ ){
						question_object_ids[index] = index - first_clue_id; 
					}

					var questionRow = 0;

					for (var index=0; index<=60; index++){
						var question_num = 0;
						var dailyDouble = false;
						if (index < 30){
							if (index == firstRoundDD){
								dailyDouble = true;
							}
							question_object_ids[index+first_clue_id] = {question_id: "J_" + index%6 + "_" + questionRow, value: round_1_values[questionRow], dailyDouble: dailyDouble};
						}
						else if(index < 60){
							if (index - 30 == secondRoundDD_A || index - 30 == secondRoundDD_B)
							{
								dailyDouble = true;
							}
							question_object_ids[index+first_clue_id] = {question_id: "DJ_" + index%6 + "_" + questionRow, value: round_2_values[questionRow], dailyDouble: dailyDouble};
						}
						else{
							question_object_ids[index+first_clue_id] = {question_id: "FJ_0_0", value: 0, dailyDouble: false};
						}
						if((index+1)%6 == 0){
							questionRow++;
						}
						if((index+1) == 30){
							questionRow = 0;
						}
					}
					console.log("game clue ids: " +  JSON.stringify(question_object_ids));
					console.log("Last Clue Id: " + last_clue_id);
				}
			});

	  		db.all(queryQuestions, function (err, rows) {
	    		if(err){
			        console.log(err);
			    }else{
			        for (var row in rows){
			        	//console.log("THIS ROW RAW DATA : " + rows[row]);
			        	var this_clue_id = rows[row].id;
			        	var this_question_id = question_object_ids[this_clue_id].question_id;
			        	var this_clue_media = rows[row].media;
			        	this_clue_media = this_clue_media.trim();
			        	//create question, set relevant fields
			        	var tempQuestion = new Question(rows[row].category, question_object_ids[this_clue_id].value, rows[row].clue, rows[row].answer, question_object_ids[this_clue_id].dailyDouble, question_object_ids[this_clue_id].question_id, this_clue_media, rows[row].round);
			        	console.log("parsing " + JSON.stringify(tempQuestion));
			        	var mediaType = parseMediaType(tempQuestion.mediaLink);
						var answerStrip = parseAnswer(tempQuestion.answer);
						tempQuestion.answer = answerStrip;
						tempQuestion.mediaType = mediaType;
			        	room.questions[this_question_id] = tempQuestion;

			        	if (tempQuestion.dailyDouble == true){
			        		console.log("\n THIS QUESTION IS A DAILY DOUBLE: " + tempQuestion.questionId + "\n");
			        	}
			        }

			        downloadImages(room);
			       console.log('THIS GAMES QUESTIONS: ' + JSON.stringify(room.questions));
			    }
			  });
  		});
}

function downloadImages(room) {
	for (var question in room.questions) {
		var mediaLink = room.questions[question].mediaLink;
		mediaLink = mediaLink.trim();
		console.log('MEDIA LINK on question loop: /' + mediaLink + '/');
		if (mediaLink) {
			var url_img_name = mediaLink;
			url_img_name = url_img_name.split('/media/');
			var filePath =
				'/temp-media/' + room.questions[question].mediaType + '/' + url_img_name[1];
			if (false) {
				console.log("doesn't need download");
				room.questions[question].mediaLink = filePath;
				emitGame(room.code, 'game data', {
					questionID: room.questions[question].questionId,
					question: room.questions[question],
				});
			} else {
				console.log(room.questions[question]);
				(function (_question, _filePath, _url_img_name, r) {
					console.log('QUESTION inside fs check ' + _question);
					console.log('URL_IMG_NAME ' + _url_img_name);
					console.log('FILE PATH ' + _filePath);
					download(_question.mediaLink, _url_img_name, function () {
						console.log('done download');
						_question.mediaLink = _filePath;
						emitGame(r.code, 'game data', {
							questionID: _question.questionId,
							question: _question,
						});
					}, _question.mediaType);
				})(room.questions[question], filePath, url_img_name[1], room);
			}
		} else {
			emitGame(room.code, 'game data', {
				questionID: room.questions[question].questionId,
				question: room.questions[question],
			});
		}
	}
}

function openTheBuzzer(room) {
	console.log('should be continuing countdown');
	room.playerBuzzerUnlocked = true;
	emitPlayers(room.code, 'open buzzer');
}

function returnToBoardPickerState(room) {
	room.clueInProgress = false;
	room.categorySelectOpen = false;
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
		'buzzed-in-player-name': room.buzzedInPlayerName,
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
	var lowestScore = 999999;
	var playerLow;

	for (var player in room.players) {
		if (room.players[player].score < lowestScore) {
			lowestScore = room.players[player].score;
			playerLow = room.players[player];
		}
	}
	console.log('LOWEST SCORING PLAYER: ' + playerLow);
	setPlayerActive(room, room.players[playerLow._name]);
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

	if (increment >= 3) {
		return true;
	}

	return false;
}

function allPlayersNoAnswer(room) {
	for (var player in room.players) {
		room.players[player].givenAnswer = false;
	}
}

function selectByDecade(decade, callback){

	var useDecade = 201;

	switch(decade){
		case "80s":
			useDecade = 198;
		break;
		case "90s":
			useDecade = 199;
		break;
		case "00s":
			useDecade = 200;
		break;
		case "10s":
			useDecade = 201;
		break;
	}

		var gameHistorySend = fs.readFileSync(gameHistory, {
  		encoding: 'binary'
	});
	// pass in the contents of a csv file
	var parsedHistory = Baby.parse(gameHistorySend);
// voila
	var rowsHistory = parsedHistory.data;

	var historyArray = new Array();
	for (var rowY in rowsHistory)
	{
		historyArray.push(rowsHistory[rowY][0]);
	}

	var playedGameIds = historyArray.filter(function (id) {
		return id != null && id !== '' && id !== 'undefined';
	});
	var notInClause = '';
	if (playedGameIds.length > 0) {
		notInClause =
			' AND clues.game NOT IN ' + iterateThroughArraySQLite(playedGameIds);
	}

	db.serialize(function() {

		var queryThisGameId ="SELECT clues.game, airdate\n" +
			"FROM clues\n" +
			"JOIN airdates ON clues.game = airdates.game\n" +
			"WHERE airdate LIKE '" + useDecade + "%'\n" +
			notInClause + "\n" +
			"GROUP BY clues.game\n" +
			"HAVING count(id) == 61\n" +
			"ORDER BY RANDOM() LIMIT 1";

			console.log(queryThisGameId);

	    db.all(queryThisGameId, function (err, rows) {
    		if(err){
		        console.log(err);
		    }else{
		    	if (!rows || !rows[0]) {
		    		console.error('selectByDecade: no game row returned');
		    		return;
		    	}
		        callback(rows[0]);
		        console.log("THIS GAME ID: " + rows[0].game);
		    }
		  });
	});
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
	console.log('listening on *:' + config.port);
});
