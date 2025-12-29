// script.js - 
// Variáveis globais
let scene, camera, renderer;
let controls;
let socket;
let playerId;
let playerTeam;
let players = {};
let zombies = [];
let obstacles = [];
let powerUps = [];
let raycaster, mouse;
let crosshair;
let ammoCount = 30;
let isReloading = false;
let minimapContext;
let lastShootTime = 0;
let shootCooldown = 200; // ms entre tiros
let lastStepTime = 0;

// Controles de movimento
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;
let prevTime = performance.now();
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();

// Sistema de áudio
let audioListener;
let audioLoader;
let sounds = {
  shoot: null,
  reload: null,
  hit: null,
  zombieHit: null,
  zombieDeath: null,
  powerUp: null,
  step: null,
  zombieGroan: null,
  playerHurt: null
};

// Efeito de corrida
let isRunning = false;
let bobbingAmount = 0.03;
let bobbingSpeed = 0.08;
let timer = 0;
let originalCameraY = 0;

// Variáveis para penalidade de respawn
let respawnTime = 0;
let weaponPenaltyTime = 0;
let isWeaponPenalized = false;

// Sistema de cooldown para colisão com zumbis
let lastZombieHitTime = 0;
let zombieHitCooldown = 2000; // 2 segundos entre danos de zumbis

// Texturas
let groundTexture, brickTexture, woodTexture;

// Inicialização do jogo
function init() {
  // Configuração da cena
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x87CEEB, 10, 200);
  scene.background = new THREE.Color(0x87CEEB);

  // Carregar texturas com fallback
  const textureLoader = new THREE.TextureLoader();

  // Textura do terreno com fallback
  groundTexture = textureLoader.load(
    '/textures/ground.jpg',
    undefined,
    undefined,
    () => {
      // Fallback caso a textura não carregue
      groundTexture = null;
    }
  );
  if (groundTexture) {
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(100, 100);
    groundTexture.anisotropy = 16;
  }

  // Textura dos tijolos com fallback
  brickTexture = textureLoader.load(
    '/textures/brick.jpg',
    undefined,
    undefined,
    () => {
      brickTexture = null;
    }
  );
  if (brickTexture) {
    brickTexture.wrapS = brickTexture.wrapT = THREE.RepeatWrapping;
    brickTexture.repeat.set(2, 2);
    brickTexture.anisotropy = 8;
  }

  // Textura da madeira com fallback
  woodTexture = textureLoader.load(
    '/textures/wood.jpg',
    undefined,
    undefined,
    () => {
      woodTexture = null;
    }
  );
  if (woodTexture) {
    woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
    woodTexture.anisotropy = 8;
  }

  // Configuração da câmera - Altura correta para jogador em primeira pessoa
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.6, 0); // Altura de um jogador em pé (1.6m)
  originalCameraY = camera.position.y;

  // Configuração do renderizador
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game-container').appendChild(renderer.domElement);

  // Configuração dos controles com limites de rotação
  controls = new THREE.PointerLockControls(camera, document.body);
  
  // Limitar a rotação vertical da câmera para evitar inversão
  const originalOnMouseMove = controls.onMouseMove;
  controls.onMouseMove = function(event) {
    originalOnMouseMove.call(this, event);
    
    // Limitar a rotação vertical para evitar inversão
    if (controls.getObject().rotation.x > Math.PI / 3) {
      controls.getObject().rotation.x = Math.PI / 3;
    } else if (controls.getObject().rotation.x < -Math.PI / 3) {
      controls.getObject().rotation.x = -Math.PI / 3;
    }
  };
  
  scene.add(controls.getObject());

  // Configuração do sistema de áudio
  setupAudio();

  // Configuração do raycaster para detecção de colisões
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Adicionar iluminação
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(50, 100, 50);
  directionalLight.castShadow = true;
  directionalLight.shadow.camera.left = -100;
  directionalLight.shadow.camera.right = 100;
  directionalLight.shadow.camera.top = 100;
  directionalLight.shadow.camera.bottom = -100;
  scene.add(directionalLight);

  // Criar o terreno com textura ou cor sólida como fallback
  const terrainGeometry = new THREE.PlaneGeometry(200, 200);
  const terrainMaterial = groundTexture 
    ? new THREE.MeshLambertMaterial({ map: groundTexture })
    : new THREE.MeshLambertMaterial({ color: 0x7CFC00 }); // Verde como fallback
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Configurar eventos
  setupEventListeners();

  // Configurar o minimapa
  setupMinimap();

  // Configurar o socket
  setupSocket();

  // Iniciar o loop de animação
  animate();
}

function setupAudio() {
  audioListener = new THREE.AudioListener();
  camera.add(audioListener);
  audioLoader = new THREE.AudioLoader();
  
  // Carregar arquivos de som da pasta correta
  loadSound('shoot', '/sounds/shoot.mp3');
  loadSound('hit', '/sounds/hit.mp3');
  loadSound('step', '/sounds/step_grass.mp3');
  loadSound('zombieGroan', '/sounds/zombie_groan.mp3');
  
  // Criar sons sintéticos para os que não têm arquivo
  createSyntheticSounds();
}

function loadSound(name, path) {
  sounds[name] = new THREE.Audio(audioListener);
  audioLoader.load(path, function(buffer) {
    sounds[name].setBuffer(buffer);
    sounds[name].setLoop(false);
    sounds[name].setVolume(0.5);
  });
}

