$(document).ready(function () {
  var socket = io('/home');

  $('.player_join_button').on('click', function () {
    Swal.fire({
      title: 'Room code',
      text: 'Enter the code shown on the host screen.',
      input: 'text',
      inputPlaceholder: 'e.g. AB12',
      showCancelButton: true,
      confirmButtonText: 'Join',
      cancelButtonText: 'Cancel',
      inputValidator: function (value) {
        if (!value || !value.trim()) {
          return 'Enter a room code.';
        }
      },
    }).then(function (result) {
      if (result.isConfirmed && result.value) {
        socket.emit('room code sent', result.value.trim());
      }
    });
  });

  socket.on('room code validated', function (roomCodeValidate) {
    if (roomCodeValidate) {
      Swal.fire({
        icon: 'success',
        title: 'Room code accepted',
        timer: 2000,
        showConfirmButton: false,
      });
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Invalid room code',
        text: 'Check with the host and try again.',
      });
    }
  });

  socket.on('send to room', function (redirectUrl) {
    window.location.href = redirectUrl;
  });
});
