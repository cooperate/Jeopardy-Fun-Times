//TODO: buzzing in immediately when question opens causes question timer to go down/question repeat
//ipads getting blocked out of answering

var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var fs = require('fs');

app.use(express.static(__dirname + '/'));

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
var lastNameFile = __dirname + '/data/last_name_stripped.csv';
var gameHistory = __dirname + '/data/games_played.csv';
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

var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database('./data/clues.db');

class Player
	{
		constructor(name)
		{
			this._name = name;
			this._score = 0;
			this._isActive = false;
			this._givenAnswer = false;
			this._finalJeopardyBet = 0;
		}

		get name()
		{
			return this._name;
		}

		get score()
		{
			return this._score;
		}

		set score(score)
		{
			this._score = score;
		}

		get finalJeopardyBet()
		{
			return this._finalJeopardyBet;
		}

		set finalJeopardyBet(bet)
		{
			this._finalJeopardyBet = bet;
		}

		get active()
		{
			return this._isActive;
		}

		set isActive(active)
		{
			this._isActive = active;
		}

		get givenAnswer()
		{
			return this._givenAnswer;
		}

		set givenAnswer(answerGiven)
		{
			this._givenAnswer = answerGiven;
		}
	}

class Question
	{
		constructor(category, value, question, answer, dailyDouble, questionId, mediaLink, round)
		{
			this._category = category;
			this._value = value;
			this._question = question;
			this._answer = answer;
			this._dailyDouble = dailyDouble;
			this._questionId = questionId;
			this._mediaLink = mediaLink;
			this._mediaType = "none";
			this._isProperName = false;
			this._round = round;
		}

		get round()
		{
			return this._round;
		}

		get category()
		{
			return this._category;
		}

		get question()
		{
			return this._question;
		}

		set question(newQuestion)
		{
			this._question = newQuestion;
		}

		get questionId()
		{
			return this._questionId;
		}

		set questionId(newQuestionId)
		{
			this._questionId = newQuestionId;
		}

		get isProperName()
		{
			return this._isProperName;
		}

		set isProperName(properName){
			this._isProperName = properName;
		}

		get answer()
		{
			return this._answer;
		}

		set answer(newAnswer)
		{
			this._answer = newAnswer;
		}

		get mediaLink()
		{
			return this._mediaLink;
		}

		set mediaLink(newLink)
		{
			this._mediaLink = newLink;
		}

		get mediaType()
		{
			return this._mediaType;
		}

		set mediaType(media)
		{
			this._mediaType = media;
		}

		get dailyDouble()
		{
			return this._dailyDouble;
		}

		set dailyDouble(valueDD)
		{
			this._dailyDouble = valueDD;
		}

		get value()
		{
			return this._value;
		}

		set value(value)
		{
			this._value = value;
		}
	}


	function parseMediaType(media)
	{	
		var urlLink = media;

		var mediaType = "none";

		if (urlLink)//link exists
		{
			// Use a regular expression to trim everything before final dot
        	var extension = urlLink.replace(/^.*\./, '');
			var extension = extension.toLowerCase();
			console.log("EXTENSION TRIM IS " + extension);
			switch(extension) {
				case 'jpg': 
					mediaType = "image";
					break;
				case 'jpeg': 
					mediaType = "image";
					break;
				case 'png':
					mediaType = "image";
					break;
				case 'wmv':
					mediaType = "video_wmv";
					break;
				case 'mp4':
					mediaType = "video_mp4";
					break;
				case 'mp3':
					mediaType = "audio";
					break;
				case 'wav':
					mediaType = "audio";
					break;
				case 'aiff':
					mediaType = "audio";
					break;
				default:
					mediaType = "none";
			}

		}

		return mediaType;
	}

	function parseAnswer(answer)
	{
		//remove any information in brackets
		var newAnswer = answer.replace(/ *\([^)]*\) */g, "");
		newAnswer = newAnswer.toUpperCase();

		var tempActualAnswerSearch = newAnswer.substring(0,1);

		var tempActualAnswerSearchEnd = newAnswer.substring((newAnswer.length - 1), newAnswer.length);

		if (tempActualAnswerSearch == "\"" && tempActualAnswerSearchEnd == "\""){
			newAnswer = newAnswer.substring(1, (newAnswer.length-1));
		}
		
		tempActualAnswerSearch = newAnswer.substring(0, 2);

		if (tempActualAnswerSearch == "A "){
			newAnswer = newAnswer.substring(2, newAnswer.length);
			newAnswer = newAnswer.trim();
		}
	
		tempActualAnswerSearch = newAnswer.substring(0, 3);

		if (tempActualAnswerSearch == "AN ")  //remove the
		{
			newAnswer = newAnswer.substring(3, newAnswer.length);
			newAnswer = newAnswer.trim();
		}

		if (tempActualAnswerSearch == "THE")  //remove the
		{
			newAnswer = newAnswer.substring(3, newAnswer.length);
			newAnswer = newAnswer.trim();
		}

		return newAnswer;
	}