function createSyntheticSound(name) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  switch(name) {
    case 'reload':
      sounds.reload = {
        play: () => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain).connect(audioContext.destination);
          osc.frequency.setValueAtTime(800, audioContext.currentTime);
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.2, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
          osc.start();
          osc.stop(audioContext.currentTime + 0.3);
        }
      };
      break;
    case 'zombieHit':
      sounds.zombieHit = {
        play: () => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain).connect(audioContext.destination);
          osc.frequency.setValueAtTime(100, audioContext.currentTime);
          osc.type = 'square';
          gain.gain.setValueAtTime(0.3, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
          osc.start();
          osc.stop(audioContext.currentTime + 0.15);
        }
      };
      break;
    case 'zombieDeath':
      sounds.zombieDeath = {
        play: () => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain).connect(audioContext.destination);
          osc.frequency.setValueAtTime(80, audioContext.currentTime);
          osc.frequency.exponentialRampToValueAtTime(40, audioContext.currentTime + 0.5);
          osc.type = 'sawtooth';
          gain.gain.setValueAtTime(0.4, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
          osc.start();
          osc.stop(audioContext.currentTime + 0.5);
        }
      };
      break;
    case 'powerUp':
      sounds.powerUp = {
        play: () => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain).connect(audioContext.destination);
          osc.frequency.setValueAtTime(400, audioContext.currentTime);
          osc.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.2);
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.3, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          osc.start();
          osc.stop();
        }
      };
      break;
    case 'playerHurt':
      sounds.playerHurt = {
        play: () => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.connect(gain).connect(audioContext.destination);
          osc.frequency.setValueAtTime(150, audioContext.currentTime);
          osc.type = 'sawtooth';
          gain.gain.setValueAtTime(0.4, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
          osc.start();
          osc.stop(audioContext.currentTime + 0.3);
        }
      };
      break;
  }
}

function createSyntheticSounds() {
  ['reload', 'zombieHit', 'zombieDeath', 'powerUp', 'playerHurt'].forEach(createSyntheticSound);
}

function setupEventListeners() {
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  document.getElementById('player-name').addEventListener('input', validateLoginForm);
  document.getElementById('team-red-btn').addEventListener('click', () => selectTeam('Red'));
  document.getElementById('team-blue-btn').addEventListener('click', () => selectTeam('Blue'));
  document.getElementById('join-btn').addEventListener('click', joinGame);
  document.getElementById('reload-btn').addEventListener('click', reloadAmmo);

  document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const message = e.target.value.trim();
      if (message) {
        socket.emit('chatMessage', { message });
        e.target.value = '';
      }
    }
  });
}

