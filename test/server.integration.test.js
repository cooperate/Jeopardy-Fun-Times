'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const root = path.join(__dirname, '..');

function startServer() {
	return new Promise(function (resolve, reject) {
		var dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jeopardy-test-'));
		var child = spawn(process.execPath, ['app.js'], {
			cwd: root,
			env: Object.assign({}, process.env, {
				PORT: '0',
				OPENAI_ANSWER_JUDGE_ENABLED: 'false',
				GAME_HISTORY_PATH: path.join(dataDir, 'games_played.csv'),
				GAME_HIGH_SCORE_PATH: path.join(dataDir, 'game_high_score.csv'),
			}),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		var stderr = '';
		var timer = setTimeout(function () {
			child.kill('SIGTERM');
			reject(new Error('Server did not start. ' + stderr));
		}, 10000);
		child.stderr.on('data', function (chunk) {
			stderr += chunk.toString();
		});
		child.stdout.on('data', function (chunk) {
			var match = chunk.toString().match(/listening on \*:(\d+)/);
			if (match) {
				clearTimeout(timer);
				resolve({
					child: child,
					baseUrl: 'http://127.0.0.1:' + match[1],
					dataDir: dataDir,
				});
			}
		});
		child.on('exit', function (code) {
			clearTimeout(timer);
			if (code && code !== 0) {
				reject(new Error('Server exited with ' + code + '. ' + stderr));
			}
		});
	});
}

function waitForSocketEvent(socket, event) {
	return new Promise(function (resolve, reject) {
		var timer = setTimeout(function () {
			socket.close();
			reject(new Error('Timed out waiting for ' + event));
		}, 5000);
		socket.once(event, function (payload) {
			clearTimeout(timer);
			resolve(payload);
		});
	});
}

async function connectPlayer(baseUrl, roomCode, name, clientId) {
	var socket = io(baseUrl + '/player', {
		query: { room: roomCode },
		transports: ['websocket'],
	});
	await waitForSocketEvent(socket, 'room configuration');
	var acceptedPromise = waitForSocketEvent(socket, 'player login accepted');
	socket.emit('login name', {
		memberName: name,
		clientId: clientId,
	});
	await acceptedPromise;
	return socket;
}

test('room creation protects host sockets and private files', async function (t) {
	var server = await startServer();
	t.after(function () {
		server.child.kill('SIGTERM');
		fs.rmSync(server.dataDir, { recursive: true, force: true });
	});

	var secretResponse = await fetch(server.baseUrl + '/.env');
	assert.equal(secretResponse.status, 404);
	var dataResponse = await fetch(server.baseUrl + '/data/clues.db');
	assert.equal(dataResponse.status, 404);

	var roomResponse = await fetch(server.baseUrl + '/api/rooms/new?mode=standard', {
		method: 'POST',
	});
	assert.equal(roomResponse.status, 200);
	var room = await roomResponse.json();
	assert.match(room.roomCode, /^[A-Z0-9]{4}$/);
	assert.ok(room.hostToken.length >= 32);

	var unauthorized = io(server.baseUrl + '/game', {
		query: { room: room.roomCode, hostToken: 'wrong' },
		transports: ['websocket'],
	});
	var authError = await waitForSocketEvent(unauthorized, 'host room error');
	assert.match(authError.message, /host key/i);
	unauthorized.close();

	var authorized = io(server.baseUrl + '/game', {
		query: { room: room.roomCode, hostToken: room.hostToken },
		transports: ['websocket'],
	});
	var hostRoom = await waitForSocketEvent(authorized, 'host room code');
	assert.equal(hostRoom.code, room.roomCode);

	var player = await connectPlayer(
		server.baseUrl,
		room.roomCode,
		'TEST PLAYER',
		'integration-test-player'
	);
	player.emit('answer selection', { questionId: 'missing', answer: null });
	player.emit('bet selection', {
		questionId: 'missing',
		betValue: 'not-a-number',
		finalJeopardyCheck: false,
	});
	await new Promise(function (resolve) {
		setTimeout(resolve, 50);
	});
	var healthResponse = await fetch(server.baseUrl + '/');
	assert.equal(healthResponse.status, 200);

	var player2 = await connectPlayer(
		server.baseUrl,
		room.roomCode,
		'TEST PLAYER 2',
		'integration-test-player-2'
	);
	var boardReady = new Promise(function (resolve, reject) {
		var questionIds = new Set();
		var timer = setTimeout(function () {
			reject(new Error('Timed out waiting for a complete 61-clue board.'));
		}, 30000);
		authorized.on('game data', function (data) {
			questionIds.add(data.questionID);
			if (questionIds.size === 61) {
				clearTimeout(timer);
				resolve(questionIds);
			}
		});
		authorized.on('host game load status', function (status) {
			if (status && status.phase === 'error') {
				clearTimeout(timer);
				reject(new Error(status.message || 'Board load failed.'));
			}
		});
	});
	var player3 = await connectPlayer(
		server.baseUrl,
		room.roomCode,
		'TEST PLAYER 3',
		'integration-test-player-3'
	);
	player.emit('option select new', ['15', '80s', 'any']);
	player2.emit('option select new', ['15', '80s', 'any']);
	player3.emit('option select new', ['15', '80s', 'any']);
	var questionIds = await boardReady;
	assert.equal(questionIds.size, 61);

	player.close();
	player2.close();
	player3.close();
	authorized.close();
});
