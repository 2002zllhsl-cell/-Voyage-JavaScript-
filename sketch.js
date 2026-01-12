let video, handPose;
let hands = [];
let creatures = []; 
let flowParticles = [];
let edgeVines = []; 
let cw, ch; 
let audioStarted = false; 
let isVideoReady = false; 

const MOSAIC_SIZE = 8; 

// --- 配色 ---
const C = {
  pixelFill: [255, 255, 255], 
  vine: [80, 80, 80, 50],
  flowBody: [100, 100, 100], 
  coreOuter: [255, 255, 255], 
  coreInner: [255, 255, 255],
  nerveTail: [30, 30, 30],
};

// --- 音频系统 ---
let musicManager; 
let globalReverb; 

function preload() {
  ml5.setBackend("webgl");
  handPose = ml5.handPose({ flipped: true });
}

function setup() {
  let targetW = windowWidth * 0.8;
  let targetH = windowHeight * 0.8;
  if (targetW / targetH > 16/9) { ch = targetH; cw = targetH * (16/9); } 
  else { cw = targetW; ch = targetW * (9/16); }
  createCanvas(cw, ch);

  video = createCapture(VIDEO, () => { console.log("Video Started"); });
  video.size(320, 240); 
  video.hide();

  handPose.detectStart(video, results => { hands = results; });

  setupGlobalAudio();

  creatures.push(new Creature());
  for (let i = 0; i < 120; i++) flowParticles.push(new FlowParticle());
}

function draw() {
  blendMode(BLEND);
  background(0); 

  checkVideoStatus();

  // --- L0: 马赛克背景 ---
  if (isVideoReady) {
    drawCircleMosaic();
  } else {
  }

  // --- L1: 边缘生长线 ---
  if (frameCount % 6 === 0 && edgeVines.length < 150) edgeVines.push(new EdgeVine());
  blendMode(ADD);
  noFill(); strokeWeight(1);
  for (let i = edgeVines.length - 1; i >= 0; i--) {
    let v = edgeVines[i]; v.update(); v.show();
    if (v.isDead()) edgeVines.splice(i, 1);
  }

  // --- L2: 洋流粒子 ---
  strokeWeight(2);
  let activeTarget = null;
  if (hands.length > 0 && creatures.length > 0) activeTarget = creatures[0].pos;
  for (let p of flowParticles) {
    p.followFlow(); p.update(activeTarget); p.show();
  }

  // --- L3: 生命体 ---
  let anyFist = creatures.some(c => c.isFist && !c.isIdle);
  manageCreatures(anyFist);

  // --- L4: 全局状态 (负片 & 音乐) ---
  if (audioStarted) {
    // 每一帧更新音乐管理器，处理节奏
    musicManager.update(anyFist); 
  }

  if (anyFist) {
    filter(INVERT); 
  }

  // UI
  if (!audioStarted) {
    blendMode(BLEND); textAlign(CENTER); textSize(12); 
    let alpha = 150 + sin(frameCount * 0.1) * 100;
    fill(255, alpha); noStroke();
    text(">>> 点击屏幕 · 启动生成式钢琴 <<<", width/2, height - 20);
  }
}

function checkVideoStatus() {
  if (video && video.loadedmetadata && video.width > 0 && video.height > 0) {
    video.loadPixels(); 
    if (video.pixels && video.pixels.length > 0) {
      isVideoReady = true;
      return;
    }
  }
  isVideoReady = false;
}

// ==========================================
//           视觉层：马赛克
// ==========================================

function drawCircleMosaic() {
  try {
    noStroke();
    push();
    translate(width, 0); scale(-1, 1);

    let vw = video.width;
    let vh = video.height;
    if (vw === 0 || vh === 0) { pop(); return; }

    let aspectCanvas = width / height;
    let aspectVideo = vw / vh;
    let sx, sy, sw, sh; 

    if (aspectCanvas > aspectVideo) {
      sw = vw; sh = vw / aspectCanvas;
      sx = 0; sy = (vh - sh) / 2;
    } else {
      sh = vh; sw = vh * aspectCanvas;
      sx = (vw - sw) / 2; sy = 0;
    }

    for (let y = 0; y < height; y += MOSAIC_SIZE) {
      for (let x = 0; x < width; x += MOSAIC_SIZE) {

        let vxRaw = map(x, 0, width, sx, sx + sw);
        let vyRaw = map(y, 0, height, sy, sy + sh);
        let vXInt = Math.floor(constrain(vxRaw, 0, vw - 1));
        let vYInt = Math.floor(constrain(vyRaw, 0, vh - 1));

        let index = (vYInt * vw + vXInt) * 4;
        let r = video.pixels[index];
        let g = video.pixels[index+1];
        let b = video.pixels[index+2];
        let bright = (r + g + b) / 3; 

        if (bright > 40) {
          let alpha = map(bright, 40, 255, 5, 60); 
          fill(C.pixelFill[0], alpha); 
          ellipse(x, y, MOSAIC_SIZE * 0.9, MOSAIC_SIZE * 0.9); 
        }
      }
    }
    pop();
  } catch (e) { pop(); }
}

