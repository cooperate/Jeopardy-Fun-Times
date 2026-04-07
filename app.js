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

ensureGameHighScoreFile(config.paths.gameHighScore);

const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname + '/'));

app.get('/', function (req, res) {
	res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Jeopardy — start here</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2.5rem auto; padding: 0 1.25rem; line-height: 1.55; color: #1a1a1a; }
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
    <li><strong>Main game board</strong> (TV / host): <a href="/game"><code>/game</code></a></li>
    <li><strong>Player buzzer</strong> (each contestant): <a href="/player"><code>/player</code></a> — three players join and enter names; the third to join picks decade &amp; timer.</li>
    <li><strong>Room code entry</strong> (optional): <a href="/home"><code>/home</code></a> — use if your group uses the room-code flow to reach the player page.</li>
  </ul>
  <p>Start the server with <code>npm start</code> (or <code>node app.js</code>), then use the links above.</p>
</body>
</html>`);
});

app.get('/home', function(req, res){
  	//res.sendFile(__dirname + '/index.html');
  	res.sendFile(__dirname + '/html/game_select.html');
});

app.get('/game', function(req, res){
  	res.sendFile(__dirname + '/html/index.html');
});

app.get('/player', function(req, res){
  res.sendFile(__dirname + '/html/player_field.html');
});


//select socket
var playerSelect = io.of('/home');

//game socket
var gameSpc = io.of('/game');

//player socket
var playerSpc = io.of('/player');

//babyparse is deprecated now
var Baby = require('papaparse');
var gameData = new Array();
var players = new Array();
var questions = new Array();
var curQuestionId;
var curActivePlayer; //player who holds the current lead for picking questions
var file = __dirname + '/data/JEOPARDY_CSV_test.csv';
var lastNameFile = config.paths.lastNameFile;
var gameHistory = config.paths.gameHistory;
var gameHighScore = config.paths.gameHighScore;
var buzzerFlipped = false;
var buzzedInPlayerName;  //tracks player currently answering questions

//TIMERS 
var roundTimerObject;
const ROUND_TIME = 600;//600;
var ANSWER_TIME = 15;
var roundTimer = ROUND_TIME;
var ROUND_QUESTIONS = 30;
var DECADE = "10s";
var AIRDATE = "0";
var GAME_ID = 0;
var questionTimer = null;
var questionTimerCount = 6;
var buzzedInTimer = null;
var buzzedInTimerCount = ANSWER_TIME;
var dailyDoubleTimer = null;
var dailyDoubleTimerCount = ANSWER_TIME;
var isSecondRound = false;
var finalJeopardyCheck = false;
var newGameCounter = 0;
var gameState = {"active": false};
var playedClueIds = new Set();
var playerJoinOrder = [];
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(config.paths.cluesDb);



checkForFullGame();

function buildHostSnapshot() {
	var keys = Object.keys(questions);
	var questionsPlain = {};
	for (var i = 0; i < keys.length; i++) {
		var k = keys[i];
		var q = questions[k];
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
	if (isSecondRound || finalJeopardyCheck) {
		boardRound = 'Double Jeopardy';
	}
	var playersList = [];
	for (var j = 0; j < playerJoinOrder.length; j++) {
		var pname = playerJoinOrder[j];
		if (!players[pname]) {
			continue;
		}
		playersList.push({
			name: pname,
			score: players[pname].score,
			isActive: players[pname].active,
			givenAnswer: players[pname].givenAnswer,
		});
	}
	var ap = getPlayerActive();
	return {
		gameActive: gameState.active === true,
		airdate: AIRDATE,
		answerTime: ANSWER_TIME,
		roundTimer: roundTimer,
		isSecondRound: isSecondRound,
		finalJeopardyCheck: finalJeopardyCheck,
		activePlayerName: ap == null ? '' : ap,
		curQuestionId: curQuestionId == null ? '' : curQuestionId,
		playedQuestionIds: Array.from(playedClueIds),
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

var curRoomCodes = new Array();

function randomString(length, chars) {
    var result = '';
    for (var i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}
var rString = randomString(32, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');

playerSelect.on('connection', function(socket){
	curRoomCodes.push(randomString(4, rString));
	socket.on('room code sent', function(roomCode){
		console.log(curRoomCodes);
		var _roomCode = roomCode.toUpperCase();
		console.log("ROOM CODE SENT " + _roomCode);
		if(curRoomCodes.indexOf(_roomCode) != -1){
			socket.emit('room code validated', true);
			socket.join(_roomCode);
			var base = config.publicBaseUrl || ('http://localhost:' + config.port);
			socket.emit('send to room', base + '/player');
		}
		else{
			socket.emit('room code validated', false);	
		}
	});
	socket.on('disconnect', function () {
  		console.log('A user disconnected');
  	});
});

gameSpc.on('connection', function(socket){
  try {
  	socket.emit('host state snapshot', buildHostSnapshot());
  } catch (err) {
  	console.error('buildHostSnapshot failed', err);
  	socket.emit('host state snapshot', { gameActive: false });
  }

  //buzzers on/off
  socket.on('open buzzer', function () {
  	openTheBuzzer();
  });

  socket.on('close buzzer', function () {
  	playerSpc.emit('close buzzer');
  });

  socket.on('open response final jeopardy', function(){
  	playerSpc.emit('open response final jeopardy', questions["FJ_0_0"]._question);
  });

  socket.on('second round started', function(content){
  	playerSpc.emit('second round started', content);
  });

  socket.on('open question category new round', function(){
  	playerSpc.emit('open question category new round', getPlayerActive());
  });

  socket.on('open question category', function(playerNameActive){
  	console.log("Showing Category Select");
  	setPlayerActive(players[playerNameActive]);
  	playerSpc.emit('open question category', playerNameActive);
  });

  socket.on('next round started', function(){
  	changeActivePlayerNewRound();
  	gameSpc.emit('next round start confirmed', getPlayerActive());
  	playerSpc.emit('next round start confirmed', getPlayerActive());
  });

  //Whenever someone disconnects this piece of code executed
  socket.on('disconnect', function () {
    console.log('A user disconnected');
  });

  socket.on('question timer out', function(){
  	questionTimesUp();
  })

  //assign random player, pass in game markup
  socket.on('player random', function(data){
  		var playerActive = players[findRandomPlayer()];
  		gameState['active'] = true;
  		playerActive.isActive = true;
  		playerSpc.emit('active player', {playerName: getPlayerActive(), gameMarkup: data.gameMarkup, newGame: "new game", airdate: AIRDATE});
  		gameSpc.emit('active player', {playerName: getPlayerActive(), newGame: "new game", airdate: AIRDATE});
  });

  socket.on('final jeopardy started', function(){
  	playerSpc.emit('final jeopardy started');
  });

  socket.on('final jeopardy bid', function()
  {
  	playerSpc.emit('final jeopardy bid', questions["FJ_0_0"]._category);
  });

  socket.on('final jeopardy time out', function()
  {
  	playerSpc.emit('final jeopardy time out');
  });

    socket.on('game over', function(winningPlayerData){
    	fs.appendFileSync(gameHistory, '\n' + GAME_ID);
    	fs.appendFileSync(gameHighScore, '\n' + winningPlayerData.winningPlayerName + ',' + winningPlayerData.winningPlayerScore);
    	playerSpc.emit('game over', winningPlayerData.winningPlayerName);
    });

    socket.on('fetch high scores', function(){
    	var highScores = findHighScores();
    	gameSpc.emit('high scores', highScores);
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

   console.log("Master Screen Connected");

   function findRandomPlayer()
   {	
   	 var names = new Array();
   		for (player in players)
   		{
   			names.push(players[player].name);
   		}
   	return names[Math.floor(Math.random() * objectLength(players))];
   }

   //TIMERS

   socket.on('begin round timer', function(){
   		stopTimer(roundTimerObject);
   		roundTimerObject = null;
   		roundTimer = ROUND_TIME;
   		setRoundTimer();
   });

  socket.on('start countdown', function(questionId){
  	curQuestionId = questionId;
  	questionBeginCountdown();
  	gameSpc.emit('countdown', {timerCount: questionTimerCount, questionId: questionId});
  	playerSpc.emit('expose question');
  });

  socket.on('continue countdown', function(questionId){
  	questionContinueCountdown();
  	gameSpc.emit('countdown', {timerCount: questionTimerCount, questionId: questionId}); //is this being called earlier somehow>SSS
  });

  socket.on('open submit dd', function(){
  	dailyDoubleTimerCount = ANSWER_TIME;
  	dailyDoubleTimer = null;
  	playerSpc.emit('daily double question finished being read');
  	dailyDoubleBeginCountdown();
  });

	//after all messages are done move play to next active player

	socket.on('finished all messages dd', function(){
		console.log('finished all messages dd');
		//if (!finalJeopardyCheck){
			playerSpc.emit('active player', {playerName: getPlayerActive(), correct: false, newGame: "no"});
			gameSpc.emit('active player', {playerName: getPlayerActive(), correct: false});
		//}
	});

	socket.on('all messages done score update correct', function(){ 
		//if(!finalJeopardyCheck){
			console.log("Next player should be going...");
			playerSpc.emit('active player', {playerName: getPlayerActive(), correct: true, newGame: "no"});
			gameSpc.emit('active player', {playerName: getPlayerActive(), correct: true});
		//}
	});
	socket.on('all messages done score update', function(){ 
		//if(!finalJeopardyCheck){
			console.log("Next player should be going...");
			playerSpc.emit('active player', {playerName: getPlayerActive(), correct: false, newGame: "no"});
			gameSpc.emit('active player', {playerName: getPlayerActive(), correct: false});
		//}
	});

	socket.on('all messages done buzzed in time out', function(){
		console.log('all messages done buzzed in time out');
		if (checkIfAllPlayersAnswered()/*&& !finalJeopardyCheck*/){
			playerSpc.emit('active player', {playerName: getPlayerActive(), correct: false, newGame: "no"});
			gameSpc.emit('active player', {playerName: getPlayerActive(), correct: false});
		}
});

	socket.on('new game ready game board', function(){
		newGameCounter = 0;
	  	buzzerFlipped =false;
	  	somecounter = 0;
	  	gameData.length = 0;
	  	gameData = [];
	  	questions.length = 0;
	  	questions = [];
	  	playedClueIds.clear();
	  	finalJeopardyCheck = false;
	  	isSecondRound = false;
	  	roundTimer = ROUND_TIME;
	  	for(player in players){
	  		players[player].score = 0;
	  		players[player].givenAnswer = false;
	  		players[player].isActive = false;
	  	}
	  	//pick next possible game
	  	//CHOOSE GAME FROM DB
		console.log(gameData);
		setGameDataNew();
	});

	socket.on('buzzer pressed confirmed', function(nameData){
		playerSpc.emit('buzzer pressed', {playerName: nameData.playerName, questionId: nameData.questionId});
	});

});

var currentConnections = new Array();
var disconnectedUserNames = new Array();
playerSpc.on('connection', function(socket){
	console.log('player connected.');
	currentConnections.push(socket);
	if (gameState["active"] == true){
		console.log("player attempting to reconnect")
		loadGame(disconnectedUserNames[0], socket, players);
  	}

	//handle player login name/ player join
  	socket.on('login name', function(name){
		console.log("PLAYER JOINED WITH NAME: " + name);
	  	socket.username = name;
	  	currentConnections[socket.id] = {socket: socket};
	  	currentConnections[socket.id].username = name;
	  	console.log("CONNECTION USER DATA " + currentConnections);
		gameSpc.emit('login name', name);
		if (playerJoinOrder.indexOf(name) === -1) {
			playerJoinOrder.push(name);
		}
		players[name] = new Player(name);
		console.log(players);
		if (objectLength(players)== 3)
		{
			playerSpc.emit('option select new', name);
		}
		else
		{
			playerSpc.emit('wait for start game', name);
		}
  	});	

  	//TESTS
  	socket.on('buzzer press test', function(playerNameBuzzed){
  		console.log("THIS PLAYER JUST BUZZED IN: " + playerNameBuzzed);
  	});

  	socket.on('expose question test', function(playerNameExposed){
  		console.log("PLAYER NAMED EXPOSED QUESTION " + playerNameExposed);
  	});

  	//set global turn time, grab game id
  	socket.on('option select new', function(optionArray){
  		console.log(optionArray);
  		ANSWER_TIME = optionArray[0];
  		DECADE = optionArray[1];
  		playerSpc.emit('answer time data', ANSWER_TIME);
  		gameSpc.emit('answer time data', ANSWER_TIME);
  		selectByDecade(DECADE, function(returnValue) {
  			GAME_ID = returnValue.game;
  			AIRDATE = returnValue.airdate;
  			var tempDate = new Date(AIRDATE);
  			AIRDATE = formatDate(tempDate);
  			console.log("GAME_ID: " + GAME_ID + " AIRDATE " + AIRDATE);
  			setGameDataNew();
		});
  	});

  	function formatDate(date) {
		  var monthNames = [
		    "January", "February", "March",
		    "April", "May", "June", "July",
		    "August", "September", "October",
		    "November", "December"
		  ];

		  var day = date.getDate();
		  var monthIndex = date.getMonth();
		  var year = date.getFullYear();

		  return monthNames[monthIndex] + ' ' + day + ', ' + year;
	}

  socket.on('new game', function(){
  	playerSpc.emit('new game');	
  });

  socket.on('new game ready', function(){
  	console.log("NEW GAME COUNTER: " + newGameCounter);
  	newGameCounter+=1; //used to determine when all 3 player clients have reset their local values
  	if (newGameCounter == 3){
  		gameSpc.emit('new game', gameData);
	}
  });

  //When active user selects a question
  socket.on('question selected', function (questionId) {
  	questionTimerCount = 6;
  	console.log("QUESTION SELECTED ID: " + questionId);
  	buzzerFlipped = false;
  	//TODO: pause timer resume when question is received
  	if(roundTimer>0)
  	{
  		questionTimer = null;
		allPlayersNoAnswer();
		curQuestionId  = questionId;
		playedClueIds.add(questionId);
		console.log("Question:" + JSON.stringify(questions[questionId]));
		gameSpc.emit('question reveal', {question: questions[questionId]._question, questionId: questionId, playerName: getPlayerActive()});
		playerSpc.emit('question reveal', {question: questions[questionId]._question, dailyDouble: questions[questionId]._dailyDouble, questionId: questionId, playerName: getPlayerActive()});
 	}
  });

  //When a player buzzes in
  socket.on('buzzer pressed', function(playerName)
  {
  	console.log("BUZZER PRESSED BY: " + playerName);
  	if (!buzzerFlipped)
  	{
  		console.log('buzzer pressed inside buzzerflip check: ' + playerName);
  		buzzerFlipped = true;
  		stopTimer(questionTimer);
		if(questionTimerCount>0)
  		{
  			buzzedInPlayerName = playerName;
		  	gameSpc.emit('buzzer pressed', {playerName: playerName, questionId: curQuestionId});
		  	players[playerName].givenAnswer = true;
		  	buzzedInTimerCount = ANSWER_TIME;
		  	buzzedInBeginCountdown();
	  	}
  	}
  });

  	socket.on('buzzers opened',function(){
		console.log("buzzers opened");
		if (questionTimer == null){
			console.log("should be initiating timer");
			questionTimer = setInterval(function() {
			  questionTimerCount--;
			  playerSpc.emit('update interval', questionTimerCount);
			  gameSpc.emit('update interval', questionTimerCount);
			  if (questionTimerCount <= 0) {
			  		console.log('stopping timer.');
					stopTimer(questionTimer);
					//stopTimer(this.int);
					//questionTimesUp();
					questionTimer = null;
				}
			}, 1000);
		}
	});

  socket.on('player no answer final jeopardy', function(playerName){
  	players[playerName].score -= final_jeopardy_bet[playerName];
  });

  	
  //On answer selection
  socket.on('answer selection', function (answer) {
	buzzerFlipped = false;
	if (answer.finalJeopardyCheck){
		checkAnswerAsync(answer.answer, answer.questionId, answer.playerName, answer.finalJeopardyCheck);
	}
	else if (buzzedInTimerCount > 0){
		stopTimer(buzzedInTimer);
		stopTimer(dailyDoubleTimer);
		buzzedInTimer = null;
		dailyDoubleTimer = null;
		checkAnswerAsync(answer.answer, answer.questionId, answer.playerName, answer.finalJeopardyCheck);
  	}
  });

  var final_jeopardy_bet = new Array();
  //for daily double bets and final jeopardy
  socket.on('bet selection', function (bet){
  	 //set question value to bet
  	 if (!bet.finalJeopardyCheck)
  	 {
	  	 questions[bet.questionId]._value = bet.betValue;
	  	 playerSpc.emit('daily double response', {playerName: bet.playerName, questionId: bet.questionId, question: questions[bet.questionId]._question, isDailyDouble: true});

	  	 gameSpc.emit('question reveal dd', {question: questions[bet.questionId]._question, questionId: bet.questionId, bet: bet.betValue});
  	}
  	else
  	{
  		final_jeopardy_bet[bet.playerName] = {playerName: bet.playerName, bet: bet.betValue};

  		gameSpc.emit('final jeopardy response', {playerName: bet.playerName, bet: bet.betValue});
  	}
  });

  socket.on('player field fj time out', function(playerName){
  	console.log("sending data: score  "+  players[playerName].score + "name " + playerName);
  	var timeOutScore = parseInt(players[playerName].score);
  	timeOutScore -= parseInt(final_jeopardy_bet[playerName].bet);
  	gameSpc.emit('score update final jeopardy buzzed out', {playerName: playerName, score: timeOutScore, correct: false, answer:"", buzzedInFJ: false});
  });
  //Whenever someone disconnects this piece of code executed
  socket.on('disconnect', function () {
    console.log('A user disconnected');
    if(currentConnections[this.id]){
   		disconnectedUserNames.push(currentConnections[this.id].username);
   	}
   	console.log("DISCONNECTED USERNAME DATA " + disconnectedUserNames);
  });

	function checkAnswerAsync(answer, questionId, playerName, finalJeopardy) {
		if (finalJeopardy) {
			questionId = 'FJ_0_0';
		}

		var originalPlayerAnswer = answer.toUpperCase();
		var originalActualAnswer = questions[questionId]._answer.toUpperCase();
		var score = players[playerName].score;
		var value = parseInt(questions[questionId]._value, 10);
		var correct = false;

		evaluateAnswer({
			playerAnswer: answer,
			canonicalAnswer: questions[questionId]._answer,
			clueText: questions[questionId]._question,
			lastNameFilePath: lastNameFile,
			aiEnabled: config.openaiAnswerJudgeEnabled,
			openaiApiKey: config.openaiApiKey,
			openaiModel: config.openaiModel,
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
					setPlayerActive(players[playerName]);
				} else {
					score -= value;
				}

				if (finalJeopardy) {
					if (correct) {
						score += parseInt(final_jeopardy_bet[playerName].bet, 10);
					} else {
						score -= parseInt(final_jeopardy_bet[playerName].bet, 10);
					}
				}

				players[playerName].score = score;

				if (!finalJeopardy) {
					gameSpc.emit('score update', {
						score: players[playerName].score,
						answer: originalPlayerAnswer,
						playerName: playerName,
						actualAnswer: originalActualAnswer,
						dailyDouble: questions[questionId]._dailyDouble,
						dailyDoubleBet: questions[questionId]._value,
						questionId: questionId,
						correct: correct,
						allPlayersAnswered: checkIfAllPlayersAnswered(),
					});
					playerSpc.emit('score update', {
						score: players[playerName].score,
						playerName: playerName,
						questionId: questionId,
						correct: correct,
						dailyDouble: questions[questionId]._dailyDouble,
						dailyDoubleBet: questions[questionId]._value,
						allPlayersAnswered: checkIfAllPlayersAnswered(),
					});
				} else {
					gameSpc.emit('score update final jeopardy', {
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
			});
	}
});


  	function setGameDataNew(){
  		var last_clue_id = 0;
  		var first_clue_id;
  		var question_object_ids = {};
  		var queryQuestions ="SELECT clues.id, clues.game, round, value, category, clue, answer, media \n" +
			"FROM clues\n" +
			"JOIN documents ON clues.id = documents.id\n" +
			"JOIN classifications ON clues.id = classifications.clue_id\n" +
			"JOIN categories ON classifications.category_id = categories.id\n" +
			"WHERE clues.game = '" + GAME_ID + "'";

		var queryQuestionsOrder ="SELECT id\n" +
			"FROM clues\n" +
			"WHERE game = '" + GAME_ID + "'\n"+
			"ORDER BY id DESC";

	
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
			        	questions[this_question_id] = tempQuestion;

			        	if (tempQuestion.dailyDouble == true){
			        		console.log("\n THIS QUESTION IS A DAILY DOUBLE: " + tempQuestion.questionId + "\n");
			        	}
			        }

			        downloadImages();
			       console.log("THIS GAMES QUESTIONS: " + JSON.stringify(questions));
			    }
			  });
  		});
  	}

  	function downloadImages(){
  		  for(question in questions){
  			var mediaLink = questions[question].mediaLink;
  			mediaLink = mediaLink.trim();
  			console.log("MEDIA LINK on question loop: /" + mediaLink + "/");
  			if (mediaLink)
  			{
  				var url_img_name = mediaLink;
  				//console.log(JSON.stringify(questions[question]));
  				url_img_name = url_img_name.split("/media/");
  				var filePath = "/temp-media/" +  questions[question].mediaType + "/" + url_img_name[1];
				if(false)
				{
					console.log("doesn't need download");
					questions[question].mediaLink = filePath;
					gameSpc.emit('game data', {questionID: questions[question].questionId, question: questions[question]});
				}
				else
				{
					console.log(questions[question]);
					(function(_question, _filePath, _url_img_name){

						console.log('QUESTION inside fs check ' + _question);
						console.log('URL_IMG_NAME ' + _url_img_name);
						console.log('FILE PATH ' + _filePath);
					  	download(_question.mediaLink, _url_img_name, function(){ //download images, once callback is completed for every image begin game
							console.log('done download');
							_question.mediaLink = _filePath;
							gameSpc.emit('game data', {questionID: _question.questionId, question: _question});
						}, _question.mediaType);
					})(questions[question], filePath, url_img_name[1]);
				}
  			}
  			else
			{
	  			gameSpc.emit('game data', {questionID: questions[question].questionId, question: questions[question]});
			}
  	 	}
  	}

function openTheBuzzer(){
	console.log("should be continuing countdown");
	playerSpc.emit('open buzzer');
}

function loadGame(name, socket, players){
	console.log("player attempting to rejoin with name " + name);
	console.log("players is " + players);
	gameState = {"active": gameState["active"],
	"final-jeopardy-check": finalJeopardyCheck,
	"buzzed-in-player-name": buzzedInPlayerName,
	"active-player-name": curActivePlayer,
	"players": players,
	"player-name": name};
	socket.emit('update-state-reload', gameState);
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

function changeActivePlayerNewRound(){
	var lowestScore = 999999;
	var playerLow;
	
	for (player in players)
	{
		if (players[player].score < lowestScore)
		{	
			lowestScore = players[player].score;
			playerLow = players[player];
		}
	}
	console.log("LOWEST SCORING PLAYER: " + playerLow);
	setPlayerActive(players[playerLow._name]);
}

function questionBeginCountdown()
{ 
	if (questionTimer == null){
		questionTimer = setInterval(function() {
		  questionTimerCount--;
		  playerSpc.emit('update interval', questionTimerCount);
		  gameSpc.emit('update interval', questionTimerCount);
		  if (questionTimerCount <= 0) {
		  		console.log('stopping timer.');
				stopTimer(questionTimer);
				//stopTimer(this.int);
				//questionTimesUp();
				questionTimer = null;
			}
		}, 1000);
	}
}

function questionContinueCountdown()
{ 
	clearInterval(questionTimer);
	questionTimer = null;
	openTheBuzzer();
}

function questionTimesUp(){
 	playerSpc.emit('question disappear', curQuestionId);

 	playerSpc.emit('active player', {playerName: getPlayerActive(), correct: false, newGame: "no"});
 	gameSpc.emit('active player', {newGame: false, playerName: getPlayerActive()});
}

function setPlayerActive(playerActive)
{
	console.log("PLAYER ACTIVE " + playerActive);
	playerActive.isActive = true;

	for (player in players)
	{
		if (players[player] != playerActive)
		{
			players[player].isActive = false;
		}
		else{
			players[player].isActive = true;	
		}
	}
}

function getPlayerActive()
{
	for (player in players)
	{
		if (players[player].active == true)
		{	
			return players[player].name;
		}
	}
}

function checkIfAllPlayersAnswered(){
	 var increment = 0;

  	for (player in players)
  	{
  		if (players[player].givenAnswer == true)
  		{
  			increment++;
  		}
  	}

  	if(increment >= 3)
  	{
  		return true;
  	}

  	else
  	{
  		return false;
  	}
}

function allPlayersNoAnswer()
{
	 for (player in players)
  	{
  		players[player].givenAnswer = false;
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


//PLAYER SOCKET 

function buzzedInBeginCountdown()
	{
		if (buzzedInTimer == null){
			buzzedInTimer = setInterval(function(){
				buzzedInTimerCount--;
				playerSpc.emit('update buzzer interval', {buzzedInTimerCount: buzzedInTimerCount, buzzedInPlayerName: buzzedInPlayerName});
	    		if (buzzedInTimerCount === 0) {
					stopTimer(buzzedInTimer);
					buzzedInTimer = null;
					buzzedInTimesUp();
					if (isSecondRound && roundTimer<=0){
						finalJeopardyCheck = true;
						console.log("FINAL JEOPARDY CHECK TRUE");
					}
				}
			}, 1000);
		}
	}

	//when a player runs out of time

	function buzzedInTimesUp(){
	  	buzzerFlipped = false;
  		var value = questions[curQuestionId]._value;
  		players[buzzedInPlayerName].score -= value;

  		playerSpc.emit('buzzed in times up', {dailyDouble: questions[curQuestionId].dailyDouble, score: players[buzzedInPlayerName].score, curQuestionId: curQuestionId, playerName: buzzedInPlayerName, allPlayersAnswered: checkIfAllPlayersAnswered()});		
													
  		gameSpc.emit('buzzed in times up', {dailyDouble: questions[curQuestionId].dailyDouble, questionId:curQuestionId, score: players[buzzedInPlayerName].score, playerName: buzzedInPlayerName, actualAnswer: questions[curQuestionId]._answer , allPlayersAnswered: checkIfAllPlayersAnswered()});
	}

//GAME "HOST SCREEN" SOCKET

    function dailyDoubleBeginCountdown(playerName)
	{
		if (dailyDoubleTimer == null)
		{
			dailyDoubleTimer = setInterval(function(){
				dailyDoubleTimerCount--;
				playerSpc.emit('update daily double interval', {dailyDoubleTimerCount: dailyDoubleTimerCount, dailyDoublePlayerName: getPlayerActive(), answerTime: ANSWER_TIME});
	    		if (dailyDoubleTimerCount === 0) {
					stopTimer(dailyDoubleTimer);
					dailyDoubleTimer = null;
					dailyDoubleTimesUp();
					if (isSecondRound && roundTimer<=0){
						finalJeopardyCheck = true;
					}
				}
			}, 1000);
		}
	}

	function dailyDoubleTimesUp(){
		buzzerFlipped = false;
  		var value = questions[curQuestionId]._value;
  		players[getPlayerActive()].score -= value;

  		playerSpc.emit('buzzed in times up', {dailyDouble: true/*questions[curQuestionId].dailyDouble*/, score: players[getPlayerActive()].score, curQuestionId: curQuestionId, playerName: getPlayerActive(), allPlayersAnswered: true});		
													
  		gameSpc.emit('buzzed in times up', {dailyDouble: true/*questions[curQuestionId].dailyDouble*/, questionId:curQuestionId, score: players[getPlayerActive()].score, playerName: getPlayerActive(), actualAnswer: questions[curQuestionId]._answer , allPlayersAnswered: true, dailyDoubleWager: questions[curQuestionId]._value});
	}

	function setRoundTimer()
	{
		roundTimerObject = setInterval(function () {
			gameSpc.emit('update round interval', {
				roundTimer: roundTimer,
				round: isSecondRound,
				activePlayerName: getPlayerActive(),
			});
			playerSpc.emit('update round interval', roundTimer);

			if (roundTimer === 0) {
				playerSpc.emit('close category select');
				stopTimer(roundTimerObject);
				roundTimerObject = null;
				if (isSecondRound && roundTimer <= 0) {
					finalJeopardyCheck = true;
				}
				if (!isSecondRound) {
					isSecondRound = true;
				}
				return;
			}
			roundTimer--;
		}, 1000);
	}

http.listen(config.port, function () {
	console.log('listening on *:' + config.port);
});
