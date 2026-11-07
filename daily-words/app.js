"use strict";
// Daily Words: daily English or Chinese words, past-day review, and the alphabet.

const PER_DAY = 5;
const REVIEW_DAYS = 14;
const $ = id => document.getElementById(id);

// ---------- Saved data (best effort: the game works without it) ----------
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let settings = Object.assign({ lang: "en", level: "easy", autoAbc: true }, store.get("dw2-settings", {}));
let progress = Object.assign({ stars: 0, streak: 0, lastDay: null }, store.get("dw2-progress", {}));
const saveProgress = () => store.set("dw2-progress", progress);

// ---------- Pictures: emoji shown as bundled Twemoji images ----------
const EMOJI_RE = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;
function picFile(e) {
  let cps = [...e].map(c => c.codePointAt(0).toString(16));
  if (!cps.includes("200d")) cps = cps.filter(c => c !== "fe0f");
  return "img/" + cps.join("-") + ".svg";
}
function pic(e) {
  return `<img class="emo" src="${picFile(e)}" alt="" draggable="false" onerror="this.replaceWith(document.createTextNode('${e}'))">`;
}
// Replace emoji characters in text nodes under root with pictures
function emojify(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (EMOJI_RE.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const span = document.createElement("span");
    span.innerHTML = n.nodeValue.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])).replace(EMOJI_RE, m => pic(m));
    n.replaceWith(...span.childNodes);
  }
}
function setText(el, text) { el.textContent = text; emojify(el); }

// ---------- Speech ----------
const voices = { en: null, zh: null };
let voicesLoaded = false;
function pickVoices() {
  if (!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices();
  if (vs.length) voicesLoaded = true;
  voices.en = vs.find(v => /^en[-_]US/i.test(v.lang) && /samantha|google|female|aria|jenny/i.test(v.name))
           || vs.find(v => /^en[-_](US|GB)/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  voices.zh = vs.find(v => /^zh[-_]CN/i.test(v.lang) || /^cmn/i.test(v.lang))
           || vs.find(v => /^zh/i.test(v.lang) && !/HK|yue/i.test(v.lang)) || null;
  updateVoiceNote();
}
if ("speechSynthesis" in window) { pickVoices(); speechSynthesis.onvoiceschanged = pickVoices; }

// parts: [[text, "en"|"zh", rate?, onStart?], ...] spoken in order.
// onStart runs as that part begins (used to light up letters as they are read).
// onDone runs once, when the last part has finished; not if newer speech replaced this one.
let sayTimers = [];
let sayId = 0;
function say(parts, onDone) {
  sayTimers.forEach(clearTimeout); sayTimers = [];
  const id = ++sayId;
  const speech = "speechSynthesis" in window;
  if (speech) speechSynthesis.cancel();
  const finish = () => { if (id === sayId && onDone) { const f = onDone; onDone = null; f(); } };
  let last = null;
  parts.forEach(([text, lang = "en", rate, onStart], k) => {
    if (!speech) { if (onStart) sayTimers.push(setTimeout(onStart, k * 700)); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "zh" ? "zh-CN" : "en-US";
    if (voices[lang]) u.voice = voices[lang];
    u.rate = rate || (lang === "zh" ? 0.7 : 0.8);
    u.pitch = 1.05;
    if (onStart) u.onstart = onStart;
    speechSynthesis.speak(u);
    last = u;
  });
  if (!onDone) return;
  if (!last) { sayTimers.push(setTimeout(finish, parts.length * 700)); return; }
  last.onend = finish; last.onerror = finish;
  // Safety net: some browsers never fire onend, so finish after a generous estimate anyway
  const estimate = parts.reduce((t, [text, lang]) => t + 900 + text.length * (lang === "zh" ? 500 : 120), 1500);
  sayTimers.push(setTimeout(finish, Math.min(estimate, 25000)));
}

// Letter names, so a lone "A" is read as the letter, not the word "a".
// Spelled so speech voices say them right: "ay" is often read as "eye", and "jee" is not a word.
const LETTER_NAMES = { A: "eigh", B: "bee", C: "see", D: "dee", E: "ee", F: "ef", G: "gee", H: "aitch", I: "eye",
  J: "jay", K: "kay", L: "el", M: "em", N: "en", O: "oh", P: "pee", Q: "cue", R: "ar", S: "ess", T: "tee",
  U: "you", V: "vee", W: "double you", X: "ex", Y: "why", Z: "zee" };
const letterName = l => LETTER_NAMES[l.toUpperCase()] || l;
function updateVoiceNote() {
  const missing = !("speechSynthesis" in window)
    ? "This browser can't read words aloud. Try Chrome, Safari or Edge."
    : (settings.lang === "zh" && voicesLoaded && !voices.zh)
      ? "No Chinese voice found on this device, so Chinese words may not be read aloud. Add a Chinese (Mandarin) voice in your device's speech or language settings."
      : "";
  document.querySelectorAll(".voice-note").forEach(n => { n.textContent = missing; n.hidden = !missing; });
}

// ---------- Days and lessons ----------
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const a = arr.slice(), r = rng(seed);
  for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
  return a;
}
const randomShuffle = arr => seededShuffle(arr, Math.floor(Math.random() * 1e9));
const dateKey = d => d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
const now = new Date();
function day(offset) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  return { d, offset, key: dateKey(d), num: Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) };
}
const SEEDS = { "en-easy": 7, "en-hard": 11, "zh-easy": 23, "zh-hard": 31 };
// Every word in a list is used before any repeats; the same day always gives the same words.
function lessonWords(dayObj, lang = settings.lang, level = settings.level) {
  const order = seededShuffle(DATA[lang][level], SEEDS[lang + "-" + level]);
  return Array.from({ length: PER_DAY }, (_, k) => order[(dayObj.num * PER_DAY + k) % order.length]);
}
const idOf = x => x.w || x.zh;
const runKey = dayObj => `dw2-run-${settings.lang}-${settings.level}-${dayObj.key}`;
const completeKey = dayObj => `dw2-complete-${settings.lang}-${settings.level}-${dayObj.key}`;
function dayLabel(dayObj) {
  if (dayObj.offset === 0) return "Today";
  if (dayObj.offset === 1) return "Yesterday";
  return dayObj.d.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "short" });
}

