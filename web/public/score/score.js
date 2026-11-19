import { stage } from "./stage.js";
// Edit motifs here. Each note is [midi, beats]. One beat = 0.75 s (80 bpm).
// D3=50 A3=57 D4=62 E4=64 F#4=66 G4=67 A4=69 B4=71 C#5=73 D5=74 E5=76 F5=77 F#5=78 A5=81
// dir: up rises toward the worker, down falls back to the organizer,
// ask hangs open, split is two voices, time is the long wait.
const MOTIFS = {
  F1: { dir: "up", voice: "worker", lines: [[[62, 0.5], [66, 0.5], [69, 1.5]]] },
  F2: { dir: "down", voice: "organizer", lines: [[[69, 0.5], [66, 0.5], [62, 1.5]]] },
  A1: { dir: "up", voice: "organizer", lines: [[[66, 0.5], [69, 0.5], [73, 0.5], [74, 2]]], chord: [50, 57, 62] },
  A2: { dir: "down", voice: "worker", lines: [[[74, 0.5], [71, 0.5], [69, 0.5], [66, 1.5]]] },
  A3: { dir: "up", voice: "worker", lines: [[[69, 0.33], [69, 0.33], [69, 0.33], [74, 1.75]]] },
  A4: { dir: "ask", voice: "organizer", lines: [[[62, 0.5], [67, 0.5], [69, 0.5], [71, 2]]] },
  C1: { dir: "up", voice: "nobody", lines: [[[50, 0.4], [57, 0.4], [62, 0.4], [66, 0.4], [69, 0.4], [74, 3]]] },
  C2: { dir: "ask", voice: "organizer", lines: [[[78, 0.5], [77, 0.5], [74, 2]]] },
  C3: { dir: "up", voice: "organizer", lines: [[[66, 0.5], [69, 0.5], [74, 0.5], [78, 2]]] },
  C4: { dir: "down", voice: "worker", lines: [[[69, 0.5], [66, 0.5], [64, 0.5], [62, 1.5]]] },
  D1: { dir: "up", voice: "arbiter", lines: [[[62, 0.5], [66, 0.5], [69, 0.5], [74, 0.5], [78, 2]]] },
  D2: { dir: "down", voice: "arbiter", lines: [[[74, 0.5], [69, 0.5], [66, 0.5], [62, 0.5], [50, 2]]] },
  D3: {
    dir: "split",
    voice: "arbiter",
    lines: [
      [[81, 0.5], [78, 0.5], [74, 0.5], [69, 2]],
      [[57, 0.5], [62, 0.5], [66, 0.5], [69, 2]]
    ]
  },
  D4: { dir: "time", voice: "nobody", lines: [[[57, 1], [57, 1], [57, 1], [62, 2.5]]] },
  D5: { dir: "up", voice: "organizer", lines: [[[64, 0.5], [69, 0.5], [73, 0.5], [76, 2]]] },
  D6: { dir: "down", voice: "worker", lines: [[[76, 0.5], [73, 0.5], [69, 0.5], [64, 1.5]]] }
};

const DIRECTION = {
  up: "↑ toward the worker",
  down: "↓ back to the organizer",
  ask: "? a question",
  split: "⇄ a split",
  time: "⏳ time decides"
};

// Seconds from Play. Lock, the show, the ticks and the final chord light no single path.
const OLD_PERFORMANCE = [
  { t: 0, kind: "lock", caption: "The organizer locks the fee." },
  { t: 6, path: "F1", caption: "The worker accepts. The organizer can no longer cancel." },
  { t: 11, kind: "show", caption: "The show." },
  { t: 24, path: "A3", caption: "The worker claims after the event end." },
  { t: 29, kind: "ticks", caption: "432 blocks of waiting. About three days, no one's approval needed." },
  { t: 43, path: "C1", caption: "The worker collects." },
  { t: 50, path: "F2", caption: "Other endings: the organizer cancels, the worker waives, the organizer pays." },
  { t: 53, path: "A2" },
  { t: 56, path: "C3" },
  { t: 59, path: "C4" },
  { t: 63, path: "C2", caption: "If the organizer objects, a neutral arbiter decides. Shown here from a script run with a test key; the dispute steps are not in the app yet." },
  { t: 67, path: "D1" },
  { t: 71, path: "D3" },
  { t: 75, path: "D2" },
  { t: 80, kind: "chord", caption: "Eight paths proven on Bitcoin Cash mainnet with a real wallet." }
];

let PERFORMANCE = OLD_PERFORMANCE;
let PIECE_SECONDS = 85;

