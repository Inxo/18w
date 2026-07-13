window.Words18Mount = window.Words18Mount || {};
window.Words18Mount.th = function (root, opts) {
  "use strict";

  opts = opts || {};
  const WORD_BANK = window.WORDS18_DATA.th;
  const baseUrl = opts.baseUrl || document.baseURI;
  const themeTarget = root === document ? document.documentElement : root.host;

  const ROUND_LENGTHS = [4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6];
  const TIME_PER_WORD = 30; // seconds
  const AD_DURATION = 30; // seconds
  const STORAGE_KEY = "words18_th_progress_v1";
  const PLAYED_KEY = "words18_th_played_dates";
  const THEME_KEY = "words18_th_theme";
  const TILE_COLORS = ["#7c3aed", "#ec4899", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444"];

  // ---------- deterministic RNG (fallback word selection if days/*.json is unreachable) ----------

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function todayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function dayNumberFor(dateStr) {
    const epoch = Date.parse("2024-01-01T00:00:00Z");
    const t = Date.parse(dateStr + "T00:00:00Z");
    return Math.max(1, Math.floor((t - epoch) / 86400000) + 1);
  }

  function getLengthCounts() {
    const counts = {};
    for (const len of ROUND_LENGTHS) counts[len] = (counts[len] || 0) + 1;
    return counts;
  }

  function getWordsForDateLocally(dateStr) {
    const dayIndex = dayNumberFor(dateStr);
    const counts = getLengthCounts();
    const words = [];
    for (const len of Object.keys(counts).map(Number)) {
      const count = counts[len];
      const pool = WORD_BANK[len];
      const rng = mulberry32(hashString("len-" + len));
      const shuffled = seededShuffle(pool, rng);
      const start = (dayIndex * count) % shuffled.length;
      for (let i = 0; i < count; i++) {
        words.push(shuffled[(start + i) % shuffled.length]);
      }
    }
    return words;
  }

  // A word entry is "word" or "word definition" (word, then a space, then its
  // meaning). The meaning is shown during the ad break when present.
  function parseWordEntry(raw) {
    const spaceIdx = raw.indexOf(" ");
    if (spaceIdx === -1) return { word: raw, definition: null };
    return { word: raw.slice(0, spaceIdx), definition: raw.slice(spaceIdx + 1) };
  }

  async function loadWordsForDate(dateStr) {
    try {
      const res = await fetch(new URL(`days/${dateStr}.json`, baseUrl), { cache: "no-store" });
      if (!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      if (!Array.isArray(data.words) || data.words.length !== ROUND_LENGTHS.length) {
        throw new Error("unexpected payload shape");
      }
      return data.words.map(parseWordEntry);
    } catch (e) {
      return getWordsForDateLocally(dateStr).map(parseWordEntry);
    }
  }

  async function loadAvailableDates() {
    try {
      const res = await fetch(new URL("days/index.json", baseUrl), { cache: "no-store" });
      if (!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  // ---------- played-dates history (across daily + archive rounds) ----------

  function loadPlayedDates() {
    try {
      const raw = localStorage.getItem(PLAYED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  let playedDates = loadPlayedDates();

  function markDatePlayed(dateStr) {
    if (!playedDates.includes(dateStr)) {
      playedDates.push(dateStr);
      localStorage.setItem(PLAYED_KEY, JSON.stringify(playedDates));
    }
  }

  // ---------- round state ----------
  // `round` holds everything about the game currently being played, whether
  // it's today's daily round or a replayed past day from the archive.

  const today = todayDateString();

  function loadDailyState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function freshRound(date, isArchive) {
    return { date, isArchive, words: [], index: 0, score: 0, correct: 0, log: [] };
  }

  let round = (function initRound() {
    const saved = loadDailyState();
    if (saved && saved.date === today) {
      return { date: today, isArchive: false, words: [], index: saved.index, score: saved.score, correct: saved.correct, log: saved.log };
    }
    if (saved && saved.date !== today && saved.index >= ROUND_LENGTHS.length) {
      markDatePlayed(saved.date);
    }
    return freshRound(today, false);
  })();

  function persistRound() {
    if (round.isArchive) {
      if (round.index >= ROUND_LENGTHS.length) markDatePlayed(round.date);
      return;
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: round.date, index: round.index, score: round.score, correct: round.correct, log: round.log })
    );
  }

  let currentLetters = [];   // [{char, used}]
  let currentAnswer = [];    // indices into currentLetters
  let timeLeft = TIME_PER_WORD;
  let timerHandle = null;
  let roundLocked = false;

  // ---------- DOM ----------

  const el = {
    dayNumber: root.getElementById("dayNumber"),
    dateLabel: root.getElementById("dateLabel"),
    gameScreen: root.getElementById("gameScreen"),
    summaryScreen: root.getElementById("summaryScreen"),
    wordIndex: root.getElementById("wordIndex"),
    wordLenBadge: root.getElementById("wordLenBadge"),
    score: root.getElementById("score"),
    progressFill: root.getElementById("progressFill"),
    timerFill: root.getElementById("timerFill"),
    timerNum: root.getElementById("timerNum"),
    answerSlots: root.getElementById("answerSlots"),
    letterTiles: root.getElementById("letterTiles"),
    feedback: root.getElementById("feedback"),
    btnBackspace: root.getElementById("btnBackspace"),
    btnShuffle: root.getElementById("btnShuffle"),
    btnSubmit: root.getElementById("btnSubmit"),
    summaryTitle: root.querySelector(".summary-title"),
    summaryNext: root.getElementById("summaryNext"),
    sumDayNumber: root.getElementById("sumDayNumber"),
    sumDateLabel: root.getElementById("sumDateLabel"),
    sumCorrect: root.getElementById("sumCorrect"),
    sumScore: root.getElementById("sumScore"),
    sumStreak: root.getElementById("sumStreak"),
    sumGrid: root.getElementById("sumGrid"),
    btnShare: root.getElementById("btnShare"),
    btnTheme: root.getElementById("btnTheme"),
    archiveSection: root.getElementById("archiveSection"),
    archiveSelect: root.getElementById("archiveSelect"),
    archiveEmpty: root.getElementById("archiveEmpty"),
    btnArchivePlay: root.getElementById("btnArchivePlay"),
    adOverlay: root.getElementById("adOverlay"),
    adProgressFill: root.getElementById("adProgressFill"),
    adSeconds: root.getElementById("adSeconds"),
    adWord: root.getElementById("adWord"),
    adDefinition: root.getElementById("adDefinition"),
    adDefinitionText: root.getElementById("adDefinitionText"),
    btnAdClose: root.getElementById("btnAdClose"),
  };

  // ---------- theme ----------

  function applyTheme(theme) {
    themeTarget.setAttribute("data-theme", theme);
    el.btnTheme.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      applyTheme(saved);
      return;
    }
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }

  el.btnTheme.addEventListener("click", () => {
    const current = themeTarget.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  initTheme();

  function isFinished() {
    return round.index >= ROUND_LENGTHS.length;
  }

  function startWord() {
    el.dayNumber.textContent = dayNumberFor(round.date);
    el.dateLabel.textContent = round.date;

    if (isFinished()) {
      showSummary();
      return;
    }
    roundLocked = false;
    const word = round.words[round.index].word;
    const rng = mulberry32(hashString(round.date + "-" + round.index + "-shuffle"));
    const shuffledChars = seededShuffle(word.split(""), rng);
    currentLetters = shuffledChars.map((c) => ({ char: c, used: false }));
    currentAnswer = [];
    timeLeft = TIME_PER_WORD;

    el.wordIndex.textContent = round.index + 1;
    el.wordLenBadge.textContent = word.length + " ตัวอักษร";
    el.score.textContent = round.score;
    el.progressFill.style.width = (round.index / ROUND_LENGTHS.length) * 100 + "%";
    el.feedback.textContent = "";
    el.feedback.className = "feedback";

    renderTiles();
    renderAnswer();
    startTimer();
  }

  function renderTiles() {
    el.letterTiles.innerHTML = "";
    currentLetters.forEach((letterObj, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "letter-tile" + (letterObj.used ? " used" : "");
      btn.textContent = letterObj.char;
      btn.style.backgroundColor = TILE_COLORS[idx % TILE_COLORS.length];
      btn.disabled = letterObj.used;
      btn.addEventListener("click", () => pickLetter(idx));
      el.letterTiles.appendChild(btn);
    });
  }

  function renderAnswer() {
    const word = round.words[round.index].word;
    el.answerSlots.innerHTML = "";
    for (let i = 0; i < word.length; i++) {
      const slot = document.createElement("div");
      const filled = i < currentAnswer.length;
      slot.className = "answer-slot " + (filled ? "filled" : "empty");
      if (filled) {
        slot.textContent = currentLetters[currentAnswer[i]].char;
        const capturedIdx = i;
        slot.addEventListener("click", () => removeAnswerAt(capturedIdx));
      }
      el.answerSlots.appendChild(slot);
    }
  }

  function pickLetter(idx) {
    if (roundLocked) return;
    const word = round.words[round.index].word;
    if (currentLetters[idx].used) return;
    if (currentAnswer.length >= word.length) return;
    currentLetters[idx].used = true;
    currentAnswer.push(idx);
    renderTiles();
    renderAnswer();
    if (currentAnswer.length === word.length) {
      checkAnswer();
    }
  }

  function removeAnswerAt(pos) {
    if (roundLocked) return;
    const letterIdx = currentAnswer[pos];
    currentAnswer.splice(pos, 1);
    currentLetters[letterIdx].used = false;
    renderTiles();
    renderAnswer();
  }

  function clearAnswer() {
    if (roundLocked) return;
    currentAnswer.forEach((idx) => (currentLetters[idx].used = false));
    currentAnswer = [];
    renderTiles();
    renderAnswer();
  }

  function backspace() {
    if (roundLocked || currentAnswer.length === 0) return;
    removeAnswerAt(currentAnswer.length - 1);
  }

  function shuffleTiles() {
    if (roundLocked) return;
    const rng = mulberry32(Date.now() % 2147483647);
    const order = seededShuffle(
      currentLetters.map((_, i) => i),
      rng
    );
    currentLetters = order.map((i) => currentLetters[i]);
    currentAnswer = currentAnswer.map((idx) => order.indexOf(idx));
    renderTiles();
    renderAnswer();
  }

  function checkAnswer() {
    const word = round.words[round.index].word;
    const built = currentAnswer.map((idx) => currentLetters[idx].char).join("");
    if (built === word) {
      resolveWord(true);
    } else {
      const slots = el.answerSlots.querySelectorAll(".answer-slot");
      slots.forEach((s) => s.classList.add("wrong-shake"));
      setTimeout(() => {
        slots.forEach((s) => s.classList.remove("wrong-shake"));
        clearAnswer();
      }, 350);
    }
  }

  function startTimer() {
    stopTimer();
    updateTimerUI();
    timerHandle = setInterval(() => {
      timeLeft -= 1;
      updateTimerUI();
      if (timeLeft <= 0) {
        stopTimer();
        resolveWord(false);
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function updateTimerUI() {
    const pct = Math.max(0, (timeLeft / TIME_PER_WORD) * 100);
    el.timerFill.style.width = pct + "%";
    el.timerNum.textContent = Math.max(0, timeLeft);
    el.timerFill.classList.toggle("warn", timeLeft <= 15 && timeLeft > 7);
    el.timerFill.classList.toggle("danger", timeLeft <= 7);
  }

  function resolveWord(success) {
    if (roundLocked) return;
    roundLocked = true;
    stopTimer();
    const entry = round.words[round.index];
    const word = entry.word;

    if (success) {
      const bonus = Math.max(0, timeLeft);
      const points = 10 + bonus;
      round.score += points;
      round.correct += 1;
      round.log.push({ word, ok: true });
      el.feedback.textContent = `ถูกต้อง! +${points}`;
      el.feedback.className = "feedback good";
      const slots = el.answerSlots.querySelectorAll(".answer-slot");
      slots.forEach((s) => s.classList.add("correct"));
    } else {
      round.log.push({ word, ok: false });
      el.feedback.textContent = `หมดเวลา: ${word}`;
      el.feedback.className = "feedback bad";
      currentLetters.forEach((l) => (l.used = false));
      currentAnswer = word.split("").map((ch) => {
        return currentLetters.findIndex((l) => l.char === ch && !l.used) !== -1
          ? (() => {
              const i = currentLetters.findIndex((l) => l.char === ch && !l.used);
              currentLetters[i].used = true;
              return i;
            })()
          : -1;
      });
      renderAnswer();
    }

    round.index += 1;
    persistRound();
    el.score.textContent = round.score;
    el.progressFill.style.width = (round.index / ROUND_LENGTHS.length) * 100 + "%";

    if (success) {
      setTimeout(() => startWord(), 900);
    } else {
      setTimeout(() => showAd(word, entry.definition, () => startWord()), 600);
    }
  }

  function showAd(missedWord, definition, onDone) {
    let secondsLeft = AD_DURATION;
    let settled = false;
    let adInterval = null;

    el.adWord.textContent = missedWord;
    if (definition) {
      el.adDefinitionText.textContent = definition;
      el.adDefinition.classList.remove("hidden");
    } else {
      el.adDefinition.classList.add("hidden");
    }
    el.adSeconds.textContent = secondsLeft;
    el.adProgressFill.style.width = "0%";
    el.btnAdClose.disabled = true;
    el.btnAdClose.textContent = "กำลังเล่น…";
    el.adOverlay.classList.remove("hidden");
    el.adOverlay.style.display = "flex";

    function finish() {
      if (settled) return;
      settled = true;
      clearInterval(adInterval);
      el.adOverlay.classList.add("hidden");
      el.adOverlay.style.display = "none";
      el.btnAdClose.onclick = null;
      onDone();
    }

    el.btnAdClose.onclick = finish;

    adInterval = setInterval(() => {
      secondsLeft -= 1;
      el.adSeconds.textContent = Math.max(secondsLeft, 0);
      el.adProgressFill.style.width = ((AD_DURATION - secondsLeft) / AD_DURATION) * 100 + "%";
      if (secondsLeft <= 0) {
        el.btnAdClose.disabled = false;
        el.btnAdClose.textContent = "ดำเนินการต่อ";
        finish();
      }
    }, 1000);
  }

  // ---------- archive: replay past days ----------

  let availableDates = [];

  function refreshArchivePicker() {
    const playable = availableDates
      .filter((d) => d < today && !playedDates.includes(d))
      .sort()
      .reverse();

    if (playable.length === 0) {
      el.archiveSelect.classList.add("hidden");
      el.btnArchivePlay.classList.add("hidden");
      el.archiveEmpty.classList.remove("hidden");
      return;
    }

    el.archiveSelect.classList.remove("hidden");
    el.btnArchivePlay.classList.remove("hidden");
    el.archiveEmpty.classList.add("hidden");
    el.archiveSelect.innerHTML = "";
    for (const d of playable) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = `${d} (วันที่ #${dayNumberFor(d)})`;
      el.archiveSelect.appendChild(opt);
    }
  }

  el.btnArchivePlay.addEventListener("click", async () => {
    const date = el.archiveSelect.value;
    if (!date) return;
    el.btnArchivePlay.disabled = true;
    const words = await loadWordsForDate(date);
    round = freshRound(date, true);
    round.words = words;
    el.btnArchivePlay.disabled = false;
    el.summaryScreen.classList.add("hidden");
    el.gameScreen.classList.remove("hidden");
    startWord();
  });

  function showSummary() {
    el.gameScreen.classList.add("hidden");
    el.summaryScreen.classList.remove("hidden");

    el.summaryTitle.textContent = round.isArchive ? "สรุปผลวันย้อนหลัง" : "สรุปผลวันนี้";
    el.summaryNext.textContent = round.isArchive ? "เลือกวันอื่นด้านล่าง" : "คำใหม่พรุ่งนี้";
    el.sumDayNumber.textContent = dayNumberFor(round.date);
    el.sumDateLabel.textContent = round.date;
    el.sumCorrect.textContent = `${round.correct}/${ROUND_LENGTHS.length}`;
    el.sumScore.textContent = round.score;

    let bestStreak = 0;
    let cur = 0;
    el.sumGrid.innerHTML = "";
    round.log.forEach((entry) => {
      cur = entry.ok ? cur + 1 : 0;
      bestStreak = Math.max(bestStreak, cur);
      const cell = document.createElement("div");
      cell.className = "sum-cell " + (entry.ok ? "correct" : "wrong");
      cell.textContent = entry.ok ? "✅" : "❌";
      el.sumGrid.appendChild(cell);
    });
    el.sumStreak.textContent = bestStreak;

    el.btnShare.onclick = () => {
      const grid = round.log.map((e) => (e.ok ? "🟩" : "🟥")).join("");
      const text = `18 คำ — วันที่ #${dayNumberFor(round.date)}\n${round.correct}/${ROUND_LENGTHS.length} ✅  •  ${round.score} คะแนน\n${grid}\n${location.href}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          el.btnShare.textContent = "คัดลอกแล้ว!";
          setTimeout(() => (el.btnShare.textContent = "📋 คัดลอกผลลัพธ์"), 1500);
        });
      }
    };

    el.archiveSection.classList.remove("hidden");
    refreshArchivePicker();
  }

  el.btnBackspace.addEventListener("click", backspace);
  el.btnShuffle.addEventListener("click", shuffleTiles);
  el.btnSubmit.addEventListener("click", () => {
    if (currentAnswer.length === round.words[round.index].word.length) {
      checkAnswer();
    }
  });

  root.addEventListener("keydown", (e) => {
    if (isFinished() || roundLocked) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      backspace();
      return;
    }
    if (e.key === "Enter") {
      if (currentAnswer.length === round.words[round.index].word.length) checkAnswer();
      return;
    }
    const key = e.key;
    if (key.length === 1 && /[฀-๿]/.test(key)) {
      const idx = currentLetters.findIndex((l) => !l.used && l.char === key);
      if (idx !== -1) pickLetter(idx);
    }
  });

  loadAvailableDates().then((dates) => {
    availableDates = dates;
    if (!el.summaryScreen.classList.contains("hidden")) {
      refreshArchivePicker();
    }
  });

  loadWordsForDate(today).then((words) => {
    round.words = words;
    startWord();
  });
};
