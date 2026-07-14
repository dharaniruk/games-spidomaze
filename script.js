'use strict';
/* =========================================================================
   WEB RUNNER :: MAZE ESCAPE
   Vanilla JS game engine. Sections:
   1. Storage / State          5. Character & Avatar rendering
   2. Audio Engine             6. Maze generation
   3. Background FX            7. Game loop / entities
   4. Screen / UI routing      8. HUD, overlays, leaderboard, achievements
   ========================================================================= */

/* ---------------------------------------------------------------------- */
/* 1. STORAGE / STATE                                                     */
/* ---------------------------------------------------------------------- */
const STORAGE_KEY = 'webRunner.save.v1';

const DIFFICULTY = {
  easy:   { label: 'Easy',   cols: 10, rows: 8,  time: 120, trapDensity: 0,    movers: 0, multiplier: 1,   color: 'var(--blue)' },
  medium: { label: 'Medium', cols: 14, rows: 11, time: 90,  trapDensity: 0.05, movers: 1, multiplier: 1.5, color: 'var(--purple)' },
  hard:   { label: 'Hard',   cols: 18, rows: 14, time: 60,  trapDensity: 0.09, movers: 3, multiplier: 2,   color: 'var(--red)' },
};

const CHARACTERS = [
  { id: 'classic', name: 'Classic Spider', body: '#ff2952', accent: '#0d0d12', glow: '#ff2952' },
  { id: 'neon',    name: 'Neon Spider',    body: '#a238ff', accent: '#00e5ff', glow: '#a238ff' },
  { id: 'shadow',  name: 'Shadow Spider',  body: '#15121f', accent: '#7a3bff', glow: '#7a3bff' },
  { id: 'cyber',   name: 'Cyber Spider',   body: '#2f6bff', accent: '#7cf6ff', glow: '#2f6bff' },
  { id: 'scarlet', name: 'Scarlet Spider', body: '#c81034', accent: '#15121f', glow: '#ff2952' },
  { id: 'ghost',   name: 'Ghost Spider',   body: '#f4f3fb', accent: '#a238ff', glow: '#c9b6ff' },
];

const ACHIEVEMENTS = [
  { id: 'first_escape',  name: 'First Escape',  icon: '🕳️', check: s => s.gamesWon >= 1 },
  { id: 'speed_runner',  name: 'Speed Runner',  icon: '⚡', check: s => s.speedRunner },
  { id: 'treasure_hunter', name: 'Treasure Hunter', icon: '💎', check: s => s.treasureHunter },
  { id: 'maze_master',   name: 'Maze Master',   icon: '🧩', check: s => s.mazeMaster },
  { id: 'spider_legend', name: 'Spider Legend', icon: '🕷️', check: s => s.gamesWon >= 10 },
];

function defaultProfile(){
  return {
    name: 'Player',
    character: 'classic',
    difficulty: 'easy',
    music: true,
    sfx: true,
    volume: 70,
    theme: 'dark',
    stats: {
      gamesPlayed: 0, gamesWon: 0, highScore: 0, bestTime: null,
      diffCounts: { easy: 0, medium: 0, hard: 0 },
      speedRunner: false, treasureHunter: false, mazeMaster: false,
    },
    achievements: [],
    leaderboard: [],
  };
}

function loadProfile(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultProfile();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultProfile(), parsed, {
      stats: Object.assign(defaultProfile().stats, parsed.stats || {}),
    });
  }catch(e){ return defaultProfile(); }
}