checkForFullGame();


function checkForFullGame(){
	//TODO COUNT RESULTS FROM DB QUERY

}

/*DOWNLOAD REQUIRED IMAGES*/
var fs = require('fs'),
    request = require('request');

var download = function(uri, filename, callback, type){
	console.log("DOWNLOAD: " + filename);
	console.log("TYPE: " + type);
	console.log("URI: " + uri);
  request.head(uri, function(err, res, body){
    console.log('content-type:', res.headers['content-type']);
    console.log('content-length:', res.headers['content-length']);

    request(uri).pipe(fs.createWriteStream('./temp-media/' + type + '/' + filename)).on('close', callback);
  });
};

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
			socket.emit('send to room', "http://localhost:3000/player");
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
  	setPlayerActive(players[playerNameActive]);
  	playerSpc.emit('open question category', playerNameActive);
  });

  //Whenever someone disconnects this piece of code executed
  socket.on('disconnect', function () {
    console.log('A user disconnected');
  });

  socket.on('question timer out', function(){
  	questionTimesUp();
  })

  //assign random player
  socket.on('player random', function(data){
  		var playerActive = players[findRandomPlayer()];
  		playerActive.isActive = true;
  		playerSpc.emit('active player', {playerName: getPlayerActive(), gameMarkup: data.gameMarkup, newGame: "new game", airdate: AIRDATE});
  		gameSpc.emit('active player', {playerName: getPlayerActive(), newGame: "new game", airdate: AIRDATE});
  });

  socket.on('final jeopardy started', function(){
  	playerSpc.emit('final jeopardy started');
  });

  socket.on('final jeopardy bid', function()
  {
  	playerSpc.emit('final jeopardy bid');
  });

  socket.on('final jeopardy time out', function()
  {
  	playerSpc.emit('final jeopardy time out');
  });

    socket.on('game over', function(winningPlayerName){
    	fs.appendFileSync(gameHistory, '\n' + GAME_ID);
    	playerSpc.emit('game over', winningPlayerName);
    });

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
  	dailyDoubleBeginCountdown();
  })

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
	  	finalJeopardyCheck = false;
	  	isSecondRound = false;
	  	roundTimer = ROUND_TIME;
	  	for(player in players){
	  		players[player].score = 0;
	  		players[player].givernAnswer = false;
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


playerSpc.on('connection', function(socket){
	console.log('player connected.');
	//handle player login name/ player join
  	socket.on('login name', function(name){
	  	console.log("PLAYER JOINED WITH NAME: " + name);
	  	socket.username = name;
	  	 gameSpc.emit('login name', name);
	  	 players[name] = new Player(name);
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
  	if(roundTimer>0)
  	{
  		questionTimer = null;
		allPlayersNoAnswer();
		curQuestionId  = questionId;
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
			  console.log('timer count: ' + questionTimerCount);
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
		checkAnswer(answer.answer, answer.questionId, answer.playerName, answer.finalJeopardyCheck);
	}
	else if (buzzedInTimerCount > 0){
		stopTimer(buzzedInTimer);
		stopTimer(dailyDoubleTimer);
		buzzedInTimer = null;
		dailyDoubleTimer = null;
		checkAnswer(answer.answer, answer.questionId, answer.playerName, answer.finalJeopardyCheck);
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
  });

  	function checkAnswer(answer, questionId, playerName, finalJeopardy)
	{
		if (finalJeopardy)
		{
			questionId = "FJ_0_0";
		}

		console.log("question ID: " + questionId);
		console.log("answer" + answer);
		var originalPlayerAnswer = answer.toUpperCase();
		var originalActualAnswer = questions[questionId]._answer.toUpperCase(); 
		var actualAnswer = questions[questionId]._answer;
		var playerAnswer = answer;
		var score = players[playerName].score;
		var value = questions[questionId]._value;
		var correct = false;
		var skimmedAnswer = false;
		var andAnswer = false;
		value = parseInt(value, 10);

		actualAnswer = actualAnswer.toUpperCase();
		playerAnswer = playerAnswer.toUpperCase();

		console.log("ACTUAL ANSWER BEFORE MODIFICATION: " + actualAnswer);
		console.log("PLAYER ANSWER BEFORE MODIFICATION: "+ playerAnswer);


		tempActualAnswerSearch = actualAnswer.substring(0, 2);

		if (tempActualAnswerSearch == "A "){
			actualAnswer = actualAnswer.substring(2, actualAnswer.length);
			actualAnswer.trim();
		}
		
		//remove what is, who is, who are, the
		var regexCommon = new RegExp("^\\b(WHAT IS|WHO IS|WHO ARE|WHAT ARE|WHAT IS|WHO IS A|WHO ARE A|WHAT ARE A|WHAT IS A|LIKE A| LIKE)\\b", "g"); 
		playerAnswer = playerAnswer.replace(regexCommon,'');

		//change all instances of & to AND
		if(actualAnswer.includes("&") || actualAnswer.includes("AND"))
		{
			//andAnswer = true;
			actualAnswer = actualAnswer.replace("&", "AND");
		}
		if(playerAnswer.includes("&"))
		{
			playerAnswer = playerAnswer.replace("&", "AND");
		}


		console.log("actualAnswer before remove special characters" + actualAnswer);
		console.log("playerAnswer before remove special characters" + playerAnswer);

		actualAnswer = removeSpecialCharacters(actualAnswer);
		playerAnswer = removeSpecialCharacters(playerAnswer);

		actualAnswer = actualAnswer.trim();
		playerAnswer = playerAnswer.trim();

		console.log("actualAnswer after remove special characters" + actualAnswer);
		console.log("playerAnswer after remove special characters" + playerAnswer);
		
		//check if answer is proper name
		var isName = false;
		
		console.log("Player Answer before name check: " + playerAnswer);
		var playerAnswerArrayTemp = playerAnswer.split(" ");
		console.log(playerAnswerArrayTemp.length);
		if (playerAnswerArrayTemp.length == 1){
			console.log("THIS IS A PROPER NAME");
			isName = checkIfName(playerAnswer);
		}

		if (isName){
			actualAnswerArray = actualAnswer.split(" ");
			console.log("Actual Answer Last Name:" + actualAnswerArray[actualAnswerArray.length-1]);
			if(playerAnswer == actualAnswerArray[actualAnswerArray.length-1]){
				skimmedAnswer = true;
			}		
		}
		
		tempPlayerAnswerSearch = playerAnswer.substring(0, 3);

			//make sure the string isn't inside the answer or a "bad" word
			var badWords = new Array(
				"THE",
				"THEN",
				"ST",
				"ST.",
				"IS",
				"WHAT ",
				"A",
				"WHO",
				"WHERE",
				"WHEN",
				"AFTER",
				"IN",
				"TO",
				"AS",
				"WHY",
				"AN",
				"ON",
				"WITH",
				"AND");

		actualAnswer = actualAnswer.split(" ");
		playerAnswer = playerAnswer.split(" ");
		console.log("player Array length: " + playerAnswer.length);
		console.log("answer Array length: " + actualAnswer.length);
		
		if (playerAnswer.length == 1){
			playerAnswer = equateNumberLiterals(playerAnswer);
		}

		if (actualAnswer.length == 1){
			actualAnswer = equateNumberLiterals(actualAnswer);
		}
		/*if (actualAnswer.includes(playerAnswer)) //check if answer includes the players response
		{

			if (badWords.indexOf(playerAnswer) === -1) //check if the answer was something silly from the array above 
			{
				var stringToGoIntoTheRegex = playerAnswer;
				var regex = new RegExp("\\b" + stringToGoIntoTheRegex + "\\b", "g"); ///\bsdda\b/g //check if the answer has any part inside the word
				// at this point, the line above is the same as: var regex = /#abc#/g;

				var searchResult = actualAnswer.search(regex);

				console.log("String: " + regex);
				console.log("Reg ex: " + searchResult);

				if(searchResult != -1)
				{
					if(closeEnough(playerAnswer, actualAnswer))
					{
						skimmedAnswer = true;
					}
				}
			}
		}*/
		var answerObject = checkForPlural(playerAnswer, actualAnswer);

		actualAnswer = answerObject.actualAnswer;

		playerAnswer = answerObject.playerAnswer;

		console.log("player answer after plural check: " + playerAnswer);
		var answerCount = 0;

		console.log("player Array length: " + playerAnswer.length);
		console.log("answer Array length: " + actualAnswer.length);

		//remove all "spaces" from array
		for (var word in actualAnswer){
			if(actualAnswer[word] == " "){
				actualAnswer.splice(word, 1);
			}
		}
		for (var word in playerAnswer){
			console.log("WORD VAR: " + word);
			console.log("ANSWER INDEX: " + playerAnswer[word]);
			if(playerAnswer[word] == " "){
				playerAnswer.splice(word, 1);
			}
		}

		console.log("player Array length: " + playerAnswer.length);
		console.log("answer Array length: " + actualAnswer.length);

		//search to see if any meaningful words match from the actual answer and the players answer, excluding a set of "bad" words (pronouns, conjugates etc.)
		for (var word in actualAnswer){
			if (badWords.indexOf(actualAnswer[word]) == -1){
				for(var wordY in playerAnswer){
					console.log("PLAYER ANSWER CHECK: " + playerAnswer[wordY] + "ACTUAL ANSWER CHECK: "+ actualAnswer[word]);
					if(playerAnswer[wordY] == actualAnswer[word] && isName == false){
						console.log("WORD THAT WAS CONFIRMED CORRECT: " + actualAnswer[word]);
						//if (!andAnswer){
							skimmedAnswer = true;
							break;
						//}
						//else
						//{
							//answerCount++;
						//}
					}
				}
			}
		}

		if (answerCount >= 2){ 
			skimmedAnswer = true;
		}

		/*if(checkForPlural(playerAnswer, actualAnswer))
		{

			if (badWords.indexOf(playerAnswer) === -1) //check if the answer was something silly from the array above 
			{

				if (actualAnswer.slice(-1) == "S"){
					actualAnswer = actualAnswer.substring(0, actualAnswer.length - 1);
				}

				if(playerAnswer.slice(-1) == "S"){
					playerAnswer = playerAnswer.substring(0, playerAnswer.length - 1);
				}

				if (actualAnswer.includes(playerAnswer)) //check if answer includes the players response
				{
					var stringToGoIntoTheRegex = playerAnswer;
					var regex = new RegExp("\\b" + stringToGoIntoTheRegex + "\\b", "g"); ///\bsdda\b/g //check if the answer has any part inside the word
					// at this point, the line above is the same as: var regex = /#abc#/g;

					var searchResult = actualAnswer.search(regex);

					console.log("String: " + regex);
					console.log("Reg ex: " + searchResult);

					if(searchResult != -1)
					{
						if(closeEnough(playerAnswer, actualAnswer))
						{
							skimmedAnswer = true;
						}
					}
				}
			}
		}*/

		console.log("PLAYER ANSWER COMPARE: " + playerAnswer + " \n ACTUAL ANSWER COMPARE: " + actualAnswer);

		var exactEqual = actualAnswer === playerAnswer;

		if (finalJeopardy)
		{
			value = 0;
		}

		//Absolute Correct Answer variable responses "GREAT" "AWESOME" "CORRECT!"
		if (exactEqual || skimmedAnswer)
		{
			 score += value;
			 correct = true;
			 setPlayerActive(players[playerName]);
		}

		//Somewhat Close variable responses "WE'LL TAKE IT!"  "LOOKS LIKE YOUR RIGHT."

		//Incorrect
		else
		{
			score -= value;
			correct = false;
		}

		if (finalJeopardy)
		{
			console.log(final_jeopardy_bet[playerName].bet);
			console.log("correct" + correct);
			if (correct)
			{
				score += parseInt(final_jeopardy_bet[playerName].bet);
			}
			else
			{
				score -= parseInt(final_jeopardy_bet[playerName].bet);
			}
		}

		players[playerName].score = score;

		console.log("is it final jeopardy: "+ finalJeopardy);
		console.log("player Answer: " + playerAnswer);
		if (!finalJeopardy)
		{
			gameSpc.emit('score update', {score: players[playerName].score, answer: originalPlayerAnswer, playerName: playerName, actualAnswer: originalActualAnswer, dailyDouble: questions[questionId]._dailyDouble, dailyDoubleBet: questions[questionId]._value, questionId: questionId, correct: correct, allPlayersAnswered: checkIfAllPlayersAnswered()});
			playerSpc.emit('score update', {score: players[playerName].score, playerName: playerName, questionId: questionId, correct: correct, dailyDouble: questions[questionId]._dailyDouble, dailyDoubleBet: questions[questionId]._value, allPlayersAnswered: checkIfAllPlayersAnswered()});
		}
		else
		{
			console.log("sending data: score "+ score + "answer " + playerAnswer + "name " + playerName + "correct " + correct);
			gameSpc.emit('score update final jeopardy', {score: score, answer: originalPlayerAnswer, playerName: playerName, correct: correct, buzzedInFJ: true});
		}	
	}
});

//helper functions

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

function checkIfName(playerNameToCheck){

	var lastNameSend = fs.readFileSync(lastNameFile, {
  		encoding: 'binary'
	});
	// pass in the contents of a csv file
	var parsedLastName = Baby.parse(lastNameSend);

	// voila
	var rowsLastName = parsedLastName.data;

	//if (rowsLastName.indexOf(playerNameToCheck) != -1){
	for(var row in rowsLastName){
		if (playerNameToCheck == rowsLastName[row][0]){
			console.log("This last name exists in our database.");
			return true;
		}
	}

	return false;
}

function equateNumberLiterals(number){
	switch(number[0]){
		case "1":
			number[0] = "ONE";
			break;
		case "2":
			number[0] = "TWO";
			break;
		case "3":
			number[0] = "THREE";
			break;
		case "4":
			number[0] = "FOUR";
			break;
		case "5":
			number[0] = "FIVE";
			break;
		case "6":
			number[0] = "SIX";
			break;
		case "7":
			number[0] = "SEVEN";
			break;
		case "8":
			number[0] = "EIGHT";
			break;
		case "9":
			number[0] = "NINE";
			break;
		case "10":
			number[0] = "TEN";
			break;
		default:
			break;
	}

	return number;
}	

function removeSpecialCharacters(word){

	var newWord = word;
	var specialCharacters = [
		"-",
		":",
		",",
		 ".",
		 ";",
		 "!",
		 "[",
		 "]",
		 "(",
		 ")",
		 "\\",
		 "/",
		 "$",
		 "%",
		 "&",
		 "+",
		 "-",
		 "{",
		 "}",
		 "'",
		 "`",
		 "_",
		 "|"
	];

	var specialCharacter;
	for (specialCharacter in specialCharacters)
	{
		var re = new RegExp("[\\" + specialCharacters[specialCharacter] + "]","gi");
		if (newWord.includes(specialCharacters[specialCharacter]))
		{
			if(specialCharacters[specialCharacter] == "'"){
				newWord = newWord.replace(re, '');
			}
			else{
				newWord = newWord.replace(re, ' ');
			}
		}
	}

	return newWord;
}

http.listen(3000, function(){
  console.log('listening on *:3000');
});


function objectLength( object ) {
    var length = 0;
    for( var key in object ) {
        if( object.hasOwnProperty(key) ) {
            ++length;
        }
    }
    return length;
};

function checkForPlural(playerAnswer, actualAnswer){
	console.log(playerAnswer.length);
	console.log(actualAnswer.length);
	var answerObject = {playerAnswer: playerAnswer,
                    actualAnswer: actualAnswer};
	console.log(answerObject.playerAnswer.length);
	console.log(answerObject.actualAnswer.length);
    
	for (var answerWord in actualAnswer){
	    if (actualAnswer[answerWord].slice(-1) == "S")
	    {
	            answerObject.actualAnswer[answerWord] = actualAnswer[answerWord].substring(0, actualAnswer[answerWord].length - 1);
	    }
	}
	for (var answerWord in playerAnswer){
	    if (playerAnswer[answerWord].slice(-1) == "S")
	    {
	            answerObject.playerAnswer[answerWord] = playerAnswer[answerWord].substring(0, playerAnswer[answerWord].length - 1);
	    }
	}

	console.log("ANSWER OBJECT: " + JSON.stringify(answerObject));
	console.log(answerObject.playerAnswer.length);
	console.log(answerObject.actualAnswer.length);
	return answerObject;
}

//check if the answer contains enough of the actual response
function closeEnough(playerAnswer, actualAnswer){
	var actualAnswerLength = actualAnswer.split(' ').length;
	var actualAnswerArray = actualAnswer.split(' ');
	var playerAnswerArray = playerAnswer.split(' ');
	var answerArray = new Array(actualAnswerArray,
		playerAnswerArray);

	var result = answerArray.shift().filter(function(v) {
		    return answerArray.every(function(a) {
		        return a.indexOf(v) !== -1;
		    });
	});

	console.log("CLOSE ENOUGH RESULT: " + JSON.stringify(result));

	if (actualAnswerLength.length <= 2){
		if (result.length > 1 && result.length <= 3){
			return result;
		}
		else{
			return false;
		}
	}
	else{
		if(result.length>=actualAnswerLength.length - 1){
			return result;

		}
		else{
			return false;
		}
	}

}

	function changeActivePlayerNewRound(){
		var lowestScore = 99999;
		var playerLow;

		
		for (player in players)
		{
			if (players[player].score < lowestScore)
			{	
				lowestScore = players[player].score;
				playerLow = players[player];
			}
		}
		console.log(playerLow);
		setPlayerActive(players[playerLow._name]);
	}

	function questionBeginCountdown()
	{ 
		if (questionTimer == null){
			questionTimer = setInterval(function() {
			  questionTimerCount--;
			  playerSpc.emit('update interval', questionTimerCount);
			  gameSpc.emit('update interval', questionTimerCount);
			  console.log('timer count: ' + questionTimerCount);
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
	playerActive.isActive = true;

	for (player in players)
	{
		if (players[player] != playerActive)
		{
			players[player].isActive = false;
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

	db.serialize(function() {

		var queryThisGameId ="SELECT clues.game, airdate\n" +
			"FROM clues\n" +
			"JOIN airdates ON clues.game = airdates.game\n" +
			"WHERE clues.game NOT IN " + iterateThroughArraySQLite(historyArray) + "\n" +
			"AND airdate LIKE '" + useDecade + "%'\n" +
			"GROUP BY clues.game\n" +
			"HAVING count(id) == 61\n" +
			"ORDER BY RANDOM() LIMIT 1"; 

			console.log(queryThisGameId);

	    db.all(queryThisGameId, function (err, rows) {
    		if(err){
		        console.log(err);
		    }else{
		        callback(rows[0]);
		        console.log("THIS GAME ID: " + rows[0].game);
		    }
		  });
	});
}

function iterateThroughArraySQLite(arrayIterate){
	var sqliteFormatArray = "(";
	for (var arrayIndex in arrayIterate){
		sqliteFormatArray += "'" + arrayIterate[arrayIndex] + "', ";
	}
	sqliteFormatArray = sqliteFormatArray.substring(0, sqliteFormatArray.length - 3); // chop off last two characters
	sqliteFormatArray += "' )";

	return sqliteFormatArray;
}

function stopTimer(timer){
	clearInterval(timer);
}


//PLAYER SOCKET 

function buzzedInBeginCountdown()
	{
		if (buzzedInTimer == null){
			buzzedInTimer = setInterval(function(){
				console.log("buzzed in timer count: " + buzzedInTimerCount);
				buzzedInTimerCount--;
				playerSpc.emit('update buzzer interval', {buzzedInTimerCount: buzzedInTimerCount, buzzedInPlayerName: buzzedInPlayerName});
	    		if (buzzedInTimerCount === 0) {
					stopTimer(buzzedInTimer);
					buzzedInTimer = null;
					buzzedInTimesUp();
					if (isSecondRound && roundTimer<=0){
						finalJeopardyCheck = true;
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
		roundTimerObject = setInterval(function() {
			if (roundTimer==ROUND_TIME){
				gameSpc.emit('update round interval', {roundTimer: roundTimer, round: isSecondRound, activePlayerName: getPlayerActive()});
				playerSpc.emit('update round interval', roundTimer);
			}
			
			if (roundTimer == 0) {
				playerSpc.emit('close category select');
				if (!isSecondRound){
					changeActivePlayerNewRound();
				}
				stopTimer(roundTimerObject);
				gameSpc.emit('update round interval', {roundTimer: roundTimer, round: isSecondRound, activePlayerName: getPlayerActive()});
				playerSpc.emit('update round interval', roundTimer);
				isSecondRound = true;
			}
			roundTimer--;
		}, 1000);
	}
