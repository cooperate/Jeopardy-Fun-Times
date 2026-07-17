$(document).ready(function() {
	if (
		window.matchMedia &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	) {
		$.fx.off = true;
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

	var questionList = new Array();
	var playerCount = 0;
	var contentBoard = '';
	var activePlayerName = '';
	var curQuestionId = '';
	var nameIds = new Array();  //number reference for player
	var playerNames = new Array();
	var questionIsLive = false;
	var finalJeopardyCheck = false;	
	var playersFJ = {};
	var dailyDoubleBet = 0;
	var categories = new Array();
	var animated = false;
	var lockPlayers = false;
	var roundTimer = 480;
	var hostRoundIsDoubleJeopardy = false;
	var finalJeopardyThemeEnded = false;
	var finalJeopardyAnswerPeriodStarted = false;
	var finalJeopardyAnswerPeriodTimer = null;
	var finalCeremoniesStarted = false;
	var finalJeopardyAnswersOpened = false;
	var FINAL_JEOPARDY_THEME_MS = 32500;
	var answerTime = 15;
	var gameMode = 'standard';
	var hostModeConfig = {};
	var latestHostPlayers = [];
	var hostRosterLocked = false;
	const SOUNDS_DIR = "../../game-media/sounds/";
	const IMAGES_DIR = "../../game-media/images/";

	var hostSoundMutedStored = sessionStorage.getItem('jeopardyHostSoundMuted');
	var hostSoundMuted =
		hostSoundMutedStored === null ? true : hostSoundMutedStored === '1';
	/* Each full page load needs one click on the sound control before the browser allows audio */
	var hostPageAudioPrimed = false;
	var skipGameDataAfterHostRestore = false;
	var hostRestoreSuppress = false;

	//Speech Synthesis — serialized queue so visuals cannot race ahead of narration
	var synth = window.speechSynthesis;
	var cachedHostNarrationVoice = null;
	var hostSpeechQueue = [];
	var hostSpeechBusy = false;
	var hostSpeechCurrentJob = null;
	var hostSpeechFailsafeTimer = null;
	var hostSpeechJobSeq = 0;

	function hostSpeechSynthesisSupported() {
		return !!(
			typeof window !== 'undefined' &&
			window.speechSynthesis &&
			typeof window.SpeechSynthesisUtterance === 'function'
		);
	}

	/** True only when we will actually speak (API present, sound on, audio primed). */
	function hostCanSpeak() {
		return (
			hostSpeechSynthesisSupported() &&
			!!synth &&
			!hostSoundMuted &&
			hostPageAudioPrimed
		);
	}

	function clearHostSpeechFailsafe() {
		if (hostSpeechFailsafeTimer) {
			clearTimeout(hostSpeechFailsafeTimer);
			hostSpeechFailsafeTimer = null;
		}
	}

	function flushHostSpeech() {
		var i;
		for (i = 0; i < hostSpeechQueue.length; i++) {
			hostSpeechQueue[i].cancelled = true;
		}
		hostSpeechQueue = [];
		if (hostSpeechCurrentJob) {
			hostSpeechCurrentJob.cancelled = true;
		}
		clearHostSpeechFailsafe();
		try {
			if (synth && typeof synth.cancel === 'function') {
				synth.cancel();
			}
			/* Chrome can leave speechSynthesis paused after cancel */
			if (synth && synth.paused && typeof synth.resume === 'function') {
				synth.resume();
			}
		} catch (e) {
			/* ignore */
		}
		hostSpeechBusy = false;
		hostSpeechCurrentJob = null;
	}

	function estimateHostSpeechFailsafeMs(message) {
		var len = String(message || '').length;
		return Math.min(25000, Math.max(2800, len * 70 + 1200));
	}

	function pumpHostSpeechQueue() {
		if (hostSpeechBusy) {
			return;
		}
		var job = null;
		while (hostSpeechQueue.length) {
			job = hostSpeechQueue.shift();
			if (job && !job.cancelled) {
				break;
			}
			job = null;
		}
		if (!job) {
			hostSpeechCurrentJob = null;
			return;
		}

		hostSpeechBusy = true;
		hostSpeechCurrentJob = job;

		function finishJob() {
			if (!job || job.finished) {
				return;
			}
			job.finished = true;
			clearHostSpeechFailsafe();
			hostSpeechBusy = false;
			if (hostSpeechCurrentJob === job) {
				hostSpeechCurrentJob = null;
			}
			if (!job.cancelled && typeof job.callback === 'function') {
				try {
					job.callback();
				} catch (err) {
					console.error('host speech callback error', err);
				}
			}
			pumpHostSpeechQueue();
		}

		/* No usable TTS — do not simulate speech timing; advance immediately */
		if (!hostCanSpeak()) {
			setTimeout(finishJob, 0);
			return;
		}

		var utterThis = new SpeechSynthesisUtterance(job.message);
		var narrationVoice = getHostNarrationVoice();
		if (narrationVoice) {
			utterThis.voice = narrationVoice;
			utterThis.lang = narrationVoice.lang || 'en-US';
		} else {
			utterThis.lang = 'en-US';
		}
		utterThis.pitch = 1;
		utterThis.rate = 0.9;
		utterThis.onend = function () {
			finishJob();
		};
		utterThis.onerror = function () {
			finishJob();
		};
		hostSpeechFailsafeTimer = setTimeout(
			finishJob,
			estimateHostSpeechFailsafeMs(job.message)
		);
		try {
			if (synth.paused && typeof synth.resume === 'function') {
				synth.resume();
			}
			synth.speak(utterThis);
		} catch (err) {
			console.warn('speechSynthesis.speak failed', err);
			finishJob();
		}
	}

	/**
	 * Speak through a FIFO queue when TTS is available. If speech synthesis is
	 * unavailable / muted / not primed, callbacks run on the next tick with no queue wait.
	 * options.interrupt — cancel current/queued speech before enqueuing.
	 */
	function messageToVoice(message, needsCallback, callback, options) {
		options = options || {};
		if (options.interrupt) {
			flushHostSpeech();
		}

		if (!hostCanSpeak()) {
			flushHostSpeech();
			if (needsCallback && typeof callback === 'function') {
				setTimeout(callback, 0);
			}
			return;
		}

		hostSpeechQueue.push({
			id: ++hostSpeechJobSeq,
			message: String(message == null ? '' : message),
			callback:
				needsCallback && typeof callback === 'function' ? callback : null,
			cancelled: false,
			finished: false,
		});
		pumpHostSpeechQueue();
	}

	function langLower(voice) {
		return (voice.lang || '').replace(/_/g, '-').toLowerCase();
	}

	function isSpanishVoice(voice) {
		var l = langLower(voice);
		if (l === 'es' || l.indexOf('es-') === 0) {
			return true;
		}
		var n = (voice.name || '').toLowerCase();
		return /spanish|español|espanol|castellano/.test(n);
	}

	function isEnglishVoice(voice) {
		return langLower(voice).indexOf('en') === 0;
	}

	function isUsEnglishVoice(voice) {
		var l = langLower(voice);
		return l === 'en-us' || l.indexOf('en-us-') === 0;
	}

	/** Prefer en-US and typical US female / neutral-female TTS names (Chrome, Edge, macOS) */
	function femaleFriendlyScore(voice) {
		var n = (voice.name || '').toLowerCase();
		if (/zira|samantha|susan|karen|victoria|female|google us english|microsoft aria|moira|fiona|tessa|serena|allison|ava\b/.test(n)) {
			return 2;
		}
		if (/male|david|daniel|fred\b|mark\b|google uk english male/.test(n)) {
			return -2;
		}
		return 0;
	}

	function pickHostNarrationVoice(voices) {
		if (!voices || !voices.length) {
			return null;
		}
		var candidates = voices.filter(function (v) {
			return isEnglishVoice(v) && !isSpanishVoice(v);
		});
		if (!candidates.length) {
			candidates = voices.filter(function (v) {
				return !isSpanishVoice(v);
			});
		}
		if (!candidates.length) {
			candidates = voices.slice();
		}
		var usPool = candidates.filter(isUsEnglishVoice);
		var pool = usPool.length ? usPool : candidates;
		pool.sort(function (a, b) {
			return femaleFriendlyScore(b) - femaleFriendlyScore(a);
		});
		return pool[0];
	}

	function getHostNarrationVoice() {
		var voices = synth.getVoices();
		if (!voices || !voices.length) {
			return null;
		}
		if (cachedHostNarrationVoice) {
			var c = cachedHostNarrationVoice;
			for (var i = 0; i < voices.length; i++) {
				if (voices[i].voiceURI === c.voiceURI && voices[i].name === c.name) {
					cachedHostNarrationVoice = voices[i];
					return voices[i];
				}
			}
			cachedHostNarrationVoice = null;
		}
		cachedHostNarrationVoice = pickHostNarrationVoice(voices);
		return cachedHostNarrationVoice;
	}

	if (synth && typeof synth.addEventListener === 'function') {
		synth.addEventListener('voiceschanged', function () {
			cachedHostNarrationVoice = null;
		});
	}

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

	function normalizeHostRoomCode(s) {
		return String(s || '')
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '');
	}

	var hostPathMatch = window.location.pathname.match(/^\/game\/([^/]+)\/?$/);
	var hostRoomCode = hostPathMatch ? normalizeHostRoomCode(hostPathMatch[1]) : '';
	if (!hostRoomCode) {
		window.location.replace('/game');
		return;
	}
	var hostToken = sessionStorage.getItem('jeopardy.hostToken.' + hostRoomCode) || '';

	//set css for various game elements
	$('#question_field').css('display', 'none');
	$('#message_overlay').css('display', 'none');
	$('#category_container').css('display', 'none');
	$('#player_container').css('display', 'none');
	$('#game_intro').css('display', 'block');
	$('#master_container').css('display', 'none');
	$('.player_name_bubble').hide();


	var socket = io('/game', {
		query: { room: hostRoomCode, hostToken: hostToken },
	});

	socket.on('host room error', function (payload) {
		var msg = payload && payload.message ? payload.message : 'This room is not available.';
		if (typeof SimpleModal !== 'undefined' && SimpleModal.alert) {
			SimpleModal.alert({ title: 'Host', text: msg, type: 'error' }).then(function () {
				window.location.replace('/game');
			});
		} else {
			window.alert(msg);
			window.location.replace('/game');
		}
	});

	socket.on('host room code', function (payload) {
		var code = typeof payload === 'string' ? payload : payload && payload.code;
		if (code) {
			$('#host_room_code_value').text(code);
			var joinUrl =
				window.location.origin +
				'/player?room=' +
				encodeURIComponent(String(code));
			$('#host_join_url_text').text(
				window.location.host + '/player?room=' + String(code)
			);
			$('#host_join_qr')
				.attr(
					'src',
					'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=' +
						encodeURIComponent(joinUrl)
				)
				.prop('hidden', false);
			if ($(document.body).hasClass('host-board-active')) {
				updateHostRoundTimerDisplay();
			}
		}
	});

	function setHostGameState(state, label, detail) {
		var el = $('#host_game_state');
		if (!el.length) {
			return;
		}
		el.attr('data-state', state || 'waiting');
		el.text(label || 'WAITING');
		el.attr('title', detail || label || 'Waiting');
	}

	socket.on('host game load status', function (data) {
		var el = $('#host_game_load_status');
		if (!el.length) {
			return;
		}
		var phase = data && data.phase;
		var msg = data && data.message ? String(data.message) : '';
		if (phase === 'loading') {
			setHostGameState('loading', 'LOADING GAME', msg);
		} else if (phase === 'error') {
			setHostGameState('error', 'SETUP ERROR', msg);
		}
		el.removeClass('host-game-load-status--error');
		if (phase === 'done' || (!msg && phase !== 'error')) {
			el.addClass('host-game-load-status--hidden').text('');
			return;
		}
		if (phase === 'error') {
			el.removeClass('host-game-load-status--hidden')
				.addClass('host-game-load-status--error')
				.text(msg || 'Game load failed.');
			return;
		}
		if (msg) {
			el.removeClass('host-game-load-status--hidden host-game-load-status--error').text(msg);
		} else {
			el.addClass('host-game-load-status--hidden').text('');
		}
	});

	function showHostAiJudging(playerName) {
		var wrap = $('#host_ai_judging');
		if (!wrap.length) {
			return;
		}
		if (playerName) {
			$('#host_ai_judging_player').text(playerName);
		} else {
			$('#host_ai_judging_player').text('');
		}
		wrap.removeClass('host-ai-judging--hidden').attr('aria-hidden', 'false');
	}

	function hideHostAiJudging() {
		var wrap = $('#host_ai_judging');
		if (!wrap.length) {
			return;
		}
		wrap.addClass('host-ai-judging--hidden').attr('aria-hidden', 'true');
		$('#host_ai_judging_player').text('');
	}

	socket.on('answer ai judging', function (data) {
		showHostAiJudging(data && data.playerName);
		setHostGameState(
			'judging',
			'JUDGING ANSWER',
			(data && data.playerName ? data.playerName + ' · ' : '') + 'Checking response'
		);
	});

	socket.on('answer ai judging end', function () {
		hideHostAiJudging();
	});

	socket.on('game data', function (data) {
		if (skipGameDataAfterHostRestore) {
			return;
		}
	    questionList[data.questionID] = new Question(data.question._category, data.question._value, data.question._question, data.question._answer, data.question._dailyDouble, data.question._questionId, data.question._mediaLink, data.question._round);
	    questionList[data.questionID].mediaType = data.question._mediaType;
	    questionList[data.questionID]._mediaOriginalUrl =
	    	data.question._mediaOriginalUrl || '';
	    questionList[data.questionID]._mediaAttribution =
	    	data.question._mediaAttribution || null;
	    questionList[data.questionID]._mediaFallback =
	    	!!data.question._mediaFallback;
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
	var lastRosterJoinCount = 0;

	 socket.on('login name', function(name){
        /* Legacy event — roster update is the source of truth for modes. */
        if (typeof name === 'string' && name) {
        	buildPlayerBox(name);
        	playSound(playerJoinSound);
        	player_login_count++;
        	updateHostJoinedPlayersPanelFromLocalState();
        }
     });

	 socket.on('answer time data', function(answerTimeData){
	  	answerTime = answerTimeData;
	  	$('#host_game_load_status')
	  		.removeClass('host-game-load-status--error')
	  		.addClass('host-game-load-status--hidden')
	  		.text('');
	  });

	 function buildPlayerBox(name, members){

	 	var score = 0;
	 	var id = playerCount;
	 	nameIds[name] = id;
	 	playerNames.push(name);
	 	console.log(playerNames);
	 	var memberLine =
	 		gameMode === 'team' && members && members.length
	 			? "<div class='player-podium__members'>" +
	 			  $('<div>').text(members.join(' + ')).html() +
	 			  '</div>'
	 			: '';
	 	var safeName = $('<div>').text(name).html();
	 	var encodedName = encodeURIComponent(name).replace(/'/g, '%27');
	 	var content =
	 		"<div class='player-podium' id='player_podium_" + id + "'>" +
	 			"<div class='player_type' id='player_typing_" + id + "' aria-hidden='true'>" +
	 				"<h2>BUZZED IN</h2>" +
	 				"<div class='player_type__name'></div>" +
	 				"<div class='player_type__countdown'></div>" +
	 				"<div class='progress'></div>" +
	 			"</div>" +
	 			"<table class='player-podium__table'>" +
	 				"<tr id='active_indicator_" + id + "' class='player-podium__status'><td>&nbsp;</td></tr>" +
	 				"<tr class='score'>" +
	 					"<td id='name_" + id + "'>" + score + "</td>" +
	 				"</tr>" +
	 				"<tr id='player_name_" + id + "' class='name'>" +
	 					"<td><span class='player-podium__rank' aria-label='Current rank'></span>" +
	 						"<div class='player-podium__name-fit'><span class='player-podium__name-text' data-category-plain='" +
	 							encodedName + "'>" + safeName + "</span></div>" +
	 						memberLine + "</td>" +
	 				"</tr>" +
	 			"</table>" +
	 		"</div>";

	 	$('#players_table').append(content);
	 	playerCount++;

	 	
	 }

	function fitHostPodiumNames() {
		$('.player-podium__name-text').each(function () {
			var element = this;
			var container = element.closest('.player-podium__name-fit');
			if (!container || typeof window.fitJeopardyTextInContainer !== 'function') {
				return;
			}
			var plainName = '';
			try {
				plainName = decodeURIComponent(element.getAttribute('data-category-plain') || '');
			} catch (e) {
				plainName = element.textContent || '';
			}
			window.fitJeopardyTextInContainer(element, container, {
				text: plainName,
				minPx: 12,
				maxPx: 180,
				noWordBreak: true,
			});
		});
	}

	function scheduleHostPodiumNameFit() {
		window.requestAnimationFrame(function () {
			fitHostPodiumNames();
			window.setTimeout(fitHostPodiumNames, 100);
		});
	}
	var hostPodiumFitResizeTimer = null;
	$(window).on('resize', function () {
		window.clearTimeout(hostPodiumFitResizeTimer);
		hostPodiumFitResizeTimer = window.setTimeout(fitHostPodiumNames, 80);
	});
	if (typeof window.ResizeObserver === 'function') {
		new window.ResizeObserver(function () {
			window.clearTimeout(hostPodiumFitResizeTimer);
			hostPodiumFitResizeTimer = window.setTimeout(fitHostPodiumNames, 40);
		}).observe(document.getElementById('players_table'));
	}

	function updateHostPodiumRanks() {
		var standings = playerNames.map(function (name) {
			var id = nameIds[name];
			var score = parseInt($('#name_' + id).text(), 10);
			return { name: name, id: id, score: isNaN(score) ? 0 : score };
		});
		standings.sort(function (a, b) {
			return b.score - a.score;
		});
		$('.player-podium').removeClass('player-podium--leader');
		for (var si = 0; si < standings.length; si++) {
			var rank =
				si > 0 && standings[si].score === standings[si - 1].score
					? $('.player-podium__rank', '#player_podium_' + standings[si - 1].id).text()
					: String(si + 1);
			$('.player-podium__rank', '#player_podium_' + standings[si].id).text(rank);
		}
		if (
			standings.length &&
			(standings.length === 1 ||
				standings[0].score !== standings[standings.length - 1].score)
		) {
			var leadScore = standings[0].score;
			for (var li = 0; li < standings.length && standings[li].score === leadScore; li++) {
				$('#player_podium_' + standings[li].id).addClass('player-podium--leader');
			}
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
    		var catRaw = String(questionList[roundMarkerId + c + "_0"].category);
    		var catTitle = catRaw
    			.replace(/&/g, '&amp;')
    			.replace(/</g, '&lt;')
    			.replace(/>/g, '&gt;')
    			.replace(/"/g, '&quot;');
    		var catPlainAttr = encodeURIComponent(catRaw);
    		contentBoard +=
    			'<th><span class="category-header-text"><span class="category-header-text__inner" data-category-plain="' +
    			catPlainAttr +
    			'">' +
    			catTitle +
    			'</span></span></th>';
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
    	if (typeof scheduleJeopardyCategoryHeaderFit === 'function') {
    		scheduleJeopardyCategoryHeaderFit(document.getElementById('game_board_container'));
    	}
	}

	function rebuildHostPlayersTableFromSnapshot(snapshot) {
		if (!snapshot || !snapshot.players) {
			return;
		}
		$('#players_table').empty();
		playerCount = 0;
		nameIds = {};
		playerNames = [];
		latestHostPlayers = snapshot.players.slice();
		$(document.body).toggleClass('host-many-players', snapshot.players.length > 5);
		var pi;
		for (pi = 0; pi < snapshot.players.length; pi++) {
			buildPlayerBox(snapshot.players[pi].name, snapshot.players[pi].members);
			$('#name_' + nameIds[snapshot.players[pi].name]).html(snapshot.players[pi].score);
		}
		updateHostPodiumRanks();
		scheduleHostPodiumNameFit();
		player_login_count = snapshot.players.length;
	}

	function updateHostJoinedPlayersPanel(players) {
		var el = $('#host_player_roster_names');
		if (!el.length) {
			return;
		}
		if (!players || !players.length) {
			el.html('None yet — open <code>/player</code> on each phone.');
			$('#host_join_count').text('0 joined');
			return;
		}
		el.empty();
		var i;
		for (i = 0; i < players.length; i++) {
			var player = players[i];
			var $row = $('<span>', {
				class:
					'host-roster-player ' +
					(player.online ? 'host-roster-player--online' : 'host-roster-player--offline'),
			});
			$row.append($('<span>', { class: 'host-roster-player__status' }));
			var $name = $('<span>', {
				class: 'host-roster-player__name',
				text: player.name,
			});
			var memberText =
				gameMode === 'team' && player.memberDetails && player.memberDetails.length
					? player.memberDetails
							.map(function (member) {
								return member.name + (member.online ? '' : ' (offline)');
							})
							.join(' + ')
					: player.online
						? player.hasVoted
							? 'Online · vote ready'
							: 'Online'
						: 'Offline';
			$name.append(
				$('<small>', {
					class: 'host-roster-player__meta',
					text: memberText,
				})
			);
			$row.append($name);
			if (
				!hostRosterLocked &&
				!$(document.body).hasClass('host-board-active')
			) {
				$row.append(
					$('<button>', {
						type: 'button',
						class: 'host-roster-player__remove',
						text: 'Remove',
						'data-player-name': player.name,
						'aria-label': 'Remove ' + player.name + ' from this room',
					})
				);
			}
			el.append($row);
		}
		var onlineCount = players.filter(function (player) {
			return player.online;
		}).length;
		var minimum = parseInt(hostModeConfig.minContestants, 10) || 3;
		if (gameMode === 'team') {
			var memberCount = players.reduce(function (total, player) {
				return total + ((player.members && player.members.length) || 0);
			}, 0);
			var onlineMemberCount = players.reduce(function (total, player) {
				return total + (parseInt(player.onlineCount, 10) || 0);
			}, 0);
			var requiredMembers =
				minimum * (parseInt(hostModeConfig.maxMembersPerContestant, 10) || 2);
			var teamsReady =
				players.length >= minimum &&
				players.every(function (player) {
					return player.members && player.members.length >= 1;
				});
			$('#host_join_count').text(
				players.length +
					' of ' +
					minimum +
					' teams · ' +
					memberCount +
					' of ' +
					requiredMembers +
					' players · ' +
					onlineMemberCount +
					' online · ' +
					(memberCount >= requiredMembers
						? 'teams full'
						: teamsReady
							? 'ready to start · optional teammate spots open'
							: minimum - players.length + ' more teams needed')
			);
			return;
		}
		$('#host_join_count').text(
			players.length +
				' joined · ' +
				onlineCount +
				' online · ' +
				(players.length >= minimum ? 'minimum reached' : minimum - players.length + ' more needed')
		);
	}

	function updateHostJoinedPlayersPanelFromLocalState() {
		var list = [];
		var i;
		for (i = 0; i < playerNames.length; i++) {
			list.push({ name: playerNames[i] });
		}
		updateHostJoinedPlayersPanel(list);
	}

	function restoreIntroNameBubblesFromSnapshot(players) {
		var $wrap = $('.player_name_bubbles');
		$wrap.empty();
		if (!players || !players.length) {
			return;
		}
		var j;
		for (j = 0; j < players.length; j++) {
			var $bubble = $('<div>', {
				class: 'player_name_bubble',
				id: 'player_name_bubble_' + (j + 1),
			}).append($('<h2>').text(players[j].name));
			if (gameMode === 'team' && players[j].members && players[j].members.length) {
				$bubble.append(
					$('<p>', { class: 'player_name_bubble__members' }).text(
						players[j].members.join(' + ')
					)
				);
			}
			$wrap.append($bubble);
		}
	}

	/** When the game has not started (or questions are not loaded), full applyHostSnapshot is skipped — still sync roster from the server. */
	function syncHostLobbyRosterFromSnapshot(snapshot) {
		rebuildHostPlayersTableFromSnapshot(snapshot);
		updateHostJoinedPlayersPanel(snapshot.players || []);
		restoreIntroNameBubblesFromSnapshot(snapshot.players || []);
	}

	function applyHostRoomConfiguration(snapshot) {
		if (!snapshot) {
			return;
		}
		gameMode = snapshot.mode || gameMode;
		var config = snapshot.modeConfig || {};
		hostModeConfig = config;
		$('#host_mode_badge').text(config.label || gameMode.toUpperCase() + ' JEOPARDY');
		$(document.body)
			.removeClass('host-mode-standard host-mode-team host-mode-open')
			.addClass('host-mode-' + gameMode);
		var count = snapshot.players ? snapshot.players.length : latestHostPlayers.length;
		var canStartManual =
			(gameMode === 'open' || gameMode === 'team') &&
			!snapshot.gameActive &&
			!snapshot.setupVotingOpen &&
			count >= (config.minContestants || 3);
		$('#host_start_setup_btn').prop('hidden', !canStartManual);
	}

	function applyHostSnapshot(snapshot) {
		if (!snapshot || !snapshot.gameActive || snapshot.questionCount < 61) {
			return false;
		}
		skipGameDataAfterHostRestore = true;
		hostRestoreSuppress = true;
		questionList = [];
		var qid;
		for (qid in snapshot.questions) {
			if (!Object.prototype.hasOwnProperty.call(snapshot.questions, qid)) {
				continue;
			}
			var q = snapshot.questions[qid];
			questionList[qid] = new Question(
				q._category,
				q._value,
				q._question,
				q._answer,
				q._dailyDouble,
				q._questionId,
				q._mediaLink,
				q._round
			);
			questionList[qid].mediaType = q._mediaType;
			questionList[qid]._mediaOriginalUrl = q._mediaOriginalUrl || '';
			questionList[qid]._mediaAttribution = q._mediaAttribution || null;
			questionList[qid]._mediaFallback = !!q._mediaFallback;
		}
		rebuildHostPlayersTableFromSnapshot(snapshot);

		var roundName =
			snapshot.boardRound === 'Double Jeopardy' ? 'Double Jeopardy' : 'Jeopardy';
		buildBoard(questionList, roundName);
		animateBoard(roundName === 'Jeopardy');

		var pq;
		for (pq = 0; pq < snapshot.playedQuestionIds.length; pq++) {
			$('#' + snapshot.playedQuestionIds[pq]).html('');
		}

		$('#game_intro').css('display', 'none');
		/* Intro path hides this with slideUp; on refresh it stays on top of the board (black). */
		$('#airdate_screen').stop(true, true).hide();
		$('#master_container').css('display', 'block');
		$('#message_overlay').stop(true, true).hide();
		$('#category_container').css('display', 'none');
		$('#player_container').css('display', 'none');
		$('#question_field').stop(true, true).hide();

		roundTimer = snapshot.roundTimer;
		answerTime = snapshot.answerTime;
		finalJeopardyCheck = !!snapshot.finalJeopardyCheck;
		curQuestionId = snapshot.curQuestionId || '';
		questionIsLive = false;
		lockPlayers = false;
		animated = true;
		nextRoundFinalJeopardyCalled = !finalJeopardyCheck;
		hostRoundIsDoubleJeopardy = snapshot.boardRound === 'Double Jeopardy';
		setHostBoardChromeActive(true);

		if (
			snapshot.activePlayerName &&
			nameIds[snapshot.activePlayerName] !== undefined
		) {
			activePlayerName = snapshot.activePlayerName;
			moveActiveIndicator(snapshot.activePlayerName);
		}

		if (snapshot.clueInProgress && snapshot.curQuestionId && questionList[snapshot.curQuestionId]) {
			questionIsLive = true;
			curQuestionId = snapshot.curQuestionId;
			displayQuestion(questionList[curQuestionId].question, curQuestionId);
			if (snapshot.buzzedInPlayerName) {
				drawTypingPopup(
					snapshot.buzzedInPlayerName,
					snapshot.buzzedInMemberName || snapshot.buzzedInPlayerName
				);
			} else if (snapshot.phase === 'clue-reading') {
				/* The previous host disappeared before it started the server timer. */
				socket.emit('start countdown', curQuestionId);
			}
		}

		if (snapshot.finalJeopardyCheck) {
			mergeFinalJeopardyBets(snapshot.finalJeopardyBets || []);
			(snapshot.finalJeopardyResults || []).forEach(function (result) {
				applyFJScore(result);
			});
			if (snapshot.finalJeopardyWageringPhase) {
				var wagerCount = snapshot.finalJeopardyBets
					? snapshot.finalJeopardyBets.length
					: 0;
				if (wagerCount >= snapshot.players.length) {
					openFinalJeopardyAnswersOnce();
				}
			} else if (
				(snapshot.finalJeopardyAnswerPhase ||
					snapshot.phase === 'final-scoring' ||
					snapshot.phase === 'game-over') &&
				questionList['FJ_0_0']
			) {
				finalJeopardyAnswersOpened = true;
				displayQuestion(questionList['FJ_0_0'].question, 'FJ_0_0');
				postScreenMessage(
					questionList['FJ_0_0'].category +
						'</br></br>' +
						questionList['FJ_0_0'].question,
					false
				);
				if (snapshot.phase === 'final-scoring' || snapshot.phase === 'game-over') {
					finalJeopardyThemeEnded = true;
					waitForFinalScoresThenCeremonies();
				} else {
					beginFinalJeopardyAnswerPeriod(
						Math.max(0, snapshot.finalJeopardyAnswerEndsAt - Date.now())
					);
				}
			}
			var fjMsg =
				'Final Jeopardy — host view restored. Player phones should show the wager or clue again after they refresh or reconnect.';
			if (snapshot.finalJeopardyAnswerPhase) {
				fjMsg += ' <b>Answer phase</b> is active on the server.';
			} else if (snapshot.finalJeopardyWageringPhase) {
				fjMsg += ' <b>Wager phase</b> is active on the server.';
			} else {
				fjMsg +=
					' The host has not opened wagers yet (or audio is still playing); players see a short wait message.';
			}
			fjMsg +=
				' If the room is stuck, use <b>New game</b> (button under the room code) to reset everyone.';
			if (!snapshot.finalJeopardyAnswerPhase) {
				postScreenMessage(fjMsg, false, 0);
			}
		}

		updateHostJoinedPlayersPanel(snapshot.players || []);

		setTimeout(function () {
			hostRestoreSuppress = false;
		}, 0);
		return true;
	}

	socket.on('host state snapshot', function (snapshot) {
		if (!snapshot) {
			return;
		}
		applyHostRoomConfiguration(snapshot);
		if (!snapshot.gameActive) {
			setHostGameState('lobby', 'LOBBY', 'Waiting for players');
		} else if (snapshot.clueInProgress) {
			setHostGameState(
				snapshot.buzzedInPlayerName ? 'answering' : 'reading',
				snapshot.buzzedInPlayerName ? 'ANSWERING' : 'CLUE IN PLAY',
				snapshot.buzzedInPlayerName || 'Clue in progress'
			);
		} else {
			setHostGameState(
				'selecting',
				'SELECTING A CLUE',
				snapshot.activePlayerName || 'Board is open'
			);
		}
		var full = applyHostSnapshot(snapshot);
		if (full) {
			console.log('Host UI restored from server snapshot');
			return;
		}
		syncHostLobbyRosterFromSnapshot(snapshot);
		if (snapshot.players && snapshot.players.length > 0) {
			console.log('Host player roster synced (lobby or board not in snapshot yet)');
		}
	});

	socket.on('roster update', function (players) {
		var list = players || [];
		var snapshot = {
			players: list,
			mode: gameMode,
			modeConfig: {
				label: $('#host_mode_badge').text(),
				minContestants: 3,
			},
			gameActive: false,
			setupVotingOpen: false,
		};
		if (list.length > lastRosterJoinCount) {
			playSound(playerJoinSound);
		}
		lastRosterJoinCount = list.length;
		player_login_count = list.length;
		rebuildHostPlayersTableFromSnapshot(snapshot);
		updateHostJoinedPlayersPanel(snapshot.players);
		restoreIntroNameBubblesFromSnapshot(snapshot.players);
		applyHostRoomConfiguration(snapshot);
	});

	socket.on('setup voting started', function () {
		hostRosterLocked = true;
		$('#host_start_setup_btn').prop('hidden', true);
		$('.host-roster-player__remove').remove();
		setHostGameState('voting', 'VOTING', 'Players are choosing game settings');
	});

	$('#host_player_roster_names').on('click', '.host-roster-player__remove', function () {
		var name = String($(this).attr('data-player-name') || '');
		if (!name || !window.confirm('Remove ' + name + ' from this room?')) {
			return;
		}
		socket.emit('host remove contestant', name);
	});

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
		if (hostSoundMuted || !hostPageAudioPrimed) {
			return;
		}
	    var sound = soundObject;
	    sound.volume = 1.0;

	    var fadeAudio = setInterval(function () {
	    	if (hostSoundMuted || !hostPageAudioPrimed) {
	    		clearInterval(fadeAudio);
	    		stopSound(sound);
	    		return;
	    	}
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
			setHostGameState(
				'selecting',
				'SELECTING A CLUE',
				(data && data.playerName ? data.playerName : 'A player') + ' has board control'
			);

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
							setHostBoardChromeActive(true);
		   					setTimeout(function(){
		   						playSound(openUpSound);
		   						$('#airdate_screen').slideUp("slow", function(){
		   							getSoundAndFadeAudio(dateSoundEffect);
				   					setTimeout(function(){
						   				animateBoard(true);
						   				setTimeout(function(){messageToVoice("Hello and welcome to Jeopardy! These are todays categories", false)}, 1800);
						   				setTimeout(function(){categoryAnimate(data.playerName)}, 3200);
						   				activePlayerName = data.playerName;
					   				}, 1000);
		   						});
			   				}, 2800);
				   			  
			   			});
		   			}, 2000);
		   		}

		   		else
		   		{
		   			console.log("ROUND TIMER: " + roundTimer);
		   			if (roundTimer > 0) //prevent shitty messages to popup if round is over
		   			{
		   				console.log(roundTimer);
						if (data.correct === true) {
							if (data.gainedBoardControl) {
								message = data.playerName + ", you have the board.";
							} else {
								message = data.playerName + ", still yours.";
							}
						} else if (activePlayerName == data.playerName) {
							if (newRound == true) {
								message = data.playerName + ", you have the board.";
								newRound = false;
							} else {
								message = data.playerName + ", still yours.";
							}
						} else {
							message = data.playerName + ", you have the board.";
						}
						console.log(message);
						var msgRead = false;
						messageToVoice(message, true, function(){ //TODO WHY DOES THIS NEVER GET HERE?  It is probably something to do with googles api failing to finish a voice sequence so the callback never occurs.
							msgRead = true;
							console.log("ACTIVE PLAYER MESSAGE FINISHED.");
							staticMessageOff();
							hideQuestionField();
							stopSound(chooseCategoryTheme);
							flashActiveOn(data.playerName);
							socket.emit('open question category', data.playerName);
						});
						setTimeout(function(){ 
							if (!msgRead){
								console.log("ACTIVE PLAYER MESSAGE FINISHED.");
								staticMessageOff();
								hideQuestionField();
								stopSound(chooseCategoryTheme);
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

	function formatHostRoundClock(totalSec) {
		var sec = Math.max(0, parseInt(totalSec, 10) || 0);
		var m = Math.floor(sec / 60);
		var s = sec % 60;
		return m + ':' + (s < 10 ? '0' : '') + s;
	}

	function hostRoomCodeForDisplay() {
		var fromDom = ($('#host_room_code_value').text() || '').replace(/\s+/g, '').trim();
		if (fromDom) {
			return fromDom;
		}
		return hostRoomCode || '';
	}

	function setHostBoardChromeActive(active) {
		$(document.body).toggleClass('host-board-active', !!active);
		updateHostRoundTimerDisplay();
	}

	function updateHostRoundTimerDisplay() {
		var wrap = $('#host_round_timer');
		if (!wrap.length) {
			return;
		}
		var sec = Math.max(0, parseInt(roundTimer, 10) || 0);
		$('#host_round_timer_value').text(formatHostRoundClock(sec));
		var label;
		if ($(document.body).hasClass('host-board-active')) {
			label = hostRoomCodeForDisplay() || '----';
		} else if (finalJeopardyCheck) {
			label = 'FINAL J!';
		} else if (hostRoundIsDoubleJeopardy) {
			label = 'DOUBLE JEOPARDY';
		} else {
			label = 'JEOPARDY';
		}
		$('#host_round_timer_label').text(label);
		wrap.toggleClass('host-round-timer--low', sec > 0 && sec <= 60);
		wrap.toggleClass('host-round-timer--ended', sec <= 0);
	}

	function setRoundTimer(secondRound, roundTimerArg)
	{
		hostRoundIsDoubleJeopardy = !!secondRound;
		roundTimer = roundTimerArg;
		updateHostRoundTimerDisplay();
		console.log("ROUND TIMER UPDATE WITH : " + roundTimer);
		if (hostRestoreSuppress) {
			return;
		}
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
		setHostGameState(
			'round-transition',
			finalJeopardyCheck ? 'FINAL JEOPARDY' : 'NEXT ROUND',
			'Preparing the next round'
		);
		nextRoundOrdered();
	});

	function nextRoundOrdered(){
		for(playerNameSingle in playerNames){
			console.log("FLASH PLAYER NAMES : " + playerNameSingle);
			flashActiveOff(playerNames[playerNameSingle]);
		}
		moveActiveIndicator(activePlayerName);
		
		hideQuestionField();
		flushHostSpeech();
		if (finalJeopardyCheck)
		{
			if(nextRoundFinalJeopardyCalled){ //should only be called once
				nextRoundFinalJeopardyCalled = false;
				playSound(roundOverSound);
				postScreenMessage("Double Jeopardy Round is Over!", false, 0);
				messageToVoice("Double Jeopardy Round is Over!", true, function () {
					socket.emit('final jeopardy started');
					startFinalJeopardy();
				});
			}	
		}
		else
		{
			playSound(roundOverSound);
			postScreenMessage("Jeopardy Round is Over!", false, 0);
			messageToVoice("Jeopardy Round is Over!", true, function () {
				buildBoard(questionList, "Double Jeopardy");
				animateBoard(false);
				socket.emit('second round started', contentBoard);
				setTimeout(function () {
					startSecondRound(activePlayerName);
				}, 1200);
			});
		}
	}

	function startSecondRound(activePlayer)
	{
		console.log("START SECOND ROUND");

		if (!animated)
		{
			animated = true;
			var message = "Get ready for the Double Jeopardy Round, all clues will be worth double!";
			postScreenMessage(message, false, 0);
			messageToVoice(message, true, function () {
				messageToVoice("Here are your categories.", true, function () {
					categoryAnimate(activePlayer);
				});
			});
		}
	}

	function startFinalJeopardy()
	{
		flashActiveOff(activePlayerName);
		playersFJ = {};
		playerFJCounter = 0;
		finalJeopardyAnswersOpened = false;
		finalJeopardyAnswerPeriodStarted = false;
		finalJeopardyThemeEnded = false;
		finalCeremoniesStarted = false;
		countScores = 0;
		$("#message_overlay").css("background-color", "rgb(63, 81, 181)");
		$("#message_overlay").css("color", "rgb(255, 255, 255)");
		postScreenMessage("", false, 0);
		var message = "Here is tonights Final Jeopardy Category: ";
		messageToVoice(message, true, function () {
			playSound(finalJeopardyBloop);
			stopSound(chooseCategoryTheme);
			$("#message_overlay").html("<h2>" + questionList["FJ_0_0"].category + "</h2>");
			messageToVoice(questionList["FJ_0_0"].category, true, function () {
				messageToVoice("Please make your wager.", true, function () {
					socket.emit('final jeopardy bid');
				});
			});
		});
	}

	var playerFJCounter = 0;

	function beginFinalJeopardyAnswerPeriod(durationOverrideMs) {
		if (finalJeopardyAnswerPeriodStarted) {
			return;
		}
		finalJeopardyAnswerPeriodStarted = true;

		playSound(finalJeopardyTheme);

		var durationMs =
			typeof durationOverrideMs === 'number' && isFinite(durationOverrideMs)
				? Math.max(0, durationOverrideMs)
				: FINAL_JEOPARDY_THEME_MS;

		clearTimeout(finalJeopardyAnswerPeriodTimer);
		finalJeopardyAnswerPeriodTimer = setTimeout(function () {
			onFinalJeopardyTimeUp();
		}, durationMs);
	}

	function onFinalJeopardyTimeUp() {
		if (finalJeopardyThemeEnded) {
			return;
		}
		finalJeopardyThemeEnded = true;
		clearTimeout(finalJeopardyAnswerPeriodTimer);
		finalJeopardyAnswerPeriodTimer = null;
		try {
			finalJeopardyTheme.pause();
			finalJeopardyTheme.currentTime = 0;
		} catch (e) {
			/* ignore */
		}

		socket.emit('final jeopardy time out');
		waitForFinalScoresThenCeremonies();
	}

	function applyFJScore(scoreFJ) {
		if (!scoreFJ || !scoreFJ.playerName) {
			return;
		}
		var entry = playersFJ[scoreFJ.playerName];
		if (!entry) {
			return;
		}

		if (entry.scoreRecorded) {
			if (scoreFJ.buzzedInFJ && !entry.buzzedInFJ) {
				entry.buzzedInFJ = true;
				entry.score = scoreFJ.score;
				entry.correct = !!scoreFJ.correct;
				entry.answer = scoreFJ.answer || '';
			}
			return;
		}

		entry.buzzedInFJ = !!scoreFJ.buzzedInFJ;
		entry.score = scoreFJ.score;
		entry.correct = !!scoreFJ.correct;
		entry.answer = scoreFJ.answer || '';
		entry.scoreRecorded = true;
		countScores++;
		tryStartFinalCeremonies();
	}

	function fillMissingFJScores() {
		var i;
		for (i = 0; i < playerNames.length; i++) {
			var name = playerNames[i];
			var p = playersFJ[name];
			if (!p || p.scoreRecorded) {
				continue;
			}
			var bet = parseInt(p.bet, 10);
			if (isNaN(bet)) {
				bet = 0;
			}
			var currentScore = 0;
			if (nameIds[name] !== undefined) {
				currentScore = parseInt($('#name_' + nameIds[name]).html(), 10);
				if (isNaN(currentScore)) {
					currentScore = 0;
				}
			}
			applyFJScore({
				playerName: name,
				score: currentScore - bet,
				correct: false,
				answer: '',
				buzzedInFJ: false,
			});
		}
	}

	function tryStartFinalCeremonies() {
		if (!finalJeopardyThemeEnded || finalCeremoniesStarted) {
			return;
		}
		if (countScores >= playerNames.length) {
			finalCeremonies();
		}
	}

	function waitForFinalScoresThenCeremonies() {
		tryStartFinalCeremonies();
		if (finalCeremoniesStarted) {
			return;
		}
		var waitStart = Date.now();
		var lastTimer = setInterval(function () {
			if (countScores >= playerNames.length || Date.now() - waitStart > 20000) {
				clearInterval(lastTimer);
				fillMissingFJScores();
				tryStartFinalCeremonies();
			}
		}, 50);
	}

	//bid is submitted (progressive sync; answer period opens via 'all wagers ready')
	socket.on('final jeopardy response', function(response){
		playersFJ[response.playerName] = playersFJ[response.playerName] || {
			playerName: response.playerName,
			buzzedInFJ: false,
			scoreRecorded: false,
		};
		playersFJ[response.playerName].playerName = response.playerName;
		playersFJ[response.playerName].bet = response.bet;
		playerFJCounter++;
	});

	socket.on('final jeopardy wagers sync', function(payload){
		mergeFinalJeopardyBets(payload && payload.bets);
	});

	socket.on('final jeopardy scoring ready', function(){
		onFinalJeopardyTimeUp();
	});

	socket.on('final jeopardy all wagers ready', function(payload){
		mergeFinalJeopardyBets(payload && payload.bets);
		openFinalJeopardyAnswersOnce();
	});

	function mergeFinalJeopardyBets(bets) {
		if (!bets || !bets.length) {
			return;
		}
		var i;
		for (i = 0; i < bets.length; i++) {
			var bet = bets[i];
			if (!bet || !bet.playerName) {
				continue;
			}
			playersFJ[bet.playerName] = playersFJ[bet.playerName] || {
				playerName: bet.playerName,
				buzzedInFJ: false,
				scoreRecorded: false,
			};
			playersFJ[bet.playerName].playerName = bet.playerName;
			playersFJ[bet.playerName].bet = bet.bet;
		}
	}

	function openFinalJeopardyAnswersOnce() {
		if (finalJeopardyAnswersOpened) {
			return;
		}
		if (!questionList['FJ_0_0']) {
			return;
		}
		finalJeopardyAnswersOpened = true;
		displayQuestion(questionList["FJ_0_0"].question, "FJ_0_0");
		postScreenMessage(questionList["FJ_0_0"].category + "</br></br>" + questionList["FJ_0_0"].question, false);
		var msgSuccess = false;
		var answerPeriodOpened = false;
		function openFJAnswers() {
			if (answerPeriodOpened) {
				return;
			}
			answerPeriodOpened = true;
			beginFinalJeopardyAnswerPeriod();
			socket.emit('open response final jeopardy');
		}
		messageToVoice("The answer is: " + questionList["FJ_0_0"].question + "...Good Luck!", true, function(){
			openFJAnswers();
			msgSuccess = true;
		});
		setTimeout(function(){
			if (!msgSuccess){
				openFJAnswers();
			}
		}, 10000);
	}

	function finalCeremonies()
	{
		if (finalCeremoniesStarted) {
			return;
		}
		finalCeremoniesStarted = true;

		var winners = [];
		var playerNamesArray = [];
		var necessaryAnswer = false;
		var compareScore = -99999;
		var i;

		console.log(playersFJ);
		for (i = 0; i < playerNames.length; i++) {
			var name = playerNames[i];
			var p = playersFJ[name];
			if (!p) {
				continue;
			}
			var scoreForEndGame = parseInt(p.score, 10);
			if (isNaN(scoreForEndGame)) {
				scoreForEndGame = 0;
			}
			p.score = scoreForEndGame;
			updateScore(p.playerName, scoreForEndGame);
			if (scoreForEndGame > compareScore) {
				winners = [p];
				compareScore = scoreForEndGame;
			} else if (scoreForEndGame === compareScore) {
				winners.push(p);
			}
			if (!p.correct) {
				necessaryAnswer = true;
			}
			playerNamesArray.push(name);
		}

		if (!winners.length && playerNamesArray.length) {
			winners = [playersFJ[playerNamesArray[0]]];
		}

		for (i = $('#player_container .player_display').length; i < playerNamesArray.length; i++) {
			$('#player_container').append(
				$('<div>', {
					class: 'player_display',
					id: 'player_' + i,
				}).append($('<div>', { class: 'secure_player_container' }))
			);
		}
		$('.player_display .secure_player_container').empty();
		$('.player_display').addClass('player-reveal-hidden');
		$('#player_container').css({ width: '100%', height: '100%' });

		$('#player_container').slideDown('slow', function () {
			messageToVoice('Lets take a look at the answers.', true, function () {
				revealFinalJeopardyPlayer(0, playerNamesArray, winners, necessaryAnswer);
			});
		});
	}

	function formatWinnerNames(winners) {
		if (!winners || !winners.length) {
			return '';
		}
		if (winners.length === 1) {
			return winners[0].playerName;
		}
		if (winners.length === 2) {
			return winners[0].playerName + ' and ' + winners[1].playerName;
		}
		var names = [];
		var i;
		for (i = 0; i < winners.length - 1; i++) {
			names.push(winners[i].playerName);
		}
		return names.join(', ') + ', and ' + winners[winners.length - 1].playerName;
	}

	function revealFinalJeopardyPlayer(index, playerNamesArray, winners, necessaryAnswer) {
		if (index >= playerNamesArray.length) {
			showFinalJeopardyResults(winners, necessaryAnswer);
			return;
		}

		var curPlayerObject = playersFJ[playerNamesArray[index]];
		if (!curPlayerObject) {
			revealFinalJeopardyPlayer(index + 1, playerNamesArray, winners, necessaryAnswer);
			return;
		}

		var $slide = $('#player_' + index);
		var $container = $slide.find('.secure_player_container');
		$('.player_display').addClass('player-reveal-hidden');
		$container.empty();
		$slide.removeClass('player-reveal-hidden');

		var correctText = curPlayerObject.correct ? 'correct' : 'incorrect';
		var answer = curPlayerObject.answer;
		var msgAnswer = curPlayerObject.answer || '';
		var intro = curPlayerObject.playerName + ' said, ';
		if (answer === undefined || answer === '') {
			answer = '?';
			msgAnswer = '';
			intro = curPlayerObject.playerName + " couldn't come up with anything.  ";
		}

		$container.append($('<h2>').text(curPlayerObject.playerName));
		$container.append($('<h2>').text(String(answer)));

		socket.emit('final jeopardy reveal player', {
			playerName: curPlayerObject.playerName,
			correct: !!curPlayerObject.correct,
			score: curPlayerObject.score,
			answer: curPlayerObject.answer || '',
			bet: curPlayerObject.bet,
		});

		var resultLine =
			intro +
			(msgAnswer ? msgAnswer + ' ' : '') +
			'and was ' +
			correctText +
			'.';
		messageToVoice(
			resultLine,
			true,
			function () {
				$container.append($('<h2>').text(String(curPlayerObject.bet)));
				messageToVoice(
					'They wagered ' + curPlayerObject.bet + '.',
					true,
					function () {
						setTimeout(function () {
							revealFinalJeopardyPlayer(
								index + 1,
								playerNamesArray,
								winners,
								necessaryAnswer
							);
						}, 1500);
					}
				);
			},
			{ interrupt: true }
		);
	}

	function showFinalJeopardyResults(winners, necessaryAnswer) {
		$('#player_container').fadeOut('fast', function () {
			$('#player_container').css('display', 'none');
			$('.player_display .secure_player_container').empty();
			$('.player_display').addClass('player-reveal-hidden');

			function buildStandings() {
				var standings = [];
				var i;
				for (i = 0; i < playerNames.length; i++) {
					var p = playersFJ[playerNames[i]];
					if (!p) {
						continue;
					}
					standings.push({
						name: p.playerName,
						score: parseInt(p.score, 10) || 0,
					});
				}
				standings.sort(function (a, b) {
					return b.score - a.score;
				});
				return standings;
			}

			function buildFinalStandingsListHtml(standings) {
				var html = '<ol>';
				var i;
				for (i = 0; i < standings.length; i++) {
					html +=
						'<li>' +
						$('<div>').text(standings[i].name).html() +
						' — $' +
						standings[i].score +
						'</li>';
				}
				html += '</ol>';
				return html;
			}

			function announceWinnerAndScores() {
				var standings = buildStandings();
				var standingsList = buildFinalStandingsListHtml(standings);
				if (!winners || !winners.length) {
					$('#message_overlay')
						.html('<div><h2>FINAL RESULTS</h2>' + standingsList + '</div>')
						.fadeIn('slow');
					setTimeout(function () {
						socket.emit('fetch high scores');
					}, 5000);
					return;
				}

				var winnerNames = formatWinnerNames(winners);
				var winningScore = winners[0].score;
				var isTie = winners.length > 1;
				var headline = isTie
					? 'It\'s a tie!'
					: 'You win ' + winners[0].playerName + '!';
				var voiceLine = isTie
					? 'We have a tie between ' +
					  winnerNames +
					  ' with ' +
					  winningScore +
					  ', congratulations!  See you next time.'
					: 'Todays winner is ' +
					  winnerNames +
					  ' with ' +
					  winningScore +
					  ', congratulations!  See you next time.';

				messageToVoice(voiceLine, false);
				$('#message_overlay')
					.html(
						'<div><h2>' +
							$('<div>').text(headline).html() +
							'</h2>' +
							(isTie
								? '<p>' + $('<div>').text(winnerNames).html() + '</p>'
								: '') +
							standingsList +
							'</div>'
					)
					.fadeIn('slow');
				jeopardyIntroMusic.volume = 1;
				playSound(jeopardyIntroMusic);
				socket.emit('game over', {
					winningPlayerName: winners[0].playerName,
					winningPlayerScore: winningScore,
					winningPlayerNames: winners.map(function (w) {
						return w.playerName;
					}),
					isTie: isTie,
					standings: standings,
				});
				setTimeout(function () {
					socket.emit('fetch high scores');
				}, 10000);
			}

			if (necessaryAnswer && questionList['FJ_0_0']) {
				messageToVoice(
					'The answer we were looking for was ' + questionList['FJ_0_0'].answer,
					false
				);
				postScreenMessage(questionList['FJ_0_0'].answer, false, 0);
				setTimeout(announceWinnerAndScores, 4000);
			} else {
				announceWinnerAndScores();
			}
		});
	}

	socket.on('high scores', function(highScores){
		console.log("HIGH SCORES : " + JSON.stringify(highScores));
		var $wrap = $('<div>');
		var $list = $('<ol>');
		$wrap.append($('<h2>', { text: 'HIGH SCORES' }));
		for (var scoreCounter = 0; scoreCounter < Math.min(10, highScores.length); scoreCounter++) {
			$list.append(
				$('<li>', {
					text: String(highScores[scoreCounter].name || '') + ' ' + String(highScores[scoreCounter].score || 0),
				})
			);
		}
		$wrap.append($list);
		$("#message_overlay").empty().append($wrap);
	});

    socket.on('new game', function(){
    	skipGameDataAfterHostRestore = false;
    	playerFJCounter = 0;
    	countScores = 0;
    	finalJeopardyThemeEnded = false;
    	finalJeopardyAnswerPeriodStarted = false;
    	finalCeremoniesStarted = false;
    	finalJeopardyAnswersOpened = false;
    	nextRoundFinalJeopardyCalled = true;
    	flushHostSpeech();
    	clearTimeout(finalJeopardyAnswerPeriodTimer);
    	finalJeopardyAnswerPeriodTimer = null;
    	try {
    		finalJeopardyTheme.pause();
    		finalJeopardyTheme.currentTime = 0;
    	} catch (e) {
    		/* ignore */
    	}
    	$('#host_game_load_status')
    		.removeClass('host-game-load-status--error')
    		.addClass('host-game-load-status--hidden')
    		.text('');
    	questionList.length = 0;
		questionList = [];
		categories.length = 0;
		categories = [];
		playersFJ = {};
		playerCount = 0;
		contentBoard = '';
		activePlayerName = '';
		nameIds.length = 0;  //number reference for player
		categories.length = 0;
		playerNames.length = 0;
		questionIsLive = false;
		finalJeopardyCheck = false;
		dailyDoubleBet = 0;
		roundTimer = 480;
		hostRoundIsDoubleJeopardy = false;
		setHostBoardChromeActive(false);
		animated = false;
		lockPlayers = false;
		$("#message_overlay").css("background-color", "rgb(189, 189, 189)");
		$("#message_overlay").css("color", "rgb(0, 0, 0)");
		$('#question_field').css('display', 'none');
		$('#message_overlay').css('display', 'none');
		$('#category_container').css('display', 'none');
		$('#player_container').css('display', 'none');
		$('.player_display .secure_player_container').empty();
		$('.player_display').addClass('player-reveal-hidden');
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
	  	setHostGameState('reading', 'READING CLUE', 'Buzzers are locked until reading ends');
	  	timerCount = 6;
	  	questionIsLive = true;
	  	flushHostSpeech();
	  	var hostCell = document.getElementById(question.questionId);
	  	if (hostCell) {
	  		hostCell.innerHTML = '';
	  	} else {
	  		console.warn('question reveal: missing host board cell #' + question.questionId);
	  	}
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
		 		messageToVoice(
		 			questionList[question.questionId].category.toLowerCase() +
		 				' for ' +
		 				questionList[question.questionId].value,
		 			true,
		 			function () {
		 				displayQuestion(question.question, question.questionId);
		 				messageToVoice(question.question, true, function () {
		 					if (questionRead) {
		 						return;
		 					}
		 					questionRead = true;
		 					console.log('question reveal');
		 					socket.emit('start countdown', question.questionId);
		 					playSound(questionTheme);
		 				});
		 			}
		 		);
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
	  		displayQuestion(question.question, question.questionId);
	  		staticMessageOff();
		  	messageToVoice(question.question, true, function(){ 
		  		if (messageSuccess) {
		  			return;
		  		}
		  		messageSuccess = true;
		  		socket.emit('open submit dd');
		  		drawTypingPopup(activePlayerName, question.memberName);
		  	}, { interrupt: true });
	  });

	 //capture buzzer press buzzed in buzz in
	 socket.on('buzzer pressed', function(pressed){
	 	if(!lockPlayers)
	 	{
	 		setHostGameState(
	 			'answering',
	 			'ANSWERING',
	 			(pressed.memberName || pressed.playerName) + ' buzzed in'
	 		);
	 		socket.emit('buzzer pressed confirmed', pressed);
		 	console.log('buzzer pressed');
		 	socket.emit('close buzzer');
		 	flashBuzzer(pressed.playerName);
		 	drawTypingPopup(pressed.playerName, pressed.memberName);
		 	stopSound(questionTheme);
		 	//play buzzer sound
		 	playSound(buzzInSound);
		 	setTimeout(function(){/*playSound(clockCountdown)*/}, 1000);
	 	}
	 });

	 //on answer determination answer submit
	 socket.on('score update', function(score){
	 	hideHostAiJudging();
	 	var openQuestionsSwitch = true;
	 	$('#name_' + nameIds[score.playerName]).html(score.score);
	 	updateHostPodiumRanks();
	 	setHostGameState(
	 		score.correct ? 'correct' : 'incorrect',
	 		score.correct ? 'CORRECT' : 'INCORRECT',
	 		score.playerName + ' · ' + score.score
	 	);
	 	//stopSound(clockCountdown);

	 	hidePopup(score.playerName);
	 	console.log("hide popup should be called for " + score.playerName);
	 	flushHostSpeech();

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
	 		hideHostAiJudging();
	 		console.log("score update score: " + scoreFJ.score + " player name: " + scoreFJ.playerName);
	 		applyFJScore(scoreFJ);
	 });

	 socket.on('score update final jeopardy buzzed out', function(scoreFJ){
	 		applyFJScore(scoreFJ);
	 });

	 var timerCount = 6;

	//global timers

	socket.on('countdown', function(data){
 		//beginCountdown(data.questionId, data.timerCount);  CAUSING GLITCH?
 		setHostGameState('buzzers-open', 'BUZZERS OPEN', 'Players may buzz now');
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
		  		postScreenMessage(msgRsp, false, 0);
 				messageToVoice(msgRsp, true, function(){
 					question_read = true;
 					endCountdown(questionId);
 					socket.emit('question timer out');
 					staticMessageOff();
 					console.log("QUESTION TIMER OUT SOCKET EMIT");
 				});
 				setTimeout(function(){ 
						if (question_read==false){
							endCountdown(questionId);
							socket.emit('question timer out');
							staticMessageOff();
 							console.log("QUESTION TIMER OUT SOCKET EMIT (GOOGLE SPEECH API FAIL)");
						}
				}, 12000);
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

	// Display clue media from downloaded /temp-media (or remote URL fallback).
	function searchForMedia(questionId)
	{
		var $container = $("#question_field #image_container");
		$container.empty();
		var q = questionList[questionId];
		if (!q) {
			return;
		}
		var mediaLink = String(q.mediaLink || '').trim();
		var mediaType = q.mediaType || 'none';
		var originalUrl = String(q._mediaOriginalUrl || '').trim();
		var attribution = q._mediaFallback ? q._mediaAttribution : null;
		console.log("MEDIA LINK: " + mediaLink + " type=" + mediaType);

		if (!mediaLink || mediaLink === 'no url') {
			return;
		}

		if (
			mediaType === 'image' ||
			(mediaType === 'none' && /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(mediaLink))
		) {
			showQuestionImage(mediaLink, originalUrl, attribution);
			return;
		}

		if (mediaType === 'audio') {
			playQuestionAudio(mediaLink, originalUrl);
			return;
		}

		if (mediaType === 'video_mp4') {
			showQuestionVideo(mediaLink, originalUrl);
			return;
		}

		if (mediaType === 'video_wmv' || mediaType === 'video') {
			/* WMV rarely plays in-browser; still try local/remote as <video>, else image fallback */
			showQuestionVideo(mediaLink, originalUrl);
		}
	}

	function safeHttpUrl(value) {
		var url = String(value || '');
		return /^https?:\/\//i.test(url) ? url : '';
	}

	function showImageAttribution($container, attribution) {
		if (!attribution) {
			return;
		}
		var $credit = $('<div>', { class: 'image_attribution' });
		var sourceUrl = safeHttpUrl(attribution.sourceUrl);
		var licenseUrl = safeHttpUrl(attribution.licenseUrl);
		var artist = String(attribution.artist || 'Wikimedia Commons contributor');
		var license = String(attribution.license || 'license details');

		$credit.append(document.createTextNode('Image: '));
		if (sourceUrl) {
			$credit.append(
				$('<a>', {
					href: sourceUrl,
					target: '_blank',
					rel: 'noopener noreferrer',
					text: artist,
				})
			);
		} else {
			$credit.append(document.createTextNode(artist));
		}
		$credit.append(document.createTextNode(' · '));
		if (licenseUrl) {
			$credit.append(
				$('<a>', {
					href: licenseUrl,
					target: '_blank',
					rel: 'noopener noreferrer',
					text: license,
				})
			);
		} else {
			$credit.append(document.createTextNode(license));
		}
		$container.append($credit);
	}

	function showQuestionImage(primaryUrl, fallbackUrl, attribution) {
		var $container = $("#question_field #image_container");
		var $img = $('<img>', {
			id: 'question_image',
			alt: 'Clue media',
		});
		var triedFallback = false;
		var usingPrimary = true;
		$img.on('load', function () {
			$container.find('.image_attribution').remove();
			if (usingPrimary) {
				showImageAttribution($container, attribution);
			}
		});
		$img.on('error', function () {
			if (!triedFallback && fallbackUrl && fallbackUrl !== primaryUrl) {
				triedFallback = true;
				usingPrimary = false;
				$container.find('.image_attribution').remove();
				$img.attr('src', fallbackUrl);
				return;
			}
			$container.find('.image_attribution').remove();
			$img.remove();
		});
		$img.attr('src', primaryUrl);
		$container.append($img);
	}

	function playQuestionAudio(primaryUrl, fallbackUrl) {
		var audioClip = new Audio();
		var src = primaryUrl;
		audioClip.addEventListener('error', function () {
			if (fallbackUrl && fallbackUrl !== src) {
				src = fallbackUrl;
				audioClip.src = fallbackUrl;
				audioClip.play().catch(function () { /* ignore */ });
			}
		});
		audioClip.src = primaryUrl;
		audioClip.play().catch(function () { /* autoplay / missing file */ });
	}

	function showQuestionVideo(primaryUrl, fallbackUrl) {
		var $container = $("#question_field #image_container");
		var $video = $('<video>', {
			id: 'question_image',
			controls: true,
			autoplay: true,
			muted: true,
			playsinline: true,
		});
		$video.css({ maxWidth: '100%', maxHeight: '350px' });
		var triedFallback = false;
		$video.on('error', function () {
			if (!triedFallback && fallbackUrl && fallbackUrl !== primaryUrl) {
				triedFallback = true;
				$video.attr('src', fallbackUrl);
				return;
			}
			$video.remove();
			var source = safeHttpUrl(fallbackUrl) || safeHttpUrl(primaryUrl);
			if (source) {
				$container.append(
					$('<a>', {
						href: source,
						target: '_blank',
						rel: 'noopener noreferrer',
						text: 'Open clue media in a compatible player',
						class: 'question-media-fallback-link',
					})
				);
			}
		});
		$video.attr('src', primaryUrl);
		$container.append($video);
	}

	function musicAnimate(audioClip){
		/* unused */
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
		var questionWidth = $(document.body).hasClass('host-many-players') ? '75%' : '85%';
		$('#question_field').animate({
			width: questionWidth,
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
    	var $cc = $('#category_container');

    	playSound(openUpSound);

    	for (category in categories) {
    		$('#cat_' + category).html("<div class='secure_category_container'><h2>" + categories[category] + '</h2></div>');
    	}

    	// Start cycle only after the container is visible: jQuery Cycle measures hidden slides as
    	// width 0, then slideResize shrinks later slides so category text stops being centered.
    	$cc.slideDown(function () {
    		var cw = $cc.width();
    		var ch = $cc.height();
    		if (!cw || !ch) {
    			cw = $(window).width();
    			ch = $(window).height();
    		}
    		$cc.cycle({
    			fx: 'scrollRight',
    			next: '#category_container',
    			speed: 100,
    			timeout: 2400,
    			after: function () {
    				if (index < categories.length) {
    					messageToVoice(categories[index].toLowerCase(), false, null, {
    						interrupt: true,
    					});
    					index++;
    				}
    			},
    			fit: true,
    			width: cw,
    			height: ch,
    			slideResize: false,
    			containerResize: false,
    			easing: 'easeInOutBack',
    			autostop: 1,
    			end: function () {
    				$cc.cycle('stop');
    				playSound(openUpSound);
    				$cc.slideUp('fast', function () {
    					message = playerName + ', you have the board.';
    					postScreenMessage(message, true, 2000);
    					messageToVoice(message, true, function () {
    						stopSound(chooseCategoryTheme);
    						flashActiveOn(activePlayerName);
    					});
    					socket.emit('begin round timer');
    					socket.emit('open question category new round');
    				});
    			},
    		});
    	});
    }
	function moveActiveIndicator(name)
	{
		$('.player-podium').removeClass('player-podium--active');
		for(nameId in nameIds)
		{
			$('#active_indicator_' + nameIds[nameId] + " td").html('WAITING');
		}
		$('#active_indicator_' + nameIds[name] + " td").html("ACTIVE");
		$('#player_podium_' + nameIds[name]).addClass('player-podium--active');
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
		var message = playerName + " has selected " + questionList[questionId].category + ".";
		messageToVoice(message, true, function(){
			playSound(dailyDoubleSound);
			postScreenMessage(playerName + " is setting their wager.", false, 0);
		}, { interrupt: true });
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
    var jeopardyIntroMusic = document.createElement('audio');
    jeopardyIntroMusic.setAttribute('src', SOUNDS_DIR + 'jeopardy_intro.mp3');
    jeopardyIntroMusic.setAttribute('class', 'init-audio');

	var timesUpSound = document.createElement('audio');
    timesUpSound.setAttribute('src', SOUNDS_DIR + 'times_up.mp3');

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

	var allHostAudio = [
		jeopardyIntroMusic,
		timesUpSound,
		dateSoundEffect,
		openUpSound,
		playerJoinSound,
		gameSoundWrong,
		dailyDoubleSound,
		buzzInSound,
		roundOverSound,
		finalJeopardyTheme,
		finalJeopardyBloop,
		chooseCategoryTheme,
		questionTheme,
		clockCountdown,
		boardFillSound,
	];

	function hostPauseAllGameAudio() {
		var i;
		for (i = 0; i < allHostAudio.length; i++) {
			try {
				allHostAudio[i].pause();
				allHostAudio[i].currentTime = 0;
			} catch (e) {
				/* ignore */
			}
		}
		try {
			window.speechSynthesis.cancel();
		} catch (e2) {
			/* ignore */
		}
	}

	function updateHostSoundToggleUi() {
		var btn = $('#host_sound_toggle');
		if (!btn.length) {
			return;
		}
		if (hostSoundMuted) {
			btn.attr('aria-pressed', 'false');
			btn.attr(
				'aria-label',
				'Sound off. Click to turn sound on.'
			);
			btn.attr(
				'title',
				'Sound off — click to turn on (browsers require a click before playing audio)'
			);
			btn.removeClass('host-sound-on').addClass('host-sound-off');
			btn.text('🔇');
		} else {
			btn.attr('aria-pressed', 'true');
			btn.attr('aria-label', 'Sound on. Click to mute.');
			btn.attr('title', 'Sound on — click to mute');
			btn.removeClass('host-sound-off').addClass('host-sound-on');
			btn.text('🔊');
		}
	}

	$('#host_sound_toggle').on('click', function () {
		if (!hostPageAudioPrimed) {
			hostPageAudioPrimed = true;
			if (hostSoundMutedStored === null) {
				hostSoundMuted = false;
				sessionStorage.setItem('jeopardyHostSoundMuted', '0');
			}
			updateHostSoundToggleUi();
			if (
				!hostSoundMuted &&
				$('#game_intro').is(':visible') &&
				jeopardyIntroMusic.paused
			) {
				playSound(jeopardyIntroMusic);
			}
			return;
		}
		hostSoundMuted = !hostSoundMuted;
		sessionStorage.setItem(
			'jeopardyHostSoundMuted',
			hostSoundMuted ? '1' : '0'
		);
		updateHostSoundToggleUi();
		if (hostSoundMuted) {
			flushHostSpeech();
			hostPauseAllGameAudio();
		}
	});
	updateHostSoundToggleUi();

	$('#host_new_game_btn').on('click', function () {
		if (
			!window.confirm(
				'Start a new game? This resets scores and loads a fresh board for the host and all player phones in this room.'
			)
		) {
			return;
		}
		socket.emit('host request new game');
	});

	socket.on('player new game requested', function (data) {
		var requester = data && data.playerName ? data.playerName : 'A player';
		if (window.confirm(requester + ' requested another game. Start a fresh board now?')) {
			socket.emit('host request new game');
		}
	});

	$('#host_start_setup_btn').on('click', function () {
		$(this).prop('disabled', true).text('Starting…');
		socket.emit('host start setup');
	});

    //loop the theme if it ends
    jeopardyIntroMusic.addEventListener('ended', function() {
    	if (hostSoundMuted || !hostPageAudioPrimed) {
    		return;
    	}
    	this.currentTime = 0;
    	this.play().catch(function () { /* autoplay / mute */ });
	}, false);

    //loop the theme if it ends
    questionTheme.addEventListener('ended', function() {
    	if (hostSoundMuted || !hostPageAudioPrimed) {
    		return;
    	}
    	this.currentTime = 0;
    	this.play().catch(function () { /* ignore */ });
	}, false);
	
	    //loop the theme if it ends
    chooseCategoryTheme.addEventListener('ended', function() {
    	if (hostSoundMuted || !hostPageAudioPrimed) {
    		return;
    	}
    	this.currentTime = 0;
    	this.play().catch(function () { /* ignore */ });
	}, false);

    //when the final jeopardy theme ends (or silent fallback timer fires via onFinalJeopardyTimeUp)
    finalJeopardyTheme.addEventListener('ended', function() {
    	onFinalJeopardyTimeUp();
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
    	updateHostPodiumRanks();
    }

    function playSound(soundName)
    {
    	if (hostSoundMuted || !hostPageAudioPrimed) {
    		return Promise.resolve();
    	}
    	soundName.volume = 1.0;
    	soundName.currentTime = 0;
    	var p = soundName.play();
    	if (p !== undefined && typeof p.catch === 'function') {
    		return p.catch(function (err) {
    			console.warn('Audio play blocked or failed:', err && err.message);
    		});
    	}
    	return Promise.resolve();
    }

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

	var timePercent = new Array();
	
	//question timer for popups
	function drawTypingPopup(pressedPlayerName, respondingMemberName)
	{
		console.log("drawing for " + pressedPlayerName);

		var idForPlayer = nameIds[pressedPlayerName];
		if (idForPlayer === undefined || idForPlayer === null) {
			console.warn('No podium found for buzzed player:', pressedPlayerName);
			return;
		}
		var $tab = $("#player_typing_" + idForPlayer);
		var responderLabel =
			gameMode === 'team' && respondingMemberName
				? respondingMemberName + ' for ' + pressedPlayerName
				: pressedPlayerName;
		$tab.find('.player_type__name').text(responderLabel);
		$tab.find('.player_type__countdown').text(answerTime + 's');
		$tab
			.stop(true, true)
			.css({ display: 'flex', opacity: 1 })
			.attr('aria-hidden', 'false')
			.addClass('player_type--visible');
		$tab.find('.progress').css('width', '100%');

		clearInterval(timePercent["timer_" + idForPlayer]);
		var startedAt = Date.now();
		var durationMs = Math.max(1, Number(answerTime) || 15) * 1000;
		timePercent["timer_" + idForPlayer] = setInterval(function(){
			var elapsed = Date.now() - startedAt;
			var remainingMs = Math.max(0, durationMs - elapsed);
			var remainingSeconds = Math.ceil(remainingMs / 1000);
			var remainingPercent = (remainingMs / durationMs) * 100;
			$tab.find('.player_type__countdown').text(remainingSeconds + 's');
			$tab.find('.progress').css('width', remainingPercent + '%');
			if (remainingMs <= 0) {
				clearInterval(timePercent["timer_" + idForPlayer]);
			}
		}, 100);
	}	

	function hidePopup(pressedPlayerName)
	{
		var idForPlayer = nameIds[pressedPlayerName];
		if (idForPlayer === undefined || idForPlayer === null) {
			return;
		}
		clearInterval(timePercent["timer_"+idForPlayer]);
		var $tab = $("#player_typing_" + idForPlayer);
		$tab
			.stop(true, true)
			.removeClass('player_type--visible')
			.attr('aria-hidden', 'true')
			.fadeOut(180);
		$tab.find('.progress').css('width', '0%');
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

	updateHostRoundTimerDisplay();
});	