// ---------- Screens ----------
let screen = "home";
let laterTimer = null;   // delayed speech; cancelled when the screen changes
function show(id) {
  clearTimeout(laterTimer); sayTimers.forEach(clearTimeout);
  if (id !== screen && "speechSynthesis" in window) speechSynthesis.cancel();
  screen = id;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === id));
  document.documentElement.lang = (id === "play" || id === "done" || id === "exam") && settings.lang === "zh" ? "zh-CN" : "en";
  window.scrollTo(0, 0);
  updateVoiceNote();
}
function goHome() { show("home"); renderHome(); }
document.querySelectorAll(".home-btn").forEach(b => b.addEventListener("click", goHome));

// ---------- Home ----------
const CAPTIONS = {
  "en-easy": "Short English words (up to 4 letters)",
  "en-hard": "Longer English words (5 to 7 letters)",
  "zh-easy": "Everyday Chinese words · listen and find the picture",
  "zh-hard": "Chinese phrases for daily life · build them with characters"
};
function renderHome() {
  document.querySelectorAll("[data-lang]").forEach(b => { b.classList.toggle("on", b.dataset.lang === settings.lang); b.setAttribute("aria-pressed", b.dataset.lang === settings.lang); });
  document.querySelectorAll("[data-level]").forEach(b => { b.classList.toggle("on", b.dataset.level === settings.level); b.setAttribute("aria-pressed", b.dataset.level === settings.level); });
  $("level-caption").textContent = CAPTIONS[settings.lang + "-" + settings.level];
  setText($("home-stars"), "⭐ " + progress.stars);
  setText($("home-streak"), "🔥 " + progress.streak + (progress.streak === 1 ? " day" : " days"));
  const t = day(0);
  const done = store.get(completeKey(t), false);
  setText($("today-preview"), done ? "Done today ✅" : lessonWords(t).map(x => x.pic).join(""));
  const best = store.get(examKey(), null);
  setText($("exam-best"), best ? `No hints · best ${best.right} / ${best.n}` : "No hints · check what you know");
}
document.querySelectorAll("[data-lang]").forEach(b => b.addEventListener("click", () => {
  settings.lang = b.dataset.lang; store.set("dw2-settings", settings); renderHome(); updateVoiceNote();
  say(settings.lang === "zh" ? [["中文", "zh"]] : [["English"]]);
}));
document.querySelectorAll("[data-level]").forEach(b => b.addEventListener("click", () => {
  settings.level = b.dataset.level; store.set("dw2-settings", settings); renderHome();
  say([[settings.level === "easy" ? "Easy" : "Hard"]]);
}));
$("m-today").addEventListener("click", () => { say([["Let's learn some words!"]]); startLesson(day(0)); });
$("m-review").addEventListener("click", () => { renderDays(); show("days"); });
$("m-abc").addEventListener("click", () => { renderAbc(); renderAbcTestBest(); show("abc"); say([["A B C"]]); });

// ---------- Review past days ----------
function renderDays() {
  $("days-caption").textContent = (settings.lang === "zh" ? "中文" : "English") + " · " + (settings.level === "easy" ? "Easy" : "Hard");
  const box = $("daylist"); box.innerHTML = "";
  for (let k = 0; k < REVIEW_DAYS; k++) {
    const d = day(k), words = lessonWords(d);
    const complete = store.get(completeKey(d), false);
    const run = store.get(runKey(d), []);
    const b = document.createElement("button");
    b.className = "day" + (k === 0 ? " today" : "");
    b.innerHTML = `<b></b><span class="pics"></span><span class="status"></span>`;
    b.querySelector("b").textContent = dayLabel(d);
    b.querySelector(".pics").textContent = words.map(x => x.pic).join("");
    const st = b.querySelector(".status");
    if (complete) { st.textContent = "✅ Done · tap to practise again"; st.classList.add("ok"); }
    else if (run.length) st.textContent = `${run.length} of ${PER_DAY} done`;
    else st.textContent = k === 0 ? "New today" : "Not started";
    b.setAttribute("aria-label", dayLabel(d) + ": " + words.map(idOf).join(", "));
    b.addEventListener("click", () => startLesson(d));
    box.appendChild(b);
  }
  emojify(box);
}

// ---------- Lesson ----------
let game = null;
const cur = () => game.words[game.i];
const isZh = () => settings.lang === "zh";
const cheers = ["Great job!", "Super!", "Well done!", "Awesome!", "You did it!", "Fantastic!"];

function startLesson(dayObj) {
  const words = lessonWords(dayObj);
  let run = store.get(runKey(dayObj), []);
  if (run.length >= words.length) run = [];          // finished before: practise again from the start
  game = { day: dayObj, words, run, i: 0, bonus: false };
  game.i = Math.max(0, words.findIndex(x => !run.includes(idOf(x))));
  show("play");
  loadWord();
}

function renderTop() {
  setText($("stars"), "⭐ " + progress.stars);
  const dots = $("dots"); dots.innerHTML = "";
  if (game.bonus) { setText(dots, "🎁"); return; }
  game.words.forEach((x, k) => {
    const d = document.createElement("div");
    d.className = "dot" + (game.run.includes(idOf(x)) ? " done" : "") + (k === game.i ? " now" : "");
    dots.appendChild(d);
  });
}

function loadWord() {
  game.typed = 0; game.misses = 0; game.solved = false;
  renderTop();
  $("msg").textContent = "";
  $("next").style.visibility = "hidden";
  $("ready").hidden = true;
  $("slots").innerHTML = ""; $("slots").classList.remove("read-all"); $("tiles").innerHTML = ""; $("prompt").textContent = "";
  if (isZh()) zhLearn(); else enSpell();
}

