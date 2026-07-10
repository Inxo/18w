(function () {
  "use strict";

  const ROUND_LENGTHS = [4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6];
  const TIME_PER_WORD = 30; // seconds
  const AD_DURATION = 30; // seconds
  const STORAGE_KEY = "words18_progress_v1";
  const THEME_KEY = "words18_theme";
  const TILE_COLORS = ["#7c3aed", "#ec4899", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444"];

  // ---------- deterministic RNG ----------

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

  function getDailyWords(dateStr) {
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

  // ---------- game state ----------

  const today = todayDateString();
  const dayNumber = dayNumberFor(today);
  const dailyWords = getDailyWords(today);

  let state = loadState();
  if (!state || state.date !== today) {
    state = { date: today, index: 0, score: 0, correct: 0, log: [] };
    saveState();
  }

  let currentLetters = [];   // [{char, used}]
  let currentAnswer = [];    // indices into currentLetters
  let timeLeft = TIME_PER_WORD;
  let timerHandle = null;
  let roundLocked = false;

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- DOM ----------

  const el = {
    dayNumber: document.getElementById("dayNumber"),
    dateLabel: document.getElementById("dateLabel"),
    gameScreen: document.getElementById("gameScreen"),
    summaryScreen: document.getElementById("summaryScreen"),
    wordIndex: document.getElementById("wordIndex"),
    wordLenBadge: document.getElementById("wordLenBadge"),
    score: document.getElementById("score"),
    progressFill: document.getElementById("progressFill"),
    timerFill: document.getElementById("timerFill"),
    timerNum: document.getElementById("timerNum"),
    answerSlots: document.getElementById("answerSlots"),
    letterTiles: document.getElementById("letterTiles"),
    feedback: document.getElementById("feedback"),
    btnBackspace: document.getElementById("btnBackspace"),
    btnShuffle: document.getElementById("btnShuffle"),
    btnSubmit: document.getElementById("btnSubmit"),
    sumDayNumber: document.getElementById("sumDayNumber"),
    sumDateLabel: document.getElementById("sumDateLabel"),
    sumCorrect: document.getElementById("sumCorrect"),
    sumScore: document.getElementById("sumScore"),
    sumStreak: document.getElementById("sumStreak"),
    sumGrid: document.getElementById("sumGrid"),
    btnShare: document.getElementById("btnShare"),
    btnTheme: document.getElementById("btnTheme"),
    adOverlay: document.getElementById("adOverlay"),
    adProgressFill: document.getElementById("adProgressFill"),
    adSeconds: document.getElementById("adSeconds"),
    adWord: document.getElementById("adWord"),
    btnAdClose: document.getElementById("btnAdClose"),
  };

  el.dayNumber.textContent = dayNumber;
  el.dateLabel.textContent = today;

  // ---------- theme ----------

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
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
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  initTheme();

  function isFinished() {
    return state.index >= ROUND_LENGTHS.length;
  }

  function startWord() {
    if (isFinished()) {
      showSummary();
      return;
    }
    roundLocked = false;
    const word = dailyWords[state.index];
    const rng = mulberry32(hashString(today + "-" + state.index + "-shuffle"));
    const shuffledChars = seededShuffle(word.split(""), rng);
    currentLetters = shuffledChars.map((c) => ({ char: c, used: false }));
    currentAnswer = [];
    timeLeft = TIME_PER_WORD;

    el.wordIndex.textContent = state.index + 1;
    el.wordLenBadge.textContent = word.length + " букв";
    el.score.textContent = state.score;
    el.progressFill.style.width = (state.index / ROUND_LENGTHS.length) * 100 + "%";
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
    const word = dailyWords[state.index];
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
    const word = dailyWords[state.index];
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
    const word = dailyWords[state.index];
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
    const word = dailyWords[state.index];

    if (success) {
      const bonus = Math.max(0, timeLeft);
      const points = 10 + bonus;
      state.score += points;
      state.correct += 1;
      state.log.push({ word, ok: true });
      el.feedback.textContent = `Верно! +${points}`;
      el.feedback.className = "feedback good";
      const slots = el.answerSlots.querySelectorAll(".answer-slot");
      slots.forEach((s) => s.classList.add("correct"));
    } else {
      state.log.push({ word, ok: false });
      el.feedback.textContent = `Время вышло: ${word}`;
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

    state.index += 1;
    saveState();
    el.score.textContent = state.score;
    el.progressFill.style.width = (state.index / ROUND_LENGTHS.length) * 100 + "%";

    if (success) {
      setTimeout(() => startWord(), 900);
    } else {
      setTimeout(() => showAd(word, () => startWord()), 600);
    }
  }

  function showAd(missedWord, onDone) {
    let secondsLeft = AD_DURATION;
    let settled = false;
    let adInterval = null;

    el.adWord.textContent = missedWord;
    el.adSeconds.textContent = secondsLeft;
    el.adProgressFill.style.width = "0%";
    el.btnAdClose.disabled = true;
    el.btnAdClose.textContent = "Идёт показ…";
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
        el.btnAdClose.textContent = "Продолжить";
        finish();
      }
    }, 1000);
  }

  function showSummary() {
    el.gameScreen.classList.add("hidden");
    el.summaryScreen.classList.remove("hidden");

    el.sumDayNumber.textContent = dayNumber;
    el.sumDateLabel.textContent = today;
    el.sumCorrect.textContent = `${state.correct}/${ROUND_LENGTHS.length}`;
    el.sumScore.textContent = state.score;

    let bestStreak = 0;
    let cur = 0;
    el.sumGrid.innerHTML = "";
    state.log.forEach((entry) => {
      cur = entry.ok ? cur + 1 : 0;
      bestStreak = Math.max(bestStreak, cur);
      const cell = document.createElement("div");
      cell.className = "sum-cell " + (entry.ok ? "correct" : "wrong");
      cell.textContent = entry.ok ? "✅" : "❌";
      el.sumGrid.appendChild(cell);
    });
    el.sumStreak.textContent = bestStreak;

    el.btnShare.onclick = () => {
      const grid = state.log.map((e) => (e.ok ? "🟩" : "🟥")).join("");
      const text = `18 слов — День #${dayNumber}\n${state.correct}/${ROUND_LENGTHS.length} ✅  •  ${state.score} очков\n${grid}\n${location.href}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          el.btnShare.textContent = "Скопировано!";
          setTimeout(() => (el.btnShare.textContent = "📋 Скопировать результат"), 1500);
        });
      }
    };
  }

  el.btnBackspace.addEventListener("click", backspace);
  el.btnShuffle.addEventListener("click", shuffleTiles);
  el.btnSubmit.addEventListener("click", () => {
    if (currentAnswer.length === dailyWords[state.index].length) {
      checkAnswer();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (isFinished() || roundLocked) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      backspace();
      return;
    }
    if (e.key === "Enter") {
      if (currentAnswer.length === dailyWords[state.index].length) checkAnswer();
      return;
    }
    const key = e.key.toLowerCase();
    if (key.length === 1 && /[а-яё]/.test(key)) {
      const idx = currentLetters.findIndex((l) => !l.used && l.char === key);
      if (idx !== -1) pickLetter(idx);
    }
  });

  startWord();
})();
