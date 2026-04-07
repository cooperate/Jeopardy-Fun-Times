$(document).ready(function () {
	function normalizeCode(s) {
		return String(s || '')
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '');
	}

	$('#host_new_room_btn').on('click', function () {
		fetch('/api/rooms/new')
			.then(function (res) {
				return res.json();
			})
			.then(function (data) {
				var code = data && data.roomCode;
				if (code) {
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
				window.location.href = '/game/' + encodeURIComponent(code);
			}
		});
	});
});