// Feeling of each path. The key lights in this colour while it plays.
const MOOD = {
  F1: "joy", F2: "sad", A1: "joy", A2: "sad", A3: "joy", A4: "tense",
  C1: "joy", C2: "tense", C3: "joy", C4: "sad",
  D1: "joy", D2: "sad", D3: "split", D4: "time", D5: "joy", D6: "sad"
};
const MOOD_WORD = {
  joy: "joy, the worker is paid",
  sad: "sad, the money goes back",
  tense: "tension, a dispute",
  split: "two voices meet, a split",
  time: "time decides",
  calm: "the story"
};
const KIND_LABEL = {
  lock: { label: "The fee is locked", mood: "calm" },
  show: { label: "The show", mood: "calm" },
  ticks: { label: "432 blocks of waiting", mood: "time" },
  chord: { label: "Eight real-wallet paths together", mood: "joy" }
};

// Order of the recorded clips. gap = seconds after the previous clip's music ends.
const CLIP_SEQUENCE = [
  { clip: "lock", kind: "lock", gap: 0, caption: "The organizer locks the fee." },
  { clip: "F1", path: "F1", gap: 0.3, caption: "The worker accepts. The organizer can no longer cancel." },
  { clip: "show", kind: "show", gap: 0.2, caption: "The show." },
  { clip: "A3", path: "A3", gap: -0.6, caption: "The worker claims after the event end." },
  { clip: "wait", kind: "ticks", gap: 0.3, caption: "432 blocks of waiting. About three days, no one's approval needed." },
  { clip: "C1", path: "C1", gap: 1.6, caption: "The worker collects." },
  { clip: "F2", path: "F2", gap: 0.8, caption: "Other endings: the organizer cancels, the worker waives, the organizer pays." },
  { clip: "A2", path: "A2", gap: 0.2 },
  { clip: "A1", path: "A1", gap: 0.2 },
  { clip: "C3", path: "C3", gap: 0.3 },
  { clip: "C4", path: "C4", gap: 0.2 },
  { clip: "C2", path: "C2", gap: 0.9, caption: "If the organizer objects, a neutral arbiter decides. Shown here from a script run with a test key; the dispute steps are not in the app yet." },
  { clip: "D1", path: "D1", gap: 0.4 },
  { clip: "D3", path: "D3", gap: 0.2 },
  { clip: "D2", path: "D2", gap: 0.2 },
  { clip: "finale", kind: "chord", gap: 0.8, caption: "Eight paths proven on Bitcoin Cash mainnet with a real wallet." }
];
const CLIP_GAIN = 0.9;

const SOUND = {
  master: 0.25,
  wet: 0.22,
  lowpass: 3500,
  reverbSeconds: 2,
  beat: 0.75,
  piano: { attack: 0.005, decay: 1.2, index: 1.2, indexEnd: 0.2, gain: 0.2 },
  marimba: { attack: 0.004, decay: 0.8, upper: 0.3, upperDecay: 0.08, gain: 0.18 },
  bell: { attack: 0.008, decay: 2.5, ratio: 3.5, index: 1.6, indexEnd: 0.25, indexDecay: 0.9, gain: 0.13 },
  celesta: { attack: 0.006, decay: 1.8, gain: 0.15, low: 0.2 },
  tick: { midi: 88, gain: 0.035, attack: 0.005, decay: 0.035 },
  showEvery: 2,
  showUntil: 13,
  tickEvery: 0.8,
  tickUntil: 12,
  chordSeconds: 4,
  chordLow: [50, 57, 62],
  chordHigh: [66, 69, 74]
};

const INFO = {
  F1: { name: "Accept", does: "The worker accepts. The organizer can no longer cancel.", who: "Signed by the worker." },
  F2: { name: "Cancel", does: "The organizer takes the money back before the worker accepts.", who: "Signed by the organizer." },
  A1: { name: "Pay", does: "The organizer pays the worker.", who: "Signed by the organizer." },
  A2: { name: "Waive", does: "The worker gives the money back after accept.", who: "Signed by the worker." },
  A3: { name: "Claim", does: "The worker claims after the event end.", who: "Signed by the worker." },
  A4: { name: "Open dispute", does: "The organizer opens a dispute about 7 days after the event end.", who: "Signed by the organizer." },
  C1: { name: "Collect", does: "The worker collects after the 432-block wait, about 3 days.", who: "Nobody signs." },
  C2: { name: "Object", does: "The organizer objects.", who: "Signed by the organizer." },
  C3: { name: "Pay out", does: "The organizer pays at the claim stage.", who: "Signed by the organizer." },
  C4: { name: "Waive", does: "The worker waives at the claim stage.", who: "Signed by the worker." },
  D1: { name: "For the worker", does: "The arbiter decides for the worker.", who: "Signed by the arbiter." },
  D2: { name: "For the organizer", does: "The arbiter decides for the organizer.", who: "Signed by the arbiter." },
  D3: { name: "Split", does: "The arbiter splits.", who: "Signed by the arbiter." },
  D4: { name: "Fallback", does: "Fallback if nobody signs, after about 14 days.", who: "Nobody signs." },
  D5: { name: "Pay out", does: "The organizer pays out.", who: "Signed by the organizer." },
  D6: { name: "Waive", does: "The worker waives.", who: "Signed by the worker." }
};

