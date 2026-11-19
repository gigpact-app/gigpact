// The side stage of The Gig Score. A canvas above the page, never in the way of a click.
// score.js tells it what is playing; it shows the money, the people and the feeling.

const MOODS = {
  joy: { c: "#3ddc84", glow: "61,220,132" },
  sad: { c: "#5aa9ff", glow: "90,169,255" },
  tense: { c: "#ff5d5d", glow: "255,93,93" },
  split: { c: "#c39bff", glow: "195,155,255" },
  time: { c: "#f3f1eb", glow: "243,241,235" },
  calm: { c: "#ffb020", glow: "255,176,32" }
};
const INK = "#f3f1eb";
const MUTE = "#9096a0";
const PANEL = "#121418";
const AMBER = "#ffb020";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// What each path does on stage.
const ACT = {
  F1: "accept", F2: "back", A1: "pay", A2: "back", A3: "claim", A4: "dispute",
  C1: "pay", C2: "dispute", C3: "pay", C4: "back",
  D1: "judge-worker", D2: "judge-organizer", D3: "judge-split", D4: "toll", D5: "pay", D6: "back"
};
const KIND_ACT = { lock: "lock", show: "show", ticks: "wait", chord: "finale" };

const KIND_KEY = { lock: "lock", show: "show", ticks: "wait", chord: "finale" };

// What the people say. [who, text, seconds after the event starts]. One script is picked at random.
const LINES = {
  lock: [[["org", "Fee locked. No take-backs!", 0.5]], [["org", "Locked in the contract. Gulp.", 0.5]]],
  F1: [[["wrk", "Accepted! No cancelling now.", 0.4]], [["wrk", "Deal. Shaking hands. Virtually.", 0.4]]],
  show: [[["wrk", "Playing for a locked fee. Bliss.", 1]], [["wrk", "Best gig ever. I know I'm paid.", 1]]],
  A3: [[["wrk", "Show's over. Claiming my fee!", 0.3]]],
  wait: [[["org", "Any day now...", 0.6], ["wrk", "432 blocks. I brought snacks.", 4.2]]],
  C1: [[["wrk", "Collected. Nobody had to say yes!", 0.5]], [["wrk", "No chasing. No invoice. Just paid.", 0.5]]],
  F2: [[["org", "Cancelled in time. Phew.", 0.4]]],
  A2: [[["wrk", "I waive it. Keep it, boss.", 0.4]]],
  A1: [[["org", "Paying on time? Wow, me.", 0.3], ["wrk", "Paid! My landlord loves you.", 2]]],
  C3: [[["org", "Fine, fine, I'm paying!", 0.3]]],
  C4: [[["wrk", "Waiving. Let's stay friends.", 0.4]]],
  C2: [[["org", "I object!", 0.2], ["arb", "Order! Order!", 1.5]]],
  A4: [[["org", "I'd like to open a dispute.", 0.3], ["arb", "Order! Order!", 2.2]]],
  D1: [[["arb", "For the worker!", 0.4]]],
  D2: [[["arb", "For the organizer.", 0.4]]],
  D3: [[["arb", "Let's split it.", 0.4]]],
  D4: [[["arb", "Nobody answered. Time decides.", 0.6]]],
  D5: [[["org", "Paying after all that. Sigh.", 0.3]]],
  D6: [[["wrk", "Fine. I waive it.", 0.3]]],
  finale: [[["wrk", "Eight paths. Real wallet. Real money.", 0.8]]]
};
const CONFETTI = ["#3ddc84", "#ffb020", "#5aa9ff", "#ff5d5d", "#c39bff", "#f3f1eb"];

const WAIT_FROM = 977619;
const WAIT_SPAN = 432;

const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let canvas = null;
let g = null;
let W = 0;
let H = 0;
let dpr = 1;
let L = null;
let analyser = null;
let bins = null;
let eq = [];
let effects = [];
let parts = [];
let bubbles = [];
let lastFrame = 0;
let raf = 0;
let running = false;
let activeUntil = 0;
let visible = 0;
let potFill = 1;
let potTarget = 1;
let lockT = 1;
let walletN = 0;
let walletPulse = 0;
let ambient = { mood: "calm", until: 0, from: 0 };
let scaleA = 0;
let scaleAngle = 0;
let scaleTarget = 0;
let spawnClock = 0;
const timers = [];

const now = () => performance.now() / 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function envOf(effect, t) {
  const age = t - effect.t0;
  return Math.min(ease(age / 0.3), ease((effect.dur - age) / 0.9));
}

function fx(type) {
  const t = now();
  let best = 0;
  let ref = null;
  for (const effect of effects) {
    if (effect.type !== type || t < effect.t0 || t >= effect.t0 + effect.dur) continue;
    const v = envOf(effect, t);
    if (v >= best) {
      best = v;
      ref = effect;
    }
  }
  return { v: best, e: ref };
}