function setupSocket() {
  socket = io();
  socket.on('connect', () => updateConnectionStatus('Conectado', true));
  socket.on('disconnect', () => updateConnectionStatus('Desconectado', false));

  socket.on('gameState', (data) => {
    playerId = data.playerId;
    players = data.players;
    obstacles = data.obstacles;
    powerUps = data.powerUps;
    zombies = data.zombies;
    updateGameUI(data);
    createObstacles();
    createPowerUps();
    updateZombies();
    
    // Criar arma imediatamente após receber o gameState
    if (playerId && players[playerId]) {
      createPlayerWeapon();
    }
    
    // CORREÇÃO: Criar todos os jogadores existentes
    Object.values(players).forEach(player => {
      if (player.id !== playerId) {
        createPlayer(player);
      }
    });
    
    console.log("GameState recebido. Jogadores:", Object.keys(players));
  });

  socket.on('playerJoined', (player) => {
    players[player.id] = player;
    createPlayer(player);
    console.log("Player joined:", player.id, player.name);
  });

  socket.on('playerMoved', (data) => {
    if (players[data.id]) {
      players[data.id].position = data.position;
      players[data.id].rotation = data.rotation;
      const playerObject = scene.getObjectByName(`player-${data.id}`);
      if (playerObject) {
        playerObject.position.set(data.position.x, 0, data.position.z);
        playerObject.rotation.y = data.rotation.y;
      }
    }
  });

  socket.on('playerLeft', (id) => {
    if (players[id]) {
      delete players[id];
      const playerObject = scene.getObjectByName(`player-${id}`);
      if (playerObject) scene.remove(playerObject);
      console.log("Player left:", id);
    }
  });

  socket.on('playerHit', (data) => {
    if (data.hitPlayerId === playerId) {
      showEliminatedScreen();
      if (sounds.hit && sounds.hit.isPlaying) {
        sounds.hit.stop();
      }
      if (sounds.hit) sounds.hit.play();
    }
    const hitObject = scene.getObjectByName(`player-${data.hitPlayerId}`);
    if (hitObject) {
      // Verificar se o material tem a propriedade color antes de acessá-la
      if (hitObject.material && hitObject.material.color) {
        const originalColor = hitObject.material.color.getHex();
        hitObject.material.color.setHex(0xff0000);
        setTimeout(() => hitObject.material.color.setHex(originalColor), 500);
      }
    }
  });

  socket.on('playerRevived', (data) => {
    if (data.playerId === playerId) {
      hideEliminatedScreen();
      // Iniciar penalidade de arma ao respawnar
      weaponPenaltyTime = Date.now() + 3000; // 3 segundos de penalidade
      isWeaponPenalized = true;
      showWeaponPenaltyNotification();
    }
    if (players[data.playerId]) {
      players[data.playerId].position = data.position;
      players[data.playerId].isEliminated = false;
      const playerObject = scene.getObjectByName(`player-${data.playerId}`);
      if (playerObject) {
        playerObject.position.set(data.position.x, 0, data.position.z);
        playerObject.visible = true;
      }
    }
  });

  socket.on('playerDamaged', (data) => {
    if (data.playerId === playerId) {
      // Efeito de tela vermelha ao levar dano
      document.body.style.backgroundColor = 'rgba(255,0,0,0.3)';
      setTimeout(() => document.body.style.backgroundColor = 'transparent', 200);
      
      // Tocar som de dano
      if (sounds.playerHurt && sounds.playerHurt.isPlaying) {
        sounds.playerHurt.stop();
      }
      if (sounds.playerHurt) sounds.playerHurt.play();
      
      // Efeito de shake
      document.body.style.animation = 'none';
      void document.body.offsetWidth;
      document.body.style.animation = 'shake 0.5s';
    }
  });

  socket.on('zombieHit', (data) => {
    const zombie = zombies.find(z => z.id === data.id);
    if (zombie) {
      zombie.health = data.health;
      if (sounds.zombieHit && sounds.zombieHit.isPlaying) {
        sounds.zombieHit.stop();
      }
      if (sounds.zombieHit) sounds.zombieHit.play();
      const pos = new THREE.Vector3(zombie.x, zombie.y + 1.5, zombie.z);
      createBloodEffect(pos);
      const zombieObj = scene.getObjectByName(`zombie-${data.id}`);
      if (zombieObj) {
        zombieObj.traverse(child => { 
          if (child.material && child.material.emissive) {
            child.material.emissive.setHex(0xff0000);
          }
        });
        setTimeout(() => {
          zombieObj.traverse(child => { 
            if (child.material && child.material.emissive) {
              child.material.emissive.setHex(0x000000);
            }
          });
        }, 200);
      }
    }
  });

  socket.on('zombieKilled', (data) => {
    const zombieObject = scene.getObjectByName(`zombie-${data.id}`);
    if (zombieObject) scene.remove(zombieObject);
    if (sounds.zombieDeath && sounds.zombieDeath.isPlaying) {
      sounds.zombieDeath.stop();
    }
    if (sounds.zombieDeath) sounds.zombieDeath.play();
    updateScoreUI(data.score);
    createExplosion(data.position);
  });

  socket.on('zombieSpawned', (data) => updateZombie(data));
  socket.on('zombiesUpdate', (data) => {
    zombies = data;
    updateZombies();
  });

  socket.on('powerUpCollected', (data) => {
    if (data.playerId === playerId) {
      if (sounds.powerUp && sounds.powerUp.isPlaying) {
        sounds.powerUp.stop();
      }
      if (sounds.powerUp) sounds.powerUp.play();
      showPowerUpNotification(data.type);
      switch(data.type) {
        case 'ammo': 
          ammoCount = 30; 
          updateAmmoUI(); 
          break;
        case 'shield': 
          document.getElementById('player-shield').classList.remove('hidden'); 
          break;
      }
    }
    const pu = scene.getObjectByName(`powerup-${data.powerUpId}`);
    if (pu) scene.remove(pu);
  });

  socket.on('powerUpSpawned', (data) => createPowerUp(data));
  socket.on('powerUpExpired', (data) => {
    if (data.playerId === playerId && data.type === 'shield') {
      document.getElementById('player-shield').classList.add('hidden');
    }
  });

  socket.on('shieldBroken', (data) => {
    if (data.playerId === playerId) {
      document.getElementById('player-shield').classList.add('hidden');
      document.body.style.backgroundColor = 'rgba(0,0,255,0.3)';
      setTimeout(() => document.body.style.backgroundColor = 'transparent', 200);
    }
  });

  socket.on('ammoRefill', (data) => {
    if (data.playerId === playerId) {
      ammoCount = 30;
      updateAmmoUI();
    }
  });

  socket.on('newWave', (data) => showWaveNotification(data.wave));
  socket.on('gameOver', (data) => showGameOverScreen(data.winningTeam));
  socket.on('gameReset', () => {
    hideGameOverScreen();
    hideEliminatedScreen();
    ammoCount = 30;
    updateAmmoUI();
  });

  socket.on('chatMessage', (data) => addChatMessage(data));
  socket.on('playersUpdate', (data) => {
    players = data;
    updatePlayers();
  });

  socket.on('gameStatsUpdate', (data) => updateGameStatsUI(data));
}

// Função para atualizar a UI do jogo - CORRIGIDA
function updateGameUI(data) {
  document.getElementById('player-team').textContent = playerTeam === 'Red' ? 'Vermelho' : 'Azul';
  
  // Verificar se data.score existe antes de acessá-lo
  if (data.score) {
    updateScoreUI(data.score);
  }
  
  document.getElementById('wave-info').textContent = `Onda: ${data.wave || 1}`;
  
  // Verificar se data.zombieKills existe antes de acessá-lo
  if (data.zombieKills) {
    document.getElementById('zombie-kills-red').textContent = `Zumbis abatidos: ${data.zombieKills.Red || 0}`;
    document.getElementById('zombie-kills-blue').textContent = `Zumbis abatidos: ${data.zombieKills.Blue || 0}`;
  }
}