function showPicture(e) { $("pic").innerHTML = pic(e); }
function bounce() { const p = $("pic"); p.classList.remove("bounce"); void p.offsetWidth; p.classList.add("bounce"); }
function wordInfo(parts) {
  const x = cur(), el = $("word-info");
  el.innerHTML = "";
  if (parts.includes("hanzi")) el.insertAdjacentHTML("beforeend", `<span class="hanzi" lang="zh-CN"></span>`);
  if (parts.includes("pinyin")) el.insertAdjacentHTML("beforeend", `<span class="pinyin"></span>`);
  if (parts.includes("meaning")) el.insertAdjacentHTML("beforeend", `<span class="meaning"></span>`);
  if (el.querySelector(".hanzi")) el.querySelector(".hanzi").textContent = x.zh;
  if (el.querySelector(".pinyin")) el.querySelector(".pinyin").textContent = x.py;
  if (el.querySelector(".meaning")) el.querySelector(".meaning").textContent = "“" + x.en + "”";
  if (parts.includes("sentence") && x.s) {
    el.insertAdjacentHTML("beforeend",
      `<span class="sentence"><span class="s-zh" lang="zh-CN"></span><span class="s-py"></span><span class="s-en"></span></span>`);
    el.querySelector(".s-zh").textContent = x.s;
    el.querySelector(".s-py").textContent = x.sp;
    el.querySelector(".s-en").textContent = x.se;
  }
}

// What tapping the picture (or Space) says, depending on the step
function sayWord() {
  const x = cur();
  bounce();
  if (game.solved && game.phase !== "learn" && $("slots").children.length) return readBack(x);
  if (!isZh()) return say([[x.w], [x.s], [x.w]]);
  if (game.phase === "quiz") return say([["Find", "en"], [x.zh, "zh"]]);
  if (game.phase === "build") return say([[x.zh, "zh"], [x.en, "en"]]);
  // Learn: the word, its meaning, an example sentence, then the word again (like English mode).
  // "I'm ready" unlocks only once all of it has been heard.
  say([[x.zh, "zh"], [x.en, "en"]].concat(x.s ? [[x.s, "zh"]] : [], [[x.zh, "zh"]]), () => setReady(true));
}

// English: spell with letter tiles
function enSpell() {
  const x = cur(), word = x.w.toUpperCase(), hard = settings.level === "hard";
  game.phase = "spell";
  showPicture(x.pic);
  wordInfo([]);
  $("prompt").textContent = hard ? "Listen and spell it!" : "Spell the word!";
  word.split("").forEach(l => {
    const s = document.createElement("div");
    s.className = "slot"; s.innerHTML = `<span class="ch"></span>`;
    s.firstChild.textContent = hard ? "" : l;      // faint guide letters in Easy
    $("slots").appendChild(s);
  });
  let letters = word.split("");
  if (hard) {   // one extra letter that is not in the word
    const extra = [..."ABCDEFGHIJKLMNOPRSTUVWY"].filter(c => !word.includes(c));
    letters.push(extra[Math.floor(Math.random() * extra.length)]);
  }
  makeTiles(letters, word, l => say([[letterName(l), "en", 0.9]]));
  sayWord();
}

// Letter or character tiles; target is the answer string (or array of characters)
function makeTiles(items, target, speakTile) {
  const t = [...target];
  let order = randomShuffle(items);
  for (let k = 0; k < 20 && items.length > 1 && order.slice(0, t.length).join("") === t.join(""); k++) order = randomShuffle(items);
  order.forEach(l => {
    const b = document.createElement("button");
    b.className = "tile" + (isZh() ? " zh" : ""); b.textContent = l;
    if (isZh()) b.lang = "zh-CN";
    b.setAttribute("aria-label", (isZh() ? "Character " : "Letter ") + l);
    b.addEventListener("click", () => tapTile(l, b, t, speakTile));
    $("tiles").appendChild(b);
  });
}

function tapTile(l, btn, target, speakTile) {
  if (game.solved || btn.classList.contains("used")) return;
  if (l === target[game.typed]) {
    speakTile(l);
    document.querySelectorAll(".tile.hint").forEach(t => t.classList.remove("hint"));
    const slot = $("slots").children[game.typed];
    slot.classList.add("filled"); slot.querySelector(".ch").textContent = l;
    game.typed++; game.misses = 0;
    btn.classList.add("used");
    if (game.typed === target.length) solved();
  } else {
    say(isZh() ? [[l, "zh", 0.8], ["Try again.", "en", 1]] : [[letterName(l), "en", 0.9], ["Try again.", "en", 1]]);
    btn.classList.add("wrong");
    setTimeout(() => btn.classList.remove("wrong"), 400);
    if (++game.misses >= 2) {
      const need = target[game.typed];
      const tile = [...document.querySelectorAll(".tile:not(.used)")].find(t => t.textContent === need);
      if (tile) tile.classList.add("hint");
    }
  }
}

// Chinese step 1: learn the word (picture, characters, pinyin, meaning, audio)
function zhLearn() {
  const x = cur();
  game.phase = "learn";
  showPicture(x.pic);
  wordInfo(["hanzi", "pinyin", "meaning", "sentence"]);
  setText($("prompt"), "👂 Listen and say it!");
  setReady(false);
  $("ready").hidden = false;
  sayWord();
}
function setReady(on) {
  const r = $("ready");
  r.disabled = !on;
  setText(r, on ? "I'm ready ➜" : "🔊 Listen…");
  if (on && game.phase === "learn") r.focus({ preventScroll: true });
}
$("ready").addEventListener("click", () => {
  $("ready").hidden = true;
  if (settings.level === "easy") zhQuiz(); else zhBuild();
});

