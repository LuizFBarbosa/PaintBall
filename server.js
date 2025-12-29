const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const THREE = require('three');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

// === CONFIGURAÇÕES DOS NÍVEIS ===
const levelConfigs = {
  1: {
    name: "Praça Central",
    description: "Uma praça aberta com poucos esconderijos",
    spawnPoints: {
      Red: { x: -40, z: 0, y: 1 },
      Blue: { x: 40, z: 0, y: 1 }
    },
    map: [
      "WWWWWWWWWWWWWWWWWWWW",
      "W....................W",
      "W....TT....TT......W",
      "W.....T.....T.....W",
      "W....................W",
      "W.....WWW.WWW.....W",
      "W....................W",
      "W.....WWW.WWW.....W",
      "W....................W",
      "W.....T.....T.....W",
      "W....TT....TT......W",
      "W....................W",
      "WWWWWWWWWWWWWWWWWWWW"
    ]
  },
  2: {
    name: "Floresta Escura",
    description: "Uma floresta densa com muitos esconderijos",
    spawnPoints: {
      Red: { x: -40, z: -40, y: 1 },
      Blue: { x: 40, z: 40, y: 1 }
    },
    map: [
      "WWWWWWWWWWWWWWWWWWWW",
      "W.T.T.T.T.T.T.T.T.W",
      "W..................W",
      "W..T...T...T...T..W",
      "W..................W",
      "W....T.....T....W.W",
      "W..................W",
      "W..T...T...T...T..W",
      "W..................W",
      "W.T.T.T.T.T.T.T.T.W",
      "W..................W",
      "W..T...T...T...T..W",
      "WWWWWWWWWWWWWWWWWWWW"
    ]
  },
  3: {
    name: "Complexo Industrial",
    description: "Um complexo com muitas paredes e corredores",
    spawnPoints: {
      Red: { x: -45, z: 0, y: 1 },
      Blue: { x: 45, z: 0, y: 1 }
    },
    map: [
      "WWWWWWWWWWWWWWWWWWWW",
      "W.WWWWW.WWWWWW.WWW.W",
      "W..................W",
      "W.WW....WW....WW.W.W",
      "W..................W",
      "W.WW.WWWWWWWW.WW.W.W",
      "W..................W",
      "W.WW..........WW.W.W",
      "W..................W",
      "W.WW.WWWWWWWW.WW.W.W",
      "W..................W",
      "W.WWWWW.WWWWWW.WWW.W",
      "WWWWWWWWWWWWWWWWWWWW"
    ]
  }
};

// === ESTADO GLOBAL ===
let gameState = {
  players: {},
  teams: { Red: [], Blue: [] },
  obstacles: [],
  gameActive: true,
  score: { Red: 0, Blue: 0 },
  wave: 1,
  zombieKills: { Red: 0, Blue: 0 },
  totalZombieKills: 0,
  currentLevel: 1
};

// === POWER-UPS ===
let powerUps = [
  { id: 'speed1', type: 'speed', x: -20, z: 10, active: true, duration: 5000 },
  { id: 'ammo1', type: 'ammo', x: 20, z: -10, active: true },
  { id: 'health1', type: 'health', x: 0, z: 30, active: true },
  { id: 'shield1', type: 'shield', x: -10, z: -20, active: true, duration: 8000 },
  { id: 'damage1', type: 'damage', x: 15, z: 15, active: true, duration: 7000 }
];

// === ZUMBIES ===
const MAX_ZOMBIES = 5;
let zombies = [];

function createZombie(id, x, z) {
  const types = ['normal', 'fast', 'tank'];
  const type = types[Math.floor(Math.random() * types.length)];
  let health = 2;
  let speed = 0.04;
  let color = 0x00ff00;
  switch(type) {
    case 'fast':
      health = 1;
      speed = 0.08;
      color = 0xffff00;
      break;
    case 'tank':
      health = 4;
      speed = 0.02;
      color = 0xff0000;
      break;
  }
  return { id, x, y: 1, z, health, maxHealth: health, speed, type, color, isDead: false, respawnTime: 0 };
}

function initZombies() {
  zombies = [];
  for (let i = 0; i < MAX_ZOMBIES; i++) {
    let x, z;
    do {
      x = (Math.random() - 0.5) * 160;
      z = (Math.random() - 0.5) * 160;
    } while (isInObstacle(x, z));
    zombies.push(createZombie(`z${i}`, x, z));
  }
}
initZombies();