const GROUPS = [
  { title: "Accept", ids: ["F1", "F2"] },
  { title: "After the event", ids: ["A1", "A2", "A3", "A4"] },
  { title: "Claim stage", ids: ["C1", "C2", "C3", "C4"] },
  { title: "Dispute", ids: ["D1", "D2", "D3", "D4", "D5", "D6"] }
];

const KEYMAP = {
  Digit1: "F1", Digit2: "F2", Digit3: "A1", Digit4: "A2", Digit5: "A3", Digit6: "A4",
  Digit7: "C1", Digit8: "C2", Digit9: "C3", Digit0: "C4",
  KeyQ: "D1", KeyW: "D2", KeyE: "D3", KeyR: "D4", KeyT: "D5", KeyY: "D6"
};

const AXIS_START = 977601;
const AXIS_END = 978057;
const WAIT_FROM = 977619;
const WAIT_TO = 978051;
const EXPLORER = "https://3xpl.com/bitcoin-cash/transaction/";

const $ = (id) => document.getElementById(id);

const buttons = {};
const entries = {};
let data = null;
let ctx = null;
let bus = null;
let master = null;
let audioMissing = false;
let muted = false;
let running = false;
let paused = false;
let pausedAt = 0;
let originCtx = 0;
let originPerf = 0;
let raf = 0;
let windows = [];
let oscillators = [];
let clipBus = null;
let clipsPromise = null;
let clipMode = false;
let clipVoices = [];
let lightTargets = [];
const clipBuffers = {};
const clipInfo = {};
let shownCaption = "";
let linksShown = false;
const soloOff = {};

