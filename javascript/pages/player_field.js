$(document).ready(function() {
	if (
		window.matchMedia &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	) {
		$.fx.off = true;
	}
	// To add to window
	if(typeof Promise !== "undefined" && Promise.toString().indexOf("[native code]") !== -1){
	    console.log("PROMISES WORK!");
	}
	else{
		console.log("PROMISES DON'T WORK :(");
	}

	var roundTimer = 480;
	var playerName = null;
	var memberName = null;
	var gameMode = 'standard';
	var roomConfiguration = null;
	var roomConfigurationLoaded = false;
	var teamSelectionState = { teams: [], canCreate: false, registrationClosed: false };
	var suggestedTeamName = '';
	var creatingNewTeam = false;
	var playerScore = 0;
	var activePlayerName;
	var curQuestionId = '';
	var disputeWindowOpen = false;

	function parkPlayerDisputeButton() {
		var $btn = $('#dispute_btn');
		if ($btn.length && $btn.parent().is('#message_overlay')) {
			$('body').append($btn);
		}
		$btn.attr('hidden', true).prop('disabled', false);
	}

	function hidePlayerDisputeButton() {
		disputeWindowOpen = false;
		parkPlayerDisputeButton();
	}

	function showPlayerDisputePrompt() {
		disputeWindowOpen = true;
		var $btn = $('#dispute_btn').removeAttr('hidden').prop('disabled', false);
		/* Build the prompt inside the overlay so the button is part of the same
		   layer — fixed z-index inside .player_field cannot beat the overlay. */
		$('#message_overlay')
			.stop(true, true)
			.empty()
			.css({
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: '28px'
			})
			.append(
				$('<h2 class="player-dispute-prompt__title"></h2>').text(
					'Press Dispute to challenge this ruling.'
				)
			)
			.append($btn)
			.hide()
			.fadeIn('slow');
	}

	function showPlayerDisputeReview(playerName, answer) {
		var text =
			(playerName || 'Contestant') +
			' answer ' +
			(answer || '') +
			' is in dispute, waiting for review team to process...';
		$('#player_dispute_review_text').text(text);
		$('#player_dispute_review')
			.removeClass('player-dispute-review--hidden')
			.attr('aria-hidden', 'false');
		postScreenMessage(text, false, 0);
	}

	function hidePlayerDisputeReview() {
		$('#player_dispute_review')
			.addClass('player-dispute-review--hidden')
			.attr('aria-hidden', 'true');
	}

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
	socket.on('room configuration', function (config) {
		roomConfiguration = config || {};
		gameMode = roomConfiguration.mode || 'standard';
		teamSelectionState = roomConfiguration.teamSelection || teamSelectionState;
		suggestedTeamName = String(roomConfiguration.suggestedTeamName || '').trim().toUpperCase();
		roomConfigurationLoaded = true;
		$('#player_mode_label').text(roomConfiguration.label || 'JEOPARDY');
		$('#team_name_field').prop('hidden', gameMode !== 'team');
		renderTeamSelection();
		updateJoinButtonState();
	});
	socket.on('team selection update', function (state) {
		teamSelectionState = state || { teams: [], canCreate: false, registrationClosed: true };
		renderTeamSelection();
		updateJoinButtonState();
	});
	socket.on('player login accepted', function (payload) {
		var acceptedTeam = String(payload && payload.contestantName || '').trim().toUpperCase();
		var acceptedMember = String(payload && payload.memberName || memberName || '').trim().toUpperCase();
		if (acceptedTeam) {
			playerName = acceptedTeam;
		}
		if (acceptedMember) {
			memberName = acceptedMember;
		}
		if (gameMode === 'team') {
			persistTeamName(playerName);
			creatingNewTeam = false;
			$('#login_team_name').val(playerName);
		}
		updatePlayerIdentityDisplay();
	});
	socket.on('player login rejected', function (payload) {
		playerName = null;
		memberName = null;
		updateJoinButtonState();
		SimpleModal.alert({
			title: 'Could not join',
			text: (payload && payload.message) || 'Check your name and try again.',
			type: 'error',
		});
	});
	socket.on('contestant removed', function (contestantName) {
		if (contestantName !== playerName) {
			return;
		}
		window.alert('The host removed you from this room.');
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
	var playerConnectionOnline = false;
	const SOUNDS_DIR = "../../game-media/sounds/";
	const IMAGES_DIR =  "../../game-media/images/";
	var TEAM_NAME_STORAGE_KEY = 'jeopardy.teamName';
	var CLIENT_ID_STORAGE_KEY = 'jeopardy.clientId';
	var waitForStartGameTimer = null;

	function setPlayerConnectionState(state, label) {
		var wrap = $('#player_connection_status');
		wrap
			.removeClass(
				'player-connection-status--connecting player-connection-status--online player-connection-status--offline'
			)
			.addClass('player-connection-status--' + state);
		$('#player_connection_status_text').text(label);
		playerConnectionOnline = state === 'online';
		if (!playerConnectionOnline) {
			$('.buzzer, #answer_btn, #bet_btn').prop('disabled', true);
		} else {
			$('#answer_btn, #bet_btn').prop('disabled', false);
			$('.buzzer').prop('disabled', !buzzerOpen);
		}
	}

	function setPlayerBuzzerState(state, label, buttonLabel) {
		var wrap = $('.player_buzzer');
		wrap
			.removeClass(
				'player_buzzer--waiting player_buzzer--ready player_buzzer--open player_buzzer--taken player_buzzer--answering player_buzzer--submitted'
			)
			.addClass('player_buzzer--' + state);
		$('#player_buzzer_status').text(label);
		$('.buzzer')
			.text(buttonLabel || label)
			.prop('disabled', state !== 'open' || !playerConnectionOnline)
			.attr('aria-label', label);
	}

	function vibratePlayer(pattern) {
		if (navigator.vibrate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			try {
				navigator.vibrate(pattern);
			} catch (e) { /* unsupported or blocked */ }
		}
	}

	function getClientId() {
		try {
			var current = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
			if (current) {
				return current;
			}
			var generated =
				'jp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
			localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
			return generated;
		} catch (e) {
			return 'socket-' + Math.random().toString(36).slice(2, 12);
		}
	}
	var playerClientId = getClientId();

	function readStoredTeamName() {
		try {
			return String(localStorage.getItem(TEAM_NAME_STORAGE_KEY) || '').trim().toUpperCase();
		} catch (e) {
			return '';
		}
	}

	function persistTeamName(name) {
		try {
			if (name) {
				localStorage.setItem(TEAM_NAME_STORAGE_KEY, name);
			}
		} catch (e) { /* private mode / quota */ }
	}

	function updateJoinButtonState() {
		var missingName = !String($('#login_name').val() || '').trim();
		var missingTeam =
			gameMode === 'team' && !String($('#login_team_name').val() || '').trim();
		$('#join_btn').prop('disabled', missingName || missingTeam);
	}

	function selectTeamOption(teamName, createNew) {
		var normalized = String(teamName || '').trim().toUpperCase();
		creatingNewTeam = !!createNew;
		$('#login_team_name').val(normalized);
		$('#login_team_create').val(creatingNewTeam ? 'true' : 'false');
		$('.team-selection-card')
			.removeClass('team-selection-card--selected')
			.attr('aria-pressed', 'false');
		if (creatingNewTeam) {
			$('#create_team_option')
				.addClass('team-selection-card--selected')
				.attr('aria-pressed', 'true');
			$('#team_selection_status').text('New team selected: ' + normalized);
		} else {
			$('.team-selection-card[data-team-name="' + encodeURIComponent(normalized) + '"]')
				.addClass('team-selection-card--selected')
				.attr('aria-pressed', 'true');
			$('#team_selection_status').text('Joining ' + normalized);
		}
		updateJoinButtonState();
	}

	function renderTeamSelection() {
		if (gameMode !== 'team') {
			return;
		}
		var options = $('#team_selection_options').empty();
		var selectedName = String($('#login_team_name').val() || '').trim().toUpperCase();
		var savedTeam = readStoredTeamName();
		var teams = Array.isArray(teamSelectionState.teams) ? teamSelectionState.teams : [];
		teams.forEach(function (team) {
			var name = String(team.name || '').trim().toUpperCase();
			var reconnectingToSavedTeam = name === savedTeam;
			var enabled = !!team.available || reconnectingToSavedTeam;
			var memberLabel =
				team.memberCount +
				' of ' +
				team.maxMembers +
				(team.memberCount === 1 ? ' player' : ' players');
			var button = $('<button>', {
				type: 'button',
				class: 'team-selection-card',
				'data-team-name': encodeURIComponent(name),
				'aria-pressed': 'false',
				disabled: !enabled,
			});
			button.append($('<strong>', { text: name }));
			button.append(
				$('<span>', {
					text: enabled ? memberLabel + ' · Join this team' : memberLabel + ' · Team full',
				})
			);
			options.append(button);
		});
		if (!teams.length) {
			options.append(
				$('<p>', {
					class: 'team-selection-empty',
					text: 'No teams yet — create the first one.',
				})
			);
		}
		$('#suggested_team_name').text(suggestedTeamName || 'New team');
		$('#create_team_option').prop(
			'disabled',
			!teamSelectionState.canCreate || teamSelectionState.registrationClosed
		);
		if (
			!creatingNewTeam &&
			selectedName &&
			teams.some(function (team) {
				var name = String(team.name || '').trim().toUpperCase();
				return name === selectedName && (!!team.available || name === savedTeam);
			})
		) {
			selectTeamOption(selectedName, false);
		} else if (creatingNewTeam && suggestedTeamName) {
			selectTeamOption(suggestedTeamName, true);
		} else {
			$('#login_team_name').val('');
			$('#team_selection_status').text(
				teamSelectionState.registrationClosed
					? 'Team selection is closed.'
					: 'Select a team to continue.'
			);
		}
	}

	function loginPayload(person, team, createNew) {
		return {
			memberName: person,
			teamName: gameMode === 'team' ? team : '',
			createTeam: gameMode === 'team' && !!createNew,
			clientId: playerClientId,
		};
	}

	function updatePlayerIdentityDisplay() {
		var el = $('#player_name');
		if (!el.length) {
			return;
		}
		el.empty();
		if (gameMode === 'team') {
			el.append(
				$('<span>', { class: 'player-identity__team', text: playerName })
			);
			el.append(
				$('<small>', {
					class: 'player-identity__member',
					text: 'You: ' + memberName,
				})
			);
		} else {
			el.text(playerName);
		}
	}

	function beginPlayerJoin(loginNameStripped, teamNameStripped) {
		memberName = loginNameStripped;
		playerName = gameMode === 'team' ? teamNameStripped : loginNameStripped;
		if (gameMode === 'team') {
			persistTeamName(playerName);
		}
		if (!$('#player_name').length) {
			$('.player_field_info').append("<h2 id='player_name'></h2>");
			$('.player_field_info').append("<h2 id='player_score'>0</h2>");
		}
		updatePlayerIdentityDisplay();
		$('#player_score').html('0');
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
	setPlayerBuzzerState('waiting', 'WAITING FOR CLUE', 'WAIT');

	function beginCountdown(buzzerTime)
	{
		console.log(buzzerTime);
		$('#player_answer_countdown').text(
			Math.max(0, parseInt(buzzerTime, 10) || 0) + 's'
		);
		
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
			if (state['final-jeopardy-answer-submitted']) {
				pressedAnswer = true;
				switchBuzzer(true);
				postScreenMessage('Your answer is locked in — watch the screen.', false, 0);
				return;
			}
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
			var allWagersIn = !!state['final-jeopardy-all-wagers-in'];
			if (hasBet) {
				$('.player_bet_field').css('display', 'none');
				postScreenMessage(
					allWagersIn
						? 'All wagers are in — watch the screen.'
						: 'You wagered ' + fjBetRecorded + '. Waiting for other players.',
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
		memberName = state['member-name'] || memberName || playerName;
		gameMode = state.mode || gameMode;
		if (gameMode === 'team') {
			persistTeamName(playerName);
		}
		var sc = state['player-score'];
		playerScore = typeof sc === 'number' ? sc : parseInt(sc, 10) || 0;
		activePlayerName = state['active-player-name'];
		finalJeopardyCheck = !!state['final-jeopardy-check'];
		var rt = state['round-timer'];
		if (typeof rt === 'number') {
			roundTimer = rt;
		}
		var at = state['answer-time'];
		var parsedAnswerTime = parseInt(at, 10);
		if (!isNaN(parsedAnswerTime) && parsedAnswerTime > 0) {
			answerTime = parsedAnswerTime;
		}
		$('#login_container').css('display', 'none');
		$('.player_field').css('display', 'block');
		scheduleQuestionRevealedTextFit();
		if (!$('#player_name').length) {
			$('.player_field_info').append("<h2 id='player_name'></h2>");
			$('.player_field_info').append("<h2 id='player_score'>" + playerScore + "</h2>");
		}
		updatePlayerIdentityDisplay();
		$('#player_score').html(playerScore);
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
			var buzzedMember = state['buzzed-in-member-name'];
			var buzzedClientId = state['buzzed-in-client-id'];

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
				if (buzzedClientId === playerClientId) {
					buzzerLock = true;
					setPlayerBuzzerState('answering', 'YOU BUZZED IN — ANSWER NOW', 'ANSWER NOW');
					switchBuzzer(false);
					var bic = state['buzzed-in-timer-count'];
					beginCountdown(typeof bic === 'number' ? bic : answerTime);
				} else {
					switchBuzzer(true);
					if (buzzedName === playerName) {
						buzzerLock = true;
					}
					setPlayerBuzzerState(
						'taken',
						(buzzedMember || buzzedName) +
							(gameMode === 'team' ? ' BUZZED FOR ' + buzzedName : ' BUZZED IN'),
						'TAKEN'
					);
					postScreenMessage(
						(buzzedMember || buzzedName) +
							(gameMode === 'team' ? ' buzzed in for ' + buzzedName : '') +
							' and is typing an answer.',
						false,
						0
					);
				}
			} else if (state['player-buzzer-unlocked'] && !state['buzzer-flipped']) {
				buzzerOpen = true;
				setPlayerBuzzerState('open', 'BUZZ NOW', 'BUZZ IN');
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
		if (buzzerTimeData.buzzedInClientId == playerClientId)
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
			$('#player_answer_countdown').text(answerTime + 's');
			focusAnswerFieldWithMobileKeyboard();
		}
	}

	$('.player_answer_field').css(
		'display', 'none'
	);

	$('#join_btn').prop('disabled', true);

	$('#team_selection_options').on('click', '.team-selection-card', function () {
		if ($(this).prop('disabled')) {
			return;
		}
		selectTeamOption(decodeURIComponent(String($(this).attr('data-team-name') || '')), false);
	});

	$('#create_team_option').on('click', function () {
		if ($(this).prop('disabled')) {
			return;
		}
		selectTeamOption(suggestedTeamName, true);
	});

	$('#login_name').on('input keyup', function (event) {
		updateJoinButtonState();
		if (event.which === 13) {
			$(this).blur();
		}
	});


	 //PLAYER LOGIN
	   
	  $('#player_login').submit(function(){
	  		var loginNameStripped = $('#login_name').val();
	  		loginNameStripped = loginNameStripped.trim();
	  		loginNameStripped = loginNameStripped.toUpperCase();
	  		var teamNameStripped = $('#login_team_name').val();
	  		teamNameStripped = String(teamNameStripped || '').trim().toUpperCase();
	  		if (loginNameStripped == '' || (gameMode === 'team' && teamNameStripped === ''))
	  		{
	  			SimpleModal.alert({
				  title: "Oops!",
				  text: gameMode === 'team' ? "Please enter your name and choose a team." : "Please enter a name.",
				  timer: 2000
				});
	  		}
	  		else
	  		{
	  			$('#join_btn').prop('disabled', true);
	  			beginPlayerJoin(loginNameStripped, teamNameStripped);
	  			socket.emit(
	  				'login name',
	  				loginPayload(loginNameStripped, teamNameStripped, creatingNewTeam)
	  			);
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

	  function setVoteFormLocked(locked) {
	  	var $panel = $('.game_options');
	  	var $btn = $('#options_accept');
	  	$panel.toggleClass('game_options--locked', !!locked);
	  	$panel.find('select, button').prop('disabled', !!locked);
	  	if (locked) {
	  		$btn.text('Submitted');
	  	} else {
	  		$btn.text('OK');
	  	}
	  }

	  function updateVoteCountdown(remaining) {
	  	var el = document.getElementById('vote_countdown');
	  	if (!el) {
	  		return;
	  	}
	  	var secs = Math.max(0, parseInt(remaining, 10) || 0);
	  	el.textContent = secs + 's left';
	  	el.classList.toggle('game_options__countdown--urgent', secs > 0 && secs <= 10);
	  }

	  function showGameOptionsPanel() {
	  	clearTimeout(waitForStartGameTimer);
	  	waitForStartGameTimer = null;
	  	// Early joiners may already have the player field / buzzer visible
	  	// (Open mode waits for the host). Hide them so they cannot bleed through.
	  	staticMessageOff();
	  	$('#message_overlay').empty();
	  	$('.player_field').css('display', 'none');
	  	$('#login_container').css('display', 'block');
	  	options_accept_clicked = false;
	  	setVoteFormLocked(false);
	  	setVoteFeedback('', false);
	  	updateVoteCountdown(30);
	  	$('.login').hide();
	  	$('.game_options').fadeIn('slow');
	  }

	  socket.on('option select new', function () {
	  	showGameOptionsPanel();
	  });

	  socket.on('game options vote timer', function (data) {
	  	if (!data) {
	  		return;
	  	}
	  	updateVoteCountdown(data.remaining);
	  	if (!$('.game_options').is(':visible') && !options_accept_clicked) {
	  		showGameOptionsPanel();
	  	}
	  });

	  socket.on('game options vote progress', function (p) {
	  	if (!p || typeof p.received !== 'number' || p.received >= p.needed) {
	  		return;
	  	}
	  	if (options_accept_clicked) {
	  		setVoteFormLocked(true);
	  		setVoteFeedback(
	  			'Votes ' + p.received + ' / ' + p.needed + ' — waiting for others.',
	  			true
	  		);
	  	} else {
	  		setVoteFeedback(
	  			'Votes ' + p.received + ' / ' + p.needed + ' — cast your vote.',
	  			true
	  		);
	  	}
	  });

	  socket.on('contestant option vote recorded', function (contestantName) {
	  	if (contestantName !== playerName) {
	  		return;
	  	}
	  	options_accept_clicked = true;
	  	setVoteFormLocked(true);
	  	if (gameMode === 'team') {
	  		setVoteFeedback('Team vote submitted — waiting for the other teams.', true);
	  	}
	  });

	  socket.on('game setup loading', function (payload) {
	  	setVoteFormLocked(true);
	  	var msg =
	  		(payload && payload.message) ||
	  		(payload && payload.reason === 'timeout'
	  			? 'Vote time is up. Loading game…'
	  			: 'Loading game…');
	  	setVoteFeedback(msg, true);
	  });

	  socket.on('game setup failed', function (payload) {
	  	var msg =
	  		(payload && payload.message) ||
	  		'Could not load a game. Change your votes and try again.';
	  	options_accept_clicked = false;
	  	setVoteFormLocked(false);
	  	setVoteFeedback(msg, true);
	  	$('.game_options').show();
	  });

	var options_accept_clicked = false;

	function finishOptionsPhaseAndShowField() {
		setVoteFeedback('', false);
		$('.game_options').css('display', 'none');
		showWaitForStartScreen();
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
			setVoteFormLocked(true);
			setVoteFeedback('Vote submitted — waiting for others.', true);
			socket.emit('option select new', [
				time_option,
				decade_option,
				episode_filter_option,
			]);
		}	

	});

	  socket.on('wait for start game',function(name){
	  		if(playerName == name){
		  		/* Keep the buzzer field hidden until setup is done so Open-mode
		  		   voting cannot reveal it underneath the options panel. */
		  		$('.player_field').css('display', 'none');
		  		showWaitForStartScreen();
		  		clearTimeout(waitForStartGameTimer);
		  		waitForStartGameTimer = setTimeout(function(){
		  			waitForStartGameTimer = null;
		  			if ($('.game_options').is(':visible')) {
		  				return;
		  			}
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
	   		setPlayerBuzzerState(
	   			'waiting',
	   			data.playerName === playerName
	   				? 'YOU HAVE BOARD CONTROL'
	   				: 'WAITING FOR ' + data.playerName,
	   			'WAIT'
	   		);

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
	   	setPlayerBuzzerState(
	   		'waiting',
	   		playerNameActive === playerName ? 'PICK A CLUE' : 'CLUE SELECTION',
	   		'WAIT'
	   	);
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
	   		$("#answer_field").blur();
	   		switchBuzzer(true);
	   		if (!finalJeopardyAnswered){
	   			socket.emit('player no answer final jeopardy', playerName);
	   			postScreenMessage('Time is up — watch the screen for the results.', false, 0);
	   		} else {
	   			postScreenMessage('Watch the screen for the results.', false, 0);
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

	  $('.player_field').on('keydown', '#tempGAME td[role="button"]', function (e) {
	  	if (e.key !== 'Enter' && e.key !== ' ') {
	  		return;
	  	}
	  	e.preventDefault();
	  	$(this).trigger('click');
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
	  	setPlayerBuzzerState('ready', 'GET READY — CLUE IS BEING READ', 'GET READY');
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
	  	setPlayerBuzzerState('ready', 'GET READY — BUZZERS OPEN SOON', 'GET READY');
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
	  			setPlayerBuzzerState('submitted', 'TIME EXPIRED — ANSWER CLOSED', 'TIME UP');
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
	  	  setPlayerBuzzerState('waiting', 'TIME EXPIRED', 'WAIT');
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
						setPlayerBuzzerState('open', 'BUZZ NOW', 'BUZZ IN');
						//$(".buzzer").prop("disabled",false);
		  				$(".buzzer").css("background-color", "rgb(76, 175, 80)");
					}, 500);
				}
				else
				{
					console.log("buzzer open");
					buzzerOpen = true;
					setPlayerBuzzerState('open', 'BUZZ NOW', 'BUZZ IN');
		  			//$(".buzzer").prop("disabled",false);
		  			$(".buzzer").css("background-color", "rgb(76, 175, 80)");
	  			}
	  		}
	  });
	  
	  //buzzers are off
	 socket.on('close buzzer',function(){
		buzzerOpen = false;
		if (!$('.player_answer_field').is(':visible')) {
			setPlayerBuzzerState('waiting', 'BUZZERS LOCKED', 'LOCKED');
		}
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
				vibratePlayer([35, 30, 35]);
				socket.emit('buzzer pressed', playerName);
			}
		}
	});

	//capture buzzer press from all connected players //used to be buzzer pressed
	 socket.on('buzzer pressed', function(pressed){
	 	if (pressed.clientId !== playerClientId)
	 	{
	 		if (pressed.playerName === playerName) {
	 			buzzerLock = true;
	 		}
	 		var responder = pressed.memberName || pressed.playerName;
	 		setPlayerBuzzerState(
	 			'taken',
	 			responder +
	 				(gameMode === 'team' ? ' BUZZED FOR ' + pressed.playerName : ' BUZZED IN'),
	 			'TAKEN'
	 		);
	 		postScreenMessage(
	 			responder +
	 				(gameMode === 'team' ? ' buzzed in for ' + pressed.playerName : '') +
	 				" and is typing an answer.",
	 			false,
	 			0
	 		);
	 	}
	 	else
	 	{
	 		setPlayerBuzzerState('answering', 'YOU BUZZED IN — ANSWER NOW', 'ANSWER NOW');
	 		vibratePlayer(80);
	 		//start timer
	  		beginCountdown(answerTime);
	 		switchBuzzer(false);
			buzzerLock=true; //we know if this instance of the player buzzed in, disable the buzzer for the remainder of this question
			$(".buzzer").css("background-color", "rgb(105,105,105)"); //background-color: rgb(76, 175, 80);
	 	}
	 });

	 //capture Daily Double Response from bet begin countdown
	 socket.on('daily double response', function(response){
	 	if (response.clientId === playerClientId)
	 	{
	 		$("#answer_btn").prop("disabled", true);
	 		$("#answer_btn").css("background-color", "rgb(105,105,105)");
	 		$("#question_revealed").html(response.question);
	 		scheduleQuestionRevealedTextFit();
	 		$(".player_bet_field").css("display", "none");
	 		curQuestionId = response.questionId;
	 		switchBuzzer(false);
	 	}
	 	else if (response.playerName === playerName)
	 	{
	 		$(".player_bet_field").css("display", "none");
	 		postScreenMessage(
	 			(response.memberName || 'Your teammate') + ' is answering the Daily Double for ' + playerName + '.',
	 			false,
	 			0
	 		);
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
			$('#player_answer_countdown').text(
				Math.max(0, parseInt(dailyDoubleTimerCount, 10) || 0) + 's'
			);
			
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
				setPlayerBuzzerState('submitted', 'ANSWER LOCKED IN', 'SUBMITTED');
				$('#player_answer_countdown').text('LOCKED');
				switchBuzzer(true);
		  		endCountdown();
		  		console.log(playerName);
		  		socket.emit('answer selection', {answer: answer, questionId: curQuestionId, playerName: playerName, finalJeopardyCheck: finalJeopardyCheck});
		        $('#answer_field').val('');
		        console.log(finalJeopardyCheck);
		        if(finalJeopardyCheck)
		        {
		        	postScreenMessage("Answer locked in — watch the screen.", false, 0);
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
	 	hidePlayerDisputeButton();
	 	hidePlayerDisputeReview();

	 	if (playerName == score.playerName)
	 	{
	 		/* Final Jeopardy: keep the result secret until the host reveal announces it. */
	 		if (score.finalJeopardy) {
	 			return;
	 		}
	 		$('#player_score').html(score.score);
	 		playerScore= score.score;
	 	}
	 	if (!finalJeopardyCheck)
	 	{
	 		if (score.disputeAvailable && !score.correct) {
	 			setPlayerBuzzerState(
	 				'taken',
	 				playerName == score.playerName
	 					? 'INCORRECT — DISPUTE NOW IF YOU WANT REVIEW'
	 					: 'INCORRECT — DISPUTE WINDOW OPEN',
	 				'WAIT'
	 			);
	 			if (playerName == score.playerName) {
	 				showPlayerDisputePrompt();
	 			} else if (!buzzerLock) {
	 				staticMessageOff();
	 			}
	 			return;
	 		}
		 	setPlayerBuzzerState(
		 		score.correct || score.allPlayersAnswered || score.dailyDouble
		 			? 'waiting'
		 			: 'taken',
		 		score.correct
		 			? 'CORRECT — WATCH THE HOST SCREEN'
		 			: score.allPlayersAnswered || score.dailyDouble
		 				? 'CLUE COMPLETE'
		 				: 'INCORRECT — OTHER PLAYERS MAY BUZZ',
		 		'WAIT'
		 	);
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

	 socket.on('dispute window open', function (data) {
	 	if (!data || data.playerName !== playerName) {
	 		return;
	 	}
	 	showPlayerDisputePrompt();
	 	setPlayerBuzzerState(
	 		'taken',
	 		'INCORRECT — DISPUTE NOW IF YOU WANT REVIEW',
	 		'WAIT'
	 	);
	 });

	 socket.on('dispute window closed', function () {
	 	hidePlayerDisputeButton();
	 });

	 socket.on('answer dispute started', function (data) {
	 	hidePlayerDisputeButton();
	 	showPlayerDisputeReview(data && data.playerName, data && data.answer);
	 	setPlayerBuzzerState('waiting', 'ANSWER IN DISPUTE — PLEASE WAIT', 'WAIT');
	 });

	 socket.on('dispute resolved', function (data) {
	 	hidePlayerDisputeButton();
	 	hidePlayerDisputeReview();
	 	if (!data) {
	 		return;
	 	}
	 	if (playerName == data.playerName) {
	 		$('#player_score').html(data.score);
	 		playerScore = data.score;
	 	}
	 	setPlayerBuzzerState(
	 		data.correct || data.allPlayersAnswered || data.dailyDouble
	 			? 'waiting'
	 			: 'taken',
	 		data.correct
	 			? 'DISPUTE WON — WATCH THE HOST SCREEN'
	 			: data.allPlayersAnswered || data.dailyDouble
	 				? 'CLUE COMPLETE'
	 				: 'DISPUTE DENIED — OTHER PLAYERS MAY BUZZ',
	 		'WAIT'
	 	);
	 	if (data.allPlayersAnswered || data.correct || data.dailyDouble) {
	 		eliminateQuestion(data.questionId);
	 	} else if (playerName == data.playerName) {
	 		postScreenMessage("Dispute denied. You'll get it next time!", false, 0);
	 	} else if (!buzzerLock) {
	 		staticMessageOff();
	 	}
	 });

	 $('#dispute_btn').on('click', function () {
	 	if (!disputeWindowOpen) {
	 		return;
	 	}
	 	$(this).prop('disabled', true);
	 	socket.emit('answer dispute');
	 });

	 socket.on('final jeopardy reveal player', function(data){
	 	if (!data || data.playerName !== playerName) {
	 		return;
	 	}
	 	playerScore = parseInt(data.score, 10);
	 	if (isNaN(playerScore)) {
	 		playerScore = 0;
	 	}
	 	$('#player_score').html(playerScore);
	 	var msg = data.correct
	 		? 'Correct! Your score is now $' + playerScore + '.'
	 		: 'Incorrect. Your score is now $' + playerScore + '.';
	 	postScreenMessage(msg, false, 0);
	 });

	 socket.on('final jeopardy all wagers ready', function(){
	 	$('.player_bet_field').css('display', 'none');
	 	postScreenMessage('All wagers are in — watch the screen.', false, 0);
	 });

	 socket.on('final jeopardy contestant wager locked', function(data){
	 	if (!data || data.playerName !== playerName || data.clientId === playerClientId) {
	 		return;
	 	}
	 	$('.player_bet_field').css('display', 'none');
	 	postScreenMessage('Your team wagered $' + data.bet + '. Waiting for the other teams.', false, 0);
	 });

	 socket.on('final jeopardy contestant answer locked', function(data){
	 	if (!data || data.playerName !== playerName || data.clientId === playerClientId) {
	 		return;
	 	}
	 	pressedAnswer = true;
	 	switchBuzzer(true);
	 	postScreenMessage('Your team answer is locked in — watch the screen.', false, 0);
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

	socket.on('final jeopardy wager timed out', function(){
		$(".player_bet_field").css("display", "none");
		postScreenMessage("Wager time is up — please look at the screen.", false, 0);
	});

	socket.on('open response final jeopardy', function(question){
		$("#question_revealed").html(question);
		scheduleQuestionRevealedTextFit();
  		$(".player_bet_field").css("display", "none");
		switchBuzzer(false);
		staticMessageOff();
	});

	socket.on('game over', function(gameOverData){
		var winnerNames = [];
		var winningScore = 0;
		var isTie = false;
		var standings = [];
		var i;

		if (typeof gameOverData === 'string') {
			winnerNames = gameOverData ? [gameOverData] : [];
		} else if (gameOverData && typeof gameOverData === 'object') {
			if (Array.isArray(gameOverData.winningPlayerNames)) {
				winnerNames = gameOverData.winningPlayerNames.slice();
			} else if (gameOverData.winningPlayerName) {
				winnerNames = [gameOverData.winningPlayerName];
			}
			winningScore = parseInt(gameOverData.winningPlayerScore, 10) || 0;
			isTie = !!gameOverData.isTie || winnerNames.length > 1;
			if (Array.isArray(gameOverData.standings)) {
				standings = gameOverData.standings;
			}
		}

		for (i = 0; i < standings.length; i++) {
			if (standings[i].name === playerName) {
				playerScore = parseInt(standings[i].score, 10) || 0;
				$('#player_score').html(playerScore);
				break;
			}
		}

		var isWinner = winnerNames.indexOf(playerName) !== -1;
		var endMsg;
		if (isWinner && isTie) {
			endMsg = "You're co-champions! Tied at $" + winningScore + ".";
		} else if (isWinner) {
			endMsg = "You're today's champion, congratulations!";
		} else if (winnerNames.length) {
			endMsg =
				(isTie ? 'Tied winners: ' : 'Winner: ') +
				winnerNames.join(' & ') +
				' with $' +
				winningScore +
				'. Nice game!';
		} else {
			endMsg = 'Game over — nice playing!';
		}
		postScreenMessage(endMsg, false, 0);

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
			var $headers = $('#tempGAME tr:first-child th');
			$('#tempGAME tr:not(:first-child) td').each(function () {
				var $cell = $(this);
				var value = String($cell.text() || '').trim();
				if (!value) {
					$cell.attr({ tabindex: '-1', 'aria-disabled': 'true' }).removeAttr('role');
					return;
				}
				var category = String($headers.eq($cell.index()).text() || '').trim();
				$cell.attr({
					role: 'button',
					tabindex: '0',
					'aria-disabled': 'false',
					'aria-label': (category ? category + ' for ' : 'Clue for ') + value,
				});
			});
			$('#tempGAME').fadeIn('fast');	
		}	
		else
		{
			$('#tempGAME td').attr('tabindex', '-1');
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
	 	var validationObject = validateBet(value, finalJeopardyCheck);
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
	 		postScreenMessage("You wagered $" + value + ". Waiting for other players.", false, 0);
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

	 function getMaxWager(score, isFinalJeopardy)
	 {
	 	score = parseInt(score, 10);
	 	if (isNaN(score)) {
	 		score = 0;
	 	}
		if (isFinalJeopardy) {
			return Math.max(0, score);
		}
		var boardMaximum = String(curQuestionId || '').indexOf('DJ_') === 0 ? 2000 : 1000;
		return Math.max(boardMaximum, score);
	 }

	 function validateBet(bet, isFinalJeopardy)
	 {
	 	if (isNaN(bet))
	 	{
	 		return {message: "Please enter a number.", isValid: false};
	 	}
	 	bet = parseInt(bet, 10);
	 	if (bet < 0)
	 	{
	 		return {message: "You can't make a negative bet.", isValid: false};
	 	}
	 	var minBet = isFinalJeopardy ? 0 : 5;
	 	if (bet < minBet)
	 	{
	 		return {message: "The minimum bet is " + minBet + ".", isValid: false};
	 	}
		var maxBet = getMaxWager(playerScore, isFinalJeopardy);
	 	if (bet > maxBet)
	 	{
			return {
				message: "You can only wager up to $" + maxBet + ".",
				isValid: false
			};
	 	}
	 	return {message: "Valid", isValid: true};
	 }

	 socket.on('wager rejected', function (payload) {
		$('.player_bet_field').css('display', 'block');
		SimpleModal.alert({
			title: 'Invalid wager',
			text: (payload && payload.message) || 'That wager is not allowed.',
			type: 'error',
		});
	 });

	function escapeHtml(value) {
		return String(value == null ? '' : value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function showWaitForStartScreen() {
		var modeLabel =
			(roomConfiguration && roomConfiguration.label) ||
			(gameMode === 'team'
				? 'TEAM JEOPARDY'
				: gameMode === 'open'
					? 'OPEN JEOPARDY'
					: 'STANDARD JEOPARDY');
		var roomCode =
			(roomConfiguration && roomConfiguration.code) || playerRoomCode || '—';
		var yourName = memberName || playerName || '—';
		var rows =
			'<div><dt>Game mode</dt><dd>' +
			escapeHtml(modeLabel) +
			'</dd></div>' +
			'<div><dt>Room code</dt><dd>' +
			escapeHtml(roomCode) +
			'</dd></div>' +
			'<div><dt>Your name</dt><dd>' +
			escapeHtml(yourName) +
			'</dd></div>';
		if (gameMode === 'team') {
			rows +=
				'<div><dt>Team</dt><dd>' +
				escapeHtml(playerName || '—') +
				'</dd></div>';
		}
		$('#message_overlay').fadeIn('slow');
		$('#message_overlay').html(
			'<div class="player-wait-panel">' +
				'<h2 class="player-wait-panel__title">Please wait for the game to begin.</h2>' +
				'<dl class="player-wait-panel__meta">' +
				rows +
				'</dl>' +
				'</div>'
		);
	}

	//TODO: this function will post a message overlay on top of the board that will fade out.  handy for any alerts
	function postScreenMessage(message, needsFadeOut, time, callback)
	{
		/* .html() would destroy #dispute_btn if it is currently inside the overlay. */
		parkPlayerDisputeButton();
		disputeWindowOpen = false;
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
		setPlayerConnectionState('online', 'Connected');
		if (playerName && memberName) {
			socket.emit('login name', loginPayload(memberName, playerName));
		}
	});
	if (socket.io && typeof socket.io.on === 'function') {
		socket.io.on('reconnect', function () {
			setPlayerConnectionState('online', 'Connected');
			if (playerName && memberName) {
				socket.emit('login name', loginPayload(memberName, playerName));
			}
		});
		socket.io.on('reconnect_attempt', function () {
			setPlayerConnectionState('connecting', 'Reconnecting…');
		});
	}

	socket.on('connect', function () {
		setPlayerConnectionState('online', 'Connected');
	});
	socket.on('disconnect', function () {
		buzzerOpen = false;
		setPlayerConnectionState('offline', 'Reconnecting…');
		setPlayerBuzzerState('waiting', 'CONNECTION LOST — PLEASE WAIT', 'OFFLINE');
	});
	socket.on('reconnecting', function () {
		setPlayerConnectionState('connecting', 'Reconnecting…');
	});

	if (socket.connected) {
		setPlayerConnectionState('online', 'Connected');
	}
});