function layout() {
  const column = document.querySelector("main");
  const r = column ? column.getBoundingClientRect() : { left: 0, right: W };
  const left = r.left;
  const right = W - r.right;
  const side = Math.min(left, right);
  if (side >= 150) {
    const s = Math.max(0.62, Math.min(1.5, side / 190));
    const cl = left / 2;
    const cr = r.right + right / 2;
    L = {
      mode: "wide", s,
      pot: { x: cl, y: H * 0.3 },
      org: { x: cl, y: H * 0.7 },
      scale: { x: cr, y: H * 0.3 },
      wrk: { x: cr - 16 * s, y: H * 0.7 },
      wallet: { x: cr + 34 * s, y: H * 0.7 - 2 },
      eq: [[10, left - 10], [r.right + 10, W - 10]],
      eqH: H * 0.2
    };
  } else {
    const s = 0.56;
    const y = H - 58;
    const potX = Math.max(44, Math.min(90, W * 0.12));
    const orgX = potX + Math.max(78, Math.min(110, W * 0.08));
    const wrkX = W - Math.max(48, Math.min(90, W * 0.12));
    L = {
      mode: "strip", s,
      pot: { x: potX, y },
      org: { x: orgX, y },
      scale: { x: wrkX - 92, y },
      wrk: { x: wrkX, y },
      wallet: { x: wrkX + 34 * s, y: y - 2 },
      eq: [[8, W - 8]],
      eqH: 46
    };
  }
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  layout();
}

function moodOf(name) {
  return MOODS[name] || MOODS.calm;
}

// ---------- particles

function control(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const lift = len * 0.32 + 50 * L.s + rand(0, 40);
  return { x: (a.x + b.x) / 2 + nx * lift, y: (a.y + b.y) / 2 + ny * lift };
}

function flight(from, to, mood, count, kind, delay) {
  const t = now();
  for (let i = 0; i < count; i += 1) {
    const a = { x: from.x + rand(-14, 14) * L.s, y: from.y - 22 * L.s };
    const b = { x: to.x + rand(-8, 8) * L.s, y: to.y - 10 * L.s };
    parts.push({
      k: "coin", a, b, c: control(a, b), t0: t + (delay || 0) + i * 0.085,
      dur: rand(1.05, 1.5), mood, kind, spin: rand(5, 9), trail: []
    });
  }
}

function sparks(x, y, mood, n) {
  for (let i = 0; i < n; i += 1) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(40, 190) * L.s;
    parts.push({ k: "spark", x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 30, life: rand(0.45, 0.9), age: 0, mood });
  }
}

function ring(x, y, mood, big) {
  parts.push({ k: "ring", x, y, age: 0, life: big ? 2.2 : 1.4, mood, max: (big ? 260 : 150) * L.s });
}

function speak(key, dur, mood) {
  const scripts = LINES[key];
  if (!scripts) return;
  const script = scripts[Math.floor(Math.random() * scripts.length)];
  const t = now();
  for (const [who, text, delay] of script) {
    bubbles.push({ who, text, mood, t0: t + delay, dur: Math.min(3.6, Math.max(1.8, dur - delay)) });
  }
}

function later(fn, seconds) {
  timers.push(setTimeout(fn, seconds * 1000));
}

// ---------- scene events

export function fire(item) {
  if (reduce || !canvas || !item) return;
  const act = item.path ? ACT[item.path] : KIND_ACT[item.kind];
  if (!act) return;
  const t = now();
  const dur = Math.max(1.2, item.dur || 3);
  const mood = item.mood || "calm";
  activeUntil = Math.max(activeUntil, t + dur + 1.6);
  ambient = { mood, from: t, until: t + dur };
  ensureLoop();
  const add = (type, extra) => effects.push({ type, t0: t, dur, mood, ...(extra || {}) });
  speak(item.path || KIND_KEY[item.kind], dur, mood);

  if (act === "lock") {
    walletN = 0;
    add("sweat", { dur: 1.8 });
    potTarget = 1;
    lockT = 0;
    potFill = 0.05;
    add("lock");
    for (let i = 0; i < 9; i += 1) {
      const a = { x: L.pot.x + rand(-10, 10), y: L.pot.y - H * 0.25 };
      const b = { x: L.pot.x + rand(-10, 10) * L.s, y: L.pot.y - 20 * L.s };
      parts.push({ k: "coin", a, b, c: { x: a.x, y: (a.y + b.y) / 2 }, t0: t + 0.15 + i * 0.22, dur: 0.7, mood: "calm", kind: "drop", spin: 6, trail: [] });
    }
  } else if (act === "accept") {
    add("cheer");
    sparks(L.wrk.x, L.wrk.y - 100 * L.s, "joy", 26);
    ring(L.wrk.x, L.wrk.y - 40 * L.s, "joy", false);
  } else if (act === "claim") {
    add("cheer");
    ring(L.pot.x, L.pot.y, "joy", false);
    sparks(L.wrk.x, L.wrk.y - 100 * L.s, "joy", 18);
  } else if (act === "pay" || act === "judge-worker") {
    add("cheer");
    if (act === "judge-worker") judge(0.34, dur);
    potTarget = 0.12;
    flight(L.pot, L.wallet, "joy", 11, "wallet", 0.1);
    later(() => { potTarget = 1; }, Math.max(1.8, dur * 0.85));
  } else if (act === "back" || act === "judge-organizer") {
    add("rain");
    if (act === "judge-organizer") judge(-0.34, dur);
    potTarget = 0.12;
    flight(L.pot, L.org, "sad", 11, "org", 0.2);
    later(() => { potTarget = 1; }, Math.max(1.8, dur * 0.85));
  } else if (act === "judge-split") {
    add("cheer", { weak: true });
    judge(0, dur);
    potTarget = 0.12;
    flight(L.pot, L.wallet, "split", 6, "wallet", 0.1);
    flight(L.pot, L.org, "split", 6, "org", 0.1);
    later(() => { potTarget = 1; }, Math.max(1.8, dur * 0.85));
  } else if (act === "dispute") {
    add("tense");
    judge(0, dur, true);
  } else if (act === "toll") {
    add("toll");
    judge(0, dur, true);
    for (let i = 0; i < 4; i += 1) later(() => ring(L.pot.x, L.pot.y, i === 3 ? "calm" : "time", i === 3), 0.2 + i * 1.7);
  } else if (act === "show") {
    add("show");
  } else if (act === "wait") {
    add("wait");
  } else if (act === "finale") {
    add("finale");
    add("cheer");
    add("confetti", { dur: 3.4 });
    for (let i = 0; i < 3; i += 1) later(() => ring(L.wrk.x, L.wrk.y - 40 * L.s, "joy", true), i * 1.2);
  }
}