function commas(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function xOf(block) {
  return ((block - AXIS_START) / (AXIS_END - AXIS_START)) * 100;
}

function midiHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function motifSeconds(motif) {
  const beats = Math.max(...motif.lines.map((line) => line.reduce((sum, note) => sum + note[1], 0)));
  return beats * SOUND.beat;
}

function levelClass(level) {
  if (level === "real-wallet-mainnet") return "real";
  if (level === "script-mainnet-test-key") return "script";
  return "regtest";
}

function levelSentence(entry) {
  if (entry.kind === "fund") return "Funding transaction recorded on Bitcoin Cash mainnet.";
  if (entry.level === "real-wallet-mainnet") return "Proven on mainnet with a real wallet.";
  if (entry.level === "script-mainnet-test-key") return "Ran on mainnet by a script with a test key. Not in the app.";
  if (entry.path === "A4") return "Not run on mainnet. It needs about 7 days of waiting. Run on a local test chain only.";
  return "Not run on mainnet. It needs about 14 days of waiting. Run on a local test chain only.";
}

function ariaFor(entry) {
  const name = entry.kind === "fund" ? "Funding transaction Lock" : `${entry.path} ${INFO[entry.path].name}`;
  const block = entry.block != null ? `, block ${commas(entry.block)}` : "";
  return `${name}${block}. ${levelSentence(entry)}`;
}

function shortTx(tx) {
  return `${tx.slice(0, 10)}…${tx.slice(-8)}`;
}

async function copyText(text, button) {
  const previous = button.textContent;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    button.textContent = "Copied";
  } catch (err) {
    button.textContent = "Copy failed";
  }
  setTimeout(() => { button.textContent = previous; }, 1200);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function makeKey(entry) {
  const info = INFO[entry.path];
  const button = document.createElement("button");
  button.type = "button";
  button.className = `key ${levelClass(entry.level)}`;
  button.dataset.path = entry.path;
  button.setAttribute("aria-label", ariaFor(entry));
  button.append(el("span", "code", entry.path), el("span", "name", info.name));
  if (entry.level === "script-mainnet-test-key") button.append(el("span", "tag", "script"));
  button.addEventListener("click", () => pressPath(entry.path));
  buttons[entry.path] = button;
  return button;
}

function showProof(entry) {
  const proof = $("proof");
  proof.replaceChildren();
  const info = entry.kind === "fund" ? null : INFO[entry.path];
  proof.append(el("h2", null, entry.kind === "fund" ? "Lock" : `${entry.path} · ${info.name}`));
  if (info && MOTIFS[entry.path]) proof.append(el("p", "badge", DIRECTION[MOTIFS[entry.path].dir]));
  const list = document.createElement("dl");
  const row = (term, value) => {
    list.append(el("dt", null, term), el("dd", null, value));
  };
  row("What it does", entry.kind === "fund" ? entry.what : (entry.what || info.does));
  if (info) row("Who signs", info.who);
  row("Level", levelSentence(entry));
  if (entry.block != null) row("Block", commas(entry.block));
  proof.append(list);
  if (entry.tx) {
    const tx = el("p", "tx-row");
    tx.append(el("span", "txid", shortTx(entry.tx)));
    const link = document.createElement("a");
    link.href = EXPLORER + entry.tx;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View on explorer";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "text-btn";
    copy.textContent = "Copy id";
    copy.addEventListener("click", () => copyText(entry.tx, copy));
    tx.append(link, copy);
    proof.append(tx);
  }
}

function render(score) {
  const byPath = {};
  for (const path of score.paths) byPath[path.path] = path;
  for (const group of GROUPS) {
    const section = el("section", "stage");
    section.append(el("h2", null, group.title));
    const keys = el("div", "keys");
    for (const id of group.ids) {
      const path = byPath[id];
      if (!path) continue;
      entries[id] = path;
      keys.append(makeKey(path));
    }
    section.append(keys);
    $("stages").append(section);
  }

  entries.fund = { kind: "fund", ...score.fund };
  const markers = [{ kind: "fund", label: "Lock", block: score.fund.block, tx: score.fund.tx, sort: 0 }];
  for (const path of score.paths) {
    if (path.level === "real-wallet-mainnet" && path.block != null) {
      markers.push({ kind: "path", label: path.path, block: path.block, path: path.path, sort: 1 });
    }
  }
  markers.sort((a, b) => a.block - b.block || a.sort - b.sort || a.label.localeCompare(b.label));

  const plot = $("plot");
  plot.append(el("div", "baseline"));
  const wait = el("div", "waitbar");
  wait.style.left = `${xOf(WAIT_FROM)}%`;
  wait.style.width = `${xOf(WAIT_TO) - xOf(WAIT_FROM)}%`;
  plot.append(wait);

  const early = [];
  const right = [];
  for (const marker of markers) (xOf(marker.block) > 80 ? right : early).push(marker);
  const place = (marker, row, edge) => {
    const button = document.createElement("button");
    button.type = "button";
    const entry = marker.kind === "fund" ? entries.fund : entries[marker.path];
    button.className = marker.kind === "fund" ? "marker fund" : `marker ${levelClass(entry.level)}`;
    button.setAttribute("aria-label", ariaFor(entry));
    if (marker.path) button.dataset.path = marker.path;
    button.append(el("span", "m-code", marker.label), el("span", "m-block", commas(marker.block)));
    button.style.left = `${xOf(marker.block)}%`;
    button.style.bottom = `${row * 46 + 12}px`;
    if (edge === "end") button.style.transform = "translateX(-100%)";
    button.addEventListener("click", () => {
      showProof(entry);
      if (marker.path) pressPath(marker.path, { proofAlready: true });
    });
    plot.append(button);
  };
  early.forEach((marker, i) => place(marker, i, "start"));
  right.forEach((marker, i) => place(marker, i, "end"));
  plot.style.height = `${Math.max(early.length, right.length, 1) * 46 + 12}px`;

  const lane = $("script-lane");
  for (const path of score.paths) {
    if (path.level !== "script-mainnet-test-key") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key script";
    button.dataset.path = path.path;
    button.setAttribute("aria-label", ariaFor(path));
    button.append(el("span", "code", path.path), el("span", "name", INFO[path.path].name), el("span", "tag", "script"));
    button.addEventListener("click", () => pressPath(path.path));
    lane.append(button);
  }

  const list = $("proven-list");
  for (const path of score.paths) {
    if (path.level !== "real-wallet-mainnet" || !path.tx) continue;
    const item = document.createElement("li");
    item.append(el("span", null, `${path.path} ${INFO[path.path].name}`), el("span", "txid", shortTx(path.tx)));
    const link = document.createElement("a");
    link.href = EXPLORER + path.tx;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "View on explorer";
    item.append(link);
    list.append(item);
  }
}

function track(node) {
  oscillators.push(node);
  return node;
}

function stopOscillators() {
  fadeVoices(0.7);
  if (ctx && master) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
    master.gain.linearRampToValueAtTime(0.0001, now + 0.03);
    for (const node of oscillators) {
      try { node.stop(now + 0.04); } catch (err) { /* already stopped */ }
    }
    master.gain.setValueAtTime(muted ? 0.0001 : SOUND.master, now + 0.05);
  } else {
    for (const node of oscillators) {
      try { node.stop(); } catch (err) { /* already stopped */ }
    }
  }
  oscillators = [];
}

function makeImpulse(audio, seconds) {
  const length = Math.floor(audio.sampleRate * seconds);
  const buffer = audio.createBuffer(2, length, audio.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      samples[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.2;
    }
  }
  return buffer;
}

