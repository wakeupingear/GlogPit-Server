const network = Object.freeze(
    {
        "send0": 0,
        "player_connect": 1,
        "player_disconnect": 2,
        "state": 3,
        "move": 4,
        "game_start": 5
    });

const states = Object.freeze(
    {
        "idle": 0,
        "offering": 1,
        "playing": 2,
        "spectating": 3,
        "rematchOffering": 4
    });

//npm
const net = require("net");
const buf = Buffer.alloc(4096);

let port = 34579;
let server = net.createServer();
let ids = 0;

let socketToPlayer = {};
let socketToID = {};
let games = {};

server.on("connection", function (socket)//player connects
{
    console.log("New player");
    socket.id = ids; //set this player's id
    socketToID[socket.id] = socket; //add an entry mapping id to socket (bad name I know)
    buf.fill(0)
    buf.writeUInt8(network.player_connect, 0); //send a connect packet with this id
    buf.writeUInt8(ids, 1);
    buf.write(JSON.stringify(socketToPlayer),2);
    socket.write(buf);
    ids = (ids + 1) % 256; //iterate ids (1 byte constraint)

    socket.on("data", function (data) { //recieving data
        switch (data.readUInt8(0)) {
            case network.send0: //debug
                console.log("Recieved '0'");
                break;

            case network.player_connect: //player confirms connection
                let _structConnect = readBufString(data, 1); //recieve player struct
                socketToPlayer[socket.id] = _structConnect;
                console.log(socketToPlayer);

                updateState(socket); //send struct to other clients
                console.log("PlayerName: " + _structConnect.name);
                break;

            case network.move:
                let _x = data.readInt16LE(1); //get data
                let _y = data.readInt16LE(3);
                let _spriteIndex = data.readUInt8(5);
                let _imageIndex = data.readUInt8(6);
                let _imageXs = data.readInt8(7);
                let _state = data.readUInt8(8);
                let _attack = data.readUInt8(9);

                let _struct = games[socketToPlayer[socket.id].game]; //get game struct
                let _players = _struct.spectators; //get spectators
                let _playerNum = (socket.id == _struct.p2); //figure out which player this one isn't
                if (_playerNum) _players.push(_struct.p1);
                else _players.push(_struct.p2);
                for (let i = 0; i < _players.length; i++) { //loop through spectators and players to send movement
                    buf.fill(0);
                    buf.writeUInt8(network.move, 0);
                    buf.writeUInt8(_playerNum, 1); //player 1 or 2
                    buf.writeInt16LE(_x, 2);
                    buf.writeInt16LE(_y, 4);
                    buf.writeUInt8(_spriteIndex, 6);
                    buf.writeUInt8(_imageIndex, 7);
                    buf.writeInt8(_imageXs, 8);
                    buf.writeUInt8(_state, 9);
                    buf.writeUInt8(_attack, 10);
                    socketToID[_players[i]].write(buf);
                }
                break;

            case network.state: //updated state
                const oldStruct = socketToPlayer[socket.id]; //save copy of previous struct
                let newStruct = JSON.parse(readBufString(data.read(1))); //read new struct
                switch (newStruct.clientState) {
                    case states.offering: //game offers
                    case states.rematchOffering:
                        const other = socketToPlayer[newStruct.clicked]; //get the one that you are offering to
                        if (other.clientState == newStruct.clientState && other.clicked == socket.id) { //both are offering to each other
                            const gameTitle = getGameTitle(socket.id, newStruct.clicked); //calculate title of game
                            console.log("Game starting: " + gameTitle);
                            if (games[gameTitle] == undefined) { //brand new game
                                games[gameTitle] = {
                                    "p1": newStruct.clicked,
                                    "p2": socket.id,
                                    "p1Score": 0,
                                    "p2Score": 0,
                                    "spectators": []
                                }
                            }
                            else { //game already exists
                                if (oldStruct.wins < newStruct.wins) { //this player won the last game
                                    if (games[gameTitle].p1 == socket.id) games[gameTitle].p1Score++;
                                    else games[gameTitle].p2Score++;
                                }
                                else { //the other player won the last game
                                    if (games[gameTitle].p1 == newStruct.clicked) games[gameTitle].p1Score++;
                                    else games[gameTitle].p2Score++;
                                }
                            }
                            const _players = [games[gameTitle].p1, games[gameTitle].p2].concat(games[gameTitle].spectators); //combine spectators and players
                            for (let i = 0; i < _players.length; i++) { //send game_start to everyone involved
                                buf.fill(0);
                                buf.writeUInt8(network.game_start, 0);
                                buf.writeUInt8(_players[Math.max(1 - i,0)], 1);
                                buf.writeUInt8(i, 2);
                                buf.writeUInt8(games[gameTitle].p1Score, 3);
                                buf.writeUInt8(games[gameTitle].p2Score, 4);
                                buf.writeUInt8(_players[1], 5);
                                socketToID[_players[i]].write(buf);
                            }
                        }
                        break;
                    case states.spectating: //watch a game
                        Object.entries(games).forEach(game => {
                            if (game.indexOf("'" + newStruct.clicked + "'") > -1||game.spectators.includes(newStruct.clicked)) { //determine the right game
                                games[game].spectators.push(socket.id);
                                buf.fill(0);
                                buf.writeUInt8(network.game_start, 0); //send game_start to this player
                                buf.writeUInt8(2, 1); //
                                buf.writeUInt8(1 + spectators.length, 2); //position in spectator queue
                                buf.writeUInt8(games[game].p1Score, 3);
                                buf.writeUInt8(games[game].p2Score, 4);

                                //add code to send this spectator to the players
                            }
                        });
                        break;
                    case states.idle: //return to game select screen
                        Object.entries(games).forEach(game => {
                            if (game.indexOf("'" + socket.id + "'") > -1) { //remove game if you were playing in one
                                delete games[game]; 
                                //add code to close game for spectators/other player
                            }
                            else if (game.spectators.includes(socket.id)) { //remove from spectator list
                                game.spectators.splice(game.spectators.indexOf(socket.id), 1);
                            }
                        });
                        break;
                    default: break;
                }
                socketToPlayer[socket.id] = newStruct; //set the struct to the new one
                console.log(socketToPlayer);
                updateState(socket); //send updated struct to other players
                break;

            default: break;
        }
    });

    socket.on("error", function (data) { //disconnect
        delete socketToPlayer[socket.id];
        delete socketToID[socket.id];

        socektToID.forEach(sock => { //send disconnect to other players
            buf.fill(0);
            buf.writeUInt8(network.player_disconnect, 0);
            buf.writeUInt8(socket.id, 1);
            sock.write(buf);
        });
        console.log("Player disconnected")
    });
});
server.listen(port, function () { //activate server
    console.log("The Server has Started");
});

function sendPlayerObject(socketData, toSocket) { //send socketData's struct to toStruct
    buf.fill(0);
    buf.writeUInt8(network.state, 0);
    buf.writeUInt8(socketData, 1);
    buf.write(JSON.stringify(socketToPlayer[socketData]), 2);
    toSocket.write(buf);
}

function updateState(socketData) { //send socketData's struct to all other players
    Object.keys(socketToPlayer).forEach(sock => {
        if (sock.id != socketData) sendPlayerObject(socketData, sock);
    });
}

function getGameTitle(sock1, sock2) { //compute game title - lower number id first
    if (socket.id > newStruct.clicked) return "'" + socket.id + "'V'" + newStruct.clicked + "'";
    return "'" + newStruct.clicked + "'V'" + socket.id + "'"; //apostrophe allows for an id to be searched for when removing a player from a game
}

function readBufString(str, ind) { //remove gamemaker packet headers from strings
    return str.toString("utf-8", ind).replace(/\0/g, '').replace("\u0005", "");
}