// === FUNÇÕES DO NÍVEL ===
function processMap(mapData) {
  const obstacles = [];
  const rows = mapData.length;
  const cols = mapData[0].length;
  const CELL_SIZE = 10;
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = mapData[row][col];
      const x = col * CELL_SIZE - (cols * CELL_SIZE) / 2;
      const z = row * CELL_SIZE - (rows * CELL_SIZE) / 2;
      
      if (cell === 'T') {
        obstacles.push({ x, z, radius: 1.5, height: 8, type: 'tree' });
      } else if (cell === 'W') {
        obstacles.push({ x, z, radius: 2.5, height: 4, type: 'wall' });
      }
    }
  }
  
  return obstacles;
}

function initLevel() {
  const levelConfig = levelConfigs[gameState.currentLevel];
  if (levelConfig) {
    gameState.obstacles = processMap(levelConfig.map);
    console.log(`✅ Nível ${gameState.currentLevel} (${levelConfig.name}) carregado com ${gameState.obstacles.length} obstáculos`);
  }
}
initLevel();

// === SPAWN ===
function getSpawnPosition(team, level = gameState.currentLevel) {
  const levelConfig = levelConfigs[level];
  if (levelConfig && levelConfig.spawnPoints && levelConfig.spawnPoints[team]) {
    return levelConfig.spawnPoints[team];
  }
  
  // Fallback para spawn padrão
  return team === 'Red' ? { x: -10, z: 0, y: 1 } : { x: 10, z: 0, y: 1 };
}

// === VITÓRIA ===
function checkWinCondition() {
  const aliveTeams = Object.keys(gameState.teams)
    .filter(t => gameState.teams[t].some(id => !gameState.players[id]?.isEliminated));
  if (aliveTeams.length === 1 && gameState.gameActive) {
    gameState.gameActive = false;
    const winner = aliveTeams[0];
    io.emit('gameOver', { winningTeam: winner });
    setTimeout(resetGame, 5000);
  }
}

function resetGame() {
  Object.values(gameState.players).forEach(p => {
    p.isEliminated = false;
    const spawn = getSpawnPosition(p.team);
    p.position = { ...spawn };
    p.rotation = { x: 0, y: p.team === 'Red' ? Math.PI/2 : -Math.PI/2, z: 0 };
  });
  gameState.gameActive = true;
  gameState.wave = 1;
  gameState.zombieKills = { Red: 0, Blue: 0 };
  gameState.totalZombieKills = 0;
  initZombies();
  io.emit('gameReset');
}

// === VERIFICAR SE POSIÇÃO ESTÁ EM OBSTÁCULO ===
function isInObstacle(x, z) {
  for (const obs of gameState.obstacles) {
    const dx = x - obs.x;
    const dz = z - obs.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < obs.radius + 1.0) return true;
  }
  return false;
}

// === VERIFICAR ONDA DE ZUMBIS ===
function checkWaveProgress() {
  const killsNeededForWave = gameState.wave * 10;
  if (gameState.totalZombieKills >= killsNeededForWave) {
    gameState.wave++;
    io.emit('newWave', { wave: gameState.wave });
    zombies.forEach(zombie => {
      zombie.speed *= 1.1;
      zombie.maxHealth += 1;
      zombie.health = zombie.maxHealth;
    });
  }
}

// Função para gerar posição aleatória para power-ups
function getRandomPowerUpPosition() {
  let x, z;
  do {
    x = (Math.random() - 0.5) * 160;
    z = (Math.random() - 0.5) * 160;
  } while (isInObstacle(x, z));
  return { x, z };
}