function ensureAudio() {
  if (ctx || audioMissing) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    audioMissing = true;
    const note = $("audio-note");
    note.hidden = false;
    note.textContent = "This browser has no Web Audio. The proofs still work.";
    return null;
  }
  try {
    ctx = new AudioCtx();
  } catch (err) {
    audioMissing = true;
    const note = $("audio-note");
    note.hidden = false;
    note.textContent = "This browser has no Web Audio. The proofs still work.";
    return null;
  }
  bus = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = SOUND.lowpass;
  filter.Q.value = 0.6;
  const dry = ctx.createGain();
  dry.gain.value = 0.82;
  const wet = ctx.createGain();
  wet.gain.value = SOUND.wet;
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, SOUND.reverbSeconds);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 16;
  comp.ratio.value = 3;
  comp.attack.value = 0.008;
  comp.release.value = 0.24;
  master = ctx.createGain();
  master.gain.value = muted ? 0.0001 : SOUND.master;
  bus.connect(filter);
  filter.connect(dry);
  filter.connect(wet);
  wet.connect(reverb);
  dry.connect(comp);
  reverb.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);
  clipBus = ctx.createGain();
  clipBus.gain.value = muted ? 0.0001 : CLIP_GAIN;
  clipBus.connect(ctx.destination);
  const tap = ctx.createAnalyser();
  tap.fftSize = 128;
  tap.smoothingTimeConstant = 0.75;
  clipBus.connect(tap);
  stage.attach(tap);
  return ctx;
}

function ampEnv(when, peak, attack, decay) {
  const node = ctx.createGain();
  const level = Math.max(peak, 0.0002);
  node.gain.setValueAtTime(0.0001, when);
  node.gain.exponentialRampToValueAtTime(level, when + Math.max(attack, 0.003));
  node.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(attack, 0.003) + Math.max(decay, 0.02));
  node.connect(bus);
  return { node, end: when + attack + decay };
}

function makeSine(freq, when) {
  const node = ctx.createOscillator();
  node.type = "sine";
  node.frequency.setValueAtTime(Math.max(freq, 1), when);
  return node;
}

function arm(node, when, end) {
  node.start(when);
  node.stop(end + 0.02);
  return track(node);
}

function sine(freq, when, end, destination) {
  const node = makeSine(freq, when);
  node.connect(destination);
  return arm(node, when, end);
}

function fmDepth(freq, ratio, index, indexEnd, decay, when) {
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(Math.max(index * freq * ratio, 1), when);
  depth.gain.exponentialRampToValueAtTime(Math.max(indexEnd * freq * ratio, 1), when + Math.max(decay, 0.02));
  return depth;
}

function addFm(carrier, freq, ratio, index, indexEnd, decay, when, end) {
  const depth = fmDepth(freq, ratio, index, indexEnd, decay, when);
  const mod = makeSine(freq * ratio, when);
  mod.connect(depth);
  depth.connect(carrier.frequency);
  arm(mod, when, end);
}

function strike(voice, midi, when, scale, decayOverride) {
  const freq = midiHz(midi);
  const at = Math.max(when, ctx.currentTime);
  if (voice === "worker") {
    const spec = SOUND.piano;
    const { node, end } = ampEnv(at, spec.gain * scale, spec.attack, decayOverride || spec.decay);
    const carrier = makeSine(freq, at);
    carrier.connect(node);
    addFm(carrier, freq, 1, spec.index, spec.indexEnd, spec.decay, at, end);
    arm(carrier, at, end);
    return;
  }
  if (voice === "organizer") {
    const spec = SOUND.marimba;
    const { node, end } = ampEnv(at, spec.gain * scale, spec.attack, decayOverride || spec.decay);
    sine(freq, at, end, node);
    const upper = ctx.createGain();
    upper.gain.setValueAtTime(0.0001, at);
    upper.gain.exponentialRampToValueAtTime(Math.max(spec.upper, 0.0002), at + 0.004);
    upper.gain.exponentialRampToValueAtTime(0.0001, at + spec.upperDecay);
    upper.connect(node);
    sine(freq * 4, at, at + spec.upperDecay, upper);
    return;
  }
  if (voice === "arbiter") {
    const spec = SOUND.bell;
    const decay = decayOverride || spec.decay;
    const { node, end } = ampEnv(at, spec.gain * scale, spec.attack, decay);
    const carrier = makeSine(freq, at);
    carrier.connect(node);
    addFm(carrier, freq, spec.ratio, spec.index, spec.indexEnd, spec.indexDecay, at, end);
    arm(carrier, at, end);
    return;
  }
  const spec = SOUND.celesta;
  const { node, end } = ampEnv(at, spec.gain * scale, spec.attack, decayOverride || spec.decay);
  const carrier = makeSine(freq, at);
  carrier.connect(node);
  addFm(carrier, freq, 3.5, 1.1, 0.2, 0.45, at, end);
  const low = ctx.createGain();
  low.gain.setValueAtTime(spec.low, at);
  low.connect(node);
  sine(freq / 2, at, end, low);
  arm(carrier, at, end);
}