// Chinese Easy step 2: hear the word, find the picture
function zhQuiz() {
  const x = cur();
  game.phase = "quiz";
  showPicture("🔊");
  wordInfo(["hanzi", "pinyin"]);
  $("prompt").textContent = "Which picture is it?";
  const pool = randomShuffle(DATA.zh.easy.concat(DATA.zh.hard).filter(y => y.pic !== x.pic));
  const options = [x];
  for (const y of pool) { if (options.length === 3) break; if (!options.some(o => o.pic === y.pic)) options.push(y); }
  const box = $("tiles");
  randomShuffle(options).forEach((o, k) => {
    const b = document.createElement("button");
    b.className = "choice"; b.innerHTML = pic(o.pic); b.dataset.key = k + 1;
    if (o === x) b.dataset.answer = "1";
    b.setAttribute("aria-label", "Picture " + (k + 1));
    b.addEventListener("click", () => {
      if (game.solved) return;
      if (o === x) {
        b.classList.add("right");
        showPicture(x.pic); wordInfo(["hanzi", "pinyin", "meaning"]);
        solved();
      } else {
        say([["Try again", "en"], [x.zh, "zh"]]);
        b.classList.add("wrong"); setTimeout(() => b.classList.remove("wrong"), 400);
        if (++game.misses >= 2) box.querySelector('[data-answer="1"]')?.classList.add("hint");
      }
    });
    box.appendChild(b);
  });
  sayWord();
}

// Chinese Hard step 2: build the phrase with character tiles (one extra character)
function zhBuild() {
  const x = cur(), chars = [...x.zh], syll = x.py.split(" ");
  game.phase = "build";
  wordInfo(["pinyin", "meaning"]);
  $("prompt").textContent = "Build it with the characters!";
  chars.forEach((c, k) => {
    const s = document.createElement("div");
    s.className = "slot zh"; s.lang = "zh-CN";
    s.innerHTML = `<span class="ch"></span><small></small>`;
    s.querySelector(".ch").textContent = c;             // faint guide character to match
    s.querySelector("small").textContent = syll[k] || "";
    $("slots").appendChild(s);
  });
  const others = [...new Set(DATA.zh.easy.concat(DATA.zh.hard).flatMap(y => [...y.zh]))].filter(c => !chars.includes(c));
  makeTiles(chars.concat(others[Math.floor(Math.random() * others.length)]), chars, c => say([[c, "zh", 0.8]]));
  sayWord();
}

// After a correct answer: read each letter (or character) while it lights up, then the whole word
function readBack(x, cheer) {
  const slots = [...$("slots").children];
  const light = k => () => { slots.forEach((sl, j) => sl.classList.toggle("reading", j === k)); $("slots").classList.remove("read-all"); };
  const all = () => { slots.forEach(sl => sl.classList.remove("reading")); $("slots").classList.add("read-all"); };
  // Chinese: read characters one by one only when there are character tiles (Hard). Reading
  // a lone 宝 then 宝 before 宝宝 in Easy mode sounded wrong, so Easy says just the word.
  const parts = x.zh
    ? ([...x.zh].length > 1 && slots.length ? [...x.zh].map((c, k) => [c, "zh", 0.7, light(k)]) : []).concat([[x.zh, "zh", 0.7, all], [x.en, "en", 0.85]])
    : [...x.w.toUpperCase()].map((l, k) => [letterName(l), "en", 0.8, light(k)]).concat([[x.w, "en", 0.75, all]]);
  if (cheer) parts.push([cheer, "en", 0.9]);
  say(parts);
}

function solved() {
  const x = cur();
  game.solved = true;
  const cheer = cheers[Math.floor(Math.random() * cheers.length)];
  setText($("msg"), "🎉 " + cheer + " ⭐");
  progress.stars++;
  if (!game.bonus && !game.run.includes(idOf(x))) {
    game.run.push(idOf(x));
    store.set(runKey(game.day), game.run);
    if (game.run.length === game.words.length) {
      store.set(completeKey(game.day), true);
      if (game.day.offset === 0 && progress.lastDay !== game.day.key) {
        progress.streak = progress.lastDay === day(1).key ? progress.streak + 1 : 1;
        progress.lastDay = game.day.key;
      }
    }
  }
  saveProgress();
  renderTop();
  game.cheer = cheer;
  laterTimer = setTimeout(() => readBack(x, cheer), 350);
  $("next").style.visibility = "visible";
  $("next").focus({ preventScroll: true });
}

function nextWord() {
  if (game.bonus) return bonusWord();
  const k = game.words.findIndex(x => !game.run.includes(idOf(x)));
  if (k === -1) return showDone();
  game.i = k; loadWord();
}
$("next").addEventListener("click", nextWord);
$("pic").addEventListener("click", sayWord);

function showDone() {
  show("done");
  $("done-title").textContent = (game.day.offset === 0 ? "Today" : dayLabel(game.day)) + " you learned:";
  const box = $("learned"); box.innerHTML = "";
  game.words.forEach(x => {
    const b = document.createElement("button");
    b.className = "learned";
    if (isZh()) {
      b.innerHTML = `<span class="lp">${pic(x.pic)}</span><span class="hanzi" lang="zh-CN"></span><small></small>`;
      b.querySelector(".hanzi").textContent = x.zh; b.querySelector("small").textContent = x.py;
      b.addEventListener("click", () => say([[x.zh, "zh"], [x.en, "en"]].concat(x.s ? [[x.s, "zh"]] : [])));
    } else {
      b.innerHTML = `<span class="lp">${pic(x.pic)}</span><span></span>`;
      b.lastChild.textContent = x.w;
      b.addEventListener("click", () => say([[x.w], [x.s]]));
    }
    box.appendChild(b);
  });
  setText($("done-streak"), "🔥 " + progress.streak + " day" + (progress.streak === 1 ? "" : "s") + " in a row  ·  ⭐ " + progress.stars + " stars");
  say([["You did it! You learned " + game.words.length + " words. Tap a picture to hear it again."]]);
}
$("again").addEventListener("click", () => { store.set(runKey(game.day), []); startLesson(game.day); });

function bonusWord() {
  const pool = DATA[settings.lang][settings.level].filter(x => !game.words.includes(x) && x !== cur());
  game = Object.assign(game, { words: [pool[Math.floor(Math.random() * pool.length)]], i: 0, bonus: true });
  show("play"); loadWord();
}
$("bonus").addEventListener("click", bonusWord);