// === CONEXÃO SOCKET ===
io.on('connection', (socket) => {
  console.log(`🟢 ${socket.id} conectado`);

  socket.on('newPlayer', ({ name, team, level, requestTeamSpawn }) => {
    // Usar o nível solicitado ou o atual
    const selectedLevel = level || gameState.currentLevel;
    
    // Se solicitado spawn por equipe, usar ponto de spawn específico
    let spawnPosition;
    if (requestTeamSpawn && levelConfigs[selectedLevel]) {
      spawnPosition = levelConfigs[selectedLevel].spawnPoints[team];
    } else {
      spawnPosition = getSpawnPosition(team, selectedLevel);
    }
    
    const player = {
      id: socket.id,
      name, team,
      position: spawnPosition,
      rotation: { x: 0, y: team === 'Red' ? Math.PI/2 : -Math.PI/2, z: 0 },
      isEliminated: false,
      powerUps: { speed: false, shield: false, damage: false }
    };
    
    gameState.players[socket.id] = player;
    gameState.teams[team].push(socket.id);
    
    // Enviar estado completo do jogo incluindo nível atual
    socket.emit('gameState', {
      players: gameState.players,
      obstacles: gameState.obstacles,
      powerUps,
      zombies,
      playerId: socket.id,
      score: gameState.score,
      wave: gameState.wave,
      level: selectedLevel,
      totalZombieKills: gameState.totalZombieKills
    });
    
    socket.broadcast.emit('playerJoined', player);
  });

  socket.on('playerMove', (data) => {
    const p = gameState.players[socket.id];
    if (p && !p.isEliminated) {
      p.position = data.position;
      p.rotation = data.rotation;
      socket.broadcast.emit('playerMoved', { id: socket.id, ...data });
      checkPowerUpCollection(socket.id, data.position);
    }
  });

  socket.on('playerShoot', (data) => {
    const shooter = gameState.players[socket.id];
    if (!shooter || shooter.isEliminated || !gameState.gameActive) return;

    const origin = new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z);
    const direction = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z).normalize();
    const damageMultiplier = shooter.powerUps.damage ? 2 : 1;

    for (let d = 1; d < 50; d += 0.5) {
      const point = origin.clone().add(direction.clone().multiplyScalar(d));

      for (const obs of gameState.obstacles) {
        const dx = point.x - obs.x;
        const dz = point.z - obs.z;
        if (Math.sqrt(dx*dx + dz*dz) < obs.radius) return;
      }

      for (const [id, target] of Object.entries(gameState.players)) {
        if (id === socket.id || target.isEliminated) continue;
        if (target.powerUps.shield) {
          target.powerUps.shield = false;
          io.emit('shieldBroken', { playerId: id });
          return;
        }
        const dist = new THREE.Vector3(target.position.x, target.position.y, target.position.z).distanceTo(point);
        if (dist < 1.5) {
          target.isEliminated = true;
          io.emit('playerHit', { hitPlayerId: id, shooterId: socket.id, hitPosition: target.position });
          checkWinCondition();
          return;
        }
      }

      for (const zombie of zombies) {
        if (zombie.isDead) continue;
        const pos = new THREE.Vector3(zombie.x, zombie.y, zombie.z);
        if (point.distanceTo(pos) < 1.2) {
          zombie.health -= damageMultiplier;
          if (zombie.health <= 0) {
            zombie.isDead = true;
            zombie.respawnTime = Date.now() + 3000;
            gameState.score[shooter.team] += 10;
            gameState.zombieKills[shooter.team]++;
            gameState.totalZombieKills++;
            io.emit('zombieKilled', { 
              id: zombie.id, 
              position: pos, 
              score: gameState.score,
              teamKills: gameState.zombieKills,
              totalKills: gameState.totalZombieKills
            });
            checkWaveProgress();
          } else {
            io.emit('zombieHit', { id: zombie.id, health: zombie.health, maxHealth: zombie.maxHealth });
          }
          return;
        }
      }
    }
  });

  socket.on('collectPowerUp', (data) => {
    const pu = powerUps.find(p => p.id === data.powerUpId);
    const player = gameState.players[socket.id];
    if (pu && pu.active && player) {
      pu.active = false;
      switch(pu.type) {
        case 'speed':
          player.powerUps.speed = true;
          setTimeout(() => {
            player.powerUps.speed = false;
            io.emit('powerUpExpired', { playerId: socket.id, type: 'speed' });
          }, pu.duration);
          break;
        case 'shield':
          player.powerUps.shield = true;
          setTimeout(() => {
            player.powerUps.shield = false;
            io.emit('powerUpExpired', { playerId: socket.id, type: 'shield' });
          }, pu.duration);
          break;
        case 'damage':
          player.powerUps.damage = true;
          setTimeout(() => {
            player.powerUps.damage = false;
            io.emit('powerUpExpired', { playerId: socket.id, type: 'damage' });
          }, pu.duration);
          break;
        case 'ammo':
          io.emit('ammoRefill', { playerId: socket.id });
          break;
        case 'health':
          if (player.isEliminated) {
            player.isEliminated = false;
            const spawn = getSpawnPosition(player.team);
            player.position = { ...spawn };
            io.emit('playerRevived', { playerId: socket.id, position: player.position });
          }
          break;
      }
      io.emit('powerUpCollected', { powerUpId: pu.id, playerId: socket.id, type: pu.type });
      setTimeout(() => {
        const newPos = getRandomPowerUpPosition();
        pu.x = newPos.x;
        pu.z = newPos.z;
        pu.active = true;
        io.emit('powerUpSpawned', pu);
      }, 15000);
    }
  });

  socket.on('chatMessage', (data) => {
    const player = gameState.players[socket.id];
    if (player) {
      const msg = { name: player.name, message: data.message, team: player.team };
      gameState.teams[player.team].forEach(id => io.to(id).emit('chatMessage', msg));
    }
  });

  socket.on('disconnect', () => {
    const p = gameState.players[socket.id];
    if (p) {
      gameState.teams[p.team] = gameState.teams[p.team].filter(id => id !== socket.id);
      delete gameState.players[socket.id];
      socket.broadcast.emit('playerLeft', socket.id);
    }
  });
  
  // NOVO: Evento para mudança de nível
  socket.on('changeLevel', (data) => {
    gameState.currentLevel = data.level;
    const levelConfig = levelConfigs[gameState.currentLevel];
    
    if (levelConfig) {
      gameState.obstacles = processMap(levelConfig.map);
      
      // Reposicionar jogadores nos novos pontos de spawn
      Object.values(gameState.players).forEach(player => {
        const newSpawn = levelConfig.spawnPoints[player.team];
        player.position = { ...newSpawn };
      });
      
      // Notificar todos os jogadores sobre a mudança de nível
      io.emit('levelChanged', { 
        level: gameState.currentLevel,
        obstacles: gameState.obstacles
      });
    }
  });
});