function saveProfile(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

let profile = loadProfile();

/* ---------------------------------------------------------------------- */
/* 2. AUDIO ENGINE (Web Audio API — fully synthesized, no external files) */
/* ---------------------------------------------------------------------- */
const Audio2 = (() => {
  let ctx = null;
  let musicNodes = null;
  let musicTimer = null;

  function ensureCtx(){
    if(!ctx){ ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    if(ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function vol(){ return (profile.volume / 100); }

  function tone({freq=440, dur=0.15, type='sine', gain=0.2, glideTo=null, delay=0}){
    if(!profile.sfx) return;
    const c = ensureCtx();
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if(glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * vol(), t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  const sfx = {
    click:   () => tone({freq: 520, dur: 0.08, type: 'square', gain: 0.12}),
    move:    () => tone({freq: 220, dur: 0.04, type: 'triangle', gain: 0.03}),
    collect: () => { tone({freq: 660, dur: 0.12, type: 'triangle', gain: 0.18}); tone({freq: 990, dur: 0.14, type: 'triangle', gain: 0.14, delay: 0.05}); },
    golden:  () => { [660,880,1100,1320].forEach((f,i)=>tone({freq:f, dur:0.16, type:'triangle', gain:0.18, delay:i*0.07})); },
    power:   () => tone({freq: 300, dur: 0.3, type: 'sawtooth', gain: 0.14, glideTo: 700}),
    hit:     () => tone({freq: 180, dur: 0.25, type: 'sawtooth', gain: 0.2, glideTo: 60}),
    victory: () => { [523,659,784,1046].forEach((f,i)=>tone({freq:f, dur:0.3, type:'triangle', gain:0.2, delay:i*0.12})); },
    gameover:() => { [400,300,200,120].forEach((f,i)=>tone({freq:f, dur:0.35, type:'sawtooth', gain:0.18, delay:i*0.15})); },
    achievement: () => { [784,988,1174].forEach((f,i)=>tone({freq:f, dur:0.2, type:'sine', gain:0.16, delay:i*0.09})); },
  };

  function startMusic(){
    if(!profile.music || musicTimer) return;
    const c = ensureCtx();
    const scale = [220, 246.94, 261.63, 293.66, 329.63, 349.23, 415.3]; // A minor-ish
    let step = 0;
    musicTimer = setInterval(() => {
      if(!profile.music) return;
      const note = scale[Math.floor(Math.random()*scale.length)] * (Math.random() > 0.7 ? 2 : 1);
      tone({freq: note, dur: 0.9, type: 'sine', gain: 0.045});
      if(step % 4 === 0) tone({freq: scale[0]/2, dur: 1.2, type: 'triangle', gain: 0.05});
      step++;
    }, 480);
  }
  function stopMusic(){ clearInterval(musicTimer); musicTimer = null; }
  function setMusic(on){ profile.music = on; on ? startMusic() : stopMusic(); }

  return { sfx, startMusic, stopMusic, setMusic, ensureCtx };
})();

/* ---------------------------------------------------------------------- */
/* 3. BACKGROUND FX — animated spider webs + floating particles           */
/* ---------------------------------------------------------------------- */
(function backgroundFX(){
  const webCanvas = document.getElementById('webCanvas');
  const particleCanvas = document.getElementById('particleCanvas');
  const wctx = webCanvas.getContext('2d');
  const pctx = particleCanvas.getContext('2d');
  let w, h;

  function resize(){
    w = webCanvas.width = particleCanvas.width = window.innerWidth;
    h = webCanvas.height = particleCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // Web strands: a few anchor points with radiating + concentric lines
  const anchors = Array.from({length: 3}, () => ({
    x: Math.random()*w, y: Math.random()*h,
    r: 140 + Math.random()*120, spokes: 7 + Math.floor(Math.random()*3),
    speed: (Math.random()*0.3+0.1) * (Math.random()>0.5?1:-1),
    hue: [ '255,41,82', '47,107,255', '162,56,255' ][Math.floor(Math.random()*3)],
  }));

  function drawWeb(a, t){
    wctx.save();
    wctx.translate(a.x, a.y);
    wctx.rotate(t * a.speed * 0.05);
    wctx.strokeStyle = `rgba(${a.hue},0.12)`;
    wctx.lineWidth = 1;
    for(let s=0;s<a.spokes;s++){
      const ang = (s / a.spokes) * Math.PI*2;
      wctx.beginPath();
      wctx.moveTo(0,0);
      wctx.lineTo(Math.cos(ang)*a.r, Math.sin(ang)*a.r);
      wctx.stroke();
    }
    for(let ring=1; ring<=4; ring++){
      wctx.beginPath();
      for(let s=0;s<=a.spokes;s++){
        const ang = (s / a.spokes) * Math.PI*2;
        const rr = (a.r/4)*ring;
        const px = Math.cos(ang)*rr, py = Math.sin(ang)*rr;
        s===0 ? wctx.moveTo(px,py) : wctx.lineTo(px,py);
      }
      wctx.stroke();
    }
    wctx.restore();
  }

  const particles = Array.from({length: 46}, () => ({
    x: Math.random()*w, y: Math.random()*h,
    r: Math.random()*2+0.5, vy: -(Math.random()*0.4+0.1),
    vx: (Math.random()-0.5)*0.2,
    hue: ['255,41,82','47,107,255','162,56,255','244,243,251'][Math.floor(Math.random()*4)],
    a: Math.random()*0.6+0.2,
  }));

  let t = 0;
  function frame(){
    t += 1;
    wctx.clearRect(0,0,w,h);
    anchors.forEach(a => drawWeb(a, t));

    pctx.clearRect(0,0,w,h);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if(p.y < -10){ p.y = h+10; p.x = Math.random()*w; }
      if(p.x < -10) p.x = w+10; if(p.x > w+10) p.x = -10;
      pctx.beginPath();
      pctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      pctx.fillStyle = `rgba(${p.hue},${p.a})`;
      pctx.fill();
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ---------------------------------------------------------------------- */
/* 4. SCREEN / UI ROUTING                                                 */
/* ---------------------------------------------------------------------- */
const screens = document.querySelectorAll('.screen');
function showScreen(name){
  screens.forEach(s => s.classList.toggle('active', s.dataset.screen === name));
}
function goHome(){
  stopGameLoop();
  showScreen('home');
  renderSelectedSummary();
}

function renderSelectedSummary(){
  const diff = DIFFICULTY[profile.difficulty];
  const char = CHARACTERS.find(c => c.id === profile.character);
  document.getElementById('selectedSummary').textContent = `${diff.label.toUpperCase()} · ${char.name.toUpperCase()}`;
}

document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if(!btn) return;
  const action = btn.dataset.action;
  Audio2.ensureCtx();
  if(action !== 'move') Audio2.sfx.click();
  handleAction(action, btn);
});

function handleAction(action, btn){
  switch(action){
    case 'go-home': closeSettings(); hideOverlays(); goHome(); break;
    case 'how-to-play': showScreen('howto'); break;
    case 'leaderboard': renderLeaderboard(); showScreen('leaderboard'); break;
    case 'profile': renderProfile(); showScreen('profile'); break;
    case 'start-game': renderSetup(); showScreen('setup'); break;
    case 'launch-game': hideOverlays(); playTransitionThenStart(); break;
    case 'resume': togglePause(false); break;
    case 'restart-run': hideOverlays(); startGameRun(); break;
    case 'open-settings': openSettings(); break;
    case 'play-again': hideOverlays(); startGameRun(); break;
    case 'next-level': hideOverlays(); bumpDifficulty(); startGameRun(); break;
    case 'retry': hideOverlays(); startGameRun(); break;
    case 'change-difficulty': hideOverlays(); renderSetup(); showScreen('setup'); break;
  }
}

function bumpDifficulty(){
  const order = ['easy','medium','hard'];
  const idx = order.indexOf(profile.difficulty);
  profile.difficulty = order[Math.min(idx+1, order.length-1)];
  saveProfile();
}

/* ----- Settings panel ----- */
const settingsPanel = document.getElementById('settingsPanel');
const settingsScrim = document.getElementById('settingsScrim');
function openSettings(){ settingsPanel.classList.add('open'); settingsScrim.classList.add('active'); syncSettingsUI(); }
function closeSettings(){ settingsPanel.classList.remove('open'); settingsScrim.classList.remove('active'); }
document.getElementById('settingsFab').addEventListener('click', openSettings);
document.getElementById('closeSettings').addEventListener('click', closeSettings);
settingsScrim.addEventListener('click', closeSettings);

document.getElementById('musicToggle').addEventListener('change', e => { Audio2.setMusic(e.target.checked); saveProfile(); });
document.getElementById('sfxToggle').addEventListener('change', e => { profile.sfx = e.target.checked; saveProfile(); });
document.getElementById('volumeSlider').addEventListener('input', e => { profile.volume = +e.target.value; saveProfile(); });

document.getElementById('themeToggle').addEventListener('click', e => {
  const b = e.target.closest('.theme-btn'); if(!b) return;
  profile.theme = b.dataset.theme;
  document.documentElement.setAttribute('data-theme', profile.theme);
  document.querySelectorAll('.theme-btn').forEach(x => x.classList.toggle('active', x === b));
  saveProfile();
});

function syncSettingsUI(){
  document.getElementById('musicToggle').checked = profile.music;
  document.getElementById('sfxToggle').checked = profile.sfx;
  document.getElementById('volumeSlider').value = profile.volume;
  document.documentElement.setAttribute('data-theme', profile.theme);
  document.querySelectorAll('.theme-btn').forEach(x => x.classList.toggle('active', x.dataset.theme === profile.theme));
  buildDifficultyPicker(document.getElementById('settingsDifficultyGrid'));
  buildCharacterPicker(document.getElementById('settingsCharacterGrid'));
}

/* ---------------------------------------------------------------------- */
/* 5. CHARACTER & AVATAR RENDERING                                        */
/* ---------------------------------------------------------------------- */
function drawSpider(ctx, cx, cy, radius, char, phase, moving){
  const legSway = moving ? Math.sin(phase*0.02)*0.35 : Math.sin(phase*0.006)*0.08;
  ctx.save();
  ctx.translate(cx, cy);

  // glow
  ctx.shadowColor = char.glow; ctx.shadowBlur = radius*0.9;

  // legs (4 per side)
  ctx.strokeStyle = char.accent; ctx.lineWidth = Math.max(1.6, radius*0.14);
  ctx.lineCap = 'round';
  for(let side = -1; side <= 1; side += 2){
    for(let i=0;i<4;i++){
      const baseAngle = side * (0.5 + i*0.32);
      const sway = legSway * (i%2===0?1:-1);
      const kneeX = Math.cos(baseAngle+sway) * radius*1.5;
      const kneeY = Math.sin(baseAngle*0.6+sway) * radius*0.9 - radius*0.1;
      const footX = Math.cos(baseAngle+sway*1.4) * radius*2.2;
      const footY = Math.sin(baseAngle*0.5+sway*1.4) * radius*1.6 + radius*0.5;
      ctx.beginPath();
      ctx.moveTo(0, -radius*0.1);
      ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
      ctx.stroke();
    }
  }

  // abdomen
  ctx.shadowBlur = radius*0.5;
  ctx.fillStyle = char.body;
  ctx.beginPath();
  ctx.ellipse(0, radius*0.15, radius*0.85, radius*0.95, 0, 0, Math.PI*2);
  ctx.fill();

  // head
  ctx.beginPath();
  ctx.ellipse(0, -radius*0.75, radius*0.5, radius*0.45, 0, 0, Math.PI*2);
  ctx.fill();

  // web-marking accent
  ctx.strokeStyle = char.accent; ctx.lineWidth = Math.max(1, radius*0.06); ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.moveTo(0, -radius*0.4); ctx.lineTo(0, radius*0.9); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-radius*0.6, radius*0.1); ctx.lineTo(radius*0.6, radius*0.1); ctx.stroke();

  // eyes
  ctx.fillStyle = char.accent === '#0d0d12' ? '#ffffff' : char.accent;
  [-1,1].forEach(s => {
    ctx.beginPath();
    ctx.ellipse(s*radius*0.22, -radius*0.78, radius*0.16, radius*0.2, 0, 0, Math.PI*2);
    ctx.fill();
  });

  ctx.restore();
}

function renderMiniAvatar(container, char, size=64){
  container.innerHTML = '';
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  container.appendChild(c);
  const ctx = c.getContext('2d');
  let phase = 0;
  (function loop(){
    ctx.clearRect(0,0,size,size);
    drawSpider(ctx, size/2, size/2+size*0.08, size*0.28, char, phase, false);
    phase++;
    if(container.isConnected) requestAnimationFrame(loop);
  })();
}

function buildCharacterPicker(container){
  container.innerHTML = '';
  CHARACTERS.forEach(char => {
    const card = document.createElement('button');
    card.className = 'char-card' + (char.id === profile.character ? ' selected' : '');
    card.style.setProperty('--char-color', char.glow);
    card.innerHTML = `<div class="char-card__avatar"></div><span class="char-card__name">${char.name}</span>`;
    card.addEventListener('click', () => {
      profile.character = char.id; saveProfile();
      container.querySelectorAll('.char-card').forEach(x => x.classList.remove('selected'));
      card.classList.add('selected');
      renderSelectedSummary();
    });
    container.appendChild(card);
    renderMiniAvatar(card.querySelector('.char-card__avatar'), char, 56);
  });
}

function buildDifficultyPicker(container){
  container.querySelectorAll('.diff-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.diff === profile.difficulty);
    card.onclick = () => {
      profile.difficulty = card.dataset.diff; saveProfile();
      container.querySelectorAll('.diff-card').forEach(x => x.classList.remove('selected'));
      card.classList.add('selected');
      renderSelectedSummary();
    };
  });
}

/* ---------------------------------------------------------------------- */
/* SETUP SCREEN                                                           */
/* ---------------------------------------------------------------------- */
function renderSetup(){
  buildDifficultyPicker(document.getElementById('difficultyGrid'));
  buildCharacterPicker(document.getElementById('characterGrid'));
}

function playTransitionThenStart(){
  const diff = DIFFICULTY[profile.difficulty];
  document.getElementById('transitionDiffText').textContent = 'You Selected: ' + diff.label.toUpperCase();
  const fill = document.getElementById('transitionFill');
  fill.style.width = '0%';
  showScreen('transition');
  requestAnimationFrame(() => { fill.style.width = '100%'; });
  setTimeout(() => { startGameRun(); }, 1100);
}

/* ---------------------------------------------------------------------- */
/* 6. MAZE GENERATION (recursive backtracker)                             */
/* ---------------------------------------------------------------------- */
function generateMaze(cols, rows){
  // cell: {walls:{N,E,S,W}: bool present, visited}
  const grid = [];
  for(let y=0;y<rows;y++){
    const row = [];
    for(let x=0;x<cols;x++) row.push({ x, y, walls: {N:true,E:true,S:true,W:true}, visited:false });
    grid.push(row);
  }
  const at = (x,y) => (x>=0&&x<cols&&y>=0&&y<rows) ? grid[y][x] : null;
  const DIRS = [
    ['N',0,-1,'S'], ['E',1,0,'W'], ['S',0,1,'N'], ['W',-1,0,'E'],
  ];
  const stack = [grid[0][0]];
  grid[0][0].visited = true;
  while(stack.length){
    const cur = stack[stack.length-1];
    const options = DIRS
      .map(([dir,dx,dy,opp]) => ({dir, opp, cell: at(cur.x+dx, cur.y+dy)}))
      .filter(o => o.cell && !o.cell.visited);
    if(!options.length){ stack.pop(); continue; }
    const choice = options[Math.floor(Math.random()*options.length)];
    cur.walls[choice.dir] = false;
    choice.cell.walls[choice.opp] = false;
    choice.cell.visited = true;
    stack.push(choice.cell);
  }
  // add a few extra connections for shortcuts (loops)
  const extra = Math.floor((cols*rows) * 0.04);
  for(let i=0;i<extra;i++){
    const x = Math.floor(Math.random()*cols), y = Math.floor(Math.random()*rows);
    const cell = grid[y][x];
    const [dir,dx,dy,opp] = DIRS[Math.floor(Math.random()*4)];
    const n = at(x+dx,y+dy);
    if(n){ cell.walls[dir] = false; n.walls[opp] = false; }
  }
  return grid;
}

function bfsSolve(grid, cols, rows, start, goal){
  const key = (x,y) => y*cols+x;
  const prev = new Map();
  const q = [start];
  const seen = new Set([key(start.x,start.y)]);
  const DIRS = [['N',0,-1],['E',1,0],['S',0,1],['W',-1,0]];
  while(q.length){
    const cur = q.shift();
    if(cur.x === goal.x && cur.y === goal.y) break;
    const cell = grid[cur.y][cur.x];
    for(const [dir,dx,dy] of DIRS){
      if(cell.walls[dir]) continue;
      const nx = cur.x+dx, ny = cur.y+dy;
      if(nx<0||ny<0||nx>=cols||ny>=rows) continue;
      const k = key(nx,ny);
      if(seen.has(k)) continue;
      seen.add(k); prev.set(k, cur);
      q.push({x:nx,y:ny});
    }
  }
  const path = [];
  let cur = goal, guard=0;
  while(cur && !(cur.x===start.x && cur.y===start.y) && guard++<10000){
    path.unshift(cur);
    cur = prev.get(key(cur.x,cur.y));
  }
  path.unshift(start);
  return path;
}

/* ---------------------------------------------------------------------- */
/* 7. GAME STATE / LOOP                                                   */
/* ---------------------------------------------------------------------- */
const gameCanvas = document.getElementById('gameCanvas');
const gctx = gameCanvas.getContext('2d');
const minimapCanvas = document.getElementById('minimapCanvas');
const mctx = minimapCanvas.getContext('2d');

let G = null; // active game state
let rafId = null;
let keys = {};

function stopGameLoop(){
  if(rafId) cancelAnimationFrame(rafId);
  rafId = null;
  Audio2.stopMusic();
  document.getElementById('screen-game').classList.remove('active');
}

function startGameRun(){
  const diffKey = profile.difficulty;
  const diff = DIFFICULTY[diffKey];
  const char = CHARACTERS.find(c => c.id === profile.character);
  const cols = diff.cols, rows = diff.rows;
  const grid = generateMaze(cols, rows);
  const start = {x:0,y:0}, goal = {x:cols-1, y:rows-1};
  const solutionPath = bfsSolve(grid, cols, rows, start, goal);

  // gather path cells (walkable) excluding start for item placement
  const allCells = [];
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) allCells.push({x,y});
  const farFromStart = allCells.filter(c => Math.abs(c.x-start.x)+Math.abs(c.y-start.y) > 2 && !(c.x===goal.x&&c.y===goal.y));
  shuffle(farFromStart);

  const emblemCount = Math.max(5, Math.floor(cols*rows*0.14));
  const emblems = farFromStart.slice(0, emblemCount).map(c => ({...c, taken:false}));
  const goldenCount = diffKey === 'easy' ? 1 : diffKey === 'medium' ? 2 : 3;
  const goldens = farFromStart.slice(emblemCount, emblemCount+goldenCount).map(c => ({...c, taken:false}));

  const trapCount = Math.floor(cols*rows*diff.trapDensity);
  const traps = farFromStart.slice(emblemCount+goldenCount, emblemCount+goldenCount+trapCount).map(c => ({...c}));

  const moverCount = diff.movers;
  const movers = [];
  for(let i=0;i<moverCount;i++){
    const cell = farFromStart[emblemCount+goldenCount+trapCount+i];
    if(!cell) continue;
    // find a neighbor to patrol toward
    const neighborsOpen = [];
    const c = grid[cell.y][cell.x];
    if(!c.walls.N) neighborsOpen.push({x:cell.x,y:cell.y-1});
    if(!c.walls.S) neighborsOpen.push({x:cell.x,y:cell.y+1});
    if(!c.walls.E) neighborsOpen.push({x:cell.x+1,y:cell.y});
    if(!c.walls.W) neighborsOpen.push({x:cell.x-1,y:cell.y});
    const target = neighborsOpen[0] || cell;
    movers.push({ a:{x:cell.x,y:cell.y}, b: target, t:0, dir:1, speed: 0.5 + Math.random()*0.3 });
  }

  const powerTypes = ['speed','freeze','sense','shield'];

  G = {
    diffKey, diff, char, cols, rows, grid, start, goal, solutionPath,
    emblems, goldens, traps, movers, powerTypes,
    powerups: [],
    cellSize: 0,
    player: {
      px: 0.5, py: 0.5, // cell-space coordinates (float)
      angle: 0, moving:false, phase:0,
      speedMult: 1, speedTimer: 0,
      shielded: false,
      slowTimer: 0,
    },
    score: 0,
    moves: 0,
    timeLeft: diff.time,
    totalTime: diff.time,
    freezeTimer: 0,
    senseTimer: 0,
    paused: false,
    over: false,
    startedAt: performance.now(),
    lastTs: performance.now(),
    powerSpawnCooldown: 6000,
    emblemsTotal: emblems.length,
    treasureHunterEligible: true,
  };

  moveAccum = 0;
  showScreen('game');
  document.getElementById('screen-game').classList.add('active');
  hideOverlays();
  resizeGameCanvas();

  document.getElementById('hudPlayerName').textContent = profile.name || 'Player';
  document.getElementById('hudDifficulty').textContent = diff.label.toUpperCase();
  document.getElementById('hudBest').textContent = profile.stats.highScore;
  renderMiniAvatar(document.getElementById('hudAvatar'), char, 38);

  Audio2.startMusic();
  if(rafId) cancelAnimationFrame(rafId);
  G.lastTs = performance.now();
  rafId = requestAnimationFrame(loop);
}

function resizeGameCanvas(){
  if(!G) return;
  const stage = gameCanvas.parentElement;
  const maxW = stage.clientWidth - 4;
  const maxH = stage.clientHeight - 4;
  const cell = Math.max(14, Math.min(Math.floor(maxW / G.cols), Math.floor(maxH / G.rows), 46));
  G.cellSize = cell;
  gameCanvas.width = cell * G.cols;
  gameCanvas.height = cell * G.rows;
  minimapCanvas.width = 130; minimapCanvas.height = 130;
}
window.addEventListener('resize', resizeGameCanvas);

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}

/* ----- Input ----- */
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
  if(e.key === 'Escape' && G && !G.over) togglePause(!G.paused);
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

document.querySelectorAll('.dpad-btn').forEach(btn => {
  const setDir = (v) => { keys['__'+btn.dataset.dir] = v; };
  btn.addEventListener('touchstart', e => { e.preventDefault(); setDir(true); }, {passive:false});
  btn.addEventListener('touchend', e => { e.preventDefault(); setDir(false); }, {passive:false});
  btn.addEventListener('mousedown', () => setDir(true));
  btn.addEventListener('mouseup', () => setDir(false));
  btn.addEventListener('mouseleave', () => setDir(false));
});

document.getElementById('pauseBtn').addEventListener('click', () => togglePause(!G.paused));
document.getElementById('restartBtn').addEventListener('click', () => { hideOverlays(); startGameRun(); });
document.getElementById('homeBtn').addEventListener('click', goHome);

function togglePause(state){
  if(!G || G.over) return;
  G.paused = state;
  document.getElementById('pauseOverlay').classList.toggle('active', state);
}

/* ----- Main loop ----- */
function loop(ts){
  if(!G) return;
  const dt = Math.min(48, ts - G.lastTs);
  G.lastTs = ts;
  if(!G.paused && !G.over) update(dt);
  render();
  rafId = requestAnimationFrame(loop);
}

function update(dt){
  const cellWallsOf = (x,y) => G.grid[y] && G.grid[y][x] ? G.grid[y][x].walls : null;

  // input direction
  let dx=0, dy=0;
  if(keys['w'] || keys['arrowup'] || keys['__up']) dy = -1;
  if(keys['s'] || keys['arrowdown'] || keys['__down']) dy = 1;
  if(keys['a'] || keys['arrowleft'] || keys['__left']) dx = -1;
  if(keys['d'] || keys['arrowright'] || keys['__right']) dx = 1;

  const p = G.player;
  p.moving = (dx !== 0 || dy !== 0);
  if(p.moving) p.phase += dt;

  // normalize diagonal
  if(dx && dy){ dx *= 0.7071; dy *= 0.7071; }

  let speed = 0.0042 * dt * p.speedMult;
  if(p.slowTimer > 0){ speed *= 0.4; p.slowTimer -= dt; }
  if(p.speedTimer > 0){ p.speedTimer -= dt; if(p.speedTimer<=0) p.speedMult = 1; }

  const cellX = Math.floor(p.px), cellY = Math.floor(p.py);
  const walls = cellWallsOf(cellX, cellY) || {N:true,E:true,S:true,W:true};
  const margin = 0.16;

  // resolve X axis
  if(dx !== 0){
    let nx = p.px + dx*speed;
    const targetCellX = Math.floor(nx + (dx>0?margin:-margin));
    if(dx>0 && walls.E && targetCellX > cellX) nx = cellX + 1 - margin;
    if(dx<0 && walls.W && targetCellX < cellX) nx = cellX + margin;
    nx = Math.max(margin, Math.min(G.cols-margin, nx));
    p.px = nx;
  }
  // resolve Y axis
  if(dy !== 0){
    let ny = p.py + dy*speed;
    const cx2 = Math.floor(p.px);
    const w2 = cellWallsOf(cx2, Math.floor(p.py)) || walls;
    const targetCellY = Math.floor(ny + (dy>0?margin:-margin));
    if(dy>0 && w2.S && targetCellY > cellY) ny = cellY + 1 - margin;
    if(dy<0 && w2.N && targetCellY < cellY) ny = cellY + margin;
    ny = Math.max(margin, Math.min(G.rows-margin, ny));
    p.py = ny;
    if (dy!==0 || dx!==0) countMoveMaybe();
  } else if(dx !== 0){ countMoveMaybe(); }

  if(p.moving && Math.random() < 0.02) Audio2.sfx.move();

  // collectibles
  const pcx = Math.floor(p.px), pcy = Math.floor(p.py);
  G.emblems.forEach(em => {
    if(!em.taken && em.x===pcx && em.y===pcy){
      em.taken = true; G.score += 10 * G.diff.multiplier;
      Audio2.sfx.collect(); spawnFloatText('+' + Math.round(10*G.diff.multiplier));
    }
  });
  G.goldens.forEach(gd => {
    if(!gd.taken && gd.x===pcx && gd.y===pcy){
      gd.taken = true; G.score += 50 * G.diff.multiplier;
      Audio2.sfx.golden(); spawnFloatText('+' + Math.round(50*G.diff.multiplier) + ' ★');
    }
  });

  // traps (webs) slow player
  G.traps.forEach(tr => {
    if(tr.x===pcx && tr.y===pcy) p.slowTimer = 260;
  });

  // moving obstacles
  G.movers.forEach(m => {
    m.t += dt * 0.001 * m.speed * m.dir;
    if(m.t >= 1){ m.t = 1; m.dir = -1; }
    if(m.t <= 0){ m.t = 0; m.dir = 1; }
    m.cx = m.a.x + (m.b.x-m.a.x) * m.t;
    m.cy = m.a.y + (m.b.y-m.a.y) * m.t;
    const dist = Math.hypot(m.cx - p.px, m.cy - p.py);
    if(dist < 0.35 && (!p.hitCooldown || p.hitCooldown <= 0)){
      if(p.shielded){ p.shielded = false; spawnFloatText('SHIELD BLOCKED'); }
      else { G.timeLeft = Math.max(0, G.timeLeft - 5); Audio2.sfx.hit(); spawnFloatText('-5s'); }
      p.hitCooldown = 1200;
    }
  });
  if(p.hitCooldown > 0) p.hitCooldown -= dt;

  // power-ups spawn
  G.powerSpawnCooldown -= dt;
  if(G.powerSpawnCooldown <= 0){
    G.powerSpawnCooldown = 7000 + Math.random()*5000;
    trySpawnPowerup();
  }
  // power-up pickup
  G.powerups = G.powerups.filter(pu => {
    if(pu.x===pcx && pu.y===pcy){
      applyPowerup(pu.type);
      return false;
    }
    return true;
  });

  // sense / freeze timers
  if(G.senseTimer>0) G.senseTimer -= dt;
  if(G.freezeTimer>0){ G.freezeTimer -= dt; } else {
    G.timeLeft -= dt/1000;
  }
  if(G.timeLeft <= 0){ G.timeLeft = 0; endGame(false); return; }

  // win check
  if(pcx === G.goal.x && pcy === G.goal.y){ endGame(true); return; }

  updateHUD();
}

let moveAccum = 0;
function countMoveMaybe(){
  moveAccum++;
  if(moveAccum % 14 === 0){ G.moves++; }
}

function trySpawnPowerup(){
  if(G.powerups.length >= 2) return;
  const candidates = [];
  for(let y=0;y<G.rows;y++) for(let x=0;x<G.cols;x++){
    if(Math.abs(x-Math.floor(G.player.px)) + Math.abs(y-Math.floor(G.player.py)) > 2) candidates.push({x,y});
  }
  if(!candidates.length) return;
  const c = candidates[Math.floor(Math.random()*candidates.length)];
  const type = G.powerTypes[Math.floor(Math.random()*G.powerTypes.length)];
  G.powerups.push({x:c.x, y:c.y, type});
}

function applyPowerup(type){
  Audio2.sfx.power();
  const p = G.player;
  if(type==='speed'){ p.speedMult = 1.8; p.speedTimer = 5000; showPowerChip('⚡ Speed Boost'); }
  if(type==='freeze'){ G.freezeTimer = 4000; showPowerChip('⏳ Time Freeze'); }
  if(type==='sense'){ G.senseTimer = 5000; showPowerChip('🕸️ Spider Sense'); }
  if(type==='shield'){ p.shielded = true; showPowerChip('🛡️ Shield'); }
}

function showPowerChip(text){
  const tray = document.getElementById('powerTray');
  const chip = document.createElement('div');
  chip.className = 'power-chip';
  chip.textContent = text;
  tray.appendChild(chip);
  setTimeout(() => chip.remove(), 3000);
}

let floatTexts = [];
function spawnFloatText(text){
  floatTexts.push({ text, x: G.player.px, y: G.player.py, life: 900 });
}

/* ----- Rendering ----- */
function render(){
  if(!G) return;
  const cell = G.cellSize;
  gctx.clearRect(0,0,gameCanvas.width, gameCanvas.height);

  // floor
  gctx.fillStyle = '#0c0b14';
  gctx.fillRect(0,0,gameCanvas.width, gameCanvas.height);
  // subtle grid
  gctx.strokeStyle = 'rgba(255,255,255,0.03)';
  for(let x=0;x<=G.cols;x++){ gctx.beginPath(); gctx.moveTo(x*cell,0); gctx.lineTo(x*cell, gameCanvas.height); gctx.stroke(); }
  for(let y=0;y<=G.rows;y++){ gctx.beginPath(); gctx.moveTo(0,y*cell); gctx.lineTo(gameCanvas.width, y*cell); gctx.stroke(); }

  // spider-sense path overlay
  if(G.senseTimer > 0){
    gctx.strokeStyle = 'rgba(162,56,255,0.55)';
    gctx.lineWidth = Math.max(2, cell*0.14);
    gctx.beginPath();
    G.solutionPath.forEach((c,i) => {
      const cx = c.x*cell+cell/2, cy = c.y*cell+cell/2;
      i===0 ? gctx.moveTo(cx,cy) : gctx.lineTo(cx,cy);
    });
    gctx.stroke();
  }

  // start & goal
  drawGate(G.start.x*cell, G.start.y*cell, cell, 'var(--blue)', '#2f6bff');
  drawGate(G.goal.x*cell, G.goal.y*cell, cell, 'var(--red)', '#ff2952', true);

  // traps
  G.traps.forEach(tr => drawWebTrap(tr.x*cell, tr.y*cell, cell));

  // emblems
  G.emblems.forEach(em => { if(!em.taken) drawEmblem(em.x*cell+cell/2, em.y*cell+cell/2, cell*0.28, '#f4f3fb'); });
  G.goldens.forEach(gd => { if(!gd.taken) drawEmblem(gd.x*cell+cell/2, gd.y*cell+cell/2, cell*0.34, '#ffd23f', true); });

  // powerups
  G.powerups.forEach(pu => drawPowerup(pu.x*cell+cell/2, pu.y*cell+cell/2, cell*0.3, pu.type));

  // movers
  G.movers.forEach(m => {
    if(m.cx===undefined) return;
    drawWebTrap(m.cx*cell, m.cy*cell, cell, true);
  });

  // walls
  gctx.strokeStyle = '#f4f3fb';
  gctx.lineCap = 'round';
  gctx.lineWidth = Math.max(2, cell*0.09);
  gctx.shadowColor = 'rgba(162,56,255,0.5)'; gctx.shadowBlur = 4;
  for(let y=0;y<G.rows;y++){
    for(let x=0;x<G.cols;x++){
      const c = G.grid[y][x];
      const px = x*cell, py = y*cell;
      gctx.beginPath();
      if(c.walls.N){ gctx.moveTo(px,py); gctx.lineTo(px+cell,py); }
      if(c.walls.W){ gctx.moveTo(px,py); gctx.lineTo(px,py+cell); }
      if(x===G.cols-1 && c.walls.E){ gctx.moveTo(px+cell,py); gctx.lineTo(px+cell,py+cell); }
      if(y===G.rows-1 && c.walls.S){ gctx.moveTo(px,py+cell); gctx.lineTo(px+cell,py+cell); }
      gctx.stroke();
    }
  }
  gctx.shadowBlur = 0;

  // player
  drawSpider(gctx, G.player.px*cell, G.player.py*cell, cell*0.4, G.char, G.player.phase, G.player.moving);
  if(G.player.shielded){
    gctx.save();
    gctx.strokeStyle = 'rgba(47,107,255,0.8)'; gctx.lineWidth = 2;
    gctx.beginPath(); gctx.arc(G.player.px*cell, G.player.py*cell, cell*0.62, 0, Math.PI*2); gctx.stroke();
    gctx.restore();
  }

  // float texts
  gctx.font = `700 ${Math.max(11,cell*0.4)}px var(--font-body, sans-serif)`;
  gctx.textAlign = 'center';
  floatTexts.forEach(f => {
    gctx.globalAlpha = Math.max(0, f.life/900);
    gctx.fillStyle = '#ffd23f';
    gctx.fillText(f.text, f.x*cell, f.y*cell - (900-f.life)*0.05);
    f.life -= 16;
  });
  gctx.globalAlpha = 1;
  floatTexts = floatTexts.filter(f => f.life > 0);

  renderMinimap();
}

function drawGate(px,py,cell,cssVar,color,isExit){
  gctx.save();
  gctx.shadowColor = color; gctx.shadowBlur = cell*0.6;
  gctx.fillStyle = `${color}22`;
  gctx.fillRect(px+cell*0.08, py+cell*0.08, cell*0.84, cell*0.84);
  gctx.strokeStyle = color; gctx.lineWidth = Math.max(1.5, cell*0.08);
  gctx.strokeRect(px+cell*0.08, py+cell*0.08, cell*0.84, cell*0.84);
  if(isExit){
    gctx.fillStyle = color;
    gctx.font = `${cell*0.5}px sans-serif`;
    gctx.textAlign='center'; gctx.textBaseline='middle';
    gctx.fillText('🚪', px+cell/2, py+cell/2);
  }
  gctx.restore();
}

function drawEmblem(cx,cy,r,color,golden){
  gctx.save();
  gctx.translate(cx,cy);
  gctx.shadowColor = color; gctx.shadowBlur = golden ? 14 : 6;
  gctx.fillStyle = color;
  gctx.beginPath();
  for(let i=0;i<8;i++){
    const ang = (i/8)*Math.PI*2;
    gctx.moveTo(0,0);
    gctx.lineTo(Math.cos(ang)*r, Math.sin(ang)*r);
  }
  gctx.strokeStyle = color; gctx.lineWidth = r*0.18; gctx.stroke();
  gctx.beginPath(); gctx.arc(0,0,r*0.4,0,Math.PI*2); gctx.fill();
  gctx.restore();
}

function drawWebTrap(px,py,cell, isMover){
  gctx.save();
  gctx.translate(px+cell/2, py+cell/2);
  gctx.strokeStyle = isMover ? 'rgba(255,41,82,0.85)' : 'rgba(162,56,255,0.55)';
  gctx.lineWidth = 1.4;
  gctx.shadowColor = isMover ? '#ff2952' : '#a238ff'; gctx.shadowBlur = 6;
  for(let i=0;i<6;i++){
    const ang = (i/6)*Math.PI*2;
    gctx.beginPath(); gctx.moveTo(0,0); gctx.lineTo(Math.cos(ang)*cell*0.4, Math.sin(ang)*cell*0.4); gctx.stroke();
  }
  for(let r=1;r<=2;r++){
    gctx.beginPath();
    for(let i=0;i<=6;i++){ const ang=(i/6)*Math.PI*2; const px2=Math.cos(ang)*cell*0.4*r/2, py2=Math.sin(ang)*cell*0.4*r/2; i===0?gctx.moveTo(px2,py2):gctx.lineTo(px2,py2); }
    gctx.stroke();
  }
  gctx.restore();
}

function drawPowerup(cx,cy,r,type){
  const icons = {speed:'⚡',freeze:'⏳',sense:'🕸️',shield:'🛡️'};
  gctx.save();
  gctx.shadowColor = '#ffd23f'; gctx.shadowBlur = 10;
  gctx.font = `${r*1.8}px sans-serif`;
  gctx.textAlign='center'; gctx.textBaseline='middle';
  gctx.fillText(icons[type]||'❔', cx, cy);
  gctx.restore();
}

function renderMinimap(){
  const w = minimapCanvas.width, h = minimapCanvas.height;
  mctx.clearRect(0,0,w,h);
  const cs = Math.min(w/G.cols, h/G.rows);
  mctx.strokeStyle = 'rgba(244,243,251,0.5)'; mctx.lineWidth = 1;
  for(let y=0;y<G.rows;y++){
    for(let x=0;x<G.cols;x++){
      const c = G.grid[y][x];
      const px=x*cs, py=y*cs;
      mctx.beginPath();
      if(c.walls.N){ mctx.moveTo(px,py); mctx.lineTo(px+cs,py); }
      if(c.walls.W){ mctx.moveTo(px,py); mctx.lineTo(px,py+cs); }
      mctx.stroke();
    }
  }
  mctx.fillStyle = '#2f6bff'; mctx.fillRect(G.start.x*cs, G.start.y*cs, cs, cs);
  mctx.fillStyle = '#ff2952'; mctx.fillRect(G.goal.x*cs, G.goal.y*cs, cs, cs);
  mctx.fillStyle = G.char.body;
  mctx.beginPath(); mctx.arc(G.player.px*cs, G.player.py*cs, Math.max(2,cs*0.4), 0, Math.PI*2); mctx.fill();
}

/* ---------------------------------------------------------------------- */
/* 8. HUD / END STATES / LEADERBOARD / ACHIEVEMENTS                       */
/* ---------------------------------------------------------------------- */
function updateHUD(){
  document.getElementById('hudScore').textContent = Math.round(G.score);
  document.getElementById('hudMoves').textContent = G.moves;
  const taken = G.emblems.filter(e=>e.taken).length + G.goldens.filter(g=>g.taken).length;
  document.getElementById('hudEmblems').textContent = `${taken}/${G.emblems.length+G.goldens.length}`;
  const timeEl = document.getElementById('hudTime');
  timeEl.textContent = Math.ceil(G.timeLeft);
  timeEl.parentElement.classList.toggle('low', G.timeLeft <= 10);
}

function hideOverlays(){
  document.getElementById('pauseOverlay').classList.remove('active');
  document.getElementById('victoryOverlay').classList.remove('active');
  document.getElementById('gameoverOverlay').classList.remove('active');
}

function endGame(won){
  if(!G || G.over) return;
  G.over = true;
  Audio2.stopMusic();
  const timeUsed = G.totalTime - G.timeLeft;
  const stats = profile.stats;
  stats.gamesPlayed++;
  stats.diffCounts[G.diffKey] = (stats.diffCounts[G.diffKey]||0)+1;

  if(won){
    Audio2.sfx.victory();
    const emblemPts = G.score;
    const timeBonus = Math.round(G.timeLeft * 5 * G.diff.multiplier);
    const total = Math.round(emblemPts + timeBonus);
    stats.gamesWon++;
    stats.highScore = Math.max(stats.highScore, total);
    if(stats.bestTime === null || timeUsed < stats.bestTime) stats.bestTime = timeUsed;

    const allCollected = G.emblems.every(e=>e.taken) && G.goldens.every(g=>g.taken);
    if(allCollected) stats.treasureHunter = true;
    if(G.timeLeft / G.totalTime > 0.5) stats.speedRunner = true;
    if(G.diffKey === 'hard') stats.mazeMaster = true;

    addLeaderboardEntry({ name: profile.name||'Player', difficulty: G.diffKey, score: total, time: timeUsed });

    const stars = allCollected && G.timeLeft/G.totalTime>0.4 ? 3 : (total > 60 ? 2 : 1);
    document.getElementById('resDiff').textContent = G.diff.label;
    document.getElementById('resTime').textContent = formatTime(timeUsed);
    document.getElementById('resMoves').textContent = G.moves;
    document.getElementById('resScore').textContent = Math.round(emblemPts);
    document.getElementById('resBonus').textContent = timeBonus;
    document.getElementById('resTotal').textContent = total;
    const starEl = document.getElementById('victoryStars');
    starEl.innerHTML = '★★★'.split('').map((s,i)=>`<span class="${i<stars?'lit':''}">★</span>`).join('');
    document.getElementById('victoryOverlay').classList.add('active');
    launchConfetti();
  } else {
    Audio2.sfx.gameover();
    document.getElementById('gameoverReason').textContent = 'Time Ran Out';
    document.getElementById('gameoverOverlay').classList.add('active');
  }

  saveProfile();
  checkAchievements();
}

function formatTime(sec){
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec/60), s = sec%60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function addLeaderboardEntry(entry){
  profile.leaderboard.push({...entry, date: Date.now()});
  profile.leaderboard.sort((a,b) => b.score - a.score);
  profile.leaderboard = profile.leaderboard.slice(0, 50);
}

function renderLeaderboard(filter='all'){
  const body = document.getElementById('leaderboardBody');
  const rows = profile.leaderboard.filter(r => filter==='all' || r.difficulty===filter);
  body.innerHTML = '';
  document.getElementById('lbEmpty').hidden = rows.length>0;
  rows.forEach((r,i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${DIFFICULTY[r.difficulty].label}</td><td>${Math.round(r.score)}</td><td>${formatTime(r.time)}</td>`;
    body.appendChild(tr);
  });
}
document.getElementById('lbFilters').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if(!chip) return;
  document.querySelectorAll('#lbFilters .chip').forEach(c=>c.classList.remove('active'));
  chip.classList.add('active');
  renderLeaderboard(chip.dataset.diff);
});

function escapeHtml(str){ const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

function renderProfile(){
  const char = CHARACTERS.find(c => c.id === profile.character);
  renderMiniAvatar(document.getElementById('profileAvatarPreview'), char, 100);
  const nameInput = document.getElementById('playerNameInput');
  nameInput.value = profile.name;
  nameInput.oninput = () => { profile.name = nameInput.value.slice(0,16); saveProfile(); };

  const s = profile.stats;
  document.getElementById('statPlayed').textContent = s.gamesPlayed;
  document.getElementById('statWon').textContent = s.gamesWon;
  document.getElementById('statHigh').textContent = s.highScore;
  document.getElementById('statBestTime').textContent = s.bestTime===null ? '—' : formatTime(s.bestTime);
  const favDiff = Object.entries(s.diffCounts).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('profFavDiff').textContent = favDiff && favDiff[1]>0 ? DIFFICULTY[favDiff[0]].label : '—';

  const grid = document.getElementById('achievementGrid');
  grid.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const unlocked = profile.achievements.includes(a.id);
    const el = document.createElement('div');
    el.className = 'achievement' + (unlocked?' unlocked':'');
    el.innerHTML = `<span class="achievement__icon">${a.icon}</span><span class="achievement__name">${a.name}</span>`;
    grid.appendChild(el);
  });
}

function checkAchievements(){
  const s = profile.stats;
  ACHIEVEMENTS.forEach(a => {
    if(!profile.achievements.includes(a.id) && a.check(s)){
      profile.achievements.push(a.id);
      showToast(`${a.icon} Achievement Unlocked: ${a.name}`);
      Audio2.sfx.achievement();
    }
  });
  saveProfile();
}

function showToast(text){
  const stack = document.getElementById('toastStack');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  stack.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ----- Confetti (victory) ----- */
function launchConfetti(){
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  const resize = () => { canvas.width = canvas.parentElement.clientWidth; canvas.height = canvas.parentElement.clientHeight; };
  resize();
  const colors = ['#ff2952','#2f6bff','#a238ff','#f4f3fb','#ffd23f'];
  const pieces = Array.from({length: 90}, () => ({
    x: Math.random()*canvas.width, y: -20 - Math.random()*200,
    vy: 2+Math.random()*3, vx: (Math.random()-0.5)*2,
    size: 4+Math.random()*6, color: colors[Math.floor(Math.random()*colors.length)],
    rot: Math.random()*Math.PI, vr: (Math.random()-0.5)*0.2,
  }));
  let frames = 0;
  (function tick(){
    if(!document.getElementById('victoryOverlay').classList.contains('active') || frames > 260){
      ctx.clearRect(0,0,canvas.width,canvas.height); return;
    }
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
      ctx.restore();
    });
    frames++;
    requestAnimationFrame(tick);
  })();
}

/* ---------------------------------------------------------------------- */
/* INIT                                                                    */
/* ---------------------------------------------------------------------- */
function init(){
  document.documentElement.setAttribute('data-theme', profile.theme);
  document.getElementById('musicToggle').checked = profile.music;
  document.getElementById('sfxToggle').checked = profile.sfx;
  document.getElementById('volumeSlider').value = profile.volume;
  renderSelectedSummary();
  showScreen('home');
  const unlock = () => { Audio2.ensureCtx(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);
}
init();
