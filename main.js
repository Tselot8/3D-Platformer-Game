import * as THREE from './libs/three.module.js';
import { GLTFLoader } from './libs/GLTFLoader.js';
import * as CANNON from './libs/cannon-es.js';

let scene, camera, renderer, player, playerMixer, clock;
let treeModel = null, spikeModel = null, prizeModel = null;
let prizeBody = null, prizeMesh = null;
let clouds = [];
let playerBody, world, groundTiles = [], groundBodies = [];
let keys = {}, collectibles = [], obstacles = [], obstacleBodies = [];
let score = 0, lives = 4;
let canJump = true;
let cameraOffset = new THREE.Vector3(0, 3, 5);
let gameStarted = false, sceneTransitioned = false;
let currentLevel = 1; // 1: blue, 2: golden
let gameWon = false;


const GRAVITY = -7.5;
const jumpVelocity = 11;
// Preload sounds
const sounds = {};
['coin.wav', 'jump.wav', 'ouch.mp3', 'fall.mp3'].forEach(name => {
  sounds[name] = new Audio(`assets/audio/${name}`);
});

function playSound(name) {
  const sfx = sounds[name]?.cloneNode();
  if (sfx) sfx.play().catch(e => console.warn("Sound failed:", name));
}

init();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  addClouds();
  addHills();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 10, 15);

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas') });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  const gltfLoader = new GLTFLoader();
  gltfLoader.load('assets/models/tree.glb', gltf => treeModel = gltf.scene);
  gltfLoader.load('assets/models/spike.glb', gltf => spikeModel = gltf.scene);
  gltfLoader.load('assets/models/prize.glb', gltf => prizeModel = gltf.scene);


  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 7.5);
  scene.add(dirLight);

  world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
  clock = new THREE.Clock();

  createGroundTiles();
  createFallCatcher(); // 🛡️ Invisible platform underneath
  loadPlayer();

  const lanes = [-2, 0, 2];
  for (let i = 1; i <= 20; i++) {
    const x = lanes[Math.floor(Math.random() * lanes.length)];
    addCoin(x, 1, -i * 8);
  }

  for (let i = 0; i < 10; i++) addObstacle(i * 15);
  playMusic();

  window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === "Enter" && !gameStarted) {
      document.getElementById('startScreen').style.display = 'none';
      startCountdown();
      gameStarted = true;
    }
  });

  window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);
  window.addEventListener("resize", onWindowResize);
}

function startCountdown() {
  let count = 3;
  const div = document.createElement('div');
  div.id = 'countdown';
  div.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:4em;color:white;z-index:9;';
  document.body.appendChild(div);

  const interval = setInterval(() => {
    div.innerText = count;
    if (count === 0) {
      div.remove();
      animate();
      clearInterval(interval);
    }
    count--;
  }, 1000);
}

function createGroundTiles() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4169E1,
    emissive: 0x4169E1,
    emissiveIntensity: 1.2,
    metalness: 0.3,
    roughness: 0.4
  });

  for (let i = 0; i < 10; i++) {
    if (i !== 3 && i !== 6) {
      const zPos = -i * 15;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(7, 1, 18), mat);
      mesh.position.set(0, -0.5, zPos);
      scene.add(mesh);

      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(3.5, 0.5, 9)),
        position: new CANNON.Vec3(0, -0.5, zPos)
      });
      world.addBody(body);
      groundTiles.push(mesh);
      groundBodies.push(body);
    }
  }
}

function createFallCatcher() {
  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(50, 0.5, 300)),
    position: new CANNON.Vec3(0, -10, -100)
  });
  world.addBody(body);
}

function recycleGround() {
  const threshold = 15;
  groundTiles.forEach((tile, index) => {
    if (player && tile.position.z - player.position.z > threshold) {
      tile.position.z -= 150;
      groundBodies[index].position.z -= 150;
    }
  });
}