function createObstacles() {
  // Remover todos os obstáculos existentes
  const existing = scene.children.filter(c => c.name.startsWith('obstacle-'));
  existing.forEach(o => scene.remove(o));

  // Verificar se há obstáculos para criar
  if (!obstacles || obstacles.length === 0) {
    console.log("Nenhum obstáculo para criar");
    return;
  }

  console.log(`Criando ${obstacles.length} obstáculos`);

  obstacles.forEach((obs, i) => {
    if (obs.type === 'tree') {
      // Tronco da árvore melhorado
      const trunkGeo = new THREE.CylinderGeometry(0.7, 0.9, obs.height);
      const trunkMat = woodTexture 
        ? new THREE.MeshLambertMaterial({ map: woodTexture })
        : new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // Marrom como fallback
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(obs.x, obs.height / 2, obs.z);
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      trunk.name = `obstacle-${i}-trunk`;
      scene.add(trunk);

      // Folhas da árvore melhoradas
      const leavesGeo = new THREE.SphereGeometry(obs.radius * 2);
      const leavesMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
      const leaves = new THREE.Mesh(leavesGeo, leavesMat);
      leaves.position.set(obs.x, obs.height + obs.radius * 1.5, obs.z);
      leaves.castShadow = true;
      leaves.receiveShadow = true;
      leaves.name = `obstacle-${i}-leaves`;
      scene.add(leaves);
    } else if (obs.type === 'wall') {
      // Parede melhorada - AUMENTADA para permitir esconderijo
      const geo = new THREE.BoxGeometry(obs.radius * 2, obs.height * 1.5, obs.radius * 2); // 50% mais alta
      const mat = brickTexture 
        ? new THREE.MeshLambertMaterial({ map: brickTexture })
        : new THREE.MeshLambertMaterial({ color: 0x8B4513 }); // Marrom como fallback
      const wall = new THREE.Mesh(geo, mat);
      wall.position.set(obs.x, (obs.height * 1.5) / 2, obs.z); // Ajustar posição para base ficar no chão
      wall.castShadow = true;
      wall.receiveShadow = true;
      wall.name = `obstacle-${i}`;
      scene.add(wall);
    }
  });

  console.log(`Obstáculos criados: ${scene.children.filter(c => c.name.startsWith('obstacle-')).length}`);
}

function createPlayer(player) {
  // CORREÇÃO: Verificar se o jogador já existe na cena
  const existingPlayer = scene.getObjectByName(`player-${player.id}`);
  if (existingPlayer) {
    console.log("Jogador já existe na cena:", player.id);
    return;
  }

  const bodyGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.5);
  const bodyMat = new THREE.MeshLambertMaterial({ color: player.team === 'Red' ? 0xff0000 : 0x0000ff });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.75; // Metade da altura do corpo
  body.castShadow = true;

  const headGeo = new THREE.SphereGeometry(0.4);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.5; // Altura da cabeça em relação ao chão
  head.castShadow = true;

  const playerGroup = new THREE.Group();
  playerGroup.add(body);
  playerGroup.add(head);
  
  // Garantir que o jogador esteja no mesmo nível dos zumbis
  playerGroup.position.set(player.position.x, 0, player.position.z); // Y = 0 para ficar no chão
  playerGroup.rotation.y = player.rotation.y;
  playerGroup.name = `player-${player.id}`;

  // Criar arma apenas para outros jogadores (não para o jogador local)
  if (player.id !== playerId) {
    // Arma simplificada para outros jogadores
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x333333 })
    );
    gun.position.set(0.3, 0.8, 0.2);
    gun.rotation.z = -0.2;
    playerGroup.add(gun);
  }

  scene.add(playerGroup);
  console.log("Jogador criado na cena:", player.id, player.name);
}

// Função separada para criar a arma do jogador local
function createPlayerWeapon() {
  // Remover arma existente se houver
  const existingGun = camera.getObjectByName('fps-gun');
  if (existingGun) {
    camera.remove(existingGun);
  }
  
  // ARMA MELHORADA - Modelo mais detalhado
  const gunGroup = new THREE.Group();
  
  // Corpo da arma
  const gunBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.1, 0.6),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  gunBody.position.set(0, 0, 0);
  
  // Cano da arma - MELHORADO
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8),
    new THREE.MeshLambertMaterial({ color: 0x333333 })
  );
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.4, 0.05, 0);
  
  // Mira da arma
  const sight = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.02, 0.15),
    new THREE.MeshLambertMaterial({ color: 0x444444 })
  );
  sight.position.set(0.2, 0.12, 0);
  
  // Gatilho
  const trigger = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.08, 0.05),
    new THREE.MeshLambertMaterial({ color: 0x555555 })
  );
  trigger.position.set(-0.1, -0.05, 0);
  
  // Empunhadura
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.2, 0.15),
    new THREE.MeshLambertMaterial({ color: 0x111111 })
  );
  grip.position.set(-0.15, -0.15, 0);
  
  // Carregador
  const magazine = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.25, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  magazine.position.set(-0.05, -0.2, 0);
  
  gunGroup.add(gunBody, barrel, sight, trigger, grip, magazine);
  
  // Posição e rotação ajustadas para melhor visibilidade
  gunGroup.position.set(0.3, -0.25, -0.5);
  gunGroup.rotation.y = 0.1; // Ligeira rotação para melhor visualização
  gunGroup.name = 'fps-gun';

  camera.add(gunGroup);
  console.log("Arma FPS criada para o jogador:", playerId);
}

function updateZombies() {
  zombies.forEach(z => !z.isDead && !scene.getObjectByName(`zombie-${z.id}`) && createZombie(z));
  zombies.forEach(updateZombie);
}