// ---------- Test: check what was learned, with no hints ----------
// One try per question. Nothing is highlighted or read out while answering;
// after each answer the right one is shown. Each mode has two question types:
const EXAM_LEN = 10;
const EXAM_TYPES = {
  "en-easy": ["read", "spell"],   // read the word → find its picture; hear it → spell it (no guide letters)
  "en-hard": ["read", "spell"],   // same, with 4 pictures and 2 extra letters
  "zh-easy": ["listen", "read"],  // hear it → find its picture; read the characters (no pinyin) → find its picture
  "zh-hard": ["listen", "build"]  // hear it → find its picture; hear it → build it (no guide characters or pinyin)
};
let ex = null;
const examKey = () => `dw2-exam-best-${settings.lang}-${settings.level}`;
const isHard = () => settings.level === "hard";

// Words learned in the last REVIEW_DAYS days; topped up with today's words so a test is always possible
function learnedWords() {
  const ids = new Set();
  for (let k = 0; k < REVIEW_DAYS; k++) {
    const d = day(k);
    if (store.get(completeKey(d), false)) lessonWords(d).forEach(x => ids.add(idOf(x)));
    store.get(runKey(d), []).forEach(id => ids.add(id));
  }
  const pool = DATA[settings.lang][settings.level].filter(x => ids.has(idOf(x)));
  for (const x of lessonWords(day(0))) if (pool.length < PER_DAY && !pool.includes(x)) pool.push(x);
  return pool;
}

function startExam() {
  const words = randomShuffle(learnedWords()).slice(0, EXAM_LEN), types = EXAM_TYPES[settings.lang + "-" + settings.level];
  let qs = words.map((x, k) => ({ x, type: types[k % 2] }));
  // Few words learned: test each of them both ways
  if (qs.length < EXAM_LEN) qs = qs.concat(words.map((x, k) => ({ x, type: types[(k + 1) % 2] }))).slice(0, EXAM_LEN);
  ex = { qs: randomShuffle(qs), i: 0, results: [] };
  show("exam");
  examQuestion();
}

function renderExamTop() {
  setText($("exam-stars"), "⭐ " + progress.stars);
  const dots = $("exam-dots"); dots.innerHTML = "";
  ex.qs.forEach((q, k) => {
    const r = ex.results[k];
    dots.appendChild(Object.assign(document.createElement("div"),
      { className: "dot" + (r === true ? " done" : r === false ? " miss" : "") + (k === ex.i && r === undefined ? " now" : "") }));
  });
}

function examQuestion() {
  const q = ex.qs[ex.i], x = q.x;
  ex.answered = false; ex.typed = []; ex.target = null;
  $("exam-stage").hidden = false; $("exam-results").hidden = true;
  renderExamTop();
  ["exam-msg", "exam-slots", "exam-tiles", "exam-word"].forEach(id => { $(id).innerHTML = ""; });
  $("exam-next").hidden = true; $("exam-check").hidden = true; $("exam-undo").hidden = true;
  const P = $("exam-pic"), W = $("exam-word");
  P.hidden = false;
  if (q.type === "read") {
    P.hidden = true;
    const w = document.createElement("span");
    if (isZh()) { w.className = "hanzi read-word"; w.lang = "zh-CN"; w.textContent = x.zh; }
    else { w.className = "read-word"; w.textContent = x.w; }
    W.appendChild(w);
    $("exam-prompt").textContent = "Read it. Which picture is it?";
    examChoices(x);
  } else if (q.type === "listen") {
    P.innerHTML = pic("🔊");
    $("exam-prompt").textContent = "Listen. Which picture is it?";
    examChoices(x);
  } else if (q.type === "spell") {
    P.innerHTML = pic(x.pic);
    $("exam-prompt").textContent = "Spell the word!";
    const word = [...x.w.toUpperCase()];
    const extra = randomShuffle([..."ABCDEFGHIJKLMNOPRSTUVWY"].filter(c => !word.includes(c))).slice(0, isHard() ? 2 : 0);
    examTiles(word.concat(extra), word);
  } else {   // build
    P.innerHTML = pic("🔊");
    W.insertAdjacentHTML("beforeend", `<span class="meaning"></span>`);
    W.lastChild.textContent = "“" + x.en + "”";
    $("exam-prompt").textContent = "Build it with the characters!";
    const chars = [...x.zh];
    const others = randomShuffle([...new Set(DATA.zh.easy.concat(DATA.zh.hard).flatMap(y => [...y.zh]))].filter(c => !chars.includes(c)));
    examTiles(chars.concat(others.slice(0, 2)), chars);
  }
  examSay();
}

// The question, read aloud. "Read" questions only give the instruction: the word itself would be a hint.
function examSay() {
  const q = ex.qs[ex.i], x = q.x;
  if (ex.answered) return say(examAnswerSpeech(x));
  const P = $("exam-pic"); P.classList.remove("bounce"); void P.offsetWidth; P.classList.add("bounce");
  if (q.type === "read") return say([[isZh() ? "Read it. Which picture is it?" : "Read the word. Which picture is it?"]]);
  if (q.type === "listen") return say([["Find", "en"], [x.zh, "zh"]]);
  if (q.type === "spell") return say([["Spell"], [x.w]]);
  say([["Build", "en"], [x.zh, "zh"]]);
}
const examAnswerSpeech = x => isZh() ? [[x.zh, "zh"], [x.en, "en"]] : [[x.w]];

function examChoices(x) {
  const n = isHard() ? 4 : 3;
  const pool = randomShuffle(DATA[settings.lang][settings.level].filter(y => y.pic !== x.pic));
  const options = [x];
  for (const y of pool) { if (options.length === n) break; if (!options.some(o => o.pic === y.pic)) options.push(y); }
  randomShuffle(options).forEach((o, k) => {
    const b = document.createElement("button");
    b.className = "choice"; b.innerHTML = pic(o.pic); b.dataset.key = k + 1;
    if (o === x) b.dataset.answer = "1";
    b.setAttribute("aria-label", "Picture " + (k + 1));
    b.addEventListener("click", () => { if (!ex.answered) { b.classList.add(o === x ? "right" : "wrong-final"); examAnswer(o === x); } });
    $("exam-tiles").appendChild(b);
  });
}

