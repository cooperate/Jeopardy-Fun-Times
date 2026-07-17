$(document).ready(function () {
	function normalizeCode(s) {
		return String(s || '')
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '');
	}

	$('.host-mode-card').on('click', function () {
		var mode = String($(this).data('mode') || 'standard');
		$('.host-mode-card').prop('disabled', true);
		fetch('/api/rooms/new?mode=' + encodeURIComponent(mode), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		})
			.then(function (res) {
				return res.json();
			})
			.then(function (data) {
				var code = data && data.roomCode;
				var hostToken = data && data.hostToken;
				if (code && hostToken) {
					sessionStorage.setItem('jeopardy.hostToken.' + code, hostToken);
					window.location.href = '/game/' + encodeURIComponent(code);
				} else {
					SimpleModal.alert({
						title: 'Could not create room',
						text: 'Try again in a moment.',
						type: 'error',
					});
				}
			})
			.catch(function () {
				$('.host-mode-card').prop('disabled', false);
				SimpleModal.alert({
					title: 'Could not create room',
					text: 'Check that the server is running.',
					type: 'error',
				});
			});
	});

	$('#host_join_room_btn').on('click', function () {
		SimpleModal.prompt({
			title: 'Room code',
			text: 'Enter the code for an existing game.',
			placeholder: 'e.g. AB12',
			confirmText: 'Open',
			cancelText: 'Cancel',
			validate: function (value) {
				if (!normalizeCode(value)) {
					return 'Enter a room code.';
				}
				return null;
			},
		}).then(function (value) {
			var code = normalizeCode(value);
			if (code) {
				var token = sessionStorage.getItem('jeopardy.hostToken.' + code);
				if (!token) {
					SimpleModal.alert({
						title: 'Host key not found',
						text: 'Open this room in the browser that created it.',
						type: 'error',
					});
					return;
				}
				window.location.href = '/game/' + encodeURIComponent(code);
			}
		});
	});
});