function addClouds() {
  const cloudGeo = new THREE.PlaneGeometry(6, 3); 
  const cloudTex = new THREE.TextureLoader().load('assets/textures/cloud.png');
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true });

  for (let i = 0; i < 10; i++) {
     const zPos = -i * 35;
    const xOffset = Math.random() > 0.5 ? Math.random() * 20 + 15 : -Math.random() * 20 - 15;
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    cloud.position.set(xOffset, 5 + Math.random() * 2, -i * 25);
    cloud.renderOrder = -1;
    scene.add(cloud);
    clouds.push(cloud);
  }
}


function addHills() {
  const geo = new THREE.SphereGeometry(2.5, 40, 40, 0, Math.PI); // More segments = smoother
  const mat = new THREE.MeshStandardMaterial({ color: 0x228B22 });

  // Z values close to player run path (ground tiles are at z = -0 to -150)
  const positions = [-15, -25, -35, -45, -55, -65];

  positions.forEach((zPos, i) => {
    const xPos = i % 2 === 0 ? -10 : 10; // alternate left/right
    const hill = new THREE.Mesh(geo, mat);
    hill.name = 'hill'; // 
    hill.rotation.x = -Math.PI / 2;
    hill.position.set(xPos, -1.25, zPos); // Drop them halfway down to sink into the ground
    hill.scale.set(1.2, 0.6, 1.2);         // Slightly flatter, more natural

    scene.add(hill);
  });
}

function addTrees() {
  if (!treeModel) return;
  for (let i = 0; i < 6; i++) {
    const x = i % 2 === 0 ? -10 : 10;
    const z = -90 - i * 20;
    const tree = treeModel.clone();
    tree.scale.set(1.5, 1.5, 1.5);
    tree.position.set(x, 0, z);
    scene.add(tree);
  }
}


function changeEnvironment() {
  //  Show temporary loading screen (make sure it's in your HTML/CSS)
  const loader = document.getElementById('loadingOverlay');
  if (loader) loader.style.display = 'block';

  // Slight delay before starting heavy operations
  setTimeout(() => {
    currentLevel = 2;

    // Change background and ground tile color
    scene.background = new THREE.Color(0xFFD700);
    groundTiles.forEach(tile => tile.material.color.set(0xA9A9A9));

    // Remove clouds
    clouds.forEach(cloud => scene.remove(cloud));
    clouds = [];

    // Remove hills
    scene.children = scene.children.filter(obj => obj.name !== 'hill');

    // Defer model-heavy tasks slightly
    setTimeout(() => {
      // Add trees and advanced obstacles
      addTrees();
      addAdvancedObstacles();

      // Add new coins
      const lanes = [-2, 0, 2];
      for (let i = 1; i <= 10; i++) {
        const x = lanes[Math.floor(Math.random() * lanes.length)];
        addCoin(x, 1, -250 - i * 10);
      }

      // Add prize
      addPrize();

      // Remove rocks
      obstacles.forEach((obj, i) => {
        if (obj.name === 'rock') {
          scene.remove(obj);
          world.removeBody(obstacleBodies[i]);
        }
      });

      // Clean arrays
      obstacles = obstacles.filter(obj => obj.name !== 'rock');
      obstacleBodies = obstacleBodies.filter((_, i) => obstacles[i]?.name !== 'rock');

      // Hide loading after all is added
      setTimeout(() => {
        if (loader) loader.style.display = 'none';
      }, 300);

    }, 100); // Slight delay before loading GLTFs

  }, 100); // Initial wait before any updates
}