function judge(angle, dur, wobble) {
  const t = now();
  effects.push({ type: "judge", t0: t, dur: dur + 0.8, angle, wobble: !!wobble, mood: "calm" });
}

// Three quick presses of one key: the people lose their patience.
export function egg(path) {
  if (reduce || !canvas) return;
  const t = now();
  bubbles = [];
  activeUntil = Math.max(activeUntil, t + 4.8);
  ensureLoop();
  effects.push({ type: "cheer", t0: t, dur: 3.2, mood: "joy" });
  effects.push({ type: "confetti", t0: t, dur: 1.8, mood: "joy" });
  effects.push({ type: "sweat", t0: t + 1.2, dur: 2, mood: "sad" });
  for (let i = 0; i < 70; i += 1) {
    parts.push({
      k: "conf", x: L.wrk.x + rand(-20, 20), y: L.wrk.y - 60 * L.s, vx: rand(-220, 220), vy: -rand(180, 460),
      rot: rand(0, 6), vr: rand(-8, 8), w: rand(5, 9), h: rand(3, 6), c: CONFETTI[Math.floor(Math.random() * CONFETTI.length)], age: 0, life: 4
    });
  }
  const script = path === "C1"
    ? [["wrk", "Impatient? 432 blocks, my friend.", 0.1], ["org", "Told you. Be patient.", 2]]
    : [["wrk", "Hey! Stop poking me!", 0.1], ["org", "Careful, that's my fee!", 1.8]];
  for (const [who, text, delay] of script) bubbles.push({ who, text, mood: "joy", t0: t + delay, dur: 2.4 });
}

export function setRunning(flag) {
  running = !!flag;
  if (flag) {
    activeUntil = Math.max(activeUntil, now() + 2);
    ensureLoop();
  }
}

// Everything on stage settles. Called on Stop and Pause.
export function calm() {
  for (const id of timers) clearTimeout(id);
  timers.length = 0;
  effects = [];
  bubbles = [];
  parts = parts.filter((p) => p.k === "spark" || p.k === "ring" || p.k === "conf");
  potTarget = 1;
  scaleTarget = 0;
  ambient.until = 0;
  running = false;
  activeUntil = now() + 0.6;
}

export function attach(node) {
  analyser = node;
  bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
}

export function init() {
  if (reduce || canvas) return;
  canvas = document.getElementById("stage");
  if (!canvas) return;
  g = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver === "function") new ResizeObserver(layout).observe(document.querySelector("main"));
  ensureLoop();
}

function ensureLoop() {
  if (raf || !canvas) return;
  lastFrame = now();
  raf = requestAnimationFrame(frame);
}

// ---------- drawing helpers