function playMotif(path, when) {
  if (clipMode && clipBuffers[path]) return playClip(path, when, 0);
  const motif = MOTIFS[path];
  const dur = motifSeconds(motif);
  if (!ctx) return dur;
  for (const line of motif.lines) {
    let at = when;
    for (const [midi, beats] of line) {
      strike(motif.voice, midi, at, 1);
      at += beats * SOUND.beat;
    }
  }
  if (motif.chord) {
    for (const midi of motif.chord) strike("worker", midi, when, 0.38);
  }
  return dur;
}

function playLock(when) {
  if (!ctx) return;
  strike("worker", 50, when, 0.8, 3.2);
  strike("worker", 57, when, 0.55, 3.2);
}

function playShow(when) {
  if (!ctx) return;
  for (let t = 0; t < SOUND.showUntil; t += SOUND.showEvery) {
    strike("worker", 57, when + t, 0.18);
    strike("worker", 62, when + t, 0.16);
  }
}

function playTicks(when) {
  if (!ctx) return;
  const spec = SOUND.tick;
  for (let t = 0; t <= SOUND.tickUntil; t += SOUND.tickEvery) {
    const at = Math.max(when + t, ctx.currentTime);
    const { node, end } = ampEnv(at, spec.gain, spec.attack, spec.decay);
    sine(midiHz(spec.midi), at, end, node);
  }
}

function playChord(when) {
  if (!ctx) return;
  for (const midi of SOUND.chordLow) strike("worker", midi, when, 0.42, SOUND.chordSeconds);
  for (const midi of SOUND.chordHigh) strike("arbiter", midi, when, 0.36, SOUND.chordSeconds);
}

function perfNow() {
  if (!running) return paused ? pausedAt : 0;
  if (paused) return pausedAt;
  if (ctx) return originPerf + (ctx.currentTime - originCtx);
  return originPerf + (performance.now() / 1000 - originCtx);
}

function playClip(name, when, offset) {
  const buffer = clipBuffers[name];
  if (!ctx || !buffer || !clipBus) return 0;
  const startAt = Math.max(when, ctx.currentTime);
  const skip = offset || 0;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  if (skip > 0) {
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(1, startAt + 0.06);
  }
  source.connect(gain);
  gain.connect(clipBus);
  source.start(startAt, skip);
  const voice = { source, gain };
  clipVoices.push(voice);
  source.onended = () => {
    clipVoices = clipVoices.filter((item) => item !== voice);
  };
  return Math.max(0, clipInfo[name].music - skip);
}

// Every recorded voice dies away instead of being cut off.
function fadeVoices(seconds) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const voice of clipVoices) {
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
      voice.gain.gain.linearRampToValueAtTime(0.0001, now + seconds);
      voice.source.stop(now + seconds + 0.05);
    } catch (err) { /* already stopped */ }
  }
  clipVoices = [];
}

function buildClipPerformance() {
  for (const item of CLIP_SEQUENCE) {
    if (!clipInfo[item.clip] || !clipBuffers[item.clip]) return false;
  }
  const list = [];
  let end = 0;
  CLIP_SEQUENCE.forEach((item, index) => {
    const info = clipInfo[item.clip];
    const t = index === 0 ? 0 : Math.max(0, end + item.gap);
    const kind = item.kind ? KIND_LABEL[item.kind] : null;
    list.push({
      t,
      clip: item.clip,
      path: item.path,
      kind: item.kind,
      caption: item.caption,
      mood: item.path ? MOOD[item.path] : kind.mood,
      label: item.path ? `${item.path} ${INFO[item.path].name}` : kind.label,
      len: info.music,
      total: info.seconds
    });
    end = t + info.music;
  });
  const last = list[list.length - 1];
  PERFORMANCE = list;
  PIECE_SECONDS = Math.round(last.t + last.total - 1);
  $("progress").setAttribute("aria-valuemax", String(PIECE_SECONDS));
  return true;
}

function loadClips() {
  if (clipsPromise) return clipsPromise;
  if (!ctx) return Promise.resolve(false);
  clipsPromise = (async () => {
    try {
      const metaResponse = await fetch("./audio/clips.json");
      if (!metaResponse.ok) throw new Error("clips.json");
      const meta = await metaResponse.json();
      await Promise.all(Object.keys(meta).map(async (name) => {
        const response = await fetch(`./audio/${name}.mp3`);
        if (!response.ok) throw new Error(name);
        clipBuffers[name] = await ctx.decodeAudioData(await response.arrayBuffer());
      }));
      Object.assign(clipInfo, meta);
      clipMode = buildClipPerformance();
      return clipMode;
    } catch (err) {
      const note = $("audio-note");
      note.hidden = false;
      note.textContent = "The recorded music could not be loaded, so a simple built-in sound plays instead.";
      return false;
    }
  })();
  return clipsPromise;
}

