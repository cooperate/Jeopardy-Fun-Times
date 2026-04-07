$(document).ready(function () {
  var socket = io('/home');

  $('.player_join_button').on('click', function () {
    SimpleModal.prompt({
      title: 'Room code',
      text: 'Enter the code shown on the host screen.',
      placeholder: 'e.g. AB12',
      confirmText: 'Join',
      cancelText: 'Cancel',
      validate: function (value) {
        if (!value || !value.trim()) {
          return 'Enter a room code.';
        }
        return null;
      },
    }).then(function (value) {
      if (value != null && value.trim()) {
        socket.emit('room code sent', value.trim());
      }
    });
  });

  socket.on('room code validated', function (roomCodeValidate) {
    if (roomCodeValidate) {
      SimpleModal.alert({
        title: 'Room code accepted',
        text: '',
        type: 'success',
        timer: 2000,
      });
    } else {
      SimpleModal.alert({
        title: 'Invalid room code',
        text: 'Check with the host and try again.',
        type: 'error',
      });
    }
  });

  socket.on('send to room', function (redirectUrl) {
    window.location.href = redirectUrl;
  });
});