function rr(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function label(text, x, y, color, size, alpha) {
  g.globalAlpha = alpha == null ? visible : alpha;
  g.fillStyle = color;
  g.font = `600 ${size}px ${MONO}`;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillText(text, x, y);
  g.globalAlpha = 1;
}

function line(x1, y1, x2, y2, color, width) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function coin(x, y, r, mood, squash) {
  const m = moodOf(mood);
  g.save();
  g.translate(x, y);
  g.scale(Math.max(0.18, Math.abs(squash)), 1);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = m.c;
  g.fill();
  g.lineWidth = Math.max(1, r * 0.22);
  g.strokeStyle = "rgba(255,255,255,0.65)";
  g.stroke();
  g.beginPath();
  g.arc(0, 0, r * 0.52, 0, Math.PI * 2);
  g.lineWidth = Math.max(1, r * 0.14);
  g.strokeStyle = "rgba(0,0,0,0.28)";
  g.stroke();
  g.restore();
}

// ---------- the people and things

function drawPot(a) {
  const { x, y } = L.pot;
  const tense = fx("tense").v + fx("toll").v * 0.6;
  const shake = tense > 0.05 ? Math.sin(now() * 70) * 3 * tense * L.s : 0;
  g.save();
  g.translate(x + shake, y);
  g.scale(L.s, L.s);
  g.globalAlpha = a;
  // coin stack
  const n = Math.round(potFill * 9);
  for (let i = 0; i < n; i += 1) {
    g.beginPath();
    g.ellipse(((i % 3) - 1) * 4, -12 - i * 4.2, 24, 6, 0, 0, Math.PI * 2);
    g.fillStyle = i % 2 ? "#e69a12" : AMBER;
    g.fill();
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 1;
    g.stroke();
  }
  // vault
  rr(-38, -10, 76, 58, 10);
  g.fillStyle = PANEL;
  g.fill();
  g.lineWidth = 2.4;
  g.strokeStyle = tense > 0.1 ? MOODS.tense.c : AMBER;
  g.stroke();
  g.beginPath();
  g.arc(0, 20, 11, 0, Math.PI * 2);
  g.lineWidth = 2;
  g.strokeStyle = MUTE;
  g.stroke();
  const turn = ease(lockT) * Math.PI;
  line(0, 20, Math.cos(turn) * 8, 20 + Math.sin(turn) * 8, AMBER, 2.4);
  // padlock
  const open = 1 - ease(lockT);
  g.save();
  g.translate(30, -34);
  g.strokeStyle = AMBER;
  g.lineWidth = 2.4;
  g.beginPath();
  g.arc(0, open * -4, 6, Math.PI, 0);
  g.lineTo(6, open * -4 + 2 - open * 2);
  g.stroke();
  rr(-8, 0, 16, 12, 3);
  g.fillStyle = AMBER;
  g.fill();
  g.restore();
  g.globalAlpha = 1;
  g.restore();
  label("THE FEE", x, y + 66 * L.s, INK, Math.max(10, 11 * L.s));
  if (W > 520) label("locked in the contract", x, y + 66 * L.s + 12, MUTE, Math.max(9, 9.5 * L.s));
}

function drawOrganizer(a) {
  const sad = fx("rain").v;
  const { x, y } = L.org;
  g.save();
  g.translate(x, y);
  g.scale(L.s, L.s);
  g.globalAlpha = a;
  g.rotate(0.07 * sad);
  const col = sad > 0.2 ? MOODS.sad.c : INK;
  line(-8, -30, -9, 0, col, 5);
  line(8, -30, 9, 0, col, 5);
  g.beginPath();
  g.moveTo(-16, -64);
  g.lineTo(16, -64);
  g.lineTo(21, -28);
  g.lineTo(-21, -28);
  g.closePath();
  g.fillStyle = "#1b1f26";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = col;
  g.stroke();
  line(0, -64, 0, -42, AMBER, 3);
  g.beginPath();
  g.arc(4 * sad, -78 + 7 * sad, 11, 0, Math.PI * 2);
  g.fillStyle = "#1b1f26";
  g.fill();
  g.stroke();
  line(-16, -58, -24, -36 + 8 * sad, col, 4);
  line(16, -58, 24, -40, col, 4);
  rr(18, -42, 20, 15, 3);
  g.fillStyle = "#2a2f38";
  g.fill();
  g.lineWidth = 2;
  g.stroke();
  g.globalAlpha = 1;
  g.restore();
  label("ORGANIZER", x, y + 20 * L.s + 6, INK, Math.max(10, 11 * L.s));
  const pulse = fx("rain").v;
  if (pulse > 0.05) label("the money comes home", x, y + 20 * L.s + 18, MOODS.sad.c, Math.max(9, 9.5 * L.s), pulse * a);
}

function drawWorker(a) {
  const cheer = Math.max(fx("cheer").v, fx("finale").v);
  const show = fx("show").v;
  const t = now();
  const { x, y } = L.wrk;
  const bounce = cheer > 0.05 ? -Math.abs(Math.sin(t * 8.5)) * 11 * cheer : 0;
  g.save();
  g.translate(x, y + bounce * L.s);
  g.scale(L.s, L.s);
  g.globalAlpha = a;
  const col = cheer > 0.2 ? MOODS.joy.c : INK;
  const step = cheer > 0.05 ? Math.sin(t * 8.5) * 7 * cheer : 0;
  g.rotate(cheer > 0.05 ? Math.sin(t * 4.25) * 0.1 * cheer : 0);
  line(-8, -30, -10 + step, 0, col, 5);
  line(8, -30, 10 + step, 0, col, 5);
  line(0, -64, 0, -30, col, 6);
  g.beginPath();
  g.arc(0, -78, 11, 0, Math.PI * 2);
  g.fillStyle = "#1b1f26";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = col;
  g.stroke();
  if (cheer > 0.25) {
    const w = Math.sin(t * 10) * 6;
    line(0, -58, -18, -88 + w, col, 4);
    line(0, -58, 18, -88 - w, col, 4);
  } else {
    line(0, -58, 12, -42, col, 4);
    line(0, -58, -6, -40, col, 4);
    g.save();
    g.translate(14, -36);
    g.rotate(-0.5 + Math.sin(t * 2.6) * 0.14 * show);
    g.beginPath();
    g.ellipse(0, 0, 13, 9, 0, 0, Math.PI * 2);
    g.fillStyle = "#2a2f38";
    g.fill();
    g.lineWidth = 2.4;
    g.strokeStyle = AMBER;
    g.stroke();
    line(10, -2, 34, -22, AMBER, 3);
    g.restore();
  }
  g.globalAlpha = 1;
  g.restore();
  label("WORKER", x, y + 20 * L.s + 6, INK, Math.max(10, 11 * L.s));
}

function drawWallet(a) {
  const { x, y } = L.wallet;
  const pulse = Math.max(0, walletPulse);
  g.save();
  g.translate(x, y);
  g.scale(L.s * (1 + pulse * 0.18), L.s * (1 + pulse * 0.18));
  g.globalAlpha = a;
  rr(-16, -4, 36, 26, 6);
  g.fillStyle = PANEL;
  g.fill();
  g.lineWidth = 2.2;
  g.strokeStyle = pulse > 0.05 ? MOODS.joy.c : MUTE;
  g.stroke();
  g.beginPath();
  g.arc(12, 9, 3, 0, Math.PI * 2);
  g.fillStyle = AMBER;
  g.fill();
  g.globalAlpha = 1;
  g.restore();
  if (walletN > 0) label(`+${walletN}`, x + 2 * L.s, y + 36 * L.s, MOODS.joy.c, Math.max(10, 11 * L.s));
}

function drawScale(a) {
  if (a < 0.02) return;
  const { x, y } = L.scale;
  g.save();
  g.translate(x, y);
  g.scale(L.s, L.s);
  g.globalAlpha = a;
  line(0, -74, 0, 0, MUTE, 4);
  line(-18, 0, 18, 0, MUTE, 4);
  g.save();
  g.translate(0, -74);
  g.rotate(scaleAngle);
  line(-38, 0, 38, 0, AMBER, 4);
  for (const side of [-38, 38]) {
    g.save();
    g.translate(side, 0);
    g.rotate(-scaleAngle);
    line(0, 0, -14, 28, MUTE, 1.6);
    line(0, 0, 14, 28, MUTE, 1.6);
    g.beginPath();
    g.arc(0, 28, 15, 0, Math.PI);
    g.closePath();
    g.fillStyle = "#1b1f26";
    g.fill();
    g.strokeStyle = AMBER;
    g.lineWidth = 2.2;
    g.stroke();
    g.restore();
  }
  g.restore();
  g.globalAlpha = 1;
  g.restore();
  label("ARBITER", x, y + 20 * L.s + 6, INK, Math.max(10, 11 * L.s), a);
}

// ---------- the light and the weather

function drawAmbient(t) {
  if (t >= ambient.until + 0.9) return;
  const age = t - ambient.from;
  const a = Math.min(ease(age / 0.4), ease((ambient.until + 0.9 - t) / 1.2));
  const m = moodOf(ambient.mood);
  const spots = L.mode === "wide"
    ? [[(L.eq[0][0] + L.eq[0][1]) / 2, H * 0.5, H * 0.62], [(L.eq[1][0] + L.eq[1][1]) / 2, H * 0.5, H * 0.62]]
    : [[W * 0.2, H, 220], [W * 0.8, H, 220]];
  for (const [cx, cy, r] of spots) {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(${m.glow},${0.26 * a})`);
    grad.addColorStop(1, `rgba(${m.glow},0)`);
    g.fillStyle = grad;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

function drawEqualizer(t, a) {
  let level = 0;
  if (analyser && bins && running) {
    analyser.getByteFrequencyData(bins);
    const n = 14;
    const per = Math.max(1, Math.floor(bins.length / n));
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let j = 0; j < per; j += 1) sum += bins[i * per + j] || 0;
      const v = sum / per / 255;
      eq[i] = Math.max(v, (eq[i] || 0) * 0.9);
      level += v;
    }
  } else if (analyser && bins) {
    analyser.getByteFrequencyData(bins);
    const n = 14;
    const per = Math.max(1, Math.floor(bins.length / n));
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let j = 0; j < per; j += 1) sum += bins[i * per + j] || 0;
      eq[i] = Math.max(sum / per / 255, (eq[i] || 0) * 0.9);
    }
  }
  const m = moodOf(t < ambient.until + 0.9 ? ambient.mood : "calm");
  for (const [x0, x1] of L.eq) {
    const n = 14;
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i += 1) {
      const v = Math.pow(eq[i] || 0, 1.3);
      const h = 4 + v * L.eqH;
      g.fillStyle = `rgba(${m.glow},${(0.18 + v * 0.55) * a * (L.mode === "strip" ? 0.45 : 1)})`;
      rr(x0 + i * w + 2, H - 8 - h, Math.max(2, w - 4), h, 3);
      g.fill();
    }
  }
  return level;
}

function drawSpot(t) {
  const show = fx("show").v;
  const fin = fx("finale").v;
  const v = Math.max(show, fin * 0.8);
  if (v < 0.02) return;
  const m = fin > show ? MOODS.joy : MOODS.calm;
  const topY = 0;
  const bottomY = L.wrk.y + 30 * L.s;
  for (let k = 0; k < 2; k += 1) {
    const sway = Math.sin(t * 0.9 + k * Math.PI) * 70 * L.s;
    const cx = L.wrk.x + sway;
    const grad = g.createLinearGradient(0, topY, 0, bottomY);
    grad.addColorStop(0, `rgba(${m.glow},${0.0})`);
    grad.addColorStop(1, `rgba(${m.glow},${0.2 * v})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(L.wrk.x - 6 + k * 12, topY);
    g.lineTo(cx - 60 * L.s, bottomY);
    g.lineTo(cx + 60 * L.s, bottomY);
    g.closePath();
    g.fill();
  }
}

function drawVignette(t) {
  const tense = Math.max(fx("tense").v, fx("toll").v * 0.5);
  if (tense < 0.02) return;
  const beat = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 1.7), 3);
  const alpha = (0.08 + 0.22 * beat) * tense;
  for (const x of [0, W]) {
    const grad = g.createLinearGradient(x, 0, x + (x === 0 ? 1 : -1) * Math.max(160, W * 0.14), 0);
    grad.addColorStop(0, `rgba(255,70,70,${alpha})`);
    grad.addColorStop(1, "rgba(255,70,70,0)");
    g.fillStyle = grad;
    g.fillRect(x === 0 ? 0 : W - Math.max(160, W * 0.14), 0, Math.max(160, W * 0.14), H);
  }
}

