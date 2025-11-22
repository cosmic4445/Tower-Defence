const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store active servers and players
let servers = [];
let connectedPlayers = new Map();

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  // Send current server list to new connection
  socket.emit('serverList', servers);
  
  // Host a new server
  socket.on('hostServer', (serverData) => {
    const newServer = {
      id: Date.now(),
      name: serverData.name,
      difficulty: serverData.difficulty,
      maxPlayers: serverData.maxPlayers,
      hostId: socket.id,
      players: [{
        id: socket.id,
        name: serverData.playerName || 'Player',
        isHost: true
      }],
      isPublic: serverData.isPublic,
      locked: serverData.locked,
      password: serverData.password || null,
      gameStarted: false
    };
    
    servers.push(newServer);
    connectedPlayers.set(socket.id, newServer.id);
    
    socket.join(`server-${newServer.id}`);
    socket.emit('joinedLobby', newServer);
    
    // Broadcast updated server list to all clients
    io.emit('serverList', servers);
    
    console.log(`Server hosted: ${newServer.name} by ${socket.id}`);
  });
  
  // Join an existing server
  socket.on('joinServer', (data) => {
    const server = servers.find(s => s.id === data.serverId);
    
    if (!server) {
      socket.emit('error', 'Server not found');
      return;
    }
    
    if (server.players.length >= server.maxPlayers) {
      socket.emit('error', 'Server is full');
      return;
    }
    
    if (server.locked && data.password !== server.password) {
      socket.emit('error', 'Incorrect password');
      return;
    }
    
    if (server.gameStarted) {
      socket.emit('error', 'Game already started');
      return;
    }
    
    const player = {
      id: socket.id,
      name: data.playerName || 'Player',
      isHost: false
    };
    
    server.players.push(player);
    connectedPlayers.set(socket.id, server.id);
    
    socket.join(`server-${server.id}`);
    socket.emit('joinedLobby', server);
    
    // Notify all players in the lobby
    io.to(`server-${server.id}`).emit('lobbyUpdate', server);
    
    // Update server list for everyone
    io.emit('serverList', servers);
    
    console.log(`${socket.id} joined server: ${server.name}`);
  });
  
  // Leave server/lobby
  socket.on('leaveLobby', () => {
    const serverId = connectedPlayers.get(socket.id);
    if (!serverId) return;
    
    const server = servers.find(s => s.id === serverId);
    if (!server) return;
    
    // If host leaves, close the server
    if (server.hostId === socket.id) {
      io.to(`server-${serverId}`).emit('serverClosed', 'Host left the server');
      servers = servers.filter(s => s.id !== serverId);
      
      // Remove all players from this server
      server.players.forEach(p => {
        connectedPlayers.delete(p.id);
      });
      
      console.log(`Server closed: ${server.name}`);
    } else {
      // Regular player leaves
      server.players = server.players.filter(p => p.id !== socket.id);
      connectedPlayers.delete(socket.id);
      
      io.to(`server-${serverId}`).emit('lobbyUpdate', server);
    }
    
    socket.leave(`server-${serverId}`);
    io.emit('serverList', servers);
  });
  
  // Start game (host only)
  socket.on('startGame', (data) => {
    const serverId = connectedPlayers.get(socket.id);
    if (!serverId) return;
    
    const server = servers.find(s => s.id === serverId);
    if (!server || server.hostId !== socket.id) return;
    
    server.gameStarted = true;
    
    io.to(`server-${serverId}`).emit('gameStarted', {
      difficulty: server.difficulty,
      players: server.players
    });
    
    io.emit('serverList', servers);
    
    console.log(`Game started in server: ${server.name}`);
  });
  
  // Game state sync
  socket.on('gameState', (state) => {
    const serverId = connectedPlayers.get(socket.id);
    if (!serverId) return;
    
    // Broadcast game state to all players in the server
    socket.to(`server-${serverId}`).emit('gameState', state);
  });
  
  // Tower placement sync
  socket.on('towerPlaced', (towerData) => {
    const serverId = connectedPlayers.get(socket.id);
    if (!serverId) return;
    
    socket.to(`server-${serverId}`).emit('towerPlaced', towerData);
  });
  
  // Wave sync
  socket.on('waveStart', () => {
    const serverId = connectedPlayers.get(socket.id);
    if (!serverId) return;
    
    io.to(`server-${serverId}`).emit('waveStart');
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    const serverId = connectedPlayers.get(socket.id);
    if (serverId) {
      const server = servers.find(s => s.id === serverId);
      
      if (server) {
        if (server.hostId === socket.id) {
          // Host disconnected, close server
          io.to(`server-${serverId}`).emit('serverClosed', 'Host disconnected');
          servers = servers.filter(s => s.id !== serverId);
          console.log(`Server closed: ${server.name}`);
        } else {
          // Regular player disconnected
          server.players = server.players.filter(p => p.id !== socket.id);
          io.to(`server-${serverId}`).emit('lobbyUpdate', server);
        }
        
        io.emit('serverList', servers);
      }
      
      connectedPlayers.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Tower Defense Server running on port ${PORT}`);
  console.log(`📡 Players can connect from: http://localhost:${PORT}`);
});