# Jeopardy-Fun-Times
A Jeopardy Game built using Socket.io and Google's Speech API


To install you must have node and npm.

1) Install dependencies with command "npm install" from root folder of project.

2) Start server with "node app.js"

3) Your "host" screen will be @ <local address>:3000/game

4) Three players can join @ <local address>:3000/player

5) Enjoy!

This is very much a work in progress.  There is no error handling for disconnects to properly reload player states if someone exits their
window mid-game.  I have attempted to cover all bases where Google Speech API fails.  It is now deprecated and for whatever reason
sometimes it will fail, the game should recover, just give it a few seconds.