function createZombie(zombie) {
  const bodyGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.5);
  const bodyMat = new THREE.MeshLambertMaterial({ color: zombie.color });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.75; // Metade da altura do corpo
  body.castShadow = true;

  const headGeo = new THREE.SphereGeometry(0.4);
  const headMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.5; // Altura da cabeça em relação ao chão

  const armGeo = new THREE.CylinderGeometry(0.15, 0.15, 1);
  const armMat = new THREE.MeshLambertMaterial({ color: zombie.color });
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(-0.7, 1.0, 0);
  leftArm.rotation.z = 0.5;
  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(0.7, 1.0, 0);
  rightArm.rotation.z = -0.5;

  const healthBarGeo = new THREE.BoxGeometry(1, 0.1, 0.1);
  const healthBarMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const healthBar = new THREE.Mesh(healthBarGeo, healthBarMat);
  healthBar.position.set(0, 2.2, 0); // Acima da cabeça
  healthBar.name = 'health-bar';

  const group = new THREE.Group();
  group.add(body, head, leftArm, rightArm, healthBar);
  group.position.set(zombie.x, 0, zombie.z); // Y = 0 para ficar no chão
  group.rotation.y = zombie.rotationY;
  group.name = `zombie-${zombie.id}`;
  group.userData = { walkTime: 0, lastGroanTime: 0 };

  scene.add(group);
}

function updateZombie(zombie) {
  const obj = scene.getObjectByName(`zombie-${zombie.id}`);
  if (!obj || zombie.isDead) return;
  obj.position.set(zombie.x, 0, zombie.z); // Manter no chão
  obj.rotation.y = zombie.rotationY;

  const bar = obj.children.find(c => c.name === 'health-bar');
  if (bar) {
    const p = zombie.health / zombie.maxHealth;
    bar.scale.x = p;
    bar.position.x = -0.5 * (1 - p);
    bar.material.color.setHex(p > 0.6 ? 0x00ff00 : p > 0.3 ? 0xffff00 : 0xff0000);
  }
}

function createBloodEffect(pos) {
  const particles = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    p.position.copy(pos);
    p.userData.vel = new THREE.Vector3((Math.random()-0.5)*0.3, Math.random()*0.3, (Math.random()-0.5)*0.3);
    particles.add(p);
  }
  scene.add(particles);

  (function animate() {
    let alive = false;
    particles.children.forEach(p => {
      p.position.add(p.userData.vel);
      p.userData.vel.y -= 0.01;
      p.material.opacity -= 0.02;
      if (p.material.opacity > 0) alive = true;
    });
    if (alive) requestAnimationFrame(animate);
    else scene.remove(particles);
  })();
}

function createExplosion(pos) {
  const particles = new THREE.Group();
  for (let i = 0; i < 20; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xff0000 : 0xff9900 }));
    p.position.copy(pos);
    p.userData = { vel: new THREE.Vector3((Math.random()-0.5)*0.5, Math.random()*0.5, (Math.random()-0.5)*0.5), life: 1 };
    particles.add(p);
  }
  scene.add(particles);

  (function animate() {
    let allDead = true;
    particles.children.forEach(p => {
      if (p.userData.life > 0) {
        allDead = false;
        p.position.add(p.userData.vel);
        p.userData.vel.y -= 0.01;
        p.userData.life -= 0.02;
        p.material.opacity = p.userData.life;
      }
    });
    if (!allDead) requestAnimationFrame(animate);
    else scene.remove(particles);
  })();
}

function shoot() {
  // Verificar se há penalidade de arma
  if (isWeaponPenalized) {
    const remainingTime = Math.ceil((weaponPenaltyTime - Date.now()) / 1000);
    showWeaponPenaltyNotification(remainingTime);
    return;
  }

  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(direction);

  const rayEnd = origin.clone().add(direction.clone().multiplyScalar(50));
  const rayLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([origin, rayEnd]),
    new THREE.LineBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.8 })
  );
  scene.add(rayLine);
  setTimeout(() => scene.remove(rayLine), 100);

  socket.emit('playerShoot', { origin, direction });

  const gun = camera.getObjectByName('fps-gun');
  if (gun) {
    // Animação de recuo melhorada
    gun.position.z -= 0.15;
    gun.rotation.x += 0.05;
    setTimeout(() => {
      gun.position.z += 0.15;
      gun.rotation.x -= 0.05;
    }, 100);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const time = performance.now();
  const delta = (time - prevTime) / 1000;

  // Verificar se a penalidade de arma acabou
  if (isWeaponPenalized && Date.now() > weaponPenaltyTime) {
    isWeaponPenalized = false;
    hideWeaponPenaltyNotification();
  }

  velocity.x -= velocity.x * 10 * delta;
  velocity.z -= velocity.z * 10 * delta;
  direction.z = Number(moveForward) - Number(moveBackward);
  direction.x = Number(moveRight) - Number(moveLeft);
  if (direction.length() > 0) direction.normalize();

  const speed = 30.0;
  if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
  if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

  // EFEITO DE BOBBING CORRIGIDO
  if (moveForward || moveLeft || moveRight || moveBackward) {
    timer += delta;
    if (time - lastStepTime > 300 && sounds.step) {
      if (sounds.step.isPlaying) {
        sounds.step.stop();
      }
      sounds.step.play();
      lastStepTime = time;
    }
    // Limitando o movimento vertical da câmera para evitar que aponte para o céu
    const bobbingY = Math.abs(Math.sin(timer * bobbingSpeed)) * bobbingAmount;
    camera.position.y = originalCameraY - bobbingY;
  } else {
    camera.position.y = originalCameraY;
  }

  if (playerId && players[playerId]) {
    const newPos = {
      x: controls.getObject().position.x + velocity.x * delta,
      y: controls.getObject().position.y,
      z: controls.getObject().position.z + velocity.z * delta
    };

    // MELHORIA: Verificação de colisão mais precisa
    let canMove = true;
    for (const obs of obstacles) {
      const dx = newPos.x - obs.x;
      const dz = newPos.z - obs.z;
      const distance = Math.sqrt(dx*dx + dz*dz);
      
      // Aumentar o raio de colisão para evitar que jogadores fiquem presos
      const collisionRadius = obs.radius + 1.5;
      
      if (distance < collisionRadius) {
        canMove = false;
        
        // Se o jogador está muito perto, empurrá-lo para fora
        if (distance < obs.radius) {
          const pushDirection = new THREE.Vector3(dx, 0, dz).normalize();
          const pushDistance = obs.radius - distance + 0.5;
          controls.getObject().position.x += pushDirection.x * pushDistance;
          controls.getObject().position.z += pushDirection.z * pushDistance;
        }
        break;
      }
    }

    if (canMove) {
      controls.moveRight(-velocity.x * delta);
      controls.moveForward(-velocity.z * delta);
      socket.emit('playerMove', {
        position: { ...newPos, y: 0 }, // Garantir Y = 0
        rotation: { x: 0, y: controls.getObject().rotation.y, z: 0 }
      });

      // Verificar coleta de power-ups
      checkPowerUpCollection(newPos);
      
      // Verificar colisão com zumbis
      checkZombieCollision(newPos);
    }
  }

  prevTime = time;

  // Anima power-ups
  scene.children.forEach(child => {
    if (child.name.startsWith('powerup-')) {
      child.rotation.y += 0.01;
      child.position.y = 1 + Math.sin(Date.now() * 0.002) * 0.3;
    }
  });

  // Anima zumbis
  zombies.forEach(zombie => {
    if (!zombie.isDead) {
      const obj = scene.getObjectByName(`zombie-${zombie.id}`);
      if (obj) {
        obj.userData.walkTime += 0.1;
        const left = obj.children.find(c => c.position.x < 0 && c.geometry instanceof THREE.CylinderGeometry);
        const right = obj.children.find(c => c.position.x > 0 && c.geometry instanceof THREE.CylinderGeometry);
        if (left && right) {
          left.rotation.z = 0.5 + Math.sin(obj.userData.walkTime) * 0.3;
          right.rotation.z = -0.5 + Math.sin(obj.userData.walkTime) * 0.3;
        }
        if (time - obj.userData.lastGroanTime > 3000 && sounds.zombieGroan) {
          if (sounds.zombieGroan.isPlaying) {
            sounds.zombieGroan.stop();
          }
          sounds.zombieGroan.play();
          obj.userData.lastGroanTime = time;
        }
      }
    }
  });

  updateMinimap();
  renderer.render(scene, camera);
}

