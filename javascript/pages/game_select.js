//WIP

$(document).ready(function() {

	var room_code_validated = false;
	var socket = io('/home');

	$('.player_join_button').click(function(){
		swal({
		  title: "ROOM CODE",
		  text: "Enter Room Code (found on host screen)",
		  type: "input",
		  showCancelButton: true,
		  showLoaderOnConfirm: true,
		  animation: "slide-from-top",
		  closeOnConfirm: false,
		  inputPlaceholder: "RX9G(Example Room Code)"
		},
		function(inputValue){
			socket.emit('room code sent', inputValue);
		  if (inputValue === false) return false;
		  
		  if (inputValue === "") {
		    swal.showInputError("You need to enter a Room Code.");
		    return false
		  }
		});
	});

	socket.on('room code validated', function(roomCodeValidate){
		if(roomCodeValidate){
			swal("Room Code validated.");
		}
		else
		{
			swal.showInputError("Invalid Room Code.");
		}
	});

	socket.on('send to room', function(redirectUrl){
		console.log(redirectUrl);
		window.location.href = redirectUrl;
	});

});