function prefetchClips() {
  fetch("./audio/clips.json").then((response) => (response.ok ? response.json() : {})).then((meta) => {
    for (const name of Object.keys(meta)) fetch(`./audio/${name}.mp3`).catch(() => {});
  }).catch(() => {});
}

function setLit(node, mood) {
  if (mood) {
    node.classList.add("is-on");
    node.dataset.mood = mood;
  } else {
    node.classList.remove("is-on");
    delete node.dataset.mood;
  }
}

function litPath(path, mood) {
  for (const node of lightTargets) {
    if (node.dataset.path === path) setLit(node, mood);
  }
}

function showNow(item) {
  const node = $("now");
  if (!item) {
    node.hidden = true;
    delete node.dataset.mood;
    return;
  }
  node.hidden = false;
  node.dataset.mood = item.mood || "calm";
  const text = `${item.label}, ${MOOD_WORD[item.mood || "calm"]}`;
  if ($("now-text").textContent !== text) $("now-text").textContent = text;
}

function clearLights() {
  for (const node of lightTargets) setLit(node, null);
  showNow(null);
}

function light(path, start, dur) {
  const mood = MOOD[path];
  const label = `${path} ${INFO[path].name}`;
  if (!running) {
    // A new key replaces the old one at once: its light, its weather, its coins.
    for (const id of Object.keys(soloOff)) {
      clearTimeout(soloOff[id]);
      delete soloOff[id];
    }
    windows = [];
    clearLights();
    stage.calm();
  }
  windows.push({ path, mood, label, start, dur });
  if (running) return;
  litPath(path, mood);
  showNow({ mood, label });
  stage.fire({ path, mood, dur });
  clearTimeout(soloOff[path]);
  soloOff[path] = setTimeout(() => {
    litPath(path, null);
    delete soloOff[path];
    if (!running && Object.keys(soloOff).length === 0) showNow(null);
  }, dur * 1000);
}

function updateLights(now) {
  const moods = {};
  let current = null;
  for (const item of windows) {
    if (now < item.start || now >= item.start + item.dur) continue;
    if (item.path) moods[item.path] = item.mood;
    if (item.label && !item.fired) {
      item.fired = true;
      stage.fire(item);
    }
    if (item.label && (!current || item.start >= current.start)) current = item;
  }
  for (const node of lightTargets) setLit(node, moods[node.dataset.path] || null);
  if (current || !running) showNow(current);
}

function scheduleFrom(offset) {
  const lead = ctx ? 0.05 : 0;
  const start = ctx ? ctx.currentTime + lead : 0;
  originCtx = ctx ? ctx.currentTime : performance.now() / 1000;
  originPerf = offset - lead;
  for (const event of PERFORMANCE) {
    if (event.clip) {
      if (event.t + event.total <= offset) continue;
      const skip = Math.max(0, offset - event.t);
      playClip(event.clip, start + Math.max(0, event.t - offset), skip);
      const musicEnd = event.t + event.len;
      if (musicEnd <= offset) continue;
      const from = Math.max(event.t, offset);
      const dur = musicEnd - from;
      windows.push({ path: event.path, kind: event.kind, mood: event.mood, label: event.label, start: from, dur });
      if (event.kind === "chord") {
        for (const path of data.paths) {
          if (path.level !== "real-wallet-mainnet") continue;
          windows.push({ path: path.path, mood: "joy", start: from, dur });
        }
      }
      continue;
    }
    if (event.t < offset - 0.03) continue;
    const when = start + (event.t - offset);
    if (event.path) {
      const dur = playMotif(event.path, when);
      windows.push({ path: event.path, mood: MOOD[event.path], label: `${event.path} ${INFO[event.path].name}`, start: event.t, dur });
    } else if (event.kind === "lock") playLock(when);
    else if (event.kind === "show") playShow(when);
    else if (event.kind === "ticks") playTicks(when);
    else if (event.kind === "chord") {
      playChord(when);
      for (const path of data.paths) {
        if (path.level !== "real-wallet-mainnet") continue;
        windows.push({ path: path.path, mood: "joy", start: event.t, dur: SOUND.chordSeconds });
      }
    }
  }
}