// Função para verificar coleta de power-ups
function checkPowerUpCollection(playerPosition) {
  powerUps.forEach(powerUp => {
    if (!powerUp.active) return;
    
    const dx = playerPosition.x - powerUp.x;
    const dz = playerPosition.z - powerUp.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance < 2.5) {
      socket.emit('collectPowerUp', { powerUpId: powerUp.id });
    }
  });
}

// Função para verificar colisão com zumbis - CORRIGIDA COM COOLDOWN
function checkZombieCollision(playerPosition) {
  if (players[playerId] && players[playerId].isEliminated) return;
  
  // Verificar cooldown para não detectar colisão repetidamente
  const currentTime = Date.now();
  if (currentTime - lastZombieHitTime < zombieHitCooldown) {
    return; // Ainda está em cooldown
  }
  
  zombies.forEach(zombie => {
    if (zombie.isDead) return;
    
    const dx = playerPosition.x - zombie.x;
    const dy = 0; // Mesma altura vertical
    const dz = playerPosition.z - zombie.z;
    
    // Calcular distância considerando o corpo inteiro do zumbi
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    // Aumentar o raio de colisão para cobrir o corpo inteiro do zumbi
    if (distance < 1.8) { // Aumentado de 1.5 para 1.8
      // Atualizar o tempo do último hit
      lastZombieHitTime = currentTime;
      
      // Notificar o servidor que o jogador foi atingido por um zumbi
      socket.emit('zombieAttack', { zombieId: zombie.id });
      console.log("Colisão com zumbi detectada e enviada:", zombie.id, "Distância:", distance);
    }
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseDown() {
  if (document.pointerLockElement !== document.body || isReloading || ammoCount <= 0) return;
  
  // Verificar se há penalidade de arma
  if (isWeaponPenalized) {
    const remainingTime = Math.ceil((weaponPenaltyTime - Date.now()) / 1000);
    showWeaponPenaltyNotification(remainingTime);
    return;
  }
  
  const now = Date.now();
  if (now - lastShootTime < shootCooldown) return;
  lastShootTime = now;
  shoot();
  if (sounds.shoot && sounds.shoot.isPlaying) {
    sounds.shoot.stop();
  }
  if (sounds.shoot) sounds.shoot.play();
  ammoCount--;
  updateAmmoUI();
  crosshair.classList.add('firing');
  setTimeout(() => crosshair.classList.remove('firing'), 100);
  if (ammoCount === 0) reloadAmmo();
}

function onMouseUp() {
  // Placeholder - pode ser usado futuramente
}

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': moveForward = true; break;
    case 'KeyA': case 'ArrowLeft': moveLeft = true; break;
    case 'KeyS': case 'ArrowDown': moveBackward = true; break;
    case 'KeyD': case 'ArrowRight': moveRight = true; break;
    case 'KeyR': reloadAmmo(); break;
    case 'KeyZ': camera.fov = 45; camera.updateProjectionMatrix(); break;
    case 'Enter':
      document.getElementById('chat-container').classList.toggle('hidden');
      document.getElementById('chat-input').focus();
      break;
    case 'Escape': document.exitPointerLock(); break;
  }
}

function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': moveForward = false; break;
    case 'KeyA': case 'ArrowLeft': moveLeft = false; break;
    case 'KeyS': case 'ArrowDown': moveBackward = false; break;
    case 'KeyD': case 'ArrowRight': moveRight = false; break;
    case 'KeyZ': camera.fov = 75; camera.updateProjectionMatrix(); break;
  }
}