function loadPlayer() {
  const loader = new GLTFLoader().setPath('assets/models/player/');
  loader.load('scene.gltf', gltf => {
    player = gltf.scene;
    player.scale.set(3, 3, 3);
    player.rotation.set(0, Math.PI, 0);
    scene.add(player);

    player.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });


    playerMixer = new THREE.AnimationMixer(player);
    const clips = gltf.animations;
    const runClip = clips.find(c => c.name.toLowerCase().includes("run") || c.name.toLowerCase().includes("layer")) || clips[0];
    if (runClip) {
      const runAction = playerMixer.clipAction(runClip);
      runAction.setLoop(THREE.LoopRepeat);
      runAction.play();
    }

    playerBody = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(0.25),
      position: new CANNON.Vec3(0, 1, 0)
    });

    playerBody.addEventListener("collide", e => {
      const contactNormal = e.contact.ni;
      if (Math.abs(contactNormal.y) > 0.5) canJump = true;
    });

    world.addBody(playerBody);
    playerBody.velocity.set(0, 0, 0); // Reset any unwanted fall
    playerBody.position.set(0, 2, 0); // Ensure player is well above ground

  });
  setTimeout(() => {
  canJump = true;
}, 500); // Give half a second for setup

}

function addCoin(x, y, z) {
  const tex = new THREE.TextureLoader().load('assets/textures/coin.png');
 const mat = new THREE.MeshStandardMaterial({
  map: tex,
  transparent: true,
  emissive: 0xffff00,
  emissiveIntensity: 0.5,
  metalness: 0.1,
  roughness: 0.4
});
  const geo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 32);
  const coin = new THREE.Mesh(geo, mat);
  coin.rotation.x = Math.PI / 2;
  coin.position.set(x, y, z);
  coin.scale.set(4, 4, 4);
  scene.add(coin);
  collectibles.push(coin);
}

function addObstacle(zPos) {
  if (currentLevel !== 1) return; // only rocks in level 1
  const loader = new GLTFLoader();
  loader.load('assets/models/rock.glb', gltf => {
    const rock = gltf.scene;
    rock.name = 'rock';
    rock.scale.set(10, 10, 10);
    const x = Math.random() > 0.5 ? -2 : 2;
    rock.position.set(x, 0.5, -zPos);
    scene.add(rock);
    obstacles.push(rock);

    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Sphere(0.5),
      position: new CANNON.Vec3(x, 0.5, -zPos)
    });
    world.addBody(body);
    obstacleBodies.push(body);
  });
}
function addAdvancedObstacles() {
  if (!spikeModel) return;
  for (let i = 1; i <= 10; i++) {
    const x = Math.random() > 0.5 ? -2 : 2;
    const z = -150 - i * 12;
    const spike = spikeModel.clone();
    spike.scale.set(5, 5, 5);
    spike.position.set(x, 0.5, z);
    scene.add(spike);
    obstacles.push(spike);

    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Cylinder(0.3, 0.3, 1, 8),
      position: new CANNON.Vec3(x, 0.5, z)
    });
    world.addBody(body);
    obstacleBodies.push(body);
  }
}


function addPrize() {
  if (!prizeModel) return;
  prizeMesh = prizeModel.clone();
  prizeMesh.name = "prize";
  prizeMesh.scale.set(0.3, 0.3, 0.3);
  prizeMesh.position.set(0, 1, -370);

  prizeBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
    position: new CANNON.Vec3(0, 1, -370)
  });

  scene.add(prizeMesh);
  world.addBody(prizeBody);
}



function handleInput() {
  if (!playerBody || gameWon) return;
 
  const force = 5;
  playerBody.velocity.z = -force;

  if (keys['a'] || keys['arrowleft']) {
    playerBody.velocity.x = -force;
    cameraOffset.set(-2, 6, 12);
  } else if (keys['d'] || keys['arrowright']) {
    playerBody.velocity.x = force;
    cameraOffset.set(2, 6, 12);
  } else {
    playerBody.velocity.x = 0;
  }

  if ((keys[' '] || keys['space']) && canJump) {
    playerBody.velocity.y = jumpVelocity;
    canJump = false;
    playSound('jump.wav');
  }
}