// ==========================================
//           音频系统 
// ==========================================

function setupGlobalAudio() {
  globalReverb = new p5.Reverb();
  globalReverb.set(6, 2); 
  musicManager = new MusicManager();
}

class MusicManager {
  constructor() {
    // --- Track A: 生成式电钢琴 (Polyrhythmic Arp) ---
    // 每个音符有独立的计时器和间隔，形成错落有致的节奏
    this.pianoNotes = [
      // 根音 (C3): 稳定，每 4 秒一次
      { freq: 130.81, osc: new p5.Oscillator('triangle'), env: new p5.Envelope(), interval: 240, timer: 0 },
      // 三音 (E3): 稍快，每 2.5 秒
      { freq: 164.81, osc: new p5.Oscillator('triangle'), env: new p5.Envelope(), interval: 150, timer: 30 },
      // 五音 (G3): 活跃，每 1.5 秒
      { freq: 196.00, osc: new p5.Oscillator('triangle'), env: new p5.Envelope(), interval: 90, timer: 60 },
      // 七音 (B3): 偶尔，每 3.2 秒
      { freq: 246.94, osc: new p5.Oscillator('triangle'), env: new p5.Envelope(), interval: 192, timer: 100 },
      // 九音 (D4): 随机闪烁
      { freq: 293.66, osc: new p5.Oscillator('triangle'), env: new p5.Envelope(), interval: 110, timer: 10 }
    ];

    // 初始化钢琴音源
    for(let n of this.pianoNotes) {
      n.osc.disconnect();
      globalReverb.process(n.osc);
      n.osc.start();
      n.osc.amp(0); // 初始由 Envelope 控制，底噪为 0

      // 设置包络 (ADSR): 敲击感强，余韵长
      // Attack 0.01s, Decay 0.2s, Sustain Level 0.1, Release 1.5s
      n.env.setADSR(0.01, 0.2, 0.1, 1.5); 
      n.env.setRange(0.3, 0); // 最大音量 0.3
    }

    // --- Track B: 脉冲深渊 (Pulsating Bass) ---
    this.bassOsc = new p5.Oscillator('sawtooth');
    this.lfo = new p5.Oscillator('sine'); // 低频振荡器，用于控制低音的音量起伏

    this.bassOsc.disconnect(); globalReverb.process(this.bassOsc); 
    this.bassOsc.freq(55); // A1
    this.bassOsc.amp(0);

    this.lfo.disconnect();
    this.lfo.freq(2); // 每秒搏动 2 次
    this.lfo.amp(0.5); // 搏动幅度
    this.lfo.start();
  }

  // 点击屏幕启动
  start() {
    console.log("Rhythm Started");
    this.bassOsc.start();
  }

  // 每一帧调用
  update(isNegative) {
    if (isNegative) {
      // === 负片===
      // 钢琴静音
      for(let n of this.pianoNotes) n.osc.amp(0, 0.5);

      // 低音淡入
      let pulseVol = 0.2 + (sin(frameCount * 0.2) * 0.1); 
      this.bassOsc.amp(pulseVol, 0.1);
      // 频率轻微抖动
      this.bassOsc.freq(55 + sin(frameCount * 0.8) * 3);

    } else {
      // === 正常态：生成式钢琴 ===
      // 低音淡出
      this.bassOsc.amp(0, 1.0);

      // 运行钢琴音序器
      for(let n of this.pianoNotes) {
        n.timer++;
        // 随机性
        let humanize = random(-2, 2);

        if (n.timer >= n.interval + humanize) {
          // 触发音符
          n.env.play(n.osc);
          n.timer = 0; // 重置计时器
        }
      }
    }
  }
}

class CreatureAudio {
  constructor() {
    this.wind = new p5.Noise('pink');
    this.wind.amp(0);
    this.wind.disconnect();
    if (globalReverb) globalReverb.process(this.wind); 

    // 握拳声效
    this.pulse = new p5.Oscillator('sine');
    this.pulse.freq(60);
    this.pulse.amp(0);
    this.pulse.disconnect();
    this.pulse.connect(); 

    if (audioStarted) {
      this.wind.start();
      this.pulse.start();
    }
  }

