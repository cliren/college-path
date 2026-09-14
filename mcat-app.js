(function () {
  "use strict";

  var STORE_KEY = "mcat-prep-progress-v1";
  var SECTION_LABELS = {
    CP: "Chem/Phys",
    CARS: "CARS",
    BB: "Bio/Biochem",
    PS: "Psych/Soc"
  };
  // Practice-inspired section minutes (not official AAMC timing)
  var SECTION_MIN = { CP: 20, CARS: 18, BB: 20, PS: 20 };
  var SHORT_COUNT = 10;
  var FULL_PER_SECTION = 12;

  var state = {
    view: "home",
    mode: null, // short | full
    filter: "ALL",
    queue: [],
    index: 0,
    answers: {},
    startedAt: 0,
    endsAt: 0,
    timerId: null,
    result: null,
    reviewOnlyWrong: false,
    reviewIndex: 0
  };

  var main = document.getElementById("main");
  var topMeta = document.getElementById("topMeta");
  var exitBtn = document.getElementById("exitBtn");

  function bank() {
    return window.MCAT_BANK || { questions: [], meta: {} };
  }

  function allQuestions() {
    return (bank().questions || []).slice();
  }

  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveStore(s) {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  }

  function ensureStore() {
    var s = loadStore();
    if (typeof s.xp !== "number") s.xp = 0;
    if (typeof s.streak !== "number") s.streak = 0;
    if (!s.lastDay) s.lastDay = "";
    if (!s.badges) s.badges = {};
    if (typeof s.attempts !== "number") s.attempts = 0;
    if (typeof s.bestPct !== "number") s.bestPct = 0;
    return s;
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function updateStreak(s) {
    var t = todayKey();
    if (s.lastDay === t) return s;
    var y = new Date();
    y.setDate(y.getDate() - 1);
    var yk = y.getFullYear() + "-" + String(y.getMonth() + 1).padStart(2, "0") + "-" + String(y.getDate()).padStart(2, "0");
    if (s.lastDay === yk) s.streak = (s.streak || 0) + 1;
    else s.streak = 1;
    s.lastDay = t;
    return s;
  }

  function unlockBadge(s, id) {
    if (!s.badges[id]) {
      s.badges[id] = Date.now();
      return true;
    }
    return false;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function choiceText(c) {
    // Bank may already include "A) ..." prefixes
    return String(c || "").replace(/^[A-D]\)\s*/, "");
  }

  function answerIndex(q) {
    if (typeof q.answerIndex === "number") return q.answerIndex;
    if (typeof q.answer === "number") return q.answer;
    return 0;
  }

  function explanation(q) {
    return q.explanation || q.explain || "";
  }

  function passageText(q) {
    return q.passageText || q.passage || "";
  }

  function fmtMs(ms) {
    ms = Math.max(0, ms | 0);
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function clearTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function showToast(text) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  function sampleShort(filter) {
    var qs = allQuestions();
    if (filter && filter !== "ALL") qs = qs.filter(function (q) { return q.section === filter; });
    qs = shuffle(qs);
    return qs.slice(0, Math.min(SHORT_COUNT, qs.length));
  }

  function sampleFull() {
    var by = { CP: [], CARS: [], BB: [], PS: [] };
    allQuestions().forEach(function (q) {
      if (by[q.section]) by[q.section].push(q);
    });
    var out = [];
    ["CP", "CARS", "BB", "PS"].forEach(function (sec) {
      var pool = shuffle(by[sec]);
      out = out.concat(pool.slice(0, Math.min(FULL_PER_SECTION, pool.length)));
    });
    // Keep section order for "mini-sections" feel, shuffle within each already done
    return out;
  }

  function timerBudgetMs(mode, queue) {
    if (mode === "short") return 15 * 60 * 1000;
    // Full: sum practice-inspired section mins proportional to counts
    var counts = { CP: 0, CARS: 0, BB: 0, PS: 0 };
    queue.forEach(function (q) { counts[q.section] = (counts[q.section] || 0) + 1; });
    var mins = 0;
    Object.keys(counts).forEach(function (sec) {
      if (!counts[sec]) return;
      // scale from ~12Q ≈ SECTION_MIN
      mins += SECTION_MIN[sec] * (counts[sec] / FULL_PER_SECTION);
    });
    mins = Math.max(30, Math.round(mins));
    return mins * 60 * 1000;
  }

  function startMode(mode, filter) {
    state.mode = mode;
    state.filter = filter || "ALL";
    state.queue = mode === "short" ? sampleShort(state.filter) : sampleFull();
    if (!state.queue.length) {
      showToast("No questions in bank yet");
      return;
    }
    state.index = 0;
    state.answers = {};
    state.result = null;
    state.reviewOnlyWrong = false;
    state.startedAt = Date.now();
    state.endsAt = state.startedAt + timerBudgetMs(mode, state.queue);
    clearTimer();
    state.timerId = setInterval(function () {
      if (Date.now() >= state.endsAt) {
        clearTimer();
        submitTest(true);
        return;
      }
      var tEl = document.getElementById("timerEl");
      if (tEl) tEl.textContent = fmtMs(state.endsAt - Date.now());
    }, 250);
    exitBtn.hidden = false;
    route("quiz");
  }

  function currentQ() {
    return state.queue[state.index];
  }

  function grade() {
    var bySec = {};
    var correct = 0;
    var wrongIds = [];
    state.queue.forEach(function (q) {
      var sec = q.section;
      if (!bySec[sec]) bySec[sec] = { correct: 0, total: 0 };
      bySec[sec].total++;
      var ans = state.answers[q.id];
      var ok = ans === answerIndex(q);
      if (ok) {
        correct++;
        bySec[sec].correct++;
      } else {
        wrongIds.push(q.id);
      }
    });
    var total = state.queue.length;
    var pct = total ? Math.round((100 * correct) / total) : 0;
    return { correct: correct, total: total, pct: pct, bySec: bySec, wrongIds: wrongIds };
  }

  function award(result) {
    var s = ensureStore();
    s = updateStreak(s);
    s.attempts = (s.attempts || 0) + 1;
    var gained = 20 + result.correct * 8 + (result.pct >= 80 ? 40 : result.pct >= 60 ? 20 : 0);
    if (state.mode === "full") gained += 50;
    s.xp = (s.xp || 0) + gained;
    if (result.pct > (s.bestPct || 0)) s.bestPct = result.pct;
    var newly = [];
    if (s.attempts >= 1 && unlockBadge(s, "first-run")) newly.push("First stretch");
    if (s.streak >= 3 && unlockBadge(s, "streak-3")) newly.push("Streak 3");
    if (result.pct >= 80 && unlockBadge(s, "sharp-80")) newly.push("Sharp 80%");
    if (state.mode === "full" && unlockBadge(s, "full-finisher")) newly.push("Full finisher");
    if ((s.xp || 0) >= 500 && unlockBadge(s, "xp-500")) newly.push("500 XP");
    saveStore(s);
    return { gained: gained, newly: newly, store: s };
  }

  function submitTest(auto) {
    clearTimer();
    state.result = grade();
    var awardInfo = award(state.result);
    state.result.award = awardInfo;
    if (auto) showToast("Time's up — scored what you finished");
    else if (awardInfo.newly.length) showToast("+" + awardInfo.gained + " XP · " + awardInfo.newly[0]);
    else showToast("+" + awardInfo.gained + " XP");
    route("results");
  }

  function hudHtml() {
    var s = ensureStore();
    return (
      '<div class="hud">' +
      '<span class="hud-chip xp">✦ ' + (s.xp || 0) + " XP</span>" +
      '<span class="hud-chip streak">🔥 ' + (s.streak || 0) + "</span>" +
      '<span class="hud-chip">Attempts ' + (s.attempts || 0) + "</span>" +
      (s.bestPct ? '<span class="hud-chip">Best ' + s.bestPct + "%</span>" : "") +
      "</div>"
    );
  }

  function badgesHtml() {
    var s = ensureStore();
    var defs = [
      { id: "first-run", name: "First stretch" },
      { id: "streak-3", name: "Streak 3" },
      { id: "sharp-80", name: "Sharp 80%" },
      { id: "full-finisher", name: "Full finisher" },
      { id: "xp-500", name: "500 XP" }
    ];
    return (
      '<div class="badge-row">' +
      defs
        .map(function (b) {
          return '<span class="badge' + (s.badges[b.id] ? " earned" : "") + '">' + escapeHtml(b.name) + "</span>";
        })
        .join("") +
      "</div>"
    );
  }

  function renderHome() {
    topMeta.textContent = "Practice home";
    exitBtn.hidden = true;
    var n = allQuestions().length;
    var by = { CP: 0, CARS: 0, BB: 0, PS: 0 };
    allQuestions().forEach(function (q) { by[q.section] = (by[q.section] || 0) + 1; });
    main.innerHTML =
      '<header class="hero">' +
      '<p class="kicker">MCAT prep · College Path</p>' +
      "<h1>Practice that respects your brain.</h1>" +
      '<p class="sub">Short stretches when you have 15 minutes. Deeper mixed sets when you want stamina. Original items only — built for learning, not cosplay.</p>' +
      '<div class="chips">' +
      '<span class="chip">' + n + " items</span>" +
      '<span class="chip">CP ' + by.CP + "</span>" +
      '<span class="chip">CARS ' + by.CARS + "</span>" +
      '<span class="chip">BB ' + by.BB + "</span>" +
      '<span class="chip">PS ' + by.PS + "</span>" +
      "</div>" +
      "</header>" +
      hudHtml() +
      '<div class="disclaimer"><strong>Disclaimer:</strong> Original practice for learning. Not affiliated with AAMC. Not real exam items. Topics guided by public AAMC content-outline emphases (last ~3 years) as frequency guidance — not leaked content.</div>' +
      '<div class="grid two">' +
      '<div class="card cta" id="shortCard">' +
      "<h2>Short stretch</h2>" +
      "<p>Up to 10 shuffled questions. Pick a section or mix. ~15 min timer. Perfect between classes.</p>" +
      '<div class="field" style="margin-top:12px">' +
      "<label for=\"secFilter\">Section filter</label>" +
      '<select id="secFilter">' +
      '<option value="ALL">Mixed (all sections)</option>' +
      '<option value="CP">Chem/Phys</option>' +
      '<option value="CARS">CARS</option>' +
      '<option value="BB">Bio/Biochem</option>' +
      '<option value="PS">Psych/Soc</option>' +
      "</select></div>" +
      '<div class="row"><button type="button" class="btn" id="startShort">Start short stretch</button></div>' +
      "</div>" +
      '<div class="card cta" id="fullCard">' +
      "<h2>Practice full</h2>" +
      "<p>Deeper randomized set — up to ~12 per section (max available). Practice-inspired section timing, not official AAMC. Score + breakdown at the end.</p>" +
      '<div class="row"><button type="button" class="btn" id="startFull">Start practice full</button></div>' +
      "</div>" +
      "</div>" +
      '<div class="card" style="margin-top:12px">' +
      "<h3>Badges</h3>" +
      '<p class="muted">Local only — stored in your browser.</p>' +
      badgesHtml() +
      "</div>" +
      '<p class="muted" style="margin-top:16px">Also see the <a href="premed-playbook.html">premed playbook</a> for GPA/MCAT targets and life framing.</p>';

    document.getElementById("startShort").onclick = function () {
      var f = document.getElementById("secFilter").value;
      startMode("short", f);
    };
    document.getElementById("startFull").onclick = function () {
      startMode("full", "ALL");
    };
  }

  function renderQuiz() {
    var q = currentQ();
    if (!q) {
      submitTest(false);
      return;
    }
    var n = state.queue.length;
    var i = state.index;
    topMeta.textContent = (state.mode === "short" ? "Short" : "Full") + " · " + (i + 1) + "/" + n;
    var pct = Math.round((100 * i) / n);
    var selected = state.answers[q.id];
    var pass = passageText(q);
    var letters = ["A", "B", "C", "D"];
    main.innerHTML =
      '<div class="row" style="justify-content:space-between">' +
      '<div><span class="section-tag">' +
      escapeHtml(SECTION_LABELS[q.section] || q.section) +
      "</span><span class=\"qnum\">Q " +
      (i + 1) +
      " / " +
      n +
      ' · <span class="muted">' +
      escapeHtml(q.topic || "") +
      "</span></span></div>" +
      '<div class="timer" id="timerEl">' +
      fmtMs(state.endsAt - Date.now()) +
      "</div></div>" +
      '<div class="progress"><div style="width:' +
      pct +
      '%"></div></div>' +
      (pass
        ? '<div class="passage" aria-label="Passage">' + escapeHtml(pass) + "</div>"
        : "") +
      '<div class="stem">' +
      escapeHtml(q.stem) +
      "</div>" +
      '<div class="choices" id="choices"></div>' +
      '<div class="row" style="margin-top:16px">' +
      '<button type="button" class="btn secondary" id="prevBtn"' +
      (i === 0 ? " disabled" : "") +
      ">Back</button>" +
      '<button type="button" class="btn secondary" id="nextBtn">' +
      (i === n - 1 ? "Review & submit" : "Next") +
      "</button>" +
      '<button type="button" class="btn ghost" id="submitNow">Submit now</button>' +
      "</div>";

    var box = document.getElementById("choices");
    (q.choices || []).slice(0, 4).forEach(function (c, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice" + (selected === idx ? " selected" : "");
      btn.innerHTML = "<strong>" + letters[idx] + ".</strong> " + escapeHtml(choiceText(c));
      btn.onclick = function () {
        state.answers[q.id] = idx;
        route("quiz");
      };
      box.appendChild(btn);
    });

    document.getElementById("prevBtn").onclick = function () {
      if (state.index > 0) {
        state.index--;
        route("quiz");
      }
    };
    document.getElementById("nextBtn").onclick = function () {
      if (state.index >= n - 1) {
        route("confirm");
      } else {
        state.index++;
        route("quiz");
      }
    };
    document.getElementById("submitNow").onclick = function () {
      route("confirm");
    };
  }

  function renderConfirm() {
    topMeta.textContent = "Submit?";
    var answered = Object.keys(state.answers).length;
    var n = state.queue.length;
    main.innerHTML =
      '<div class="card"><h2>Ready to submit?</h2>' +
      "<p>Answered <strong>" +
      answered +
      "</strong> of <strong>" +
      n +
      "</strong>. Unanswered count as incorrect.</p>" +
      '<div class="row">' +
      '<button type="button" class="btn" id="doSubmit">Submit &amp; score</button>' +
      '<button type="button" class="btn secondary" id="keepGoing">Keep going</button>' +
      "</div></div>";
    document.getElementById("doSubmit").onclick = function () {
      submitTest(false);
    };
    document.getElementById("keepGoing").onclick = function () {
      route("quiz");
    };
  }

  function renderResults() {
    exitBtn.hidden = false;
    topMeta.textContent = "Results";
    var r = state.result;
    var rows = ["CP", "CARS", "BB", "PS"]
      .filter(function (sec) { return r.bySec[sec]; })
      .map(function (sec) {
        var b = r.bySec[sec];
        var p = b.total ? Math.round((100 * b.correct) / b.total) : 0;
        return (
          "<tr><td>" +
          escapeHtml(SECTION_LABELS[sec]) +
          "</td><td>" +
          b.correct +
          "/" +
          b.total +
          "</td><td>" +
          p +
          "%</td></tr>"
        );
      })
      .join("");
    main.innerHTML =
      hudHtml() +
      '<div class="card">' +
      "<h2>Score</h2>" +
      '<div class="score">' +
      r.pct +
      "%</div>" +
      "<p>" +
      r.correct +
      " / " +
      r.total +
      " correct" +
      (r.award ? " · +" + r.award.gained + " XP" : "") +
      "</p>" +
      '<table class="table-lite"><thead><tr><th>Section</th><th>Raw</th><th>%</th></tr></thead><tbody>' +
      rows +
      "</tbody></table>" +
      '<div class="row">' +
      '<button type="button" class="btn" id="reviewAll">Review all</button>' +
      '<button type="button" class="btn secondary" id="reviewWrong"' +
      (r.wrongIds.length ? "" : " disabled") +
      ">Review wrongs (" +
      r.wrongIds.length +
      ")</button>" +
      '<button type="button" class="btn secondary" id="retrySame">Retry mode</button>' +
      '<button type="button" class="btn ghost" id="goHome">Home</button>' +
      "</div></div>";
    document.getElementById("reviewAll").onclick = function () {
      state.reviewOnlyWrong = false;
      state.reviewIndex = 0;
      route("review");
    };
    document.getElementById("reviewWrong").onclick = function () {
      state.reviewOnlyWrong = true;
      state.reviewIndex = 0;
      route("review");
    };
    document.getElementById("retrySame").onclick = function () {
      startMode(state.mode, state.filter);
    };
    document.getElementById("goHome").onclick = function () {
      goHome();
    };
  }

  function reviewQueue() {
    if (!state.reviewOnlyWrong) return state.queue;
    var set = {};
    (state.result.wrongIds || []).forEach(function (id) { set[id] = true; });
    return state.queue.filter(function (q) { return set[q.id]; });
  }

  function renderReview() {
    var rq = reviewQueue();
    if (!rq.length) {
      main.innerHTML = '<div class="card"><p>Nothing to review.</p><button class="btn" id="backRes">Back</button></div>';
      document.getElementById("backRes").onclick = function () { route("results"); };
      return;
    }
    if (state.reviewIndex >= rq.length) state.reviewIndex = rq.length - 1;
    var q = rq[state.reviewIndex];
    var user = state.answers[q.id];
    var ans = answerIndex(q);
    var letters = ["A", "B", "C", "D"];
    topMeta.textContent = "Review " + (state.reviewIndex + 1) + "/" + rq.length;
    var pass = passageText(q);
    main.innerHTML =
      '<div class="qnum"><span class="section-tag">' +
      escapeHtml(SECTION_LABELS[q.section] || q.section) +
      "</span>" +
      escapeHtml(q.topic || "") +
      "</div>" +
      (pass ? '<div class="passage">' + escapeHtml(pass) + "</div>" : "") +
      '<div class="stem">' +
      escapeHtml(q.stem) +
      "</div>" +
      '<div class="choices" id="choices"></div>' +
      '<div class="explain"><strong>Explanation:</strong> ' +
      escapeHtml(explanation(q)) +
      "</div>" +
      '<div class="row">' +
      '<button type="button" class="btn secondary" id="revPrev"' +
      (state.reviewIndex === 0 ? " disabled" : "") +
      ">Back</button>" +
      '<button type="button" class="btn" id="revNext">' +
      (state.reviewIndex === rq.length - 1 ? "Done" : "Next") +
      "</button>" +
      '<button type="button" class="btn ghost" id="revResults">Results</button>' +
      "</div>";
    var box = document.getElementById("choices");
    (q.choices || []).slice(0, 4).forEach(function (c, idx) {
      var btn = document.createElement("div");
      btn.className = "choice";
      if (idx === ans) btn.className += " correct";
      if (user === idx && user !== ans) btn.className += " wrong";
      btn.innerHTML =
        "<strong>" +
        letters[idx] +
        ".</strong> " +
        escapeHtml(choiceText(c)) +
        (idx === ans ? " ✓" : "") +
        (user === idx && user !== ans ? " (your pick)" : "");
      box.appendChild(btn);
    });
    document.getElementById("revPrev").onclick = function () {
      if (state.reviewIndex > 0) {
        state.reviewIndex--;
        route("review");
      }
    };
    document.getElementById("revNext").onclick = function () {
      if (state.reviewIndex >= rq.length - 1) route("results");
      else {
        state.reviewIndex++;
        route("review");
      }
    };
    document.getElementById("revResults").onclick = function () {
      route("results");
    };
  }

  function goHome() {
    clearTimer();
    state.view = "home";
    state.queue = [];
    state.result = null;
    exitBtn.hidden = true;
    route("home");
  }

  function route(view) {
    state.view = view;
    if (view === "home") renderHome();
    else if (view === "quiz") renderQuiz();
    else if (view === "confirm") renderConfirm();
    else if (view === "results") renderResults();
    else if (view === "review") renderReview();
  }

  document.getElementById("brandBtn").onclick = function () {
    if (state.view === "quiz" || state.view === "confirm") {
      if (!confirm("Leave this attempt? Progress for this run will be lost.")) return;
    }
    goHome();
  };
  exitBtn.onclick = function () {
    if (state.view === "quiz" || state.view === "confirm") {
      if (!confirm("Exit to home? This attempt won't be scored.")) return;
      goHome();
    } else {
      goHome();
    }
  };

  if (!window.MCAT_BANK || !allQuestions().length) {
    main.innerHTML = '<p class="sub">Could not load question bank. Check mcat-bank-data.js.</p>';
    return;
  }
  route("home");
})();