// Blank slots and tiles. Tiles are silent, placed letters stay neutral until "Check", and ⌫ takes one back.
function examTiles(items, target) {
  ex.target = target;
  target.forEach(() => {
    const s = document.createElement("div");
    s.className = "slot" + (isZh() ? " zh" : ""); if (isZh()) s.lang = "zh-CN";
    s.innerHTML = `<span class="ch"></span>`;
    $("exam-slots").appendChild(s);
  });
  let order = randomShuffle(items);
  for (let k = 0; k < 20 && order.slice(0, target.length).join("") === target.join(""); k++) order = randomShuffle(items);
  order.forEach(l => {
    const b = document.createElement("button");
    b.className = "tile" + (isZh() ? " zh" : ""); b.textContent = l;
    if (isZh()) b.lang = "zh-CN";
    b.setAttribute("aria-label", (isZh() ? "Character " : "Letter ") + l);
    b.addEventListener("click", () => examTap(b));
    $("exam-tiles").appendChild(b);
  });
  $("exam-undo").hidden = false;
}
function examTap(b) {
  if (ex.answered || b.classList.contains("used") || ex.typed.length >= ex.target.length) return;
  const slot = $("exam-slots").children[ex.typed.length];
  slot.querySelector(".ch").textContent = b.textContent; slot.classList.add("placed");
  ex.typed.push(b); b.classList.add("used");
  const full = ex.typed.length === ex.target.length;
  $("exam-check").hidden = !full;
  if (full) $("exam-check").focus({ preventScroll: true });
}
function examUndo() {
  if (ex.answered || !ex.typed.length) return;
  ex.typed.pop().classList.remove("used");
  const slot = $("exam-slots").children[ex.typed.length];
  slot.querySelector(".ch").textContent = ""; slot.classList.remove("placed");
  $("exam-check").hidden = true;
}
function examCheck() {
  if (ex.answered || ex.typed.length !== ex.target.length) return;
  const got = ex.typed.map(b => b.textContent);
  [...$("exam-slots").children].forEach((s, k) => s.classList.add(got[k] === ex.target[k] ? "good" : "bad"));
  examAnswer(got.join("") === ex.target.join(""));
}

function examAnswer(ok) {
  const q = ex.qs[ex.i], x = q.x;
  ex.answered = true;
  ex.results[ex.i] = ok;
  if (ok) { progress.stars++; saveProgress(); }
  document.querySelectorAll("#exam-tiles button").forEach(b => { b.disabled = true; });
  if (!ok) $("exam-tiles").querySelector('[data-answer="1"]')?.classList.add("right");
  $("exam-check").hidden = true; $("exam-undo").hidden = true;
  // Show the answer: picture and word
  const P = $("exam-pic"), W = $("exam-word");
  P.hidden = false; P.innerHTML = pic(x.pic);
  W.innerHTML = "";
  if (isZh()) {
    W.insertAdjacentHTML("beforeend", `<span class="hanzi" lang="zh-CN"></span><span class="pinyin"></span><span class="meaning"></span>`);
    W.querySelector(".hanzi").textContent = x.zh; W.querySelector(".pinyin").textContent = x.py;
    W.querySelector(".meaning").textContent = "“" + x.en + "”";
  } else {
    W.appendChild(Object.assign(document.createElement("span"), { className: "answer-word", textContent: x.w }));
  }
  setText($("exam-msg"), ok ? "✅ Right! ⭐" : "❌ Not quite");
  say([[ok ? "Right!" : "It's", "en"]].concat(examAnswerSpeech(x)));
  renderExamTop();
  $("exam-next").hidden = false;
  setText($("exam-next"), ex.i + 1 < ex.qs.length ? "Next ➜" : "🏆 Results");
  $("exam-next").focus({ preventScroll: true });
}

function examNext() {
  if (!ex.answered) return;
  if (++ex.i < ex.qs.length) examQuestion(); else examResults();
}

function examResults() {
  const n = ex.qs.length, right = ex.results.filter(Boolean).length;
  const best = store.get(examKey(), null);
  if (!best || right / n > best.right / best.n) store.set(examKey(), { right, n });
  $("exam-stage").hidden = true; $("exam-results").hidden = false;
  renderExamTop();
  setText($("exam-score"), `🏆 ${right} / ${n}`);
  const verdict = right === n ? "Perfect! You know all of them!" : right >= n * 0.7 ? "Great work!" : "Good try! Practise these and try again.";
  $("exam-verdict").textContent = verdict;
  const missed = [...new Set(ex.qs.filter((q, k) => !ex.results[k]).map(q => q.x))];
  $("exam-missed-title").hidden = !missed.length;
  const box = $("exam-missed"); box.innerHTML = "";
  missed.forEach(x => {
    const b = document.createElement("button");
    b.className = "learned";
    if (isZh()) {
      b.innerHTML = `<span class="lp">${pic(x.pic)}</span><span class="hanzi" lang="zh-CN"></span><small></small>`;
      b.querySelector(".hanzi").textContent = x.zh; b.querySelector("small").textContent = x.py;
      b.addEventListener("click", () => say([[x.zh, "zh"], [x.en, "en"]].concat(x.s ? [[x.s, "zh"]] : [])));
    } else {
      b.innerHTML = `<span class="lp">${pic(x.pic)}</span><span></span>`;
      b.lastChild.textContent = x.w;
      b.addEventListener("click", () => say([[x.w], [x.s]]));
    }
    box.appendChild(b);
  });
  say([["You got " + right + " out of " + n + ". " + verdict]]);
}

$("m-exam").addEventListener("click", startExam);
$("exam-pic").addEventListener("click", examSay);
$("exam-undo").addEventListener("click", examUndo);
$("exam-check").addEventListener("click", examCheck);
$("exam-next").addEventListener("click", examNext);
$("exam-again").addEventListener("click", startExam);

