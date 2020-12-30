const network = Object.freeze(
    {
        "send0": 0,
        "player_connect": 1,
        "player_joined": 2,
        "player_disconnect": 3,
        "state": 4,
        "move": 5,
        "game_start": 6
    });

const states = Object.freeze(
    {
        "idle": 0,
        "offering": 1,
        "playing": 2,
        "spectating": 3,
    });

//npm
const net = require("net");
const http = require("http");
const buf = Buffer.alloc(512);

var port = 34579;
var server = net.createServer();
var ids = 0;

var socketToPlayer = new Map();
var socketList = [];
var games = {};

server.on("connection", function (socket)//player connects
{
    console.log("New player");
    socket.id = ids;
    var _len = socketList.length;
    socketToPlayer[ids] = {
        "cid": ids,
        "hpState": 0,
        "cx": 0,
        "cy": 0,
        "state": 0,
        "name": 0,
        //server stuff
        "socketPos": _len,
        "game": -1
    }

    buf.fill(0); //reset buffer
    buf.writeUInt8(network.player_connect, 0); //write "connect" command
    buf.writeUInt8(ids, 1); //write "connect" command
    socket.write(buf); //send buffer to player    

    for (var i = 0; i < socketList.length; i++) { //send existing players
        sendPlayerObject(socketToPlayer[socketList[i].id], socket)
    }

    socketList.push(socket);
    ids = (ids + 1) % 256;

    socket.on("data", function (data) { //recieving data
        switch (data.readUInt8(0)) {
            case network.send0:
                console.log("Recieved '0'");
                break;
            case network.player_connect:
                var playerName = data.toString("utf-8", 1);
                socketToPlayer[socket.id].name = playerName;

                for (var i = 0; i < socketList.length; i++) {
                    if (socketList[i].id != socket.id) {
                        sendPlayerObject(socketToPlayer[socket.id], socketList[i]);
                    }
                }
                console.log("PlayerName: " + playerName);
                break;
            case network.state:
                var _state = data.readInt8(1);
                switch (_state) {
                    case states.offering:
                        var _otherPlayer = data.readInt8(2);
                        var _playerInd = -1;
                        for (var i = 0; i < socketList.length; i++) {
                            if (socketList[i].id == _otherPlayer && socketToPlayer[_otherPlayer].state != states.playing) {
                                _playerInd = i;
                                break
                            }
                        }
                        if (_playerInd == -1) break;

                        buf.fill(0);
                        buf.writeUInt8(network.state, 0);
                        buf.writeUInt8(states.offering, 1);
                        buf.writeUInt8(socket.id, 2);
                        socketList[_playerInd].write(buf);

                        break;
                    default: break;
                }
                break;
            case network.game_start:
                var _players = [];
                _players[0] = data.readUInt8(1);
                _players[1] = socket.id;
                socketToPlayer[_players[0]].state = states.playing;
                socketToPlayer[_players[0]].game = _players[0] + ":" + _players[1];
                socketToPlayer[_players[1]].state = states.playing;
                socketToPlayer[_players[1]].game = _players[0] + ":" + _players[1];
                console.log("Game starting: " + _players[0] + ":" + _players[1]);
                games[_players[0] + ":" + _players[1]] =
                {
                    "p1": _players[0],
                    "p2": _players[1],
                    "spectators": []
                };

                for (var i = 0; i < socketList.length; i++) {
                    if (socketList[i].id != _players[0] && socketList[i].id != _players[1]) {
                        buf.fill(0);
                        buf.writeUInt8(network.state, 0);
                        buf.writeUInt8(states.playing, 1);
                        buf.writeUInt8(_players[0], 2);
                        buf.writeUInt8(_players[1], 3);
                        socketList[i].write(buf);
                    }
                }
                for (var i = 0; i < 2; i++) {
                    buf.fill(0);
                    buf.writeUInt8(network.game_start, 0);
                    buf.writeUInt8(_players[1 - i], 1);
                    buf.writeUInt8(i, 2);
                    socketList[socketToPlayer[_players[i]].socketPos].write(buf);
                }

                break;
                
            case network.move:
                var _x = data.readInt16LE(1);
                var _y = data.readInt16LE(3);
                var _spriteIndex = data.readUInt8(5);
                var _imageIndex = data.readUInt8(6);
                var _imageXs = data.readInt8(7);
                var _state = data.readUInt8(8);
                var _attack = data.readUInt8(9);
                //var _kJump = data.readUInt8(7);
                //var _kAttack = data.readUInt8(8);
                //var _kAttackDone = data.readUInt8(9);
                //var _state = data.readUInt8(10);
                socketToPlayer[socket.id].cx = _x;
                socketToPlayer[socket.id].cy = _y;
                socketToPlayer[socket.id].hpState = _state;

                var _struct = games[socketToPlayer[socket.id].game]; //get game struct
                var _players = [];
                var _playerNum = (socket.id == _struct.p2);
                if (_playerNum) _players.push(_struct.p1);
                else _players.push(_struct.p2);
                for (var i = 0; i < _players.length; i++) {
                    buf.fill(0);
                    buf.writeUInt8(network.move, 0);
                    buf.writeUInt8(_playerNum, 1);
                    buf.writeInt16LE(_x, 2);
                    buf.writeInt16LE(_y, 4);
                    buf.writeUInt8(_spriteIndex, 6);
                    buf.writeUInt8(_imageIndex, 7);
                    buf.writeInt8(_imageXs, 9);
                    buf.writeUInt8(_state, 9);
                    buf.writeUInt8(_attack, 10);
                    //buf.writeUInt8(_kJump, 8);
                    //buf.writeUInt8(_kAttack, 9);
                    //buf.writeUInt8(_kAttackDone, 10);
                    //buf.writeUInt8(_state, 11);
                    socketList[socketToPlayer[_players[i]].socketPos].write(buf);
                }
                break
            default: break;
        }
    });

    socket.on("error", function (data) { //disconnect
        var _ind = socketList.indexOf(socket);
        if (_ind > -1) delete socketList[_ind] //remove from socketList
        socketList = removeEmpty(socketList);

        var _cid = socketToPlayer[socket.id].cid;
        for (var i = 0; i < socketList.length; i++) //send disconnect to other players
        {
            buf.fill(0);
            buf.writeUInt8(network.player_disconnect, 0);
            buf.writeUInt8(_cid, 1);
            socketList[i].write(buf);
        }
        socketToPlayer.delete(socket.id); //remove player object
        console.log("Player disconnected")

        for (var i = 0; i < socketList.length; i++) {
            socketToPlayer[socket.id].socketPos = i;
        }
    });
});
server.listen(port, function () { //activate server
    console.log("The Server has Started");
});

function sendPlayerObject(socketData, toSocket) {
    buf.fill(0);
    buf.writeUInt8(network.player_joined, 0);
    buf.writeUInt8(socketData.cid, 1);
    buf.writeUInt8(socketData.state, 2);
    buf.write(socketData.name, 3);
    toSocket.write(buf);
}

function removeEmpty(_list) {
    return _list.filter(function (el) {
        return el != null;
    });
}