function reloadAmmo() {
  if (!isReloading && ammoCount < 30) {
    isReloading = true;
    const btn = document.getElementById('reload-btn');
    btn.disabled = true;
    btn.textContent = 'Recarregando...';
    if (sounds.reload) sounds.reload.play();
    setTimeout(() => {
      ammoCount = 30;
      isReloading = false;
      btn.disabled = false;
      btn.textContent = 'Recarregar';
      updateAmmoUI();
    }, 2000);
  }
}

function updateAmmoUI() {
  document.getElementById('ammo-count').textContent = ammoCount;
  document.getElementById('ammo-info').style.color = ammoCount <= 10 ? '#ff3333' : '#ffff00';
}

function updateScoreUI(score) {
  document.getElementById('red-score').textContent = score.Red || 0;
  document.getElementById('blue-score').textContent = score.Blue || 0;
}

function updateGameStatsUI(stats) {
  updateScoreUI(stats.score);
  document.getElementById('wave-info').textContent = `Onda: ${stats.wave}`;
  document.getElementById('zombie-kills-red').textContent = `Zumbis abatidos: ${stats.zombieKills.Red || 0}`;
  document.getElementById('zombie-kills-blue').textContent = `Zumbis abatidos: ${stats.zombieKills.Blue || 0}`;
}

function validateLoginForm() {
  const name = document.getElementById('player-name').value.trim();
  const teamSelected = !!document.querySelector('.team-btn.selected');
  document.getElementById('join-btn').disabled = !(name && teamSelected);
}

function selectTeam(team) {
  document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById(`team-${team.toLowerCase()}-btn`).classList.add('selected');
  validateLoginForm();
}

function joinGame() {
  const name = document.getElementById('player-name').value.trim();
  const selected = document.querySelector('.team-btn.selected');
  if (!name || !selected) return;
  playerTeam = selected.classList.contains('red') ? 'Red' : 'Blue';
  socket.emit('newPlayer', { name, team: playerTeam });
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('chat-container').classList.remove('hidden');
  crosshair = document.getElementById('crosshair');
  renderer.domElement.addEventListener('click', () => document.body.requestPointerLock());
  document.getElementById('player-team').textContent = playerTeam === 'Red' ? 'Vermelho' : 'Azul';
  updateAmmoUI();
}

function showEliminatedScreen() {
  document.getElementById('eliminated-screen').classList.remove('hidden');
}
function hideEliminatedScreen() {
  document.getElementById('eliminated-screen').classList.add('hidden');
}
function showGameOverScreen(team) {
  document.getElementById('winner-team-name').textContent = team === 'Red' ? 'Vermelho' : 'Azul';
  document.getElementById('gameover-screen').classList.remove('hidden');
}
function hideGameOverScreen() {
  document.getElementById('gameover-screen').classList.add('hidden');
}