function frame() {
  const now = perfNow();
  const shown = Math.max(0, Math.min(now, PIECE_SECONDS));
  $("progress-bar").style.width = `${(shown / PIECE_SECONDS) * 100}%`;
  const bar = $("progress");
  if (bar.getAttribute("aria-valuenow") !== String(Math.floor(shown))) {
    bar.setAttribute("aria-valuenow", String(Math.floor(shown)));
  }
  let caption = shownCaption;
  for (const event of PERFORMANCE) {
    if (event.caption && event.t <= now) caption = event.caption;
  }
  if (caption !== shownCaption) {
    shownCaption = caption;
    $("caption").textContent = caption;
  }
  updateLights(now);
  if (now >= PIECE_SECONDS && !linksShown) {
    linksShown = true;
    $("proven-links").hidden = false;
  }
  if (now >= PIECE_SECONDS + 2) {
    finishClock();
    return;
  }
  raf = requestAnimationFrame(frame);
}

function finishClock() {
  running = false;
  stage.setRunning(false);
  paused = false;
  cancelAnimationFrame(raf);
  $("pause").disabled = true;
  $("stop").disabled = true;
  $("play").textContent = "Play the performance";
  $("progress-bar").style.width = "100%";
  $("progress").setAttribute("aria-valuenow", String(PIECE_SECONDS));
  clearLights();
}

async function startPerformance(from) {
  ensureAudio();
  if (ctx && ctx.state === "suspended") await ctx.resume();
  await loadClips();
  stopOscillators();
  windows = [];
  for (const id of Object.keys(soloOff)) clearTimeout(soloOff[id]);
  if (from === 0) shownCaption = "";
  running = true;
  stage.setRunning(true);
  paused = false;
  pausedAt = from;
  $("pause").disabled = false;
  $("stop").disabled = false;
  $("play").textContent = "Play the performance";
  scheduleFrom(from);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

function pausePerformance() {
  if (!running || paused) return;
  pausedAt = perfNow();
  paused = true;
  stopOscillators();
  clearLights();
  stage.calm();
  cancelAnimationFrame(raf);
  $("play").textContent = "Resume";
  $("pause").disabled = true;
}

function stopPerformance() {
  running = false;
  paused = false;
  pausedAt = 0;
  cancelAnimationFrame(raf);
  stopOscillators();
  stage.calm();
  windows = [];
  for (const id of Object.keys(soloOff)) clearTimeout(soloOff[id]);
  shownCaption = "";
  updateLights(0);
  $("caption").textContent = "Press Play the performance, or play a key.";
  $("progress-bar").style.width = "0%";
  $("progress").setAttribute("aria-valuenow", "0");
  $("pause").disabled = true;
  $("stop").disabled = true;
  $("play").textContent = "Play the performance";
}

async function pressPath(path, options) {
  const entry = entries[path];
  if (!entry) return;
  if (!options || !options.proofAlready) showProof(entry);
  ensureAudio();
  if (ctx && ctx.state === "suspended") ctx.resume();
  await loadClips();
  if (!running) fadeVoices(0.25);
  const dur = playMotif(path, ctx ? ctx.currentTime : 0);
  light(path, running ? perfNow() : 0, dur);
}

function bindControls() {
  $("play").addEventListener("click", () => {
    if (paused) startPerformance(pausedAt);
    else startPerformance(0);
  });
  $("pause").addEventListener("click", pausePerformance);
  $("stop").addEventListener("click", stopPerformance);
  $("mute").addEventListener("click", () => {
    muted = !muted;
    $("mute").setAttribute("aria-pressed", muted ? "true" : "false");
    $("mute").textContent = muted ? "Unmute" : "Mute";
    if (master) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(muted ? 0.0001 : SOUND.master, now + 0.03);
      clipBus.gain.cancelScheduledValues(now);
      clipBus.gain.setValueAtTime(Math.max(clipBus.gain.value, 0.0001), now);
      clipBus.gain.exponentialRampToValueAtTime(muted ? 0.0001 : CLIP_GAIN, now + 0.05);
    }
  });
  $("copy-addr").addEventListener("click", () => {
    copyText($("donate-addr").textContent, $("copy-addr"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const path = KEYMAP[event.code];
    if (!path || !entries[path]) return;
    const tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    event.preventDefault();
    pressPath(path);
  });
}

function fail(message) {
  const node = $("load-error");
  node.hidden = false;
  node.textContent = message;
}

async function init() {
  bindControls();
  let response;
  try {
    response = await fetch("./score-data.json");
  } catch (err) {
    fail("The score data could not be loaded. score-data.json needs to sit next to this page.");
    return;
  }
  if (!response.ok) {
    fail("The score data could not be loaded. score-data.json needs to sit next to this page.");
    return;
  }
  try {
    data = await response.json();
  } catch (err) {
    fail("The score data could not be read.");
    return;
  }
  if (!data || !data.fund || !Array.isArray(data.paths)) {
    fail("The score data is missing the funding transaction or the paths.");
    return;
  }
  render(data);
  lightTargets = Array.from(document.querySelectorAll("[data-path]"));
  $("piece").hidden = false;
  stage.init();
  setTimeout(prefetchClips, 800);
}

init();