function drawWait(t) {
  const w = fx("wait");
  if (w.v < 0.02) return;
  const p = Math.min(1, (t - w.e.t0) / Math.max(1, w.e.dur - 0.6));
  const blocks = Math.floor(WAIT_FROM + WAIT_SPAN * ease(p));
  const { x, y } = L.pot;
  g.save();
  g.globalAlpha = w.v;
  g.beginPath();
  g.arc(x, y + 16 * L.s, 56 * L.s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  g.strokeStyle = MOODS.time.c;
  g.lineWidth = 3;
  g.lineCap = "round";
  g.stroke();
  const blip = Math.pow(Math.max(0, Math.cos((t - w.e.t0) * Math.PI * 2 / 0.8)), 6);
  g.beginPath();
  g.arc(x, y + 16 * L.s - 56 * L.s, 3 + 3 * blip, 0, Math.PI * 2);
  g.fillStyle = MOODS.time.c;
  g.fill();
  g.restore();
  label(`block ${blocks.toLocaleString("en-US")}`, x, y + 100 * L.s, MOODS.time.c, Math.max(10, 11.5 * L.s), w.v);
  label(`${Math.min(432, Math.round(WAIT_SPAN * ease(p)))} of 432`, x, y + 100 * L.s + 12, MUTE, Math.max(9, 9.5 * L.s), w.v);
}

// ---------- the loop

function update(dt, t) {
  // continuous spawns
  spawnClock += dt;
  const rain = fx("rain").v;
  const show = fx("show").v;
  const fin = fx("finale");
  if (rain > 0.1) {
    const n = Math.floor(dt * 70 * rain) + (Math.random() < dt * 70 * rain % 1 ? 1 : 0);
    for (let i = 0; i < n; i += 1) {
      parts.push({ k: "rain", x: L.org.x + rand(-90, 90) * L.s, y: L.org.y - rand(150, 230) * L.s, vy: rand(260, 380), age: 0, life: 0.9 });
    }
  }
  if (show > 0.1 && Math.random() < dt * 2.6) {
    parts.push({ k: "note", x: L.wrk.x + rand(-10, 30) * L.s, y: L.wrk.y - 70 * L.s, vx: rand(-20, 40), vy: -rand(40, 70), age: 0, life: 2.6, g: Math.random() < 0.5 ? "♪" : "♫" });
  }
  if (fin.v > 0.2 && Math.random() < dt * 34) {
    const k = H / 900;
    parts.push({ k: "ball", x: L.wallet.x, y: L.wallet.y - 20, vx: rand(-130, 130) * k * L.s, vy: -rand(520, 760) * k, age: 0, life: 2.4, grav: 900 * k, mood: Math.random() < 0.7 ? "joy" : "calm", spin: rand(5, 9) });
  }
  const conf = fx("confetti");
  if (conf.v > 0.1 && Math.random() < dt * 90 * conf.v) {
    for (let i = 0; i < 2; i += 1) {
      parts.push({
        k: "conf", x: rand(0, W), y: -10, vx: rand(-40, 40), vy: rand(90, 210), rot: rand(0, 6), vr: rand(-6, 6),
        w: rand(5, 9), h: rand(3, 6), c: CONFETTI[Math.floor(Math.random() * CONFETTI.length)], age: 0, life: 5
      });
    }
  }
  const nervous = Math.max(fx("tense").v, fx("toll").v * 0.7, fx("sweat").v);
  if (nervous > 0.2 && Math.random() < dt * 4) {
    parts.push({ k: "sweat", x: L.org.x + rand(6, 14) * L.s, y: L.org.y - 88 * L.s, vx: rand(10, 40), vy: rand(20, 60), age: 0, life: 0.9 });
  }
  // moving parts
  const next = [];
  for (const p of parts) {
    if (p.k === "coin") {
      if (t < p.t0) { next.push(p); continue; }
      const u = (t - p.t0) / p.dur;
      if (u >= 1) {
        if (p.kind === "wallet") {
          walletN += 1;
          walletPulse = 1;
          sparks(p.b.x, p.b.y, p.mood, 5);
        } else if (p.kind === "org") {
          sparks(p.b.x, p.b.y, p.mood, 3);
        } else if (p.kind === "drop") {
          potFill = Math.min(1, potFill + 0.1);
          lockT = Math.min(1, lockT + 0.05);
        }
        continue;
      }
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const q = p.kind === "drop" ? u * u : e;
      p.x = (1 - q) * (1 - q) * p.a.x + 2 * (1 - q) * q * p.c.x + q * q * p.b.x;
      p.y = (1 - q) * (1 - q) * p.a.y + 2 * (1 - q) * q * p.c.y + q * q * p.b.y;
      p.trail.push([p.x, p.y]);
      if (p.trail.length > 6) p.trail.shift();
      next.push(p);
    } else if (p.k === "spark") {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 160 * dt;
      if (p.age < p.life) next.push(p);
    } else if (p.k === "ring") {
      p.age += dt;
      if (p.age < p.life) next.push(p);
    } else if (p.k === "rain") {
      p.age += dt;
      p.y += p.vy * dt;
      if (p.age < p.life && p.y < H) next.push(p);
    } else if (p.k === "note") {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age < p.life) next.push(p);
    } else if (p.k === "conf") {
      p.age += dt;
      p.x += (p.vx + Math.sin(p.age * 3 + p.rot) * 24) * dt;
      p.y += p.vy * dt;
      p.vy += 20 * dt;
      p.vx *= 1 - Math.min(1, dt * 0.8);
      p.rot += p.vr * dt;
      if (p.age < p.life && p.y < H + 20) next.push(p);
    } else if (p.k === "sweat") {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 140 * dt;
      if (p.age < p.life) next.push(p);
    } else if (p.k === "ball") {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      if (p.age < p.life && p.y < H + 20) next.push(p);
    }
  }
  parts = next.length > 700 ? next.slice(-700) : next;
  bubbles = bubbles.filter((b) => t < b.t0 + b.dur + 0.1);
  // state easing
  potFill += (potTarget - potFill) * Math.min(1, dt * 3);
  if (lockT < 1 && !parts.some((p) => p.kind === "drop")) lockT = Math.min(1, lockT + dt * 2);
  walletPulse = Math.max(0, walletPulse - dt * 3);
  const judging = fx("judge");
  scaleA += ((judging.v > 0 ? 1 : 0) - scaleA) * Math.min(1, dt * 4);
  if (judging.e) {
    scaleTarget = judging.e.wobble ? Math.sin(t * 3.1) * 0.22 + Math.sin(t * 7.3) * 0.05 : judging.e.angle;
  } else {
    scaleTarget = 0;
  }
  scaleAngle += (scaleTarget - scaleAngle) * Math.min(1, dt * (judging.e && !judging.e.wobble ? 2.4 : 6));
  effects = effects.filter((e) => t < e.t0 + e.dur + 0.2);
}