// ---------- Alphabet ----------
let letterIndex = 0;
function renderAbc() {
  const grid = $("abc-grid");
  if (grid.children.length) return;
  DATA.abc.forEach((a, k) => {
    const b = document.createElement("button");
    b.className = "abc-card";
    b.innerHTML = `<span class="ap">${pic(a.pic)}</span><span class="al"><span class="cap">${a.L}</span><span class="low">${a.L.toLowerCase()}</span></span>`;
    b.setAttribute("aria-label", `${a.L} for ${a.w}`);
    b.addEventListener("click", () => openLetter(k));
    grid.appendChild(b);
  });
}
function letterSpeech(a) {
  const n = letterName(a.L);
  return [[n], ["Big " + n + ", small " + n + "."], [a.end ? n + " is in " + a.w + "." : n + " is for " + a.w + "."]];
}
// Auto-play: after a letter has been read out, move on to the next one by itself (stops after Z)
const AUTO_PAUSE = 1500;
function scheduleAutoNext() {
  clearTimeout(laterTimer);
  if (!settings.autoAbc || screen !== "letter") return;
  if (letterIndex === 25) return setAuto(false);
  laterTimer = setTimeout(() => { if (settings.autoAbc && screen === "letter") openLetter(letterIndex + 1); }, AUTO_PAUSE);
}
function setAuto(on) {
  settings.autoAbc = on; store.set("dw2-settings", settings);
  const b = $("auto-btn");
  b.setAttribute("aria-pressed", on);
  b.setAttribute("aria-label", on ? "Pause auto-play" : "Play letters automatically");
  setText(b, on ? "⏸️" : "▶️");
  b.classList.toggle("on", on);
}
$("auto-btn").addEventListener("click", () => {
  const on = !settings.autoAbc;
  // Turning it on at Z starts again from A
  if (on && letterIndex === 25) { setAuto(true); return openLetter(0); }
  setAuto(on);
  if (on) scheduleAutoNext(); else clearTimeout(laterTimer);
});
function openLetter(k) {
  clearTimeout(laterTimer);
  letterIndex = (k + 26) % 26;
  const a = DATA.abc[letterIndex];
  $("cap").textContent = a.L; $("low").textContent = a.L.toLowerCase();
  $("letter-pic").innerHTML = pic(a.pic);
  // Highlight the letter inside the word
  const w = a.w, at = a.end ? w.lastIndexOf(a.L.toLowerCase()) : 0;
  $("letter-word").innerHTML = "";
  $("letter-word").append(w.slice(0, at), Object.assign(document.createElement("mark"), { textContent: w[at] }), w.slice(at + 1));
  $("letter-count").textContent = `${letterIndex + 1} / 26`;
  if (screen !== "letter") { show("letter"); setAuto(settings.autoAbc); }
  const card = $("letter-card"); card.classList.remove("slide"); void card.offsetWidth; card.classList.add("slide");
  say(letterSpeech(a), scheduleAutoNext);
}
$("letter-card").addEventListener("click", () => { clearTimeout(laterTimer); say(letterSpeech(DATA.abc[letterIndex]), scheduleAutoNext); });
$("prev").addEventListener("click", () => openLetter(letterIndex - 1));
$("nextL").addEventListener("click", () => openLetter(letterIndex + 1));
$("letter-back").addEventListener("click", () => show("abc"));