function showWaveNotification(wave) {
  const n = document.createElement('div');
  n.className = 'wave-notification';
  n.textContent = `🔥 Onda ${wave} iniciada!`;
  document.getElementById('game-container').appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

function showPowerUpNotification(type) {
  const types = { 
    speed: '⚡ Velocidade Aumentada!', 
    ammo: '🔫 Munição Recarregada!', 
    health: '❤️ Saúde Restaurada!', 
    shield: '🛡️ Escudo Ativado!', 
    damage: '💥 Dano Aumentado!' 
  };
  const colors = { 
    speed: '#00ffff', 
    ammo: '#ffff00', 
    health: '#ff00ff', 
    shield: '#0000ff', 
    damage: '#ff0000' 
  };
  
  // Remover notificação anterior se existir
  const existing = document.querySelector('.powerup-notification');
  if (existing) existing.remove();
  
  const n = document.createElement('div');
  n.className = 'powerup-notification';
  n.textContent = types[type] || 'Power-up Coletado!';
  n.style.color = colors[type] || '#ffffff';
  n.style.fontSize = '20px';
  n.style.fontWeight = 'bold';
  n.style.textShadow = '0 0 5px rgba(0,0,0,0.7)';
  document.getElementById('game-container').appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

function showWeaponPenaltyNotification(remainingTime) {
  // Remover notificação anterior se existir
  const existing = document.querySelector('.weapon-penalty-notification');
  if (existing) existing.remove();
  
  const n = document.createElement('div');
  n.className = 'weapon-penalty-notification';
  n.textContent = remainingTime 
    ? `🔫 Arma Bloqueada: ${remainingTime}s` 
    : '🔫 Arma Bloqueada: Recarregando...';
  n.style.position = 'absolute';
  n.style.top = '40%';
  n.style.left = '50%';
  n.style.transform = 'translateX(-50%)';
  n.style.padding = '15px 30px';
  n.style.background = 'rgba(255,0,0,0.8)';
  n.style.color = 'white';
  n.style.borderRadius = '10px';
  n.style.fontSize = '18px';
  n.style.fontWeight = 'bold';
  n.style.zIndex = '20';
  n.style.textAlign = 'center';
  document.getElementById('game-container').appendChild(n);
}

function hideWeaponPenaltyNotification() {
  const existing = document.querySelector('.weapon-penalty-notification');
  if (existing) existing.remove();
}

function updateConnectionStatus(status, connected) {
  const el = document.getElementById('connection-status');
  el.textContent = status;
  el.style.backgroundColor = connected ? '#4CAF50' : '#F44336';
}

function addChatMessage(data) {
  const mc = document.getElementById('chat-messages');
  const m = document.createElement('div');
  m.className = `chat-message ${data.team.toLowerCase()}`;
  m.innerHTML = `<strong>${data.name}:</strong> ${data.message}`;
  mc.appendChild(m);
  mc.scrollTop = mc.scrollHeight;
  while (mc.children.length > 50) mc.removeChild(mc.firstChild);
}

function setupMinimap() {
  const canvas = document.getElementById('minimap-canvas');
  canvas.width = 180;
  canvas.height = 180;
  minimapContext = canvas.getContext('2d');
}

function updateMinimap() {
  if (!minimapContext) return;
  minimapContext.fillStyle = 'rgba(0,0,0,0.5)';
  minimapContext.fillRect(0, 0, 180, 180);

  obstacles.forEach(o => {
    const x = (o.x + 100) * 0.9;
    const z = (o.z + 100) * 0.9;
    minimapContext.fillStyle = '#666666';
    minimapContext.beginPath();
    minimapContext.arc(x, z, o.radius * 0.9, 0, 2 * Math.PI);
    minimapContext.fill();
  });

  Object.values(players).forEach(p => {
    if (p.isEliminated) return;
    const x = (p.position.x + 100) * 0.9;
    const z = (p.position.z + 100) * 0.9;
    minimapContext.fillStyle = p.team === 'Red' ? '#ff0000' : '#0000ff';
    minimapContext.beginPath();
    minimapContext.arc(x, z, 3, 0, 2 * Math.PI);
    minimapContext.fill();
    if (p.id === playerId) {
      minimapContext.strokeStyle = '#ffffff';
      minimapContext.lineWidth = 1;
      minimapContext.beginPath();
      minimapContext.arc(x, z, 5, 0, 2 * Math.PI);
      minimapContext.stroke();
    }
  });

  zombies.forEach(z => {
    if (z.isDead) return;
    const x = (z.x + 100) * 0.9;
    const zPos = (z.z + 100) * 0.9;
    minimapContext.fillStyle = z.type === 'fast' ? '#ffff00' : z.type === 'tank' ? '#ff0000' : '#00ff00';
    minimapContext.beginPath();
    minimapContext.arc(x, zPos, 2, 0, 2 * Math.PI);
    minimapContext.fill();
  });

  powerUps.forEach(pu => {
    if (!pu.active) return;
    const x = (pu.x + 100) * 0.9;
    const z = (pu.z + 100) * 0.9;
    minimapContext.fillStyle = '#ffffff';
    minimapContext.fillRect(x - 2, z - 2, 4, 4);
  });
}

// Função para criar power-ups
function createPowerUps() {
  // Remover power-ups existentes
  const existing = scene.children.filter(c => c.name.startsWith('powerup-'));
  existing.forEach(p => scene.remove(p));

  // Criar novos power-ups
  powerUps.forEach(pu => {
    if (!pu.active) return;
    createPowerUp(pu);
  });
}

function createPowerUp(powerUp) {
  // Remover power-up existente com o mesmo ID
  const existing = scene.getObjectByName(`powerup-${powerUp.id}`);
  if (existing) scene.remove(existing);

  // Criar geometria baseada no tipo
  let geometry, material;
  
  switch(powerUp.type) {
    case 'speed':
      geometry = new THREE.OctahedronGeometry(0.5);
      material = new THREE.MeshLambertMaterial({ color: 0x00ffff });
      break;
    case 'ammo':
      geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      material = new THREE.MeshLambertMaterial({ color: 0xffff00 });
      break;
    case 'health':
      geometry = new THREE.TetrahedronGeometry(0.5);
      material = new THREE.MeshLambertMaterial({ color: 0xff00ff });
      break;
    case 'shield':
      geometry = new THREE.IcosahedronGeometry(0.5);
      material = new THREE.MeshLambertMaterial({ color: 0x0000ff });
      break;
    case 'damage':
      geometry = new THREE.ConeGeometry(0.5, 1, 8);
      material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
      break;
    default:
      geometry = new THREE.SphereGeometry(0.5);
      material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(powerUp.x, 1, powerUp.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `powerup-${powerUp.id}`;
  
  scene.add(mesh);
}

// CORREÇÃO: Melhorar a função updatePlayers para garantir que todos os jogadores sejam criados
function updatePlayers() {
  // Obter todos os IDs de jogadores atuais
  const currentPlayerIds = Object.keys(players);
  
  // Criar jogadores que não existem na cena
  currentPlayerIds.forEach(playerId => {
    const playerObject = scene.getObjectByName(`player-${playerId}`);
    if (!playerObject) {
      console.log("Criando jogador que não existe na cena:", playerId);
      createPlayer(players[playerId]);
    } else {
      // Atualizar posição e rotação do jogador existente
      const player = players[playerId];
      playerObject.position.set(player.position.x, 0, player.position.z);
      playerObject.rotation.y = player.rotation.y;
      playerObject.visible = !player.isEliminated;
    }
  });

  // Remover jogadores que não existem mais
  scene.children.filter(child => 
    child.name.startsWith('player-') && 
    !currentPlayerIds.includes(child.name.replace('player-', ''))
  ).forEach(child => {
    console.log("Removendo jogador que não existe mais:", child.name);
    scene.remove(child);
  });
}

window.addEventListener('load', init);