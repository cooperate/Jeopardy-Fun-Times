$(document).ready(function() {
	// To add to window
	if(typeof Promise !== "undefined" && Promise.toString().indexOf("[native code]") !== -1){
	    console.log("PROMISES WORK!");
	}
	else{
		console.log("PROMISES DON'T WORK :(");
	}

	var playerName;
	var playerScore = 0;
	var activePlayerName;
	var curQuestionId = '';
	var socket = io('/player');
	var buzzerLock=false;
	var finalJeopardyCheck = false;
	var clicked = false;
	var questionTimerServer;
	var pressedAnswer = false;
	var blockClicks = false;//a bool that triggers a timer, if players attempt to buzz in before the question is being read they are penalized half a second
	var listenForClicks = false;//a bool that acts as a switch while the question is being read 
	var buzzerOpen = false;
	var finalJeopardyAnswered = false; //used to determine if a player answered the final jeopardy question for scoring purposes
	var answerTime = 15;
	const SOUNDS_DIR = "../../game-media/sounds/";
	const IMAGES_DIR =  "../../game-media/images/";
	
	//$(".buzzer").prop("disabled",true);
	$('#message_overlay').css('display', 'none');
	$('.player_bet_field').css('display', 'none');
	$('.restart').css('display', 'none');
	$('.player_field').css('display', 'none');
	$('.game_options').hide();

	function beginCountdown(buzzerTime)
	{
		console.log(buzzerTime);
		
		drawTimeBlocks(buzzerTime);

		if (buzzerTime===0) 
		{
				console.log("entered 0 section");
				//send audio times up
				socket.emit('buzzed in times up', {curQuestionId: curQuestionId, playerName:playerName, dailyDouble: false});
				switchBuzzer(true);
				$("#answer_field").val('');
				//hide mobile keyboard
				$("#answer_field").blur();
		}
	}

	socket.on('update buzzer interval', function(buzzerTimeData){
		if (buzzerTimeData.buzzedInPlayerName == playerName)
		{
			beginCountdown(buzzerTimeData.buzzedInTimerCount);
		}
	});

	function endCountdown()
	{
		$("#timer_table").find("td").css("background-color", "rgb(239, 83, 80)");
	}

	function switchBuzzer(buzzerOn)
	{
		if (buzzerOn)
		{
			$(".player_buzzer").css("display", "block");
  			$(".player_answer_field").css("display", "none");
		}
		else
		{
			$(".player_buzzer").css("display", "none");
			$(".player_answer_field").css("display", "block");
			$("#answer_field" ).focus();
		}
	}

	$('.player_answer_field').css(
		'display', 'none'
	);

	$('#join').prop('disabled',true);

	 $('#username').keyup(function(){
        $('#join').prop('disabled', this.value == "" ? true : false);     
    })


	 //PLAYER LOGIN
	   
	  $('#player_login').submit(function(){
	  		var loginNameStripped = $('#login_name').val();
	  		loginNameStripped = loginNameStripped.trim();
	  		loginNameStripped = loginNameStripped.toUpperCase();
	  		if (loginNameStripped == '')
	  		{
	  			swal({
				  title: "Oops!",
				  text: "Please enter a name.",
				  timer: 2000,
				  showConfirmButton: false
				});
	  		}
	  		else
	  		{
	  			$('#join_btn').prop('disabled',true);
	  			socket.emit('login name', loginNameStripped);
	  			playerName = loginNameStripped;
	  			$(".player_field_info").append("<h2 id='player_name'>" + playerName + "</h2>");
	  			$(".player_field_info").append("<h2 id='player_score'>0</h2>");
        	}
        	return false;
      });

	  //hide ios keyboard
	  /*$( "#login_name" ).bind('touchstart', function(e) {
    	e.preventDefault();
    	document.activeElement.blur();
	});*/

	  $('#login_name').keyup(function(event) {
		    if (event.which === 13) {
		      $(this).blur();
		    }
		});

	  socket.on('option select new', function(name){

	  		var this_result;

	  		if(playerName == name){
	  			$(".login").fadeOut('fast', function() {
	  				$(".game_options").fadeIn('slow', function() {
	  					
	  				});
	  			});
	  			
	  			//socket.emit('option select new', [30, "00s"]);
				// inputOptions can be an object or Promise
				var inputOptionsTime =  {
				      '15': '15',
				      '20': '20',
				      '30': '30'
				    };

				var inputOptionsDecade = {
				      '80s': '80s',
				      '90s': '90s',
				      '00s': '2000s',
				      '10s': '2010s'
				    };

	  		/*swal.setDefaults({
			  input: 'radio',
			  confirmButtonText: 'Next &rarr;',
			  showCancelButton: false,
			  animation: true,
			  progressSteps: ['1', '2']
			});


			var steps = [
			  {
			    title: 'Select Answer Time.',
			    input: 'radio',
			    inputOptions: inputOptionsTime,
			    inputValidator: function (result) {
				    return new Promise(function (resolve, reject) {
				      if (result) {
				        resolve();
				      } else {
				        reject('You need to select something!');
				      }
				    })
				  }
			  },
			  {
			    title: 'Which decade would you like to play in?',
			    input: 'radio',
			    inputOptions: inputOptionsDecade,
			    inputValidator: function (result) {
				    return new Promise(function (resolve, reject) {
				      if (result) {
				        resolve();
				      } else {
				        reject('You need to select something!');
				      }
				    })
				  }
			  }
			];

			swal.queue(steps).then(function (result) {
				this_result = result;
			  swal({
				  title: 'Get ready for Jeopardy!',
				  text: 'The answer time is ' + result[0] + ' seconds.',
				  timer: 3500,
				  showConfirmButton: false
				}).then(
				  function () {
				  },
				  // handling the promise rejection
				  function (dismiss) {
				    if (dismiss === 'timer') {
				      console.log('I was closed by the timer')
				      console.log("THIS RESULT DECADE AND TIMER: " + this_result);
						socket.emit('option select new', this_result);	
			 			swal.resetDefaults();
				    }
				  }
				)
			});*/
		}
	  });
	var options_accept_clicked = false;

	$("#options_accept").click(function(){
		var inputOptionsTime =  {
		      '15': '15',
		      '20': '20',
		      '30': '30'
		    };

		var inputOptionsDecade = {
		      '80\'s' : '80s',
		      '90\'s' : '90s',
		      '2000\'s' : '00s',
		      '2010\'s' : '10s'
		    };

		if (!options_accept_clicked){
			options_accept_clicked = true;
			var time_radio; 
			var decade_radio;

			$('input[name="radio-group-time-option"]:checked').each(function() {
				var idVal = $(this).attr("id");
				time_radio = $("label[for='"+idVal+"']").text();
			});
			
			$('input[name="radio-group-decade-option"]:checked').each(function() {
				var idVal = $(this).attr("id");
				decade_radio = $("label[for='"+idVal+"']").text();
			});

			var time_option = inputOptionsTime[time_radio];
			var decade_option = inputOptionsDecade[decade_radio];

			console.log("TIME OPTION: " + time_option + " DECADE OPTION: " + decade_option);
				$(".game_options").css('display', 'none');
				socket.emit('option select new', [time_option, decade_option]);
				postScreenMessage("Please wait for the game to begin.", false, 0);
				setTimeout(function(){
					$("#login_container").css('display', 'none');
					$(".player_field").css('display', 'block');
				}, 3000);
		}	

	});

	  socket.on('wait for start game',function(name){
	  		if(playerName == name){
		  		postScreenMessage("Please wait for the game to begin.", false, 0);
		  		setTimeout(function(){
		  			$("#login_container").css('display', 'none');
		  			$(".player_field").css('display', 'block');
		  		}, 3000);
	  		}
	  });

	  socket.on('answer time data', function(answerTimeData){
	  	answerTime = answerTimeData;
	  });

	  var roundTimer = 600;

	  //capture player active 
	   socket.on('active player',function(data){

	   		blockClicks = false;
	   		listenForClicks = false;

	   		if (data.newGame == "new game")
	   		{
	   			$('.player_field').append("<div id='tempGAME'>" + data.gameMarkup + "</div>");
	   			
	   			activePlayerName = data.playerName;
	   		}
	   		else
	   		{
	   			
	   			console.log("a new player is up");
	   			if (!finalJeopardyCheck)
	   			{

	   				if (roundTimer > 0)
	   				{
		   				
		   				$("#question_revealed").html("Your Question Will Appear Here");
				   		if (data.playerName == playerName)  //assign active player to player if they got the question right
				   		{
				   			postScreenMessage("YOU'RE UP! PICK A QUESTION.", false, 0);
				   		}

				   		else
				   		{
				   			$('#tempGAME').css("display", "none");
				   			postScreenMessage("Please wait for " + data.playerName + " to pick a category.", false, 0);
				   		}

				   		if (data.correct == true)
				   		{
				   			activePlayerName = data.playerName;
				   		}
			   		}
		   		}
	   		}
	  });

	   socket.on('open question category', function(playerNameActive){ //open categories for selection
	   	if (playerNameActive == playerName)
	   	{
	   		staticMessageOff();
	   		displayCategories(true);
	   	}
	   });

	   socket.on('update round interval', function(timer){
	   		roundTimer = timer;
	   })

	   socket.on('second round started', function(content){
	   		$("#tempGAME").html(content);
	   		displayCategories(false);
	   		postScreenMessage("Please look at the game board.", false, 0);
	   });

	   socket.on('close category select', function(){
				displayCategories(false);
	   });

	   socket.on('open question category new round', function(newRoundActivePlayer){
	   		if (newRoundActivePlayer == playerName)  //assign active player to player if they got the question right
	   		{
	   			staticMessageOff();
	   			displayCategories(true);
	   		}

	   		else
	   		{
	   			$('#tempGAME').css("display", "none");
				postScreenMessage("Please wait for " + activePlayerName + " to pick a category.", false, 0);
	   		}

	   		$("#question_revealed").html("Your Question Will Appear Here");
	   });

	   socket.on('final jeopardy time out', function(){
	   		console.log("FJ TIME OUT");
	   		postScreenMessage("Please look at the game board.", false, 0);
	   		socket.emit('player field fj time out', playerName);
	   		$("#answer_field").blur();
	   		if (!finalJeopardyAnswered){
	   			socket.emit('player no answer final jeopardy', playerName);
	   		}
	   });

	   //event handler for clicking on table cell select question question selected select category
	  $( ".player_field" ).on('click', '#tempGAME tr>td', function(e) {
		 var questionSelectId = $(this).attr('id');
		 console.log("Question Selected ID: " + questionSelectId);
		 var value = $("#" + questionSelectId).html();
		 if (value != '')
		 {
		 	if (!clicked) //prevent double tap
		 	{
		 	 clicked = true;
			 socket.emit('question selected', questionSelectId);
			 displayCategories(false);
			 //$("td").unbind("click");
			 e.preventDefault();
			}
		}
	  });

	   //capture question elimination sync, also when time runs out and no on answers
	  socket.on('question disappear',function(questionId){
	  	eliminateQuestion(questionId);
	  });

	  //capture question reveal
	  socket.on('question reveal',function(question){
	  	console.log("QUESTION REVEAL SOCKET DATA: " + question);
	  	listenForClicks = true;
	  	pressedAnswer = false;
	  	//daily double?
	  	curQuestionId = question.questionId;
	  	$(".buzzer").css("background-color", "rgb(76, 175, 80)");
	  	$("#timer_table").find("td").css("background-color", "rgb(239, 83, 80)");
	 	if (question.dailyDouble)
	 	{
	 		dailyDoubleSegment(question.questionId, question.question, question.playerName);
	 	}
	 	else
	 	{
	 		$("#question_revealed").css("display", "none");
	 		$("#question_revealed").html(question.question);
		  	staticMessageOff();
		  	buzzerLock=false;
	  	}
	  });

	  socket.on('expose question', function(){
	  	console.log("THIS PLAYER EXPOSED QUESTION DEVICE IS: " + playerName);
	  	socket.emit("expose question test", "THIS PLAYER EXPOSED QUESTION DEVICE IS: " + playerName);
	  	$("#question_revealed").slideDown(1500);
	  });

	  //capture timer expiration from other player, times up does not call score update
	  socket.on('buzzed in times up', function(timesUp){
	  		$("#answer_field").blur();
	  		
	  		if (recognition != undefined)
		 	{
		 		recognition.stop();
			}
	  		updateScore(timesUp.playerName, timesUp.score);
	  		if(timesUp.dailyDouble || timesUp.allPlayersAnswered)
	  		{
	  			eliminateQuestion(timesUp.curQuestionId);
	  		}
	  		if(timesUp.playerName == playerName)
	  		{
	  			$(".buzzer").css("background-color", "rgb(105,105,105)");
	  			postScreenMessage("Just relax and let the other players do the thinking.", false, 0);
	  		}
	  		else
	 		{
	 			if (!buzzerLock)
	 			{
	 				staticMessageOff();
	 			}
	 		}
	  });

	  socket.on('update interval', function(timer){
	  	questionTimerServer = timer;
	  	if (questionTimerServer <= 0)
	  	{
	  	  buzzerOpen = false;
	  	  //$(".buzzer").prop("disabled",true);
	 	  $(".buzzer").css("background-color", "rgb(105,105,105)");
	  	}
	  });

	  //buzzers are available to be used after question introduced
	  socket.on('open buzzer',function(){
	  		listenForClicks = false;
	  		console.log("before buzzer lock check");
  			if (!buzzerLock)
			{
				socket.emit("buzzers opened");//this may fire multiple times to the server, but because the server is only doing anything if the question timer is null it should only fire once which is what we want!
				staticMessageOff();
				if (blockClicks)
				{
					setTimeout(function(){
						console.log("clicks open");
						buzzerOpen = true;
						//$(".buzzer").prop("disabled",false);
		  				$(".buzzer").css("background-color", "rgb(76, 175, 80)");
					}, 500);
				}
				else
				{
					console.log("buzzer open");
					buzzerOpen = true;
		  			//$(".buzzer").prop("disabled",false);
		  			$(".buzzer").css("background-color", "rgb(76, 175, 80)");
	  			}
	  		}
	  });
	  
	  //buzzers are off
	 socket.on('close buzzer',function(){
		buzzerOpen = false;
		//$(".buzzer").prop("disabled",true);
		$(".buzzer").css("background-color", "rgb(105,105,105)");
	  });

	//buzzer is pressed buzz in
	$(".buzzer").click(function(){
		console.log("clicked player field");
		if(listenForClicks){
			console.log("blocked clicks");
			blockClicks = true;
		}
	 	socket.emit('buzzer press test', "BUZZER PRESSED BY : " + playerName);
		if (!buzzerLock)
		{
			if (buzzerOpen)
			{
				console.log("buzzer pressed: " + playerName);
				socket.emit('buzzer pressed', playerName);
			}
		}
	});

	//capture buzzer press from all connected players //used to be buzzer pressed
	 socket.on('buzzer pressed', function(pressed){
	 	if (playerName != pressed.playerName)
	 	{
	 		postScreenMessage(pressed.playerName + " buzzed in and is typing their answer.", false, 0);
	 	}
	 	else
	 	{
	 		//start timer
	  		beginCountdown(answerTime);
	 		switchBuzzer(false);
			buzzerLock=true; //we know if this instance of the player buzzed in, disable the buzzer for the remainder of this question
			$(".buzzer").css("background-color", "rgb(105,105,105)"); //background-color: rgb(76, 175, 80);
	 	}
	 });

	 //capture Daily Double Response from bet begin countdown
	 socket.on('daily double response', function(response){
	 	if (response.playerName == playerName)
	 	{
	 		$("#answer_btn").prop("disabled", true);
	 		$("#answer_btn").css("background-color", "rgb(105,105,105)");
	 		$("#question_revealed").html(response.question);
	 		$(".player_bet_field").css("display", "none");
	 		curQuestionId = response.questionId;
	 		switchBuzzer(false);
	 	}
	 });


	 socket.on('update daily double interval', function(data){
	 	updateDailyDoubleTimer(data.dailyDoubleTimerCount, data.dailyDoublePlayerName);
	 });

	 socket.on('daily double question finished being read', function(){
	 	$("#answer_btn").prop("disabled", false);
	 	$("#answer_btn").css("background-color", "rgb(255, 204, 2)");
	 });

	 function updateDailyDoubleTimer(dailyDoubleTimerCount, dailyDoublePlayerName)
	 {
 		if (playerName == dailyDoublePlayerName){
			
			drawTimeBlocks(dailyDoubleTimerCount);

			if (dailyDoubleTimerCount<=0) 
			{
					$("#answer_field").val('');
					switchBuzzer(true);
					//hide mobile keyboard
					$( "#answer_field" ).blur();
					$('.player_answer_field').css('display', 'none');
			}
		}
	 }

	 function drawTimeBlocks(remainingTime){

	 	var answerTimeDivisor = answerTime/5;

	 	switch(remainingTime)
			{
			case answerTime - answerTimeDivisor:
				$(".timer_cell_5").css("background-color", "black");
				break;
			case answerTime - answerTimeDivisor * 2:
				$(".timer_cell_4").css("background-color", "black");
				break;
			case answerTime - answerTimeDivisor * 3:
				$(".timer_cell_3").css("background-color", "black");
				break;
			case answerTime - answerTimeDivisor * 4:
				$(".timer_cell_2").css("background-color", "black");
				break;
			case answerTime - answerTimeDivisor * 5:
				$(".timer_cell_1").css("background-color", "black");
				break;
			default:
				break;	
			}
	 }

	 //on answer submission submit answer
	 $( "#answer_submit" ).submit(function( event ) {
	 	if (!pressedAnswer)
	 	{
		 	if (recognition != undefined)
		 	{
		 		recognition.stop();
			}
			var answer = $('#answer_field').val();
			answer = answer.trim();
			
			if (answer == '')
			{
					swal({
					  title: "Oops!",
					  text: "Enter an answer.",
					  timer: 3000,
					  showConfirmButton: false
					});
			}
			else{
				pressedAnswer = true;
				switchBuzzer(true);
		  		endCountdown();
		  		console.log(playerName);
		  		socket.emit('answer selection', {answer: answer, questionId: curQuestionId, playerName: playerName, finalJeopardyCheck: finalJeopardyCheck});
		        $('#answer_field').val('');
		        console.log(finalJeopardyCheck);
		        if(finalJeopardyCheck)
		        {
		        	postScreenMessage("Please look at the screen.", false, 0);
		        }
			}
			$("#answer_field").blur();


	   		if (finalJeopardyCheck==true){
	   			finalJeopardyAnswered = true;
	   		}
		}

        return false;
	});

	  //hide ios keyboard
	  /*$( "#answer_field" ).bind('touchstart', function(e) {
    	e.preventDefault();
    	document.activeElement.blur();
	});*/

	  $('#answer_field').keyup(function(event) {
		    if (event.which === 13) {
		      $(this).blur();
		    }
		});

	 //on answer determination 
	 socket.on('score update', function(score){

	 	if (playerName == score.playerName)
	 	{
	 		$('#player_score').html(score.score);
	 		playerScore= score.score;
	 	}
	 	if (!finalJeopardyCheck)
	 	{
		 	if (score.allPlayersAnswered || score.correct || score.dailyDouble)
		 	{
		 		eliminateQuestion(score.questionId);
		 	}
		 	else
		 	{	
		 		if (playerName == score.playerName)
		 		{
		 			postScreenMessage("You'll get it next time!", false, 0);
		 		}
		 		else
		 		{
		 			if (!buzzerLock)
		 			{
		 				staticMessageOff();
		 			}
		 		}
		 	}
	 	}
	 });

	 socket.on('final jeopardy started', function(){
	 	pressedAnswer = false;
	 	finalJeopardyCheck = true;
	 	endCountdown();
	 	postScreenMessage("Please look at the screen.", false, 0);
	 	$("#question_revealed").html("Your Question Will Appear Here");
	 });

	socket.on('final jeopardy bid', function(categoryName){
		console.log("time to bid");
	 	endCountdown();
	 	displayCategories(false);
	 	$("#question_revealed").html(categoryName);
		$(".player_buzzer").css("display", "none");
		$(".player_bet_field").css("display", "block");
		$("#bet_field" ).focus();
		staticMessageOff();
	});

	socket.on('open response final jeopardy', function(question){
		$("#question_revealed").html(question);
  		$(".player_bet_field").css("display", "none");
		switchBuzzer(false);
		staticMessageOff();
	});

	socket.on('game over', function(winningPlayerName){
		if (winningPlayerName == playerName)
		{
			postScreenMessage("You're todays champion, congratulations!", false, 0);
			setTimeout(function(){
				swal({
				  title: 'Play Again?',
				  text: "Play again with the current contestants.",
				  type: 'warning',
				  showCancelButton: true,
				  confirmButtonColor: '#3085d6',
				  cancelButtonColor: '#d33',
				  confirmButtonText: 'Play Again!'
				}).then(function () {
				   socket.emit('new game');
				});
			}, 8000);
		}
	});

	socket.on('new game', function(){
		playerScore = 0;
		curQuestionId = '';
		finalJeopardyCheck = false;
		clicked = false;
		questionTimerServer;
		pressedAnswer = false;
		blockClicks = false;//a bool that triggers a timer, if players attempt to buzz in before the question is being read they are penalized half a second
		listenForClicks = false;//a bool that acts as a switch while the question is being read 
		buzzerOpen = false;
		finalJeopardyAnswered = false;
		//$(".buzzer").prop("disabled",true);
		$(".player_field #tempGAME").remove();
		$("#player_score").html("0");
		$('.player_bet_field').css('display', 'none');
		$('#login_container').css('display', 'none');
	 	$(".buzzer").css("background-color", "rgb(105,105,105)");
		$('.restart').css('display', 'none');
		$('.player_answer_field').css('display', 'none');
		$(".player_buzzer").css("display", "block");
		postScreenMessage("Please look at the screen.", false, 0);

		socket.emit('new game ready');
	});

	function displayCategories(display)
	{
		if (display)
		{
			clicked = false;
			$('#tempGAME').fadeIn('fast');	
		}	
		else
		{
			$('#tempGAME').fadeOut('slow');
		}
	}

	function updateScore(playerNameUpdate, score)
	{
		clicked = false;
		if (playerName == playerNameUpdate)
		{
			$('#player_score').html(score);
			playerScore = score;
		}
	}

	function eliminateQuestion(questionId)
	{
		$("#"+ questionId).html('');
	}

	function dailyDoubleSegment(questionId, question, playerNameSend)
	{
		//postScreenMessage("DAILY DOUBLE", true);

		if (playerName == playerNameSend) //this player has the daily double
		{
			setTimeout(function(){
				$(".player_buzzer").css("display", "none");
	  			$(".player_bet_field").css("display", "block");
	  			$("#bet_field" ).focus();
			}, 3000);
		}
		else
		{
			postScreenMessage("Please look at the screen for Daily Double.", false, 0);	
		}
	}

	 //on bet submission
	 $( "#bet_submit" ).submit(function( event ) {
	 	event.preventDefault();
	 	var value = $('#bet_field').val();
	 	value = value.trim();
	 	
	 	if ( value == '')
	 	{
	 			swal({
				  title: "Oops!",
				  text: "Please enter a wager.",
				  timer: 4000,
				  showConfirmButton: false
				});
				return false;
	 	}
	 	else if (value != parseInt(value, 10))
	 	{
	 			 swal({
				  title: "Oops!",
				  text: "The value must be a number.",
				  timer: 4000,
				  showConfirmButton: false
				});
	 			 return false;
	 	}
	 	value = parseInt(value);
	 	var validationObject = validateBet(value);
	 	if (validationObject.isValid)
	 	{	
	 		socket.emit('bet selection', {betValue: value, questionId: curQuestionId, playerName: playerName, finalJeopardyCheck: finalJeopardyCheck}); //final jeopardy check is only triggered after final jeopardy segment begins (not to be confused with final jeopardy triggering ie. the game timer runs out while a daily double occurs)
	 		$('#bet_field').val('');
	 	}
	 	else
	 	{
	 		$('#bet_field').val('');
	 		swal({
				  title: "Trying to pull a fast one?",
				  text: validationObject.message,
				  timer: 2000,
				  showConfirmButton: false
				});
	 	}

	 	if(finalJeopardyCheck && validationObject.isValid && value != '')
	 	{
	 		$(".player_bet_field").fadeOut();
	 		postScreenMessage("Please look at the screen.", false, 0);
	 	}

	 	$("#bet_field").blur();
	 	event.preventDefault();
	 	return false;
	});

	$('#bet_field').keyup(function(event) {
		if (event.which === 13) {
			$(this).blur();
		}
	});

	 function validateBet(bet)
	 {
	 	if (!isNaN(bet))
		{
			if (bet<0)
		 	{
		 		return {message: "You can't make a negative bet.", isValid: false};
		 	}
		 	if (bet >= 0 && bet <5)
		 	{
		 		return {message: "The minimum bet is 5.", isValid: false};
		 	}
			if(bet>playerScore && playerScore>=0)
		 	{
		 		if (bet<5)
				{
					return{message: "The minimum bet is 5.", isValid: false};
				}
		 		else if (bet>1000 && playerScore<1000)
		 		{
		 			return {message: "Your score is less than the Jeopardy maximum but you're still not in the negatives.  You can wager up to 1000.  Keeping that in mind, make a new bet.", isValid: false};
		 		}

		 		else
		 		{
		 			return {message: "Valid.", isValid: true};
		 		}
		 	}
			if (playerScore < 0)
			{
				if (bet>playerScore && bet>1000)
				{
					return {message: "You are not doing well, bid up to 1000 as a sign of our affection.", isValid: false};
				}

				if (bet<5)
				{
					return{message: "The minimum bet is 5.", isValid: false};
				}

				else
				{
					return {message: "Valid", isValid: true};
				}
			}
			else
			{
				return {message: "Valid", isValid: true};
			}
		}
	 	else
	 	{
	 		return {message: "Please enter a number.", isValid: false};
	 	}
	 }

	//TODO: this function will post a message overlay on top of the board that will fade out.  handy for any alerts
	function postScreenMessage(message, needsFadeOut, time, callback)
	{
		$('#message_overlay').fadeIn('slow', callback);
		$("#message_overlay").html("<h2>" + message + "</h2>");
		if(needsFadeOut)
		{
			setTimeout(function() {
	        	$('#message_overlay').fadeOut('slow', callback);
	        	$("#message_overlay").empty();
	    	}, time);
		}
	}

	function staticMessageOff()
	{
		$('#message_overlay').slideUp('fast');
	}

	//ANIMATIONS
	  // jquery transit is used to handle the animation
   $('#login_name').focusin(function() {
        $('label').transition({x:'80px'},500,'ease').next()
	        .transition({x:'5px'},500, 'ease');
			//setTimeout needed for Chrome, for some reson there is no animation from left to right, the pen is immediately present. Slight delay to adding the animation class fixes it
	         setTimeout(function(){
			    $('label').next().addClass('move-pen');
		      },100);
			
			});
			  
			  $('input').focusout(function() {
	          $('label').transition({x:'0px'},500,'ease').next()
	           .transition({x:'-100px'},500, 'ease').removeClass('move-pen');
	});

	//CHECK FOR WEB SPEECH API

	var final_transcript = '';
	var recognizing = false;
	var ignore_onend;
	var start_timestamp;
	if (!('webkitSpeechRecognition' in window)) {
		  $("#start_button").css("display", "none");
		} else {
		  start_button.style.display = 'inline-block';
		  var recognition = new webkitSpeechRecognition();
		  recognition.continuous = true;
		  recognition.interimResults = true;
		  recognition.onstart = function() {
		    recognizing = true;
		    $('#start_img').attr("src", IMAGES_DIR + 'mic-animate.gif');
		  };
		  recognition.onerror = function(event) {
		    if (event.error == 'no-speech') {
		      start_img.src = IMAGES_DIR + 'mic.gif';
		      ignore_onend = true;
		    }
		    if (event.error == 'audio-capture') {
		      start_img.src = IMAGES_DIR + 'mic.gif';
		      ignore_onend = true;
		    }
		    if (event.error == 'not-allowed') {
		      if (event.timeStamp - start_timestamp < 100) {
		      } else {
		      }
		      ignore_onend = true;
		    }
		  };
		  recognition.onend = function() {
		    recognizing = false;
		    if (ignore_onend) {
		      return;
		    }
		    $('#start_img').attr("src", IMAGES_DIR + 'mic.gif');
		    if (!final_transcript) {
		      return;
		    }
		    if (window.getSelection) {
		      window.getSelection().removeAllRanges();
		      var range = document.createRange();
		      range.selectNode(document.getElementById('answer_field'));
		      window.getSelection().addRange(range);
		    }
		  };
		  recognition.onresult = function(event) {
		    var interim_transcript = '';
		    for (var i = event.resultIndex; i < event.results.length; ++i) {
		      if (event.results[i].isFinal) {
		        final_transcript += event.results[i][0].transcript;
		      } else {
		        interim_transcript += event.results[i][0].transcript;
		      }
		    }
		    final_transcript = capitalize(final_transcript);
		    console.log(final_transcript);
		    $('#answer_field').val( final_transcript);
		    if (final_transcript || interim_transcript) {
		    }
		  };
		}

		$('#start_button').click(function(event){
		  if (recognizing) {
		    recognition.stop();
		    return;
		  }
		  final_transcript = '';
		  recognition.lang = 'en-US';
		  recognition.start();
		  ignore_onend = false;
		  $('#answer_field').val( '');
		  $('#start_img').attr("src", IMAGES_DIR + 'mic-slash.gif');
		  start_timestamp = event.timeStamp;
	});
	var first_char = /\S/;
	function capitalize(s) {
  			return s.replace(first_char, function(m) { return m.toUpperCase(); });
	}
});