function checkCollisions() {
  if (!gameStarted || !player || !player.position) return;

  collectibles.forEach((coin, index) => {
    if (coin.visible && coin.position.distanceTo(player.position) < 1) {
      coin.visible = false;
      score += 10;
      document.getElementById('score').textContent = score;
      playSound('coin.wav');
    }
  });

 if (playerBody.position.z < -80 && !sceneTransitioned) {
  if (Math.abs(playerBody.velocity.y) < 0.1 && playerBody.position.y <= 1.1) {
    sceneTransitioned = true;
    changeEnvironment();
  }
}

  obstacleBodies.forEach((body, index) => {
  const dist = body.position.distanceTo(playerBody.position);
  if (dist < 2 && !gameWon) {
    const object = obstacles[index];

    // ❌ If it's the prize, ignore
    if (object?.isPrize) return;

    // ✅ Otherwise handle as dangerous obstacle
    lives--;

    document.getElementById('lives').textContent = lives;
    world.removeBody(body);
    scene.remove(obstacles[index]);
    obstacles.splice(index, 1);
    obstacleBodies.splice(index, 1);

    // Add feedback sound and knockback before removing obstacle
    playSound('ouch.mp3'); // Add 'ouch.wav' to your assets/audio folder

    // Add slight knockback effect
    playerBody.velocity.set(-1.5, 5, 2); // back and up

    if (lives <= 0) {
      endGame(false); //  You Lost
    }
  }
});


    if (playerBody.position.y < -5 && !playerBody.isFalling && !gameWon) {
      playerBody.isFalling = true;
      playSound('fall.mp3'); // 😱 Play scream on fall

      setTimeout(() => {
        if (gameWon) return; // safety: already ended

        lives--;
        document.getElementById('lives').textContent = lives;

        if (lives <= 0) {
          endGame(false); //  You Lost
        } else {
          playerBody.position.set(0, 2, playerBody.position.z + 5);
          playerBody.velocity.set(0, 5, 0);
          playerBody.isFalling = false;
        }
      }, 300);
    }

    // ✅ Check for collision with prize
    if (prizeBody && playerBody && !gameWon) {
      const dist = prizeBody.position.distanceTo(playerBody.position);
      if (dist < 1.2) {
        endGame(true); // 🎉 You win
      }
    }
  }

function endGame(won) {
  gameWon = true;
  playerBody.velocity.set(0, 0, 0);
  playerBody.angularVelocity.set(0, 0, 0);
  playerBody.type = CANNON.Body.STATIC;
  if (playerMixer) playerMixer.stopAllAction();

  const winMessage = document.getElementById("winMessage");
  winMessage.textContent = won ? "🎉 You Win! 🎉" : " You Lost ";

  setTimeout(() => {
    document.getElementById("winScreen").style.display = "flex";
  }, 500);
}

function restartGame() {
  location.reload();
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (gameWon) return;
  if (playerMixer) playerMixer.update(delta);
  handleInput();
  world.step(delta);

  collectibles.forEach(coin => {
    if (coin.visible) coin.rotation.z += 0.05;
  });

  if (!sceneTransitioned) {
  clouds.forEach(cloud => {
    cloud.position.z += 0.02;
    if (cloud.position.z > player.position.z + 10) {
      cloud.position.z = player.position.z - 100;
    }
  });
}

  if (player && playerBody) {
    player.position.copy(playerBody.position);
    const targetPosition = new THREE.Vector3().copy(player.position).add(cameraOffset);
    camera.position.lerp(targetPosition, 0.05);
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z);
  }

  if (prizeMesh && prizeBody) {
  prizeMesh.position.copy(prizeBody.position);
  prizeMesh.quaternion.copy(prizeBody.quaternion);
}


  recycleGround();
  checkCollisions();
  // Sync physics bodies to meshes
  obstacles.forEach((obj, i) => {
  if (obj.userData?.body) {
    obj.position.copy(obj.userData.body.position);
    obj.quaternion.copy(obj.userData.body.quaternion);
  }
});

  renderer.render(scene, camera);
}


function playMusic() {
  const bg = new Audio('assets/audio/bg_music.m4a');
  bg.loop = true;
  bg.volume = 0.3;
  document.body.addEventListener('click', () => bg.play(), { once: true });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

document.getElementById("playAgainBtn").addEventListener("click", () => {
  restartGame();
});