function checkPowerUpCollection(playerId, playerPosition) {
  const player = gameState.players[playerId];
  if (!player) return;
  powerUps.forEach(powerUp => {
    if (!powerUp.active) return;
    const dx = playerPosition.x - powerUp.x;
    const dz = playerPosition.z - powerUp.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < 2.5) {
      io.emit('collectPowerUp', { powerUpId: powerUp.id });
    }
  });
}

// === SINCRONIZAÇÃO CONTÍNUA (a cada 100ms) ===
setInterval(() => {
  zombies.forEach(zombie => {
    if (zombie.isDead) {
      if (Date.now() > zombie.respawnTime) {
        let newX, newZ;
        do {
          newX = (Math.random() - 0.5) * 160;
          newZ = (Math.random() - 0.5) * 160;
        } while (isInObstacle(newX, newZ));
        const healthIncrease = Math.floor(gameState.wave / 2);
        zombie.health = zombie.maxHealth + healthIncrease;
        zombie.maxHealth = zombie.health;
        zombie.x = newX;
        zombie.z = newZ;
        zombie.isDead = false;
        io.emit('zombieSpawned', zombie);
      }
      return;
    }
    const closestPlayer = Object.values(gameState.players)
      .find(p => !p.isEliminated);
    if (closestPlayer) {
      const dx = closestPlayer.position.x - zombie.x;
      const dz = closestPlayer.position.z - zombie.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist > 0.5) {
        const speedMultiplier = 1 + (gameState.wave * 0.05);
        const adjustedSpeed = zombie.speed * speedMultiplier;
        zombie.x += (dx / dist) * adjustedSpeed;
        zombie.z += (dz / dist) * adjustedSpeed;
      }
      if (dist < 1.0 && Math.random() < 0.01) {
        if (!closestPlayer.powerUps.shield) {
          io.emit('playerDamaged', { playerId: closestPlayer.id, by: 'zombie' });
        } else {
          closestPlayer.powerUps.shield = false;
          io.emit('shieldBroken', { playerId: closestPlayer.id });
        }
      }
    }
  });

  const zombiesData = zombies.map(zombie => {
    if (zombie.isDead) return { id: zombie.id, isDead: true };
    const closestPlayer = Object.values(gameState.players)
      .find(p => !p.isEliminated);
    let rotationY = 0;
    if (closestPlayer) {
      rotationY = Math.atan2(
        closestPlayer.position.x - zombie.x,
        closestPlayer.position.z - zombie.z
      );
    }
    return {
      id: zombie.id,
      x: zombie.x,
      y: zombie.y,
      z: zombie.z,
      health: zombie.health,
      maxHealth: zombie.maxHealth,
      rotationY,
      type: zombie.type,
      color: zombie.color,
      isDead: zombie.isDead
    };
  });

  const playersData = {};
  Object.keys(gameState.players).forEach(id => {
    const p = gameState.players[id];
    playersData[id] = {
      position: p.position,
      rotation: p.rotation,
      name: p.name,
      team: p.team,
      isEliminated: p.isEliminated,
      powerUps: p.powerUps
    };
  });

  io.emit('playersUpdate', playersData);
  io.emit('zombiesUpdate', zombiesData);
  io.emit('gameStatsUpdate', {
    score: gameState.score,
    wave: gameState.wave,
    zombieKills: gameState.zombieKills,
    totalZombieKills: gameState.totalZombieKills,
    killsNeededForNextWave: gameState.wave * 10
  });
}, 100);

// === SERVIDOR ===
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🎮 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📱 Para acessar pelo celular, conecte na mesma rede WiFi e use: http://SEU_IP_LOCAL:${PORT}`);
  console.log(`🗺️ Níveis disponíveis: ${Object.keys(levelConfigs).length}`);
  console.log(`🎯 Nível atual: ${gameState.currentLevel} - ${levelConfigs[gameState.currentLevel].name}`);
});