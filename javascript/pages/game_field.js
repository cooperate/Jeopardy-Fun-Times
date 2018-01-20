$(document).ready(function() {

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

	var questionList = new Array();
	var playerCount = 0;
	var contentBoard = '';
	var activePlayerName = '';
	var nameIds = new Array();  //number reference for player
	var playerNames = new Array();
	var questionIsLive = false;
	var finalJeopardyCheck = false;	
	var playersFJ = new Array();
	var dailyDoubleBet = 0;
	var categories = new Array();
	var animated = false;
	var lockPlayers = false;
	var roundTimer = 600;
	var finalJeopardyThemeEnded = false;
	var answerTime = 15;
	const SOUNDS_DIR = "../../game-media/sounds/";
	const IMAGES_DIR = "../../game-media/images/";

	var Queue = (function(){

		    function Queue() {};

		    Queue.prototype.running = false;

		    Queue.prototype.queue = [];

		    Queue.prototype.add_function = function(callback) { 
		        var _this = this;
		        //add callback to the queue
		        this.queue.push(function(){
		            var finished = callback();
		            if(typeof finished === "undefined" || finished) {
		               //  if callback returns `false`, then you have to 
		               //  call `next` somewhere in the callback
		               _this.next();
		            }
		        });

		        if(!this.running) {
		            // if nothing is running, then start the engines!
		            this.next();
		        }

		        return this; // for chaining fun!
		    }

		    Queue.prototype.next = function(){
		        this.running = false;
		        //get the first element off the queue
		        var shift = this.queue.shift(); 
		        if(shift) { 
		            this.running = true;
		            shift(); 
		        }
		    }

		    return Queue;

	})();

	var animationQueue = new Queue();


	//set css for various game elements
	$('#question_field').css('display', 'none');
	$('#message_overlay').css('display', 'none');
	$('#category_container').css('display', 'none');
	$('#player_container').css('display', 'none');
	$('#game_intro').css('display', 'block');
	$('#master_container').css('display', 'none');
	$('.player_name_bubble').hide();


	var socket = io('/game');

	

	socket.on('game data', function (data) {
	    questionList[data.questionID] = new Question(data.question._category, data.question._value, data.question._question, data.question._answer, data.question._dailyDouble, data.question._questionId, data.question._mediaLink, data.question._round);
	    questionList[data.questionID].mediaType = data.question._mediaType;
	    console.log("QUESTION LIST LENGTH: " + Object.keys(questionList).length);
	    if (Object.keys(questionList).length == 61){
	    	startGame();
	    	console.log(questionList + " ready!");
	    }
	    console.log(questionList[data.questionID]);
		console.log("QUESTION ID: " + data.questionID);
	});

	/*function buildData(data){
		var tempQuestionList = new Array();
		for (var row in data){
			data = new Question();
		}
	}*/

	var player_login_count = 0;

	 socket.on('login name', function(name){
        buildPlayerBox(name);

        //play player join sound
	    playSound(playerJoinSound);


	    player_login_count++
	    $("#player_name_bubble_" + player_login_count).append("<h2>" + name + "</h2>");
	    $("#player_name_bubble_" + player_login_count).fadeIn();
     });

	 socket.on('answer time data', function(answerTimeData){
	  	answerTime = answerTimeData;
	  });

	 function buildPlayerBox(name){

	 	var score = 0;
	 	var content = '';
	 	nameIds[name] = playerCount;
	 	playerNames.push(name);
	 	console.log(playerNames);
	 	content ="<tr id='active_indicator_" + nameIds[name] + "' style='height:20px;font-size:35px;vertical-align:middle;'><td>&nbsp;</td></tr>\
	 			<tr class='score'>\
      			<td id='name_" + nameIds[name] + "'>" + score + "</td>\
      			</tr>\
      			<tr id='player_name_" + nameIds[name] + "' class='name'>\
      			<td>" + name + "</td>\
      			</tr>";

      	if(playerCount < 3)
      	{
	 		$('#players_table').append(content);
	 		playerCount++;
	 	}

	 	
	 }

    function buildBoard(questions, round)
    {
    	var i;
    	contentBoard = "<table id='game_board'>";

    	contentBoard += "<tr>";

    	var startMarker = 0; //track our question count in loop for building question board

    	var roundMarkerId = "J_";

    	categories.length = 0; //empty categories array

    	switch(round)
    	{
    		case "Jeopardy":
    			startMarker = 0;
    			roundMarkerId = "J_";
    			break;
    		case "Double Jeopardy":
    			startMarker = 30;
    			roundMarkerId = "DJ_"
    			break;
    	}
    	var c;
    	for (c=0; c<6; c++)
    	{
    		console.log("CONTENT BOARD " + roundMarkerId + c + "_" + "_0");
    		contentBoard += "<th>"  +  questionList[roundMarkerId + c + "_0"].category + "</th>";
    		categories.push(questionList[roundMarkerId + c + "_0"].category);
    	}

    	contentBoard += "</tr>";

    	for(i=0; i<6; i++)
    	{
    		if (i>0)
    		{
    			contentBoard += "<tr>";	
    		}
    		var y;
    		for(y=0; y<6; y++)
    		{	
    			if (i>0)
    			{
    				console.log("CONTENT BOARD " + roundMarkerId + y + "_" + (i-1));
    				contentBoard += "<td id='" + roundMarkerId + y  + "_" + (i-1) + "'>" +  questionList[roundMarkerId + y  + "_" + (i-1)].value + "</td>";
    			}
    		}
    		
    		if (i>0)
    		{	
    			contentBoard += "</tr>";
    		}
    	}
    	contentBoard += "</table>";

    	$('#game_board_container').html(contentBoard);
    	$('#game_board_container tr td').css('color', 'transparent');
    	$('#game_board_container tr td').css('textShadow', 'none');
	}

	//populate game board
	//set data for all questions

	//GAME LOGIC 

	function startGame()
	{
		socket.emit('close buzzer');
		buildBoard(questionList, "Jeopardy");
		socket.emit('player random', {gameMarkup: contentBoard});
		$("#message_overlay").css("color", "rgb(0, 0, 0)");
	}

	function getSoundAndFadeAudio (soundObject) {

	    var sound = soundObject;
	    sound.volume = 1.0;

	    var fadeAudio = setInterval(function () {
	        sound.volume = Number(sound.volume - 0.1).toFixed(2);
	        // When volume at zero stop all the intervalling
	        if (sound.volume <= 0.0) {
	        	stopSound(sound);
	            clearInterval(fadeAudio);
	        }
	    }, 100);

	}

	var newRound = false;

	var nextRoundNeeded = false; //check if question is live, then if it is we enable this flag to go into next round the next time active player would usually be called
	//when a new player becomes active
	socket.on('active player',function(data){

			if (roundTimer <= 0)
			{	
				console.log("INSIDE ACTIVE PLAYER AFTER ROUND ENDED (this means a question was active while the round timer hit 0)");
				flashActiveOff(data.playerName);
				newRound = true;
				questionIsLive = false;
				if(nextRoundNeeded == true){
					console.log("NEXT ROUND SHOULD BE CALLED");
					nextRound();
				}
				nextRoundNeeded = false;
			}

			else{
			
				var message;
				if (data.newGame == "new game") //handle new game intro animation, show airdate, display intro animation, show categories
		   		{
		   			$('#master_container').css('display', 'block');
		   			getSoundAndFadeAudio(jeopardyIntroMusic);
		   			clearInterval(gradientTimer);
		   			$('#airdate_text').text(data.airdate);
		   			setTimeout(function(){
		   				$('#game_intro').slideUp("slow", function(){
		   					playSound(dateSoundEffect);
			   				$('#game_intro').css('display', 'none');
		   					setTimeout(function(){
		   						playSound(openUpSound);
		   						$('#airdate_screen').slideUp("slow", function(){
		   							getSoundAndFadeAudio(dateSoundEffect);
				   					setTimeout(function(){
						   				animateBoard(true);
						   				setTimeout(function(){messageToVoice("Hello and welcome to Jeopardy! These are todays categories", false)}, 4000);
						   				setTimeout(function(){categoryAnimate(data.playerName)}, 7000);
						   				activePlayerName = data.playerName;
					   				}, 1000);
		   						});
			   				}, 6000);
				   			  
			   			});
		   			}, 2000);
		   		}

		   		else
		   		{
		   			console.log("ROUND TIMER: " + roundTimer);
		   			if (roundTimer > 0) //prevent shitty messages to popup if round is over
		   			{
		   				console.log(roundTimer);
						if (activePlayerName == data.playerName)
						{
							if (newRound == true)
							{
								message =  data.playerName + ", you have the board.";
								newRound = false;
							}
							else
							{
								message =  data.playerName + ", still yours.";
							}
						}
						else
						{
							message =  data.playerName + ", you have the board.";
						}
						console.log(message);
						var msgRead = false;
						messageToVoice(message, true, function(){ //TODO WHY DOES THIS NEVER GET HERE?  It is probably something to do with googles api failing to finish a voice sequence so the callback never occurs.
							msgRead = true;
							console.log("ACTIVE PLAYER MESSAGE FINISHED.");
							staticMessageOff();
							hideQuestionField();
							playSound(chooseCategoryTheme);
							flashActiveOn(data.playerName);
							socket.emit('open question category', data.playerName);
						});
						setTimeout(function(){ 
							if (!msgRead){
								console.log("ACTIVE PLAYER MESSAGE FINISHED.");
								staticMessageOff();
								hideQuestionField();
								playSound(chooseCategoryTheme);
								flashActiveOn(data.playerName);
								socket.emit('open question category', data.playerName);
							}
						}, 12000);
					}
					else
					{
						
					}
				}
			 activePlayerName = data.playerName;
			 moveActiveIndicator(data.playerName);
			}
	 });

	
	socket.on('update round interval', function(data){
		activePlayerName = data.activePlayerName;
		setRoundTimer(data.round, data.roundTimer);
	});

	function setRoundTimer(secondRound, roundTimerArg)
	{
		roundTimer = roundTimerArg;
		console.log("ROUND TIMER UPDATE WITH : " + roundTimer);
		if (!secondRound)
		{

				if (roundTimer <= 0)
				{
				
					if(!questionIsLive)
					{
						stopSound(chooseCategoryTheme);
					}

				}
		}
		else
		{
				if (roundTimer <= 0)
				{
					console.log("Final Jeopardy");
					finalJeopardyCheck = true;
					//final jeopardy
					if(!questionIsLive)
					{
						console.log("initiating Final Jeopardy, no question live.");
						stopSound(chooseCategoryTheme);
					}
				}
		}

		if (roundTimer == 0)
		{
		
			if(!questionIsLive)
			{
				console.log("QUESTION IS NOT LIVE ROUND TIMER");
				nextRound();
				questionIsLive = false;
			}
			else{
				console.log("QUESTION IS LIVE, WAIT FOR ACTIVE PLAYER CALL");
				nextRoundNeeded = true;
			}

		}
	}

	var nextRoundFinalJeopardyCalled = true;

	function nextRound()
	{	
		console.log("INSIDE NEXT ROUND FUNCTION");
		var playerNameSingle;
		socket.emit('next round started');	
	}

	socket.on('next round start confirmed', function(activePlayerReceive){
		activePlayerName = activePlayerReceive;
		nextRoundOrdered();
	})

	function nextRoundOrdered(){
		for(playerNameSingle in playerNames){
			console.log("FLASH PLAYER NAMES : " + playerNameSingle);
			flashActiveOff(playerNames[playerNameSingle]);
		}
		moveActiveIndicator(activePlayerName);
		
		hideQuestionField();
		if (finalJeopardyCheck)
		{
			if(nextRoundFinalJeopardyCalled){ //should only be called once
				nextRoundFinalJeopardyCalled = false;
				playSound(roundOverSound);
				animationQueue.add_function(function(){
	   				postScreenMessage("Double Jeopardy Round is Over!", false, 0);
				});
				socket.emit('final jeopardy started');
				setTimeout(startFinalJeopardy(), 4000);
			}	
		}
		else
		{
			playSound(roundOverSound); 
			animationQueue.add_function(function(){
				postScreenMessage("Jeopardy Round is Over!", true, 5000);
			});
			buildBoard(questionList, "Double Jeopardy");
			setTimeout(function(){
			animateBoard(false);
			socket.emit('second round started', contentBoard);
			setTimeout(function(){startSecondRound(activePlayerName)}, 3000);
			}, 5000);
		}
	}

	function startSecondRound(activePlayer)
	{
		console.log("START SECOND ROUND");
		
		var playerNameSingle;

		if (!animated)
		{
			animated = true;
			var message = "Get ready for the Double Jeopardy Round, all clues will be worth double!";

			messageToVoice(message, false);
			messageToVoice("Here are your categories.", false);
			animationQueue.add_function(function(){
				postScreenMessage(message, true, 5000, function(){categoryAnimate(activePlayer)});
			});
		}
	}

	function startFinalJeopardy()
	{
		flashActiveOff(activePlayerName);
		//change message color
		$("#message_overlay").css("background-color", "rgb(63, 81, 181)");
		$("#message_overlay").css("color", "rgb(255, 255, 255)");
		postScreenMessage("", false, 5000);
		var message = "Here is tonights Final Jeopardy Category: ";
		messageToVoice(message, false);
		setTimeout(function(){
			playSound(finalJeopardyBloop);
			$("#message_overlay").html("<h2>" + questionList["FJ_0_0"].category + "</h2>");
			messageToVoice(questionList["FJ_0_0"].category, false);
			messageToVoice("Please make your wager.", true, function(){socket.emit('final jeopardy bid')});
		}, 4000);
	}

	var playerFJCounter = 0;

	//bid is submitted
	socket.on('final jeopardy response', function(response){
		playerFJObject = {playerName: response.playerName, bet: response.bet, buzzedInFJ: false};
		playersFJ[response.playerName]= playerFJObject;
		if(playerFJCounter >=2)
		{
			displayQuestion(questionList["FJ_0_0"].question, "FJ_0_0");
			postScreenMessage(questionList["FJ_0_0"].category + "</br></br>" + questionList["FJ_0_0"].question, false);
			var msgSuccess = false;
			messageToVoice("The answer is: " + questionList["FJ_0_0"].question + "...Good Luck!", true, function(){
				playSound(finalJeopardyTheme);
				socket.emit('open response final jeopardy');
				msgSuccess = true;
			});
			
			setTimeout(function(){
				if (!msgSuccess){
					playSound(finalJeopardyTheme);
					socket.emit('open response final jeopardy');
				}
			}, 10000);
		}
		playerFJCounter++;
	});

	function finalCeremonies()
	{
		var index = 0;
		var winnerPlayer;
		var playerNamesArray = new Array();
		var necessaryAnswer = false;
		

    	$("#player_container").slideDown("slow", function() {
	    // Animation complete.
	  		

	    	var compareScore = -99999; //set to something very low in case everyone is in negatives
	    	console.log(playersFJ);
			for(player in playersFJ)
			{	
				
				var scoreForEndGame = parseInt(playersFJ[player].score);
				updateScore(playersFJ[player].playerName, scoreForEndGame);
				if (scoreForEndGame > compareScore)
				{
					winnerPlayer = playersFJ[player];
					compareScore = scoreForEndGame;
				}
				if(!playersFJ[player.correct]){
					necessaryAnswer = true;
				}
				playerNamesArray.push(playersFJ[player].playerName);
			}

			messageToVoice("Lets take a look at the answers.", true, function(){
		    	//animate through each
		    	$("#player_container").cycle({
		    		fx: 'scrollRight',
		    		next: "#player_container",
		    		speed:    100,
		    		timeout: 10000,
		    		after: function(){
		    			if(index<3)
		    			{
			    			var curPlayerObject = playersFJ[playerNamesArray[index]];
			    			var correctText = "incorrect";
			    			if (curPlayerObject.correct)
			    			{
			    				correctText = "correct";
			    			}
			    			var answer = curPlayerObject.answer;
			    			var msgAnswer = curPlayerObject.answer;
			    			var playerSaid = curPlayerObject.playerName + " said, ";
			    			if(answer === undefined || answer =='')
			    			{
			    				answer = "?"
			    				msgAnswer = "";
			    				playerSaid = curPlayerObject.playerName + " couldn't come up with anything.  "
			    			}
			    			
			    			messageToVoice(playerSaid, false);
			    					setTimeout(function()
			    					{
			    						$("#player_" + index + " .secure_player_container").append("<h2>" + curPlayerObject.playerName + "</h2>");
			    						$("#player_" + index + " .secure_player_container").append("<h2>" + answer + "</h2>");
			    						messageToVoice(msgAnswer + " and was " + correctText + ".  They wagered " + curPlayerObject.bet + ".", true,
			    							function()
			    							{
			    								$("#player_" + index + " .secure_player_container").append("<h2>" + curPlayerObject.bet + "</h2>");
			    								index++;
			    							});
			    					}, 2000);
		    			}
		    			else{
		    				$('#player_container').cycle('stop');
		    				$('#player_container').fadeOut('fast');
		    			}
		    		},
		    		height: 'auto',
		    		easing:  'easeInOutBack',
		    		autostop: 1,
		    		end: function(options)
		    		{

						console.log(playersFJ);
						$('#player_container').animate({
							width: "85%",
							height: "100%"
						}, 1000, function() {
							$("#player_container").fadeOut('fast');
							$("#player_container").css("display", "none");
							if(necessaryAnswer)
							{
								messageToVoice("The answer we were looking for was " + questionList["FJ_0_0"].answer , false);
								postScreenMessage(questionList["FJ_0_0"].answer, false, 0);
								setTimeout(function()
									{
										messageToVoice("Todays winner is " + winnerPlayer.playerName + " with " + winnerPlayer.score + ", congratulations!  See you next time.", false);
										postScreenMessage("You win " + winnerPlayer.playerName + "!", false, 0);
									    jeopardyIntroMusic.volume = 1;
									    playSound(jeopardyIntroMusic);
									}, 4000);

								socket.emit('game over', winnerPlayer.playerName);
							}
							else
							{
								messageToVoice("Todays winner is " + winnerPlayer.playerName + " with " + winnerPlayer.score + ", congratulations!  See you next time.", false);
								postScreenMessage("You win " + winnerPlayer.playerName + "!", false, 0);
							    jeopardyIntroMusic.volume = 1;
							    playSound(jeopardyIntroMusic);
							    socket.emit('game over', winnerPlayer.playerName);
							}

						  });
		    		}
		    	});
	    	});	
    	});
    }

    socket.on('new game', function(){
    	questionList.length = 0;
		questionList = [];
		categories.length = 0;
		categories = [];
		playersFJ.length = 0;
		playersFJ = [];
		playerCount = 0;
		contentBoard = '';
		activePlayerName = '';
		nameIds.length = 0;  //number reference for player
		categories.length = 0;
		playerNames.length = 0;
		questionIsLive = false;
		finalJeopardyCheck = false;
		dailyDoubleBet = 0;
		roundTimer = 600;
		animated = false;
		lockPlayers = false;
		$("#message_overlay").css("background-color", "rgb(189, 189, 189)");
		$("#message_overlay").css("color", "rgb(0, 0, 0)");
		$('#question_field').css('display', 'none');
		$('#message_overlay').css('display', 'none');
		$('#category_container').css('display', 'none');
		$('#player_container').css('display', 'none');
		$('#game_intro').css('display', 'block');
		$('#master_container').css('display', 'none');
		$('.score td').html('0');
		socket.emit('new game ready game board');
    });

    socket.on('new game ready game board', function(){
    	playSound(jeopardyIntroMusic);
	    for (key in questionList)
	    {
	    	socket.emit('question data', {question: questionList[key], key: key});
	    }
	    buildBoard(questionList, "Jeopardy");
		socket.emit('close buzzer');
		socket.emit('player random', {gameMarkup: contentBoard});
    })

    

	//capture question reveal
	  socket.on('question reveal',function(question){
	  	timerCount = 6;
	  	questionIsLive = true;
	  	$("#" + question.questionId).html('');
	  	flashActiveOff(question.playerName);
	  	getSoundAndFadeAudio(chooseCategoryTheme);
	  	curQuestionId = question.questionId;
	  	if (roundTimer > 0)
		  {
		  	lockPlayers = false;
		  	//stopTimer(timer);
		  	socket.emit('close buzzer');
		  	draw(1); //for timer animation
		  	//daily double?
		 	if (questionList[question.questionId].dailyDouble)
		 	{
		 		console.log("daily double time!");
		 		dailyDoubleSegment(question.questionId, question.playerName);
		 	}
		 	else //standard question
		 	{
		 		var questionRead = false;
		 		var questionTopRead = false;
		 		messageToVoice(questionList[question.questionId].category + " for " + questionList[question.questionId].value, true, function(){
		 			questionTopRead = true;
		 			displayQuestion(question.question, question.questionId);
				  	messageToVoice(question.question, true, function(){
				  		questionRead = true;
					  	console.log("question reveal");
					  	socket.emit('start countdown', question.questionId);
					  	playSound(questionTheme);
				  	});
				  	setTimeout(function(){ //failsafe if message callback never called
				  		if (questionRead == false)
				  		{
						  	console.log("question reveal");
						  	socket.emit('start countdown', question.questionId);
						  	playSound(questionTheme);
				  		}
				  	}, 30000);
		 		});

		 		setTimeout(function(){
		 			if (questionTopRead == false){
		 						 			displayQuestion(question.question, question.questionId);
					  	messageToVoice(question.question, true, function(){
					  		questionRead = true;
						  	console.log("question reveal");
						  	socket.emit('start countdown', question.questionId);
						  	playSound(questionTheme);
					  	});
					  	setTimeout(function(){ //failsafe if message callback never called
					  		if (questionRead == false)
					  		{
							  	console.log("question reveal");
							  	socket.emit('start countdown', question.questionId);
							  	playSound(questionTheme);
					  		}
					  	}, 30000);
		 			}
		 		}, 30000);

		  	}
		  }
		  else{
		  	//nextRound();
		  }
	  });

	  $('#question_field #daily_double_bet').hide();

	  socket.on('question reveal dd', function(question){
	  		dailyDoubleBet = question.bet;
	  		flashActiveOff(activePlayerName);
	  		var messageSuccess = false;
		  	messageToVoice(question.question, true, function(){ 
		  		messageSuccess = true;
		  		socket.emit('open submit dd');
		  		drawTypingPopup(activePlayerName);
		  		});
		  	setTimeout(function(){
		  		if(!messageSuccess){
		  			socket.emit('open submit dd');
		  			drawTypingPopup(activePlayerName);
		  		}
		  	}, 15000);
		  	displayQuestion(question.question, question.questionId);
		  	staticMessageOff();
	  });

	 //capture buzzer press buzzed in buzz in
	 socket.on('buzzer pressed', function(pressed){
	 	if(!lockPlayers)
	 	{
	 		socket.emit('buzzer pressed confirmed', pressed);
		 	console.log('buzzer pressed');
		 	socket.emit('close buzzer');
		 	flashBuzzer(pressed.playerName);
		 	drawTypingPopup(pressed.playerName);
		 	stopSound(questionTheme);
		 	//play buzzer sound
		 	playSound(buzzInSound);
		 	setTimeout(function(){/*playSound(clockCountdown)*/}, 1000);
	 	}
	 });

	 //on answer determination answer submit
	 socket.on('score update', function(score){
	 	var openQuestionsSwitch = true;
	 	$('#name_' + nameIds[score.playerName]).html(score.score);
	 	//stopSound(clockCountdown);

	 	hidePopup(score.playerName);
	 	console.log("hide popup should be called for " + score.playerName);

	 	if(score.correct == true && !score.dailyDouble)
	 	{
	 		socket.emit('close buzzer');
	 		var msgRsp = score.playerName + " said " + score.answer + " and was correct!";

			var msgRead = false;
			messageToVoice(msgRsp, true, function(){
				openQuestionsSwitch = false;
				msgRead = true;
				console.log("Should be executing callback.");
				staticMessageOff();
				socket.emit('all messages done score update correct');
				hideQuestionField();
			});
			endCountdown(score.questionId);
			postScreenMessage(msgRsp, false, 0);
			setTimeout(function(){
				if (msgRead == false){
					openQuestionsSwitch = false;
					socket.emit('all messages done score update correct');
					console.log("Should be executing callback.");
					staticMessageOff();
					hideQuestionField();
				}
			}, 12000);

	 		questionIsLive = false;
	 	}
	 	else if(score.allPlayersAnswered || score.dailyDouble)
	 	{
	 		getSoundAndFadeAudio(questionTheme);
	 		socket.emit('close buzzer');
	 		var msgRsp = "The response we were looking for was " + score.actualAnswer + ".";
	 		if(score.dailyDouble)
	 		{
		 		if (score.dailyDouble && score.correct)
		 		{
		 			msgRsp = score.answer + " is correct, congratulations! ";
		 			msgRsp += "They wagered " + score.dailyDoubleBet + ".";
		 		}
		 		else
		 		{
		 			playSound(gameSoundWrong);
		 			msgRsp = score.playerName + " said " + score.answer + " and was incorrect." + " What you were looking for was " + score.actualAnswer + ".";
		 			msgRsp += "They wagered " + score.dailyDoubleBet + ".";
		 		}
	 		}
	 		else
	 		{
	 			if (score.correct)
		 		{
		 			msgRsp = score.playerName + " said " + score.answer + " and was correct!"
		 		}
		 		else
		 		{
		 			playSound(gameSoundWrong);
		 			msgRsp = score.playerName + " said " + score.answer + " and was incorrect." + " What you were looking for was " + score.actualAnswer + ".";
		 		}
	 		}
	 		

			postScreenMessage(msgRsp, false, 0);
			var question_read = false;
			messageToVoice(msgRsp, true, function(){
				question_read = true;
				staticMessageOff();
				if (score.dailyDouble){
					console.log("Should be executing callback.");
					socket.emit('finished all messages dd');
				}
				else{
					if (score.correct)
 				{
 					console.log("Should be executing callback.");
						socket.emit('all messages done score update correct');
					}
					else{
						console.log("Should be executing callback.");
						socket.emit('all messages done score update');
					}
				}
			});
				setTimeout(function(){
					if (question_read == false){
						staticMessageOff();
						if (score.dailyDouble){
							socket.emit('finished all messages dd');
						}
						else{
							if (score.correct)
							{
								socket.emit('all messages done score update correct');
							}
							else{
								socket.emit('all messages done score update');
							}
						}
					}
				}, 12000);

				removeDailyDoubleIcon();
				endCountdown(score.questionId);

 			questionIsLive = false;
	 	}
	 	else
	 	{
	 		playSound(gameSoundWrong);
	 		
	 		var msgFunction = function(){
	 			staticMessageOff();
	 			playSound(questionTheme);
	 			console.log("score update question id: "+ score);
	 			socket.emit('continue countdown', score.questionId);
	 			socket.emit('open buzzer');
	 		};

	 		var message = score.playerName + " said " + score.answer + " and was incorrect. Questions still open.";
	 		var msgRead = false;
	 		messageToVoice(message, true, function(){
	 			msgFunction();
	 			msgRead = true;
	 		});

	 		setTimeout(function(){ 
				if (!msgRead){
					msgFunction();
				}
			}, 10000);

	 		postScreenMessage(message, false, 0);
	 	}
	 	
	 });

	 var countScores = 0;
	 socket.on('score update final jeopardy', function(scoreFJ){
	 		console.log("score update score: " + scoreFJ.score + " player name: " + scoreFJ.playerName);
	 		if (!finalJeopardyThemeEnded){
		 		if (scoreFJ.buzzedInFJ)
		 		{
		 			playersFJ[scoreFJ.playerName].buzzedInFJ = scoreFJ.buzzedInFJ;
		 			playersFJ[scoreFJ.playerName].score = scoreFJ.score;
		 			playersFJ[scoreFJ.playerName].correct= scoreFJ.correct;
		 			playersFJ[scoreFJ.playerName].answer = scoreFJ.answer;
		 			countScores++;
		 		}
		 		if (!playersFJ[scoreFJ.playerName].buzzedInFJ)
		 		{
					playersFJ[scoreFJ.playerName].score = scoreFJ.score;
		 			playersFJ[scoreFJ.playerName].correct= scoreFJ.correct;
		 			playersFJ[scoreFJ.playerName].answer = scoreFJ.answer;
		 			countScores++;
		 		}
	 		}
	 });

	 socket.on('score update final jeopardy buzzed out', function(scoreFJ){
		 		if (scoreFJ.buzzedInFJ)
		 		{
		 			playersFJ[scoreFJ.playerName].buzzedInFJ = scoreFJ.buzzedInFJ;
		 			playersFJ[scoreFJ.playerName].score = scoreFJ.score;
		 			playersFJ[scoreFJ.playerName].correct= scoreFJ.correct;
		 			playersFJ[scoreFJ.playerName].answer = scoreFJ.answer;
		 			countScores++;
		 		}
		 		if (!playersFJ[scoreFJ.playerName].buzzedInFJ)
		 		{
					playersFJ[scoreFJ.playerName].score = scoreFJ.score;
		 			playersFJ[scoreFJ.playerName].correct= scoreFJ.correct;
		 			playersFJ[scoreFJ.playerName].answer = scoreFJ.answer;
		 			countScores++;
		 		}
	 });

	 var timerCount = 6;

	//global timers

	socket.on('countdown', function(data){
 		//beginCountdown(data.questionId, data.timerCount);  CAUSING GLITCH?
 		socket.emit('open buzzer');
	});

	socket.on('update interval', function(time){
		beginCountdown(curQuestionId, time);
	});

	//if google api callback fails
	function forceSocketEmit(socketCall, openQuestionsSwitch){
		console.log("Open Question Switch parameter sent to forceSocketEmit: " + openQuestionsSwitch);
		setTimeout(function(){ 
						if (openQuestionsSwitch){
							console.log("Google callback failed, force emit.");
							socketCall;
						}
		}, 12000);
	}

	function beginCountdown(questionId, timerCount)
	{ 
		console.log("COUNTDOWN STARTING TIME COUNT IS: " + timerCount);
		console.log("CURRENTLY TARGETING QUESTION ID: " + questionId);
		  draw(timerCount/6);
		  
		  if (timerCount===0) 
		  {
		  		socket.emit('close buzzer');
		  		stopSound(questionTheme);
		  		lockPlayers = true;
		  		var actualAnswer = questionList[questionId].answer;
		  		var msgRsp = "The response we were looking for was " + actualAnswer + ".";
		  		questionIsLive = false;
		  		var question_read = false;
		  		console.log("timer count for countdown");
 				messageToVoice(msgRsp, true, function(){
 					question_read = true;
 					endCountdown(questionId);
 					socket.emit('question timer out');
 					console.log("QUESTION TIMER OUT SOCKET EMIT");
 				});
 				setTimeout(function(){ 
						if (question_read==false){
							endCountdown(questionId);
 							socket.emit('question timer out');
 							console.log("QUESTION TIMER OUT SOCKET EMIT (GOOGLE SPEECH API FAIL)");
						}
				}, 12000);
 				postScreenMessage(msgRsp, true, 4000);
 				hideQuestionField();
		  }
	}

	function endCountdown(questionId) //questionAnswered being if the question timer expired
	{
		hideQuestionField();
	}

	function stopTimer(timerRef)
	{
		clearInterval(timerRef);
		//$("#player_timer_text").html("Time Remaining:" + 15);
	}

	//attempt to display media if it exists in image
	//TODO include google image search if original database fails, or just replace!
	function searchForMedia(questionId)
	{
		$("#question_field #image_container").html('');
		console.log("Searching for Media on " + JSON.stringify(questionList[questionId]));
		var mediaLink = questionList[questionId].mediaLink;
		console.log("MEDIA LINK: "  + mediaLink);
		if (mediaLink != 'no url')
		{
			switch(questionList[questionId].mediaType)
			{
				case "image":
					//getImageGoogle(questionList[questionId].answer);
					$("#question_field #image_container").html("<img id='question_image' alt='no image available' src=" + mediaLink + ">");
					break;
				case "audio":
					var audioClip = new Audio();
			        audioClip.src = mediaLink;
			        audioClip.addEventListener('load', function () {
			        	//musicAnimate();
			            audioClip.play();
			        });
				default:
			}
		}
	}

	//use google api to match the first search result from an answer
	//disabled this, not sharing api key!
	function getImageGoogle(questionAnswer){
		var cx = "";
		var key = "";
		var searchType = "image";
		var num = 1;
		var searchURL = "https://www.googleapis.com/customsearch/v1?key=" + key + "&cx=" + cx + "&q=" + questionAnswer + "&num=" + num + "&searchType=" + searchType;
		console.log("GOOGLE URL: " + searchURL);
		$.getJSON( searchURL ).then(function( data ) {
			console.log(data);
			console.log("LINK TO GOOGLE IMAGE: " + data.items[0].link);
			$("#question_field #image_container").html("<img id='question_image' alt='no image available' src=" + data.items[0].link + ">");
		});
	}

	function musicAnimate(audioClip){
		/*var clipLength = audioClip.duration;
		var musicInterval = setInterval(function(){
			var currentTime = audioClip.currentTime;
			var percentComplete = currentTime/clipLength;
		}, 500);*/
	}

	//EFFECTS
	function displayQuestion(question, questionId)
	{
		searchForMedia(questionId);
		$("#question_field #category_display_temp").html(questionList[questionId].category);
		$("#question_field #question_display_temp").html(question);
		$("#question_field h2").fadeIn('slow');
		$('#question_field').css("height", "0px");
		$('#question_field').css("width", "0px");
		$('#question_field').css("font-size", "0px");
		$('#question_field').css("display", "flex");
		$('#question_field').animate({
			width: "85%",
			height: "100%",
			fontSize: "65px"
		}, 1500, function(){
			if(questionList[questionId].dailyDouble){
				animateDailyDouble();
			}
		});
		capturePromise("#question_field");
	}

	//TODO: this function will post a message overlay on top of the board that will fade out.  handy for any alerts
	function postScreenMessage(message , needsFadeOut, time, callback, parameter)
	{

		$("#message_overlay").html("<h2>" + message + "</h2>");

		$('#message_overlay').fadeIn('slow');

		if(needsFadeOut)
		{
			setTimeout(function() {
	        	$('#message_overlay').fadeOut('slow', callback);
	        	$("#message_overlay").empty();
	        	capturePromise("#message_overlay");
	    	}, time);
		}
		capturePromise("#message_overlay");
	}

	function staticMessageOff()
	{
		if(!finalJeopardyCheck){
			$('#message_overlay').fadeOut('slow');
		}
	}

    function hideQuestionField()
    {
    	$('#question_field').fadeOut('slow', function(){
    		$("#question_field h2 #question_display_temp").remove();
    	});
		capturePromise("#question_field");
    }

    function capturePromise(element)
    {
    	/*$("div").promise().done(function( arg1 ) {
  			// Will fire right away and alert "true"
 			alert( "done" );
		});*/
		$("div").queue(function(next) {
		  //alert( "Animation complete." );
		  next();
		});
    }

    function categoryAnimate(playerName)
    {	
    	var category;
    	var index = 0;
    	var message;

    	playSound(openUpSound);
    	$("#category_container").slideDown();

    	for(category in categories)  //append names to each div in category
    	{
    		$("#cat_" + category).html("<div class='secure_category_container'><h2>" + categories[category] + "</h2></div>")
    	}
    	//animate through each
    	$("#category_container").cycle({
    		fx: 'scrollRight',
    		next: "#category_container",
    		speed:    100,
    		timeout: 3000,
    		after: function(){
    			messageToVoice(categories[index], false);
    			index++;
    		},
    		height: 'auto',
    		easing:  'easeInOutBack',
    		autostop: 1,
    		end: function(options)
    		{
    			$('#category_container').cycle('stop');
    			playSound(openUpSound);
    			$("#category_container").slideUp('fast', function(){
    				postScreenMessage(playerName + ", you have the board.", true, 2000);
	    			message =  playerName + ", you have the board.";
				  	messageToVoice(message, true, function(){
				  		playSound(chooseCategoryTheme);
				  		flashActiveOn(activePlayerName);
				  	});
				  	socket.emit('begin round timer');
				  	socket.emit('open question category new round'); // this isn't very appropriate naming
    			});
    		}
    	});
    }
	function moveActiveIndicator(name)
	{
		for(nameId in nameIds)
		{
			$('#active_indicator_' + nameIds[nameId] + " td").html('WAITING');
		}
		$('#active_indicator_' + nameIds[name] + " td").html("ACTIVE");
	}	

	function flashBuzzer(name)
	{
		$('#active_indicator_' + nameIds[name]).addClass("flash_buzzer");
		setTimeout(function() {
        	$('#active_indicator_' + nameIds[name]).removeClass("flash_buzzer");
    	}, 2000);
	}

	function flashActiveOn(playerName){
		$('#active_indicator_' + nameIds[playerName]).addClass("flash_buzzer");
	}

	function flashActiveOff(playerName){
        $('#active_indicator_' + nameIds[playerName]).removeClass("flash_buzzer");
	}

	function dailyDoubleSegment(questionId, playerName)
	{
		//postScreenMessage("DAILY DOUBLE!", true);
		var message = playerName + " has selected " + questionList[questionId].category + ".";
		messageToVoice(message, true, function(){
			playSound(dailyDoubleSound);
			postScreenMessage(playerName + " is setting their wager.", false, 0);
			//bet is made public
		});
	}


	function animateDailyDouble(){
		$( "#daily_double_icon").slideDown( "slow" );
		$('#question_field #daily_double_bet').html("<h2>BET:" + dailyDoubleBet + "</h2>").fadeIn("slow");
	}

	function removeDailyDoubleIcon(){
		$( "#daily_double_icon").css('display', 'none');
		$('#question_field #daily_double_bet').fadeOut("fast", function(){		
			$('#question_field #daily_double_bet').html("");	
		});
	}

	//SOUNDS
	var timesUpSound = document.createElement('audio');
    timesUpSound.setAttribute('src', SOUNDS_DIR + 'times_up.mp3');

    var jeopardyIntroMusic = document.createElement('audio');
    jeopardyIntroMusic.setAttribute('src', SOUNDS_DIR + 'jeopardy_intro.mp3');

    var dateSoundEffect = document.createElement('audio');
    dateSoundEffect.setAttribute('src', SOUNDS_DIR + 'radio_tuning.mp3');

    var openUpSound = document.createElement('audio');
    openUpSound.setAttribute('src', SOUNDS_DIR + 'open_up.flac');

    var playerJoinSound = document.createElement('audio');
    playerJoinSound.setAttribute('src', SOUNDS_DIR + 'game_start.ogg');

    var gameSoundWrong = document.createElement('audio');
    gameSoundWrong.setAttribute('src', SOUNDS_DIR + 'game_sound_wrong.wav');

    var dailyDoubleSound = document.createElement('audio');
    dailyDoubleSound.setAttribute('src', SOUNDS_DIR + 'daily_double.mp3');

    var buzzInSound = document.createElement('audio');
    buzzInSound.setAttribute('src', SOUNDS_DIR + 'simple_magic_response.mp3');

    var roundOverSound = document.createElement('audio');
    roundOverSound.setAttribute('src', SOUNDS_DIR + 'round_over_sound.wav');

    var finalJeopardyTheme = document.createElement( 'audio');
    finalJeopardyTheme.setAttribute('src', SOUNDS_DIR + 'final_jeopardy_theme.mp3');

    var finalJeopardyBloop = document.createElement('audio');
    finalJeopardyBloop.setAttribute('src', SOUNDS_DIR + 'final_jeopardy_bloop.wav');

    var chooseCategoryTheme = document.createElement( 'audio');
    chooseCategoryTheme.setAttribute('src', SOUNDS_DIR + 'game_background_category.mp3');


    var questionTheme = document.createElement( 'audio');
    questionTheme.setAttribute('src', SOUNDS_DIR + 'question_theme.wav');


    var clockCountdown = document.createElement( 'audio');
    clockCountdown.setAttribute('src', SOUNDS_DIR + 'clock_countdown.wav');

    var boardFillSound = document.createElement( 'audio');
    boardFillSound.setAttribute('src', SOUNDS_DIR + 'board_fill.mp3');

    //loop the theme if it ends
    jeopardyIntroMusic.addEventListener('ended', function() {
    	this.currentTime = 0;
    	this.play();
	}, false);

    //loop the theme if it ends
    questionTheme.addEventListener('ended', function() {
    	this.currentTime = 0;
    	this.play();
	}, false);
	
	    //loop the theme if it ends
    chooseCategoryTheme.addEventListener('ended', function() {
    	this.currentTime = 0;
    	this.play();
	}, false);

    //when the final jeopardy theme ends
    finalJeopardyTheme.addEventListener('ended', function() {
    	finalJeopardyThemeEnded = true;
    	socket.emit('final jeopardy time out');
    	this.currentTime = 0;
    	if(countScores>=3)
    	{
    		finalCeremonies();
    	}
    	else
    	{
    		var lastTimer = setInterval(function()
    			{
    				if(countScores>=3)
    				{
    					finalCeremonies();
    					clearInterval(lastTimer);
    				}
    			}, 10);
    	}
	}, false);
    //capture buzz out
    //buzzed in time ran out
    socket.on('buzzed in times up', function(timesUp){
    	var openQuestionsSwitch = true;
    	//stopSound(clockCountdown);
    	console.log("times up question id " + timesUp.questionId);
    	playSound(timesUpSound);
    	hidePopup(timesUp.playerName);
    	var msgRsp = "";
		updateScore(timesUp.playerName, timesUp.score);
		if(timesUp.allPlayersAnswered || timesUp.dailyDouble)
		{
			msgRsp = "The response we were looking for was " + timesUp.actualAnswer + "."  ;

			if (timesUp.dailyDouble){
				msgRsp = timesUp.playerName + " couldn't come up with anything.  They wagered " + timesUp.dailyDoubleWager + ".  The response we were looking for was " + timesUp.actualAnswer + ".";
				removeDailyDoubleIcon();
			}
	 		

			postScreenMessage(msgRsp, false, 0);
			var msgRead = false;
			messageToVoice(msgRsp, true, function(){
				openQuestionsSwitch = false;
				msgRead = true;
				endCountdown(timesUp.questionId);
				staticMessageOff();
				hideQuestionField();
				if(timesUp.dailyDouble){
					socket.emit('finished all messages dd');	
				}
				else{
					socket.emit('all messages done buzzed in time out'); //trigger next active player after all messages done
				}
			});

			setTimeout(function(){
				if(msgRead == false){
					openQuestionsSwitch = false;
					endCountdown(timesUp.questionId);
	 				staticMessageOff();
	 				hideQuestionField();
	 				if(timesUp.dailyDouble){
						socket.emit('finished all messages dd');
					}
					else{
						socket.emit('all messages done buzzed in time out');
					}
				}
			}, 17000);

 			socket.emit('close buzzer');

 			questionIsLive = false;
		}
		else
		{
			console.log("times up buzzed out question still open" + timesUp.questionId);
			msgRsp = timesUp.playerName + " ran out of time. Questions still open.";
			messageToVoice(msgRsp, true, function(){playSound(questionTheme)});
			var msgFunction = function(){
				console.log("Times up qID: " + timesUp.questionId);
				socket.emit('continue countdown', timesUp.questionId);
			};
			var msgRead = false;
			postScreenMessage(msgRsp, true, 4000, function()
				{
					msgRead = true;
					msgFunction();
				});
			setTimeout(function(){ 
				if (!msgRead){
					msgFunction();
				}
			}, 10000);

		}
    });

    function updateScore(playerName, score)
    {
    	$("#name_" + nameIds[playerName]).html(score);
    }

    var chunkLength = 120;
	var pattRegex = new RegExp('^[\\s\\S]{' + Math.floor(chunkLength / 2) + ',' + chunkLength + '}[.!?,]{1}|^[\\s\\S]{1,' + chunkLength + '}$|^[\\s\\S]{1,' + chunkLength + '} ');
    
    //read question aloud
    function messageToVoice(message, needsCallback, callback)
    {
        var arr = [];
        var element = this;
        var txt = message;
        var voices = window.speechSynthesis.getVoices();
        var u;
        var t;

        console.log("MESSAGE TO VOICE STRING: " + message);
        while (txt.length > 0) {
            arr.push(txt.match(pattRegex)[0]);
            txt = txt.substring(arr[arr.length - 1].length);
        }
        $.each(arr, function () {
            u = new SpeechSynthesisUtterance(this.trim());
            u.voice = voices[3]; // Note: some voices don't support altering params
			u.rate = 0.9; // 0.1 to 10
            window.speechSynthesis.speak(u);

        });

        if (needsCallback)
		{
			u.onend = function (event) {
			    t = event.timeStamp - t;
			    console.log(event.timeStamp);
			    console.log((t / 1000) + " seconds");
			    callback();
			};
		}
    	/*var msg = new SpeechSynthesisUtterance(message);
    	var voices = window.speechSynthesis.getVoices();
		msg.voice = voices[3]; // Note: some voices don't support altering params
		msg.rate = 0.9; // 0.1 to 10
		window.speechSynthesis.speak(msg);*/
    }

    function playSound(soundName)
    {
    	soundName.volume = 1.0;
    	soundName.currentTime=0;
    	soundName.play();
    }

    playSound(jeopardyIntroMusic);

    function stopSound(soundName)
    {
    	soundName.pause();
    	soundName.currentTime = 0;
    }

    //game round timer
	var c = document.getElementById("canvas");
	var ctx = c.getContext("2d");
	var imd = null;
	var circ = Math.PI * 2;
	var quart = Math.PI / 2;
    var centerX = canvas.width / 2;
    var centerY = canvas.height / 2;
    var radius = 60;
    

	ctx.beginPath();
	ctx.strokeStyle = "#4CAF50";
	ctx.closePath();
	ctx.lineWidth = 25;


	imd = ctx.getImageData(0, 0, 240, 240);

	var draw = function(current) {
	    ctx.putImageData(imd, 0, 0);
	    ctx.beginPath();
	    ctx.arc(centerX, centerY, radius, -(quart), ((circ) * current) - quart, false);
	    ctx.stroke();
	    ctx.restore();
	}

	var numberPercent = new Array();
	numberPercent[0]=0;
	numberPercent[1]=0;
	numberPercent[2]=0;
	var timePercent = new Array();
	
	//question timer for popups
	function drawTypingPopup(pressedPlayerName)
	{
		console.log("drawing for " + pressedPlayerName);

		var idForPlayer = nameIds[pressedPlayerName];

		console.log(idForPlayer);
		$("#player_typing_" + idForPlayer).animate({
			right: "+=50"
		}, 1500, function(){

		});


		//draw animation on popup
		timePercent["timer_" + idForPlayer] = setInterval(function(){
			if (numberPercent[idForPlayer] > answerTime * 100)
			{
				clearInterval(timePercent["timer_"+idForPlayer]);
				numberPercent[idForPlayer] = 0;
			}
			else{
				$("#player_typing_" + idForPlayer + " .progress").css("height", numberPercent[idForPlayer]/answerTime + '%');
			}
			numberPercent[idForPlayer]++;
		}, 10);
	}	

	function hidePopup(pressedPlayerName)
	{
		var idForPlayer = nameIds[pressedPlayerName];
		clearInterval(timePercent["timer_"+idForPlayer]);
		numberPercent[idForPlayer] = 0;
		$("#player_typing_" + idForPlayer).animate({
					right: "-=50"
				}, 1500, function(){
					
				});
	}

	function animateBoard(jeopardy){
		var roundName = "#J_";
		if (!jeopardy)
		{
			roundName = "#DJ_";
		}
		var pickedTds = new Array();
		playSound(boardFillSound);
		var animateBoardInterval;

		var x=0;
		for (x=0; x<30; x++)
		{
			var continueProcess = false;

			var randomNum = Math.floor(Math.random()*30);

			while(!continueProcess)
			{
				if (pickedTds.length == 0)
				{
					continueProcess = true;
					pickedTds.push(randomNum);
				}
				else if (pickedTds.indexOf(randomNum) === -1)
				{
					continueProcess = true;
					pickedTds.push(randomNum);
				}
				else
				{
					randomNum = Math.floor(Math.random()*30);
					continueProcess = false;
				}
			}
			//$('#J_' + (randomNum%6) + '_' + parseInt(randomNum / 6)).css('color', 'rgb(255, 234, 0)');
		}

		var index = 0;

		animateBoardInterval = setInterval(function(){
			if(index<30)
			{
				$(roundName + (pickedTds[index]%6) + '_' + parseInt(pickedTds[index] / 6)).css('color', 'rgb(255, 234, 0)');
				$(roundName + (pickedTds[index]%6) + '_' + parseInt(pickedTds[index] / 6)).css('textShadow', 'black 2px 2px');
				index++;
			}
			else
			{
				clearInterval(animateBoardInterval);
			}
		}, 100);
	}
});	


