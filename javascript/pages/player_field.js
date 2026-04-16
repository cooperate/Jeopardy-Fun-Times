$(document).ready(function() {
	// To add to window
	if(typeof Promise !== "undefined" && Promise.toString().indexOf("[native code]") !== -1){
	    console.log("PROMISES WORK!");
	}
	else{
		console.log("PROMISES DON'T WORK :(");
	}

	var roundTimer = 600;
	var playerName = null;
	var playerScore = 0;
	var activePlayerName;
	var curQuestionId = '';

	function normalizePlayerRoomCode(s) {
		return String(s || '')
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '');
	}

	var playerRoomCode = normalizePlayerRoomCode(
		new URLSearchParams(window.location.search).get('room')
	);
	if (!playerRoomCode) {
		window.location.replace('/home');
		return;
	}

	var socket = io('/player', { query: { room: playerRoomCode } });

	socket.on('player room error', function (payload) {
		var msg = payload && payload.message ? payload.message : 'Room not found.';
		window.alert(msg);
		window.location.replace('/home');
	});
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
	var PLAYER_NAME_STORAGE_KEY = 'jeopardy.playerName';
	var autoLoginFromStorageDone = false;
	var waitForStartGameTimer = null;

	function readStoredPlayerName() {
		try {
			var raw = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
			if (!raw || !raw.trim()) {
				return '';
			}
			return raw.trim().toUpperCase();
		} catch (e) {
			return '';
		}
	}

	function persistPlayerName(name) {
		try {
			if (name) {
				localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
			}
		} catch (e) { /* private mode / quota */ }
	}

	function beginPlayerJoin(loginNameStripped) {
		playerName = loginNameStripped;
		persistPlayerName(playerName);
		if (!$('#player_name').length) {
			$('.player_field_info').append("<h2 id='player_name'>" + playerName + "</h2>");
			$('.player_field_info').append("<h2 id='player_score'>0</h2>");
		} else {
			$('#player_name').text(playerName);
			$('#player_score').html('0');
		}
	}

	function attemptAutoLoginFromStorage() {
		if (autoLoginFromStorageDone || playerName) {
			return;
		}
		var saved = readStoredPlayerName();
		if (!saved) {
			return;
		}
		autoLoginFromStorageDone = true;
		$('#login_name').val(saved);
		$('#join_btn').prop('disabled', true);
		beginPlayerJoin(saved);
		socket.emit('login name', saved);
	}

	var speechRecognition = null;

	function stopSpeechRecognition() {
		if (speechRecognition) {
			try {
				speechRecognition.stop();
			} catch (e) { /* ignore */ }
		}
	}
	
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

	function ensurePlayerBoardMarkup(markup) {
		if (!markup || !String(markup).trim()) {
			return;
		}
		if (!$('#tempGAME').length) {
			$('.player_field').append("<div id='tempGAME'>" + markup + "</div>");
			if (typeof scheduleJeopardyCategoryHeaderFit === 'function') {
				scheduleJeopardyCategoryHeaderFit(document.getElementById('tempGAME'));
			}
		}
	}

	function scheduleQuestionRevealedTextFit() {
		if (typeof schedulePlayerQuestionRevealedFit === 'function') {
			schedulePlayerQuestionRevealedFit();
		}
	}

	/** Server tells us FJ phase so refresh/reconnect is not stuck on "look at the game board". */
	function applyFinalJeopardyReconnectState(state) {
		displayCategories(false);
		$('#tempGAME').stop(true, true).hide();
		var fjWager = !!state['final-jeopardy-wagering'];
		var fjAnswer = !!state['final-jeopardy-answer'];
		var fjCat = state['final-jeopardy-category'];
		var fjQ = state['final-jeopardy-question'];
		var fjBetRecorded = state['final-jeopardy-player-bet'];

		if (fjAnswer && fjQ) {
			curQuestionId = 'FJ_0_0';
			$('#question_revealed').html(fjQ).css('display', 'block');
			scheduleQuestionRevealedTextFit();
			$('.player_buzzer').css('display', 'none');
			$('.player_bet_field').css('display', 'none');
			switchBuzzer(false);
			staticMessageOff();
			return;
		}

		if (fjWager && fjCat) {
			curQuestionId = 'FJ_0_0';
			$('#question_revealed').html(fjCat).css('display', 'block');
			scheduleQuestionRevealedTextFit();
			$('.player_buzzer').css('display', 'none');
			var hasBet =
				fjBetRecorded !== undefined &&
				fjBetRecorded !== null &&
				fjBetRecorded !== '';
			if (hasBet) {
				$('.player_bet_field').css('display', 'none');
				postScreenMessage(
					'You wagered ' + fjBetRecorded + '. Waiting for other players.',
					false,
					0
				);
			} else {
				$('.player_bet_field').css('display', 'block');
				$('#bet_field').focus();
				staticMessageOff();
			}
			return;
		}

		postScreenMessage(
			'Final Jeopardy is in progress. Watch the main screen for the category; this phone will ask for your wager when the host announces it. If everyone is stuck, ask the host to use <b>New game</b> on the main board.',
			false,
			0
		);
	}

	function applyPlayedQuestionsFromReload(playedIds) {
		if (!playedIds || !playedIds.length) {
			return;
		}
		var i;
		for (i = 0; i < playedIds.length; i++) {
			eliminateQuestion(playedIds[i]);
		}
	}

	socket.on('update-state-reload', function(state){
		console.log('update-state-reload', state);
		var n = state['player-name'];
		if (!n) {
			return;
		}
		playerName = n;
		persistPlayerName(playerName);
		var sc = state['player-score'];
		playerScore = typeof sc === 'number' ? sc : parseInt(sc, 10) || 0;
		activePlayerName = state['active-player-name'];
		finalJeopardyCheck = !!state['final-jeopardy-check'];
		var rt = state['round-timer'];
		if (typeof rt === 'number') {
			roundTimer = rt;
		}
		var at = state['answer-time'];
		if (typeof at === 'number') {
			answerTime = at;
		}
		$('#login_container').css('display', 'none');
		$('.player_field').css('display', 'block');
		scheduleQuestionRevealedTextFit();
		if (!$('#player_name').length) {
			$('.player_field_info').append("<h2 id='player_name'>" + playerName + "</h2>");
			$('.player_field_info').append("<h2 id='player_score'>" + playerScore + "</h2>");
		} else {
			$('#player_name').text(playerName);
			$('#player_score').html(playerScore);
		}
		staticMessageOff();

		if (!state.active) {
			displayCategories(false);
			return;
		}

		if (finalJeopardyCheck) {
			applyFinalJeopardyReconnectState(state);
			return;
		}

		ensurePlayerBoardMarkup(state['game-markup']);
		applyPlayedQuestionsFromReload(state['played-question-ids']);

		var categoryOpen = !!state['category-select-open'];
		var clueOn = !!state['clue-in-progress'];
		var buzzedName = state['buzzed-in-player-name'];

		if (clueOn) {
			displayCategories(false);
			var qText = state['question-text'];
			var qId = state['cur-question-id'];
			var isDd = !!state['daily-double'];
			curQuestionId = qId || '';
			clicked = false;
			listenForClicks = true;
			pressedAnswer = false;
			blockClicks = false;
			buzzerLock = false;
			if (isDd) {
				postScreenMessage('Please look at the game board for the Daily Double.', false, 0);
				$('#tempGAME').stop(true, true).hide();
				return;
			}
			$('#question_revealed').html(qText || '').css('display', 'block');
			scheduleQuestionRevealedTextFit();
			$('#timer_table').find('td').css('background-color', 'rgb(239, 83, 80)');
			questionTimerServer = typeof state['question-timer-count'] === 'number' ? state['question-timer-count'] : 0;
			buzzerOpen = false;
			$('.buzzer').css('background-color', 'rgb(105,105,105)');
			if (buzzedName) {
				if (buzzedName === playerName) {
					buzzerLock = true;
					switchBuzzer(false);
					var bic = state['buzzed-in-timer-count'];
					beginCountdown(typeof bic === 'number' ? bic : answerTime);
				} else {
					postScreenMessage(buzzedName + ' buzzed in and is typing their answer.', false, 0);
				}
			} else if (state['player-buzzer-unlocked'] && !state['buzzer-flipped']) {
				buzzerOpen = true;
				$('.buzzer').css('background-color', 'rgb(76, 175, 80)');
			}
			$('#tempGAME').stop(true, true).hide();
			return;
		}

		if (categoryOpen) {
			$('#question_revealed').html('Your Question Will Appear Here');
			scheduleQuestionRevealedTextFit();
			buzzerOpen = false;
			$('.buzzer').css('background-color', 'rgb(105,105,105)');
			if (playerName === activePlayerName) {
				clicked = false;
				displayCategories(true);
			} else {
				$('#tempGAME').stop(true, true).hide();
				postScreenMessage('Please wait for ' + activePlayerName + ' to pick a category.', false, 0);
			}
			return;
		}

		/* Between clues: waiting for host to open category select */
		$('#tempGAME').stop(true, true).hide();
		$('#question_revealed').html('Your Question Will Appear Here');
		scheduleQuestionRevealedTextFit();
		buzzerOpen = false;
		$('.buzzer').css('background-color', 'rgb(105,105,105)');
		if (roundTimer > 0) {
			if (playerName === activePlayerName) {
				postScreenMessage("YOU'RE UP! PICK A QUESTION.", false, 0);
			} else {
				postScreenMessage('Please wait for ' + activePlayerName + ' to pick a category.', false, 0);
			}
		} else {
			displayCategories(false);
		}
	});

	socket.on('update buzzer interval', function(buzzerTimeData){
		if (buzzerTimeData.buzzedInPlayerName == playerName)
		{
			beginCountdown(buzzerTimeData.buzzedInTimerCount);
		}
	});

	socket.on('next round start confirmed', function(activePlayerReceive){
		activePlayerName = activePlayerReceive;
	});

	function endCountdown()
	{
		$("#timer_table").find("td").css("background-color", "rgb(239, 83, 80)");
	}

	function focusAnswerFieldWithMobileKeyboard() {
		var el = document.getElementById('answer_field');
		if (!el) {
			return;
		}
		var coarsePointer =
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(pointer: coarse)').matches;
		var ua = navigator.userAgent || '';
		var isIOS =
			/iPad|iPhone|iPod/i.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		if (coarsePointer || isIOS) {
			try {
				el.readOnly = true;
			} catch (e1) {}
			el.focus({ preventScroll: true });
			setTimeout(function () {
				try {
					el.readOnly = false;
				} catch (e2) {}
				el.focus({ preventScroll: true });
			}, 10);
		} else {
			el.focus({ preventScroll: true });
		}
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
			focusAnswerFieldWithMobileKeyboard();
		}
	}

	$('.player_answer_field').css(
		'display', 'none'
	);

	$('#join_btn').prop('disabled', true);

	if (readStoredPlayerName()) {
		$('#jeopardy_saved_name_hint').prop('hidden', false);
	}
	$('#jeopardy_clear_saved_player').on('click', function () {
		try {
			localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
		} catch (e) { /* ignore */ }
		autoLoginFromStorageDone = true;
		$('#login_name').val('');
		$('#join_btn').prop('disabled', true);
		$('#jeopardy_saved_name_hint').prop('hidden', true);
	});

	$('#login_name').on('keyup', function (event) {
		$('#join_btn').prop('disabled', this.value === '' ? true : false);
		if (event.which === 13) {
			$(this).blur();
		}
	});


	 //PLAYER LOGIN
	   
	  $('#player_login').submit(function(){
	  		var loginNameStripped = $('#login_name').val();
	  		loginNameStripped = loginNameStripped.trim();
	  		loginNameStripped = loginNameStripped.toUpperCase();
	  		if (loginNameStripped == '')
	  		{
	  			SimpleModal.alert({
				  title: "Oops!",
				  text: "Please enter a name.",
				  timer: 2000
				});
	  		}
	  		else
	  		{
	  			$('#join_btn').prop('disabled', true);
	  			autoLoginFromStorageDone = true;
	  			beginPlayerJoin(loginNameStripped);
	  			socket.emit('login name', loginNameStripped);
        	}
        	return false;
      });

	  //hide ios keyboard
	  /*$( "#login_name" ).bind('touchstart', function(e) {
    	e.preventDefault();
    	document.activeElement.blur();
	});*/

	  function setVoteFeedback(text, show) {
	  	var el = document.getElementById('vote_feedback');
	  	if (!el) {
	  		return;
	  	}
	  	if (show === false || text === '') {
	  		el.textContent = '';
	  		el.hidden = true;
	  		return;
	  	}
	  	el.textContent = text;
	  	el.hidden = false;
	  }

	  function showGameOptionsPanel() {
	  	clearTimeout(waitForStartGameTimer);
	  	waitForStartGameTimer = null;
	  	setVoteFeedback('', false);
	  	if ($('#login_container').is(':visible')) {
	  		$('.login').fadeOut('fast', function () {
	  			$('.game_options').fadeIn('slow');
	  		});
	  	} else {
	  		$('.game_options').fadeIn('slow');
	  	}
	  }

	  socket.on('option select new', function () {
	  	showGameOptionsPanel();
	  });

	  socket.on('game options vote progress', function (p) {
	  	if (!p || typeof p.received !== 'number' || p.received >= p.needed) {
	  		return;
	  	}
	  	setVoteFeedback(
	  		'Votes ' + p.received + ' / ' + p.needed + ' — yours is in.',
	  		true
	  	);
	  });

	  socket.on('game setup loading', function () {
	  	setVoteFeedback('Loading game…', true);
	  });

	  socket.on('game setup failed', function (payload) {
	  	var msg =
	  		(payload && payload.message) ||
	  		'Could not load a game. Change your votes and try again.';
	  	options_accept_clicked = false;
	  	$('.game_options').find('select, button').prop('disabled', false);
	  	setVoteFeedback(msg, true);
	  	$('.game_options').show();
	  });

	var options_accept_clicked = false;

	function finishOptionsPhaseAndShowField() {
		setVoteFeedback('', false);
		$('.game_options').css('display', 'none');
		postScreenMessage('Please wait for the game to begin.', false, 0);
		setTimeout(function () {
			$('#login_container').css('display', 'none');
			$('.player_field').css('display', 'block');
			scheduleQuestionRevealedTextFit();
		}, 3000);
	}

	$("#options_accept").click(function(){
		if (!options_accept_clicked){
			options_accept_clicked = true;
			var time_option = String($('#vote_select_time').val() || '20');
			var decade_option = String($('#vote_select_decade').val() || '20s');
			var episode_filter_option = String($('#vote_select_episode').val() || 'any');

			console.log(
				"TIME OPTION: " +
					time_option +
					" DECADE OPTION: " +
					decade_option +
					" EPISODE FILTER: " +
					episode_filter_option
			);
			setVoteFeedback('Vote saved.', true);
			$('.game_options').find('select, button').prop('disabled', true);
			socket.emit('option select new', [
				time_option,
				decade_option,
				episode_filter_option,
			]);
		}	

	});

	  socket.on('wait for start game',function(name){
	  		if(playerName == name){
		  		postScreenMessage("Please wait for the game to begin.", false, 0);
		  		clearTimeout(waitForStartGameTimer);
		  		waitForStartGameTimer = setTimeout(function(){
		  			waitForStartGameTimer = null;
		  			$("#login_container").css('display', 'none');
		  			$(".player_field").css('display', 'block');
		  			scheduleQuestionRevealedTextFit();
		  		}, 3000);
	  		}
	  });

	  socket.on('answer time data', function(answerTimeData){
	  	answerTime = answerTimeData;
	  	finishOptionsPhaseAndShowField();
	  });

	  

	  //capture player active 
	   socket.on('active player',function(data){

	   		blockClicks = false;
	   		listenForClicks = false;

	   		if (data.newGame == "new game")
	   		{
	   			$('.player_field').append("<div id='tempGAME'>" + data.gameMarkup + "</div>");
	   			if (typeof scheduleJeopardyCategoryHeaderFit === 'function') {
	   				scheduleJeopardyCategoryHeaderFit(document.getElementById('tempGAME'));
	   			}
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
		   				scheduleQuestionRevealedTextFit();
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
	   		if (typeof scheduleJeopardyCategoryHeaderFit === 'function') {
	   			scheduleJeopardyCategoryHeaderFit(document.getElementById('tempGAME'));
	   		}
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
	   		scheduleQuestionRevealedTextFit();
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
	  	displayCategories(false);
	  	eliminateQuestion(question.questionId);
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
	  	$("#question_revealed").slideDown(1500, function () {
	  		scheduleQuestionRevealedTextFit();
	  	});
	  });

	  //capture timer expiration from other player, times up does not call score update
	  socket.on('buzzed in times up', function(timesUp){
	  		$("#answer_field").blur();
	  		
	  		stopSpeechRecognition();
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
	 		scheduleQuestionRevealedTextFit();
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
	 	event.preventDefault();
	 	if (!pressedAnswer)
	 	{
		 	stopSpeechRecognition();
			var answer = $('#answer_field').val();
			answer = answer.trim();
			
			if (answer == '')
			{
					SimpleModal.alert({
					  title: "Oops!",
					  text: "Enter an answer.",
					  timer: 3000
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

	  $('#answer_field').on('keydown', function (e) {
			if (e.which !== 13 && e.keyCode !== 13) {
				return;
			}
			if (e.shiftKey) {
				return;
			}
			if ($('.player_answer_field').css('display') === 'none') {
				return;
			}
			e.preventDefault();
			$('#answer_submit').trigger('submit');
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
	 	scheduleQuestionRevealedTextFit();
	 });

	socket.on('final jeopardy bid', function(categoryName){
		console.log("time to bid");
	 	endCountdown();
	 	displayCategories(false);
	 	$("#question_revealed").html(categoryName);
	 	scheduleQuestionRevealedTextFit();
		$(".player_buzzer").css("display", "none");
		$(".player_bet_field").css("display", "block");
		$("#bet_field" ).focus();
		staticMessageOff();
	});

	socket.on('open response final jeopardy', function(question){
		$("#question_revealed").html(question);
		scheduleQuestionRevealedTextFit();
  		$(".player_bet_field").css("display", "none");
		switchBuzzer(false);
		staticMessageOff();
	});

	socket.on('game over', function(winningPlayerName){
		if (winningPlayerName == playerName)
		{
			postScreenMessage("You're todays champion, congratulations!", false, 0);
			setTimeout(function(){
				SimpleModal.confirm({
				  title: 'Play Again?',
				  text: "Play again with the current contestants.",
				  confirmText: 'Play Again!',
				  cancelText: 'Cancel'
				}).then(function (confirmed) {
				   if (confirmed) {
					   socket.emit('new game');
				   }
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
	 			SimpleModal.alert({
				  title: "Oops!",
				  text: "Please enter a wager.",
				  timer: 4000
				});
				return false;
	 	}
	 	else if (value != parseInt(value, 10))
	 	{
	 			 SimpleModal.alert({
				  title: "Oops!",
				  text: "The value must be a number.",
				  timer: 4000
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
	 		SimpleModal.alert({
				  title: "Trying to pull a fast one?",
				  text: validationObject.message,
				  timer: 2000
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
        var $label = $('#login_container .wrap-label label');
        var $pen = $label.next('.login-name-pen-icon');
        $label.transition({x:'80px'},500,'ease');
        $pen.transition({x:'5px'},500, 'ease');
			//setTimeout needed for Chrome, for some reson there is no animation from left to right, the pen is immediately present. Slight delay to adding the animation class fixes it
	         setTimeout(function(){
			    $pen.addClass('move-pen');
		      },100);
			
			});
			  
			  $('#login_name').focusout(function() {
	          var $label = $('#login_container .wrap-label label');
	          var $pen = $label.next('.login-name-pen-icon');
	          $label.transition({x:'0px'},500,'ease');
	          $pen.transition({x:'-100px'},500, 'ease').removeClass('move-pen');
	});

	// Web Speech API (Chrome/Edge/Safari): dictation runs entirely on the player's device.
	var final_transcript = '';
	var recognizing = false;
	var ignore_onend;
	var start_timestamp;
	var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

	function capitalize(s) {
		var first_char = /\S/;
		return s.replace(first_char, function (m) {
			return m.toUpperCase();
		});
	}

	if (!SpeechRecognition) {
		$('#start_button').hide();
		$('#mic_unsupported').prop('hidden', false);
	} else {
		speechRecognition = new SpeechRecognition();
		speechRecognition.continuous = true;
		speechRecognition.interimResults = true;
		speechRecognition.onstart = function () {
			recognizing = true;
			$('#start_img').attr('src', IMAGES_DIR + 'mic-animate.gif');
		};
		speechRecognition.onerror = function (event) {
			if (
				event.error === 'no-speech' ||
				event.error === 'audio-capture' ||
				event.error === 'not-allowed'
			) {
				$('#start_img').attr('src', IMAGES_DIR + 'mic.gif');
				ignore_onend = true;
			}
		};
		speechRecognition.onend = function () {
			recognizing = false;
			if (ignore_onend) {
				return;
			}
			$('#start_img').attr('src', IMAGES_DIR + 'mic.gif');
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
		speechRecognition.onresult = function (event) {
			var interim_transcript = '';
			for (var i = event.resultIndex; i < event.results.length; ++i) {
				if (event.results[i].isFinal) {
					final_transcript += event.results[i][0].transcript;
				} else {
					interim_transcript += event.results[i][0].transcript;
				}
			}
			final_transcript = capitalize(final_transcript);
			$('#answer_field').val(final_transcript + interim_transcript);
		};

		$('#start_button').on('click', function (event) {
			if (!speechRecognition) {
				return;
			}
			if (recognizing) {
				speechRecognition.stop();
				return;
			}
			final_transcript = '';
			speechRecognition.lang = 'en-US';
			try {
				speechRecognition.start();
			} catch (e) {
				console.warn('Speech recognition start failed', e);
				return;
			}
			ignore_onend = false;
			$('#answer_field').val('');
			$('#start_img').attr('src', IMAGES_DIR + 'mic-slash.gif');
			start_timestamp = event.timeStamp;
		});
	}

	socket.on('reconnect', function () {
		if (playerName) {
			socket.emit('login name', playerName);
		}
	});

	if (socket.connected) {
		attemptAutoLoginFromStorage();
	} else {
		socket.on('connect', attemptAutoLoginFromStorage);
	}
});