  update(velocity, isFist) {
    let targetVol = map(velocity, 0, 30, 0, 0.3, true);
    this.wind.amp(targetVol, 0.2); 

    if (isFist) {
       this.pulse.amp(0.4, 0.1);
       this.pulse.freq(60 - (frameCount % 20)); 
    } else {
       this.pulse.amp(0, 0.2);
    }
  }

  dispose() {
    try { 
      this.wind.stop(); this.wind.dispose(); 
      this.pulse.stop(); this.pulse.dispose();
    } catch(e){}
  }
}

// ==========================================
//           逻辑核心
// ==========================================

function manageCreatures(anyFistActive) {
  let targetCount = hands.length;
  if (targetCount === 0) targetCount = 1; 

  while (creatures.length < targetCount) creatures.push(new Creature());
  while (creatures.length > targetCount) {
    let removed = creatures.pop();
    removed.dispose();
  }

  for (let i = 0; i < creatures.length; i++) {
    let c = creatures[i];
    if (hands.length === 0) {
      c.update(null, false); 
    } else {
      if (hands[i]) {
        let h = hands[i];
        let handData = parseHand(h);
        let isFist = false;
        if (handData) {
          let d = p5.Vector.dist(handData.tips[0], handData.tips[1]);
          if (d < 35) isFist = true;
          c.update(handData, isFist);
        }
      }
    }
    c.show(anyFistActive);
  }
}

class Creature {
  constructor() {
    this.pos = createVector(width/2, height/2);
    this.tentacles = []; for(let i=0; i<30; i++) this.tentacles.push(new Tentacle(i % 5));
    this.angle = 0; this.noiseOff = random(1000);
    this.prevPos = this.pos.copy();
    this.isFist = false;
    this.isIdle = true; 
    this.audio = new CreatureAudio();
  }

  update(handData, isFist) {
    this.isFist = isFist || false;
    this.prevPos = this.pos.copy();
    let targetPos;

    if (handData) {
      this.isIdle = false;
      targetPos = mapHandToCanvas(handData.palm);
      for (let t of this.tentacles) {
        if (handData.tips[t.groupIndex]) {
          let tipTarget = mapHandToCanvas(handData.tips[t.groupIndex]);
          t.update(this.pos, tipTarget);
        }
      }
    } else {
      this.isIdle = true;
      let time = frameCount * 0.002; 
      let nX = noise(time + this.noiseOff) * width;
      let nY = noise(time + this.noiseOff + 100) * height;
      targetPos = createVector(nX, nY);

      for (let t of this.tentacles) {
        let angle = frameCount*0.02 + (t.groupIndex * TWO_PI / 5);
        let r = 80 + sin(frameCount*0.05 + t.groupIndex) * 20;
        let floatTarget = createVector(this.pos.x + cos(angle)*r, this.pos.y + sin(angle)*r);
        t.update(this.pos, floatTarget);
      }
    }

    let lerpSpeed = this.isIdle ? 0.04 : 0.1;
    this.pos.lerp(targetPos, lerpSpeed);
    this.angle += 0.04;

    let vel = p5.Vector.dist(this.pos, this.prevPos);
    if(this.isIdle) vel = 0; 
    if(audioStarted) this.audio.update(vel, this.isFist);
  }

  show(isGlobalInvert) {
    blendMode(ADD);
    drawingContext.shadowBlur = 30;
    drawingContext.shadowColor = color(C.coreOuter);

    if (!isGlobalInvert) {
      for (let t of this.tentacles) t.show();
    }

    push(); translate(this.pos.x, this.pos.y);
    noFill(); stroke(C.coreOuter); strokeWeight(1.5);
    push(); rotate(this.angle); ellipse(0, 0, 60, 25); pop();
    push(); rotate(this.angle * 0.8 + PI/3); ellipse(0, 0, 60, 25); pop();
    push(); rotate(-this.angle * 1.2 - PI/3); ellipse(0, 0, 60, 25); pop();
    noStroke(); fill(C.coreInner);
    let alpha = isGlobalInvert ? 255 : (200 + sin(frameCount*0.1)*55);
    fill(255, 255, 255, alpha);
    ellipse(0, 0, 15, 15);
    pop();
    drawingContext.shadowBlur = 0;
  }

  dispose() { this.audio.dispose(); }
}