function drawParts(t) {
  for (const p of parts) {
    if (p.k === "coin") {
      if (t < p.t0) continue;
      const r = 7.5 * L.s + 1.5;
      for (let i = 0; i < p.trail.length - 1; i += 1) {
        g.globalAlpha = (i / p.trail.length) * 0.35;
        coin(p.trail[i][0], p.trail[i][1], r * 0.8, p.mood, 1);
      }
      g.globalAlpha = 1;
      coin(p.x, p.y, r, p.mood, Math.cos((t - p.t0) * p.spin));
    } else if (p.k === "ball") {
      coin(p.x, p.y, 7.5 * L.s + 1.5, p.mood, Math.cos(p.age * p.spin));
    } else if (p.k === "spark") {
      g.globalAlpha = Math.max(0, 1 - p.age / p.life);
      g.fillStyle = moodOf(p.mood).c;
      g.beginPath();
      g.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    } else if (p.k === "ring") {
      const u = p.age / p.life;
      g.globalAlpha = (1 - u) * 0.7;
      g.strokeStyle = moodOf(p.mood).c;
      g.lineWidth = 3 * (1 - u) + 1;
      g.beginPath();
      g.arc(p.x, p.y, p.max * ease(u), 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    } else if (p.k === "conf") {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, Math.cos(p.age * 6 + p.rot));
      g.globalAlpha = Math.min(1, (p.life - p.age) * 1.2);
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
      g.globalAlpha = 1;
    } else if (p.k === "sweat") {
      g.globalAlpha = Math.max(0, 1 - p.age / p.life);
      g.fillStyle = MOODS.sad.c;
      g.beginPath();
      g.arc(p.x, p.y, 2.6 * L.s + 0.8, 0, Math.PI * 2);
      g.moveTo(p.x - 2.2 * L.s - 0.6, p.y - 1);
      g.lineTo(p.x, p.y - 7 * L.s - 2);
      g.lineTo(p.x + 2.2 * L.s + 0.6, p.y - 1);
      g.fill();
      g.globalAlpha = 1;
    } else if (p.k === "rain") {
      g.globalAlpha = 0.55 * Math.min(1, (0.9 - p.age) * 2);
      line(p.x, p.y, p.x - 2, p.y + 13, MOODS.sad.c, 1.6);
      g.globalAlpha = 1;
    } else if (p.k === "note") {
      g.globalAlpha = Math.min(1, (p.life - p.age) / 1.2);
      g.fillStyle = AMBER;
      g.font = `${20 * L.s + 6}px ${MONO}`;
      g.textAlign = "center";
      g.fillText(p.g, p.x, p.y);
      g.globalAlpha = 1;
    }
  }
}

