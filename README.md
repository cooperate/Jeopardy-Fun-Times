# Jeopardy-Fun-Times
A Jeopardy Game built using Socket.io and Google's Speech API


To install you must have node and npm.

1) Install dependencies with command "npm install" from root folder of project.

2) Start server with "node app.js"

3) Your "host" screen will be @ local-address:3000/game

4) Three players can join @ local-address:3000/player

5) Enjoy!

Rooms are intentionally tied to one running Node process. Player and host browser
reconnects are restored while that process remains online, but restarting or
redeploying the server expires every room. Use a stable single instance during a
game and create a new room after a restart.

Speech-to-text is optional and browser-dependent. When it is unavailable, players
can always type answers using the same answer field.