// Letter game: "Find big G" / "Find small g", 4 choices, 10 rounds.
// Letter test: the same, but the letter is only heard (not shown), one try each, no hints.
const ROUNDS = 10;
let lg = null;
function startLetterGame(test = false) {
  lg = { round: 0, right: 0, test, results: [] };
  show("abcgame"); $("game-end").hidden = true; letterRound();
}
function letterRound() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const L = letters[Math.floor(Math.random() * 26)], big = Math.random() < 0.5;
  const target = big ? L : L.toLowerCase();
  // Choices: the answer, the same letter in the other case, and two other letters
  const others = randomShuffle([...letters].filter(c => c !== L)).slice(0, 2).map(c => big ? c : c.toLowerCase());
  const options = randomShuffle([target, big ? L.toLowerCase() : L, ...others]);
  lg.target = target; lg.big = big; lg.L = L; lg.misses = 0; lg.solved = false;
  const p = $("game-prompt");
  p.innerHTML = ""; p.append("🔊 Find " + (big ? "big " : "small "));
  p.appendChild(Object.assign(document.createElement("span"), { className: big ? "cap" : "low", textContent: lg.test ? "?" : target }));
  emojify(p);
  renderLetterDots();
  setText($("game-stars"), "⭐ " + progress.stars);
  $("game-msg").textContent = "";
  const box = $("choices"); box.innerHTML = "";
  options.forEach((o, k) => {
    const b = document.createElement("button");
    b.className = "choice letter"; b.textContent = o; b.dataset.key = k + 1;
    b.setAttribute("aria-label", (o === o.toUpperCase() ? "big " : "small ") + o);
    b.addEventListener("click", () => pickLetter(o, b));
    box.appendChild(b);
  });
  sayLetterPrompt();
}
function renderLetterDots() {
  const dots = $("game-dots"); dots.innerHTML = "";
  for (let k = 0; k < ROUNDS; k++) {
    const r = lg.results[k], done = lg.test ? r === true : k < lg.round;
    dots.appendChild(Object.assign(document.createElement("div"),
      { className: "dot" + (done ? " done" : "") + (lg.test && r === false ? " miss" : "") + (k === lg.round ? " now" : "") }));
  }
}
function sayLetterPrompt() { say([["Find " + (lg.big ? "big " : "small ") + letterName(lg.L) + "."]]); }
function pickLetter(o, b) {
  if (lg.solved) return;
  if (lg.test) return testPickLetter(o, b);
  if (o === lg.target) {
    lg.solved = true; b.classList.add("right");
    if (lg.misses === 0) lg.right++;
    progress.stars++; saveProgress(); setText($("game-stars"), "⭐ " + progress.stars);
    setText($("game-msg"), "🎉 Yes! ⭐");
    say([["Yes! " + (lg.big ? "Big " : "Small ") + letterName(lg.L) + "!"]]);
    lg.round++;
    laterTimer = setTimeout(() => { if (screen === "abcgame") lg.round < ROUNDS ? letterRound() : endLetterGame(); }, 1300);
  } else {
    const isBig = o === o.toUpperCase();
    say([["That's " + (isBig ? "big " : "small ") + letterName(o) + ". Try again."]]);
    b.classList.add("wrong"); setTimeout(() => b.classList.remove("wrong"), 400);
    if (++lg.misses >= 2) [...$("choices").children].find(c => c.textContent === lg.target)?.classList.add("hint");
  }
}
function testPickLetter(o, b) {
  const ok = o === lg.target;
  lg.solved = true; lg.results[lg.round] = ok;
  b.classList.add(ok ? "right" : "wrong-final");
  if (!ok) [...$("choices").children].find(c => c.textContent === lg.target)?.classList.add("right");
  document.querySelectorAll("#choices button").forEach(c => { c.disabled = true; });
  const p = $("game-prompt").querySelector(".cap, .low"); if (p) p.textContent = lg.target;
  const name = (lg.big ? "big " : "small ") + letterName(lg.L);
  if (ok) { lg.right++; progress.stars++; saveProgress(); setText($("game-stars"), "⭐ " + progress.stars); }
  setText($("game-msg"), ok ? "✅ Right! ⭐" : "❌ Not quite");
  say([[ok ? "Right! That's " + name + "." : "This is " + name + "."]]);
  lg.round++;
  renderLetterDots();
  laterTimer = setTimeout(() => { if (screen === "abcgame") lg.round < ROUNDS ? letterRound() : endLetterGame(); }, 2200);
}
function endLetterGame() {
  $("choices").innerHTML = "";
  $("game-prompt").textContent = "";
  if (lg.test) {
    const best = store.get("dw2-exam-best-abc", null);
    if (!best || lg.right > best.right) store.set("dw2-exam-best-abc", { right: lg.right, n: ROUNDS });
    setText($("game-prompt"), `🏆 ${lg.right} / ${ROUNDS}`);
    setText($("game-msg"), lg.right === ROUNDS ? "🎉 Perfect! 🎉" : lg.right >= 7 ? "🎉 Great work! 🎉" : "Good try! 💪");
    say([["You got " + lg.right + " out of " + ROUNDS + "."]]);
  } else {
    setText($("game-prompt"), `🏆 ${lg.right} / ${ROUNDS} first try!`);
    setText($("game-msg"), "🎉 Great playing! 🎉");
    say([["Great playing! You found " + lg.right + " letters on the first try."]]);
  }
  $("game-end").hidden = false;
  renderAbcTestBest();
}
function renderAbcTestBest() {
  const best = store.get("dw2-exam-best-abc", null);
  setText($("abc-test-btn"), "📝 Letter test" + (best ? ` · best ${best.right}/${best.n}` : ""));
}
$("game-prompt").addEventListener("click", () => { if (lg && lg.round < ROUNDS && !lg.solved) sayLetterPrompt(); });
$("abc-game-btn").addEventListener("click", () => startLetterGame(false));
$("abc-test-btn").addEventListener("click", () => startLetterGame(true));
$("game-again").addEventListener("click", () => startLetterGame(lg.test));
$("game-back").addEventListener("click", () => show("abc"));
$("game-abc").addEventListener("click", () => show("abc"));

// ---------- Keyboard (desktop) ----------
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Escape" && screen !== "home") { e.preventDefault(); return goHome(); }
  if (screen === "play") {
    if (e.key === " ") { e.preventDefault(); return sayWord(); }
    if (e.key === "Enter") {
      if (!$("ready").hidden) { e.preventDefault(); return $("ready").click(); }
      if ($("next").style.visibility === "visible") { e.preventDefault(); return nextWord(); }
    }
    if (!isZh() && /^[a-z]$/i.test(e.key)) {
      const L = e.key.toUpperCase();
      const free = [...document.querySelectorAll(".tile:not(.used)")].filter(t => t.textContent === L);
      if (free.length) free[0].click();
    }
    if (/^[1-9]$/.test(e.key)) document.querySelector(`#tiles .choice[data-key="${e.key}"]`)?.click();
  } else if (screen === "exam" && ex) {
    if (e.key === " ") { e.preventDefault(); return examSay(); }
    if (e.key === "Enter") {
      if (!$("exam-check").hidden) { e.preventDefault(); return examCheck(); }
      if (!$("exam-next").hidden) { e.preventDefault(); return examNext(); }
    }
    if (e.key === "Backspace") { e.preventDefault(); return examUndo(); }
    if (!isZh() && /^[a-z]$/i.test(e.key)) {
      const L = e.key.toUpperCase();
      [...document.querySelectorAll("#exam-tiles .tile:not(.used)")].find(t => t.textContent === L)?.click();
    }
    if (/^[1-9]$/.test(e.key)) document.querySelector(`#exam-tiles .choice[data-key="${e.key}"]`)?.click();
  } else if (screen === "letter") {
    if (e.key === "ArrowLeft") openLetter(letterIndex - 1);
    else if (e.key === "ArrowRight") openLetter(letterIndex + 1);
    else if (e.key === " ") { e.preventDefault(); $("letter-card").click(); }
    else if (e.key === "Enter") { e.preventDefault(); $("auto-btn").click(); }
    else if (/^[a-z]$/i.test(e.key)) openLetter(e.key.toUpperCase().charCodeAt(0) - 65);
  } else if (screen === "abcgame") {
    if (/^[1-4]$/.test(e.key)) document.querySelector(`#choices .choice[data-key="${e.key}"]`)?.click();
    else if (e.key === " ") { e.preventDefault(); sayLetterPrompt(); }
  }
});

// ---------- Start ----------
emojify(document.body);
renderHome();