function wrapText(text, max) {
  const lines = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if ((cur ? `${cur} ${word}` : word).length > max && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawBubbles(t) {
  const fs = Math.max(10, 11.5 * L.s);
  const side = L.mode === "wide" ? L.eq[0][1] - L.eq[0][0] : 999;
  const max = side > 190 ? 22 : 16;
  for (const b of bubbles) {
    const age = t - b.t0;
    if (age < 0 || age > b.dur) continue;
    const pop = Math.min(1, age / 0.24);
    const sc = 0.78 + 0.22 * ease(pop) + Math.sin(pop * Math.PI) * 0.07;
    const alpha = Math.min(ease(age / 0.15), ease((b.dur - age) / 0.3));
    const anchor = b.who === "org" ? L.org : b.who === "arb" ? L.scale : L.wrk;
    const lines = wrapText(b.text, max);
    g.font = `700 ${fs}px ${MONO}`;
    let w = 0;
    for (const l of lines) w = Math.max(w, g.measureText(l).width);
    w += 20;
    const h = lines.length * fs * 1.3 + 14;
    const bx = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, anchor.x));
    const top = anchor.y - 112 * L.s - h;
    const tail = Math.max(bx - w / 2 + 14, Math.min(bx + w / 2 - 14, anchor.x));
    const m = moodOf(b.mood);
    g.save();
    g.globalAlpha = alpha;
    g.translate(bx, top + h + 10);
    g.scale(sc, sc);
    g.translate(-bx, -(top + h + 10));
    rr(bx - w / 2, top, w, h, 10);
    g.fillStyle = "#f3f1eb";
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = m.c;
    g.stroke();
    g.beginPath();
    g.moveTo(tail - 7, top + h - 1);
    g.lineTo(tail, top + h + 10);
    g.lineTo(tail + 7, top + h - 1);
    g.closePath();
    g.fillStyle = "#f3f1eb";
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(tail - 6, top + h - 2);
    g.lineTo(tail + 6, top + h - 2);
    g.strokeStyle = "#f3f1eb";
    g.lineWidth = 3.5;
    g.stroke();
    g.fillStyle = "#111317";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    lines.forEach((l, i) => g.fillText(l, bx, top + 7 + (i + 1) * fs * 1.3 - fs * 0.2));
    g.restore();
  }
}