class Tentacle {
  constructor(idx) {
    this.groupIndex = idx; this.segments = []; this.num = 20;
    for(let i=0; i<this.num; i++) this.segments.push(createVector(width/2, height/2));
  }
  update(root, target) {
    if (!root || !target) return; 
    this.segments[0] = root.copy();
    let wave = sin(frameCount * 0.1 + this.groupIndex) * 10;
    this.segments[this.num-1].lerp(createVector(target.x+wave, target.y+wave), 0.1);

    for (let i = 1; i < this.num; i++) {
      let prev = this.segments[i-1]; let curr = this.segments[i];
      curr.x = lerp(curr.x, prev.x, 0.4); curr.y = lerp(curr.y, prev.y, 0.4);
      if (dist(curr.x, curr.y, prev.x, prev.y) < 3) curr.add(p5.Vector.sub(curr, prev).setMag(3));
    }
  }
  show() {
    noFill(); beginShape();
    for(let i=0; i<this.num; i++) {
      let t = i / (this.num - 1);
      let sw = map(t, 0, 1, 3, 0.5);
      strokeWeight(sw); 
      let alpha = map(t, 0, 1, 120, 0);
      let c = color(C.coreOuter); 
      c.setAlpha(alpha); stroke(c);
      curveVertex(this.segments[i].x, this.segments[i].y);
      if(i===0 || i===this.num-1) curveVertex(this.segments[i].x, this.segments[i].y);
    }
    endShape();
  }
}

class FlowParticle {
  constructor() {
    this.pos = createVector(random(width), random(height));
    this.vel = createVector(0, 0); this.acc = createVector(0, 0);
    this.maxSpeed = random(2, 5); this.prevPos = this.pos.copy();
  }
  followFlow() {
    let angle = noise(this.pos.x * 0.003, this.pos.y * 0.003, frameCount * 0.0005) * TWO_PI * 4;
    this.acc.add(p5.Vector.fromAngle(angle).mult(0.5));
  }
  update(repelTarget) {
    this.prevPos = this.pos.copy();
    if (repelTarget) {
      let dir = p5.Vector.sub(this.pos, repelTarget);
      if (dir.mag() < 250) this.acc.add(dir.setMag(map(dir.mag(), 0, 250, 3, 0)));
    }
    this.vel.add(this.acc); this.vel.limit(this.maxSpeed); this.pos.add(this.vel); this.acc.mult(0);
    if (this.pos.x > width) {this.pos.x = 0; this.prevPos.x = 0;}
    if (this.pos.x < 0) {this.pos.x = width; this.prevPos.x = width;}
    if (this.pos.y > height) {this.pos.y = 0; this.prevPos.y = 0;}
    if (this.pos.y < 0) {this.pos.y = height; this.prevPos.y = height;}
  }
  show() {
    stroke(C.flowBody); line(this.pos.x, this.pos.y, this.prevPos.x, this.prevPos.y);
  }
}

class EdgeVine {
  constructor() {
    let edge = floor(random(4));
    if (edge === 0) { this.pos = createVector(random(width), -10); this.vel = createVector(0, random(1, 3)); } 
    else if (edge === 1) { this.pos = createVector(width+10, random(height)); this.vel = createVector(random(-1, -3), 0); } 
    else if (edge === 2) { this.pos = createVector(random(width), height+10); this.vel = createVector(0, random(-1, -3)); } 
    else { this.pos = createVector(-10, random(height)); this.vel = createVector(random(1, 3), 0); } 
    this.history = []; this.maxLen = random(50, 150); this.life = 255; 
  }
  update() {
    this.life -= 1.5; this.history.push(this.pos.copy());
    if (this.history.length > this.maxLen) this.history.shift();
    let centerDir = p5.Vector.sub(createVector(width/2, height/2), this.pos).normalize().mult(0.5);
    let noiseAngle = noise(this.pos.x * 0.01, this.pos.y * 0.01, frameCount * 0.005) * TWO_PI;
    this.vel.add(centerDir); this.vel.add(p5.Vector.fromAngle(noiseAngle).mult(0.8));
    this.vel.limit(2); this.pos.add(this.vel);
  }
  show() {
    stroke(C.vine[0], C.vine[1], C.vine[2], this.life * 0.5); 
    noFill(); beginShape(); for (let v of this.history) vertex(v.x, v.y); endShape();
  }
  isDead() { return this.life < 0; }
}

function mousePressed() {
  if (!audioStarted) {
    userStartAudio();
    audioStarted = true;
    musicManager.start(); 
    for(let c of creatures) {
       c.audio.wind.start();
       c.audio.pulse.start();
    }
  }
}
function parseHand(h) {
  if (!h || !h.keypoints) return null;
  return {
    palm: createVector(h.keypoints[9].x, h.keypoints[9].y),
    tips: [4, 8, 12, 16, 20].map(i => createVector(h.keypoints[i].x, h.keypoints[i].y))
  };
}
function mapHandToCanvas(vec) {
  let vw = (video && video.width > 0) ? video.width : 320;
  let vh = (video && video.height > 0) ? video.height : 240;
  let x = map(vec.x, 0, vw, 0, width); 
  let y = map(vec.y, 0, vh, 0, height); 
  return createVector(x, y);
}
function windowResized() { setup(); }