function frame() {
  raf = 0;
  if (!canvas) return;
  const t = now();
  const dt = Math.min(0.05, t - lastFrame);
  lastFrame = t;
  const live = running || t < activeUntil;
  const target = live ? 1 : L.mode === "wide" ? 0.45 : 0;
  visible += (target - visible) * Math.min(1, dt * (live ? 6 : 2.2));
  update(dt, t);

  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (visible > 0.01) {
    if (L.mode === "strip") {
      const grad = g.createLinearGradient(0, H - 150, 0, H);
      grad.addColorStop(0, "rgba(11,12,14,0)");
      grad.addColorStop(1, `rgba(11,12,14,${0.9 * visible})`);
      g.fillStyle = grad;
      g.fillRect(0, H - 150, W, 150);
    }
    drawAmbient(t);
    drawSpot(t);
    drawEqualizer(t, visible);
    drawVignette(t);
    drawScale(scaleA * visible);
    drawPot(visible);
    drawOrganizer(visible);
    drawWorker(visible);
    drawWallet(visible);
    drawWait(t);
    g.globalAlpha = Math.max(0.4, visible);
    drawParts(t);
    g.globalAlpha = 1;
    drawBubbles(t);
  }
  if (live || target > 0 || visible > 0.02 || parts.length || effects.length) {
    raf = requestAnimationFrame(frame);
  }
}

export const stage = { init, fire, calm, attach, setRunning, egg };
