(function () {
  const SECONDS = 20;
  const NTFY = "https://ntfy.sh";
  const TOPIC_PREFIX = "gxpk-cl92-rev1-";

  const $app = document.getElementById("app");
  const QUESTIONS = window.QUESTIONS;
  const TOTAL = QUESTIONS.length;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function uid(prefix) {
    return (prefix || "p") + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }
  function roomCode() {
    return String(1000 + Math.floor(Math.random() * 9000));
  }
  function parseHash() {
    const h = (location.hash || "").replace(/^#/, "");
    const parts = h.split("/").filter(Boolean);
    if (parts[0] === "host") return { role: "host", room: parts[1] || "" };
    if (parts[0] === "play") return { role: "play", room: (parts[1] || "").trim() };
    const q = new URLSearchParams(location.search);
    if (q.get("host")) return { role: "host", room: q.get("room") || "" };
    if (q.get("room")) return { role: "play", room: q.get("room") };
    return { role: "land", room: "" };
  }
  function studentUrl(room) {
    const base = location.href.split("#")[0].split("?")[0];
    return base + "#/play/" + room;
  }
  function teamLabel(t) { return t === "red" ? "红队" : "蓝队"; }
  function fmtUsed(ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m <= 0) return r + " 秒";
    return m + " 分 " + String(r).padStart(2, "0") + " 秒";
  }
  function choiceLabel(q, k) {
    if (!k) return "未作答";
    if (q.type === "tf") return k === "T" ? "对" : "错";
    return k + "．" + (q.options[k] || "");
  }

  /* ---------------- realtime bus (HTTPS, works in the browser) ---------------- */
  function topicFor(room) { return TOPIC_PREFIX + room; }

  function connectBus(room, onMsg, onStatus) {
    const topic = topicFor(room);
    let es = null;
    let closed = false;
    let opened = false;

    function handleRecord(rec) {
      try {
        if (rec && rec.event && rec.event !== "message") return;
        const raw = rec && rec.message != null ? rec.message : rec;
        const msg = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (msg && typeof msg === "object") onMsg(msg);
      } catch (e) {}
    }

    function listen() {
      if (closed) return;
      onStatus("connecting");
      try { if (es) es.close(); } catch (e) {}
      es = new EventSource(NTFY + "/" + topic + "/sse");
      es.addEventListener("open", () => { opened = true; onStatus("on"); });
      es.onopen = () => { opened = true; onStatus("on"); };
      es.onmessage = (e) => {
        try { handleRecord(JSON.parse(e.data)); } catch (err) {}
      };
      es.addEventListener("message", (e) => {
        try { handleRecord(JSON.parse(e.data)); } catch (err) {}
      });
      es.onerror = () => {
        if (closed) return;
        if (opened) onStatus("off");
        else onStatus("error");
      };
    }

    async function pub(obj) {
      try {
        if (obj.players && obj.players.length > 20) {
          obj = Object.assign({}, obj, { players: obj.players.slice(0, 80).map((p) => ({ id: p.id, name: (p.name || "").slice(0, 8), team: p.team })) });
        }
        const res = await fetch(NTFY + "/" + topic, {
          method: "POST",
          body: JSON.stringify(obj),
          headers: { "Content-Type": "text/plain" }
        });
        return res.ok;
      } catch (e) {
        return false;
      }
    }

    listen();
    return {
      pubState: pub,
      pubChat: pub,
      end() {
        closed = true;
        try { if (es) es.close(); } catch (e) {}
      }
    };
  }

  /* ---------------- audience scoring (unanswered = wrong) ---------------- */
  function audienceTotals(players, answers) {
    const res = {
      red: { n: 0, ok: 0, answered: 0, finished: 0, rate: 0 },
      blue: { n: 0, ok: 0, answered: 0, finished: 0, rate: 0 }
    };
    Object.values(players).forEach((p) => {
      if (!res[p.team]) return;
      const slot = res[p.team];
      slot.n += 1;
      const rec = answers[p.id] || {};
      let ok = 0, answered = 0;
      QUESTIONS.forEach((q) => {
        const a = rec[q.id];
        if (a) {
          answered += 1;
          if (a.ok) ok += 1;
        }
      });
      slot.ok += ok;
      slot.answered += answered;
      if (answered >= TOTAL) slot.finished += 1;
    });
    ["red", "blue"].forEach((t) => {
      const s = res[t];
      s.rate = s.n ? Math.round((s.ok / (s.n * TOTAL)) * 1000) / 10 : 0;
    });
    return res;
  }

  /* ---------------- landing ---------------- */
  function renderLanding() {
    document.body.classList.remove("is-host");
    $app.innerHTML = "";
    $app.appendChild(el(`
      <div class="landing">
        <div class="hero">
          <div class="kicker">高三一轮复习公开课</div>
          <h1>基因的表达<br>快问快答 · 红蓝 PK</h1>
          <p class="sub">转录 · 翻译 · 途径 1　　共 ${TOTAL} 题　　两边各自作答，先完赛者获胜，结束后大屏讲评错题</p>
          <div class="actions">
            <button class="btn btn-gold" id="go-host">我是教师，发起 PK</button>
          </div>
          <div class="join-box" style="max-width:420px;margin:36px auto 0;text-align:left">
            <div style="font-weight:700;margin-bottom:8px">我是学生，输入房间号</div>
            <div class="name-row">
              <input id="room-in" maxlength="4" inputmode="numeric" placeholder="4 位房间号" />
              <button class="btn btn-gold" id="go-play">加入</button>
            </div>
          </div>
          <p class="hint">教师用一体机或投影打开本页，点击「我是教师，发起 PK」。台上两位同学看左右两边的题，各做各的：点选后自动进入下一题，先把 ${TOTAL} 道题答完的一方获胜。台下同学用手机或平板扫码（或输入房间号），选择红队或蓝队，同样一道接一道作答。全部结束后，大屏会列出全部题目并标出错题，方便老师讲评。</p>
        </div>
      </div>
    `));
    $("#go-host").onclick = () => { location.hash = "#/host"; };
    $("#go-play").onclick = joinFromInput;
    $("#room-in").addEventListener("keydown", (e) => { if (e.key === "Enter") joinFromInput(); });
    function joinFromInput() {
      const r = $("#room-in").value.replace(/\D/g, "").slice(0, 4);
      if (r.length !== 4) { $("#room-in").focus(); return; }
      location.hash = "#/play/" + r;
    }
  }

  function raceWinnerInfo(winnerTeam, finishedAt, startedAt, correct) {
    if (winnerTeam) {
      const used = finishedAt[winnerTeam] && startedAt ? finishedAt[winnerTeam] - startedAt : 0;
      return {
        team: winnerTeam,
        text: "台上胜出：" + teamLabel(winnerTeam) + "（率先完赛，用时 " + fmtUsed(used) + "）",
        color: winnerTeam === "red" ? "var(--red-2)" : "var(--blue-2)"
      };
    }
    if (correct.red === correct.blue) return { team: null, text: "台上平局", color: "var(--gold)" };
    if (correct.red > correct.blue) return { team: "red", text: "台上胜出：红队（答对更多）", color: "var(--red-2)" };
    return { team: "blue", text: "台上胜出：蓝队（答对更多）", color: "var(--blue-2)" };
  }

  /* ---------------- host ---------------- */
  function renderHost(presetRoom) {
    const room = presetRoom || roomCode();
    if (!presetRoom) location.hash = "#/host/" + room;
    const players = {};
    const answers = {}; // playerId -> { qId: {choice, ok, at} }
    const cursor = { red: 0, blue: 0 };
    const remain = { red: SECONDS, blue: SECONDS };
    const stageLog = { red: [], blue: [] };
    const finishedAt = { red: null, blue: null };
    let winnerTeam = null;
    let phase = "lobby"; // lobby | race | review
    let reviewIndex = 0;
    let raceStartedAt = 0;
    let questionRound = 0;
    let timer = null;
    let bus = null;
    let demo = false;
    let netText = "正在连接答题通道…";

    document.body.classList.add("is-host");
    $app.innerHTML = "";
    $app.appendChild(el(`
      <div class="host host-fill is-lobby" id="host-root">
        <div class="board" id="host-board">
          <section class="side-panel red" id="panel-red"></section>
          <section class="mid-panel" id="panel-mid">
            <div class="mid-top" id="mid-top"></div>
            <div class="mid-scores" id="mid-scores"></div>
            <div id="mid-body"></div>
            <div class="buzz-wrap" id="buzz-wrap"></div>
            <div class="buzz-status" id="buzz-status"></div>
            <div class="mid-audience" id="mid-audience"></div>
            <div class="mid-join" id="mid-join">
              <div class="room-chip">
                <span class="status-dot off" id="dot"></span>
                <span>房间</span><b id="room-no">${esc(room)}</b>
              </div>
              <div id="qrbox"></div>
              <div class="join-hint">台下同学扫码或输入房间号，选择红队或蓝队即可作答</div>
            </div>
          </section>
          <section class="side-panel blue" id="panel-blue"></section>
        </div>
        <div class="review-screen hidden" id="review-screen"></div>
        <div class="teacher-bar" id="teacher-bar"></div>
      </div>
    `));

    const url = studentUrl(room);
    try { new QRCode($("#qrbox"), { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M }); }
    catch (e) { $("#qrbox").textContent = url; }

    function setDot(on, text) {
      const d = $("#dot");
      if (d) {
        d.classList.toggle("on", on);
        d.classList.toggle("off", !on);
      }
      if (text) netText = text;
      const net = $("#net-status");
      if (net) net.textContent = netText;
    }

    function count(team) {
      return Object.values(players).filter((p) => p.team === team).length;
    }
    function correctOf(team) {
      return stageLog[team].filter((a) => a && a.ok).length;
    }
    function isDone(team) {
      return cursor[team] >= TOTAL;
    }
    function aud() {
      return audienceTotals(players, answers);
    }

    function snapshot() {
      return {
        type: "state",
        phase,
        round: questionRound,
        total: TOTAL,
        seconds: SECONDS,
        players: Object.values(players).map((p) => ({ id: p.id, name: p.name, team: p.team })),
        rates: aud(),
        cursor: { red: cursor.red, blue: cursor.blue },
        correct: { red: correctOf("red"), blue: correctOf("blue") },
        finishedAt: { red: finishedAt.red, blue: finishedAt.blue },
        winnerTeam,
        raceStartedAt,
        reviewIndex,
        at: Date.now()
      };
    }
    let pubTimer = null;
    function publish(urgent) {
      if (!bus) return;
      if (urgent) {
        if (pubTimer) { clearTimeout(pubTimer); pubTimer = null; }
        bus.pubState(snapshot());
        return;
      }
      if (pubTimer) return;
      pubTimer = setTimeout(() => {
        pubTimer = null;
        if (bus) bus.pubState(snapshot());
      }, 700);
    }

    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

    function paintTimerOnly() {
      ["red", "blue"].forEach((team) => {
        const elT = document.getElementById("side-timer-" + team);
        if (!elT) return;
        elT.textContent = isDone(team) ? "完" : String(remain[team]);
        elT.classList.toggle("warn", !isDone(team) && remain[team] <= 5);
      });
    }

    function markTimeout(team) {
      if (isDone(team)) return false;
      const i = cursor[team];
      if (stageLog[team][i]) return false;
      const q = QUESTIONS[i];
      stageLog[team][i] = { qid: q.id, choice: null, ok: false, at: Date.now(), timeout: true };
      cursor[team] += 1;
      if (isDone(team)) {
        finishedAt[team] = Date.now();
        if (!winnerTeam) winnerTeam = team;
        remain[team] = 0;
      } else {
        remain[team] = SECONDS;
      }
      return true;
    }

    function startTicker() {
      stopTimer();
      timer = setInterval(() => {
        if (phase !== "race") return;
        let advanced = false;
        ["red", "blue"].forEach((team) => {
          if (isDone(team)) return;
          if (remain[team] > 0) remain[team] -= 1;
          if (remain[team] <= 0) advanced = markTimeout(team) || advanced;
        });
        if (isDone("red") && isDone("blue")) {
          stopTimer();
          goReview();
          return;
        }
        if (advanced) {
          paintAll();
          publish();
        } else {
          paintTimerOnly();
        }
      }, 1000);
    }

    function startRace() {
      stopTimer();
      phase = "race";
      cursor.red = 0;
      cursor.blue = 0;
      remain.red = SECONDS;
      remain.blue = SECONDS;
      stageLog.red = [];
      stageLog.blue = [];
      finishedAt.red = null;
      finishedAt.blue = null;
      winnerTeam = null;
      reviewIndex = 0;
      Object.keys(answers).forEach((k) => delete answers[k]);
      questionRound += 1;
      raceStartedAt = Date.now();
      startTicker();
      paintAll();
      publish(true);
    }

    function closeOpenQuestions() {
      ["red", "blue"].forEach((team) => {
        while (!isDone(team)) markTimeout(team);
      });
    }

    function firstWrongIndex() {
      for (let i = 0; i < TOTAL; i++) {
        const r = stageLog.red[i];
        const b = stageLog.blue[i];
        if (!r || !r.ok || !b || !b.ok) return i;
      }
      return 0;
    }

    function goReview() {
      stopTimer();
      closeOpenQuestions();
      phase = "review";
      reviewIndex = firstWrongIndex();
      paintAll();
      publish(true);
    }

    function onStageChoice(team, choice) {
      if (phase !== "race" || isDone(team)) return;
      const i = cursor[team];
      if (stageLog[team][i]) return;
      const q = QUESTIONS[i];
      const ok = choice === q.answer;
      stageLog[team][i] = { qid: q.id, choice, ok, at: Date.now() };
      cursor[team] += 1;
      if (isDone(team)) {
        finishedAt[team] = Date.now();
        if (!winnerTeam) winnerTeam = team;
        remain[team] = 0;
        if (isDone("red") && isDone("blue")) {
          goReview();
          return;
        }
      } else {
        remain[team] = SECONDS;
      }
      paintAll();
      publish(true);
    }

    function restartSameRoom() {
      stopTimer();
      Object.keys(answers).forEach((k) => delete answers[k]);
      cursor.red = 0;
      cursor.blue = 0;
      remain.red = SECONDS;
      remain.blue = SECONDS;
      stageLog.red = [];
      stageLog.blue = [];
      finishedAt.red = null;
      finishedAt.blue = null;
      winnerTeam = null;
      reviewIndex = 0;
      raceStartedAt = 0;
      questionRound += 1;
      phase = "lobby";
      paintAll();
      publish(true);
    }

    function optionItems(q) {
      return q.type === "tf"
        ? [{ k: "T", lab: "对" }, { k: "F", lab: "错" }]
        : Object.keys(q.options).map((k) => ({ k, lab: k + "　" + q.options[k] }));
    }

    function renderLiveOptions(team, q) {
      return `<div class="panel-opts">` + optionItems(q).map((it) =>
        `<button type="button" class="opt-btn ready" data-team="${team}" data-k="${it.k}">
          <span class="key">${it.k === "T" ? "对" : it.k === "F" ? "错" : esc(it.k)}</span>
          <span>${it.k === "T" || it.k === "F" ? (it.k === "T" ? "对" : "错") : esc(q.options[it.k])}</span>
        </button>`
      ).join("") + `</div>`;
    }

    function bindOptions(panel, team) {
      panel.querySelectorAll(".opt-btn").forEach((btn) => {
        btn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onStageChoice(team, btn.getAttribute("data-k"));
        };
      });
    }

    function paintSides() {
      const red = $("#panel-red");
      const blue = $("#panel-blue");

      function waitCopy(team) {
        const n = count(team);
        return `<div class="panel-wait">台上同学将在此连续作答 ${TOTAL} 道题。<br>台下已加入 ${n} 人，请扫中间二维码入队。</div>`;
      }

      function paintOne(panel, team) {
        const done = isDone(team);
        const i = Math.min(cursor[team], TOTAL - 1);
        const pts = correctOf(team);
        let body = "";
        if (done) {
          const used = finishedAt[team] && raceStartedAt ? finishedAt[team] - raceStartedAt : 0;
          const first = winnerTeam === team;
          body = `<div class="side-done">${first ? "率先完赛！" : "已全部作答"}<div class="side-done-sub">答对 ${pts} / ${TOTAL}　用时 ${fmtUsed(used)}</div></div>`;
        } else {
          const q = QUESTIONS[cursor[team]];
          body = `
            <div class="panel-progress">第 ${cursor[team] + 1} / ${TOTAL} 题　　${esc(q.tag)}</div>
            <div class="panel-stem">${esc(q.stem)}</div>
            ${renderLiveOptions(team, q)}`;
        }
        panel.innerHTML = `
          <div class="panel-hd">
            <div class="team-name">${teamLabel(team)}</div>
            <div class="stage-pts">
              <div class="lab">已答对</div>
              <div class="num">${pts}</div>
            </div>
            <div class="side-timer ${!done && remain[team] <= 5 ? "warn" : ""} ${done ? "idle" : ""}" id="side-timer-${team}">${done ? "完" : remain[team]}</div>
          </div>
          ${body}`;
        if (!done) bindOptions(panel, team);
        panel.classList.toggle("is-active", !done && phase === "race");
        panel.classList.toggle("is-dim", done && winnerTeam && winnerTeam !== team);
      }

      if (phase === "lobby") {
        red.innerHTML = `<div class="panel-hd"><div class="team-name">红队</div><div class="stage-pts"><div class="lab">已答对</div><div class="num">0</div></div></div>${waitCopy("red")}`;
        blue.innerHTML = `<div class="panel-hd"><div class="team-name">蓝队</div><div class="stage-pts"><div class="lab">已答对</div><div class="num">0</div></div></div>${waitCopy("blue")}`;
        red.classList.remove("is-active", "is-dim");
        blue.classList.remove("is-active", "is-dim");
        return;
      }

      if (phase === "review") return;

      paintOne(red, "red");
      paintOne(blue, "blue");
    }

    function paintMid() {
      const root = $("#host-root");
      root.classList.toggle("is-lobby", phase === "lobby");
      root.classList.toggle("is-play", phase === "race");
      root.classList.toggle("is-review", phase === "review");

      const midTop = $("#mid-top");
      const midBody = $("#mid-body");
      const midScores = $("#mid-scores");
      const buzzWrap = $("#buzz-wrap");
      const buzzStatus = $("#buzz-status");
      const audBox = $("#mid-audience");
      const tot = aud();

      midScores.innerHTML = `
        <div class="mid-score red"><div class="lab">红队已答对</div><div class="num">${correctOf("red")}</div></div>
        <div class="mid-score blue"><div class="lab">蓝队已答对</div><div class="num">${correctOf("blue")}</div></div>`;

      if (phase === "lobby") {
        midTop.innerHTML = `<div class="q-tag">准备就绪</div>`;
        midBody.innerHTML = `
          <div class="lobby-copy">
            <h2>请台下同学扫码加入</h2>
            <p>台上两位同学分别站在红队、蓝队一侧，各做各的 ${TOTAL} 道题。点选后自动进入下一题，先全部答完的一方获胜。<br>全部结束后，大屏会列出 10 道题并标出错题，供老师讲评。</p>
          </div>`;
        buzzWrap.innerHTML = `<button type="button" class="buzz-btn start-btn" id="btn-start-main">开始答题</button>`;
        const startMain = $("#btn-start-main");
        if (startMain) startMain.onclick = startRace;
        buzzStatus.textContent = "教师按中间金色大按钮，即可开始竞赛";
        buzzStatus.className = "buzz-status";
        audBox.innerHTML = `台下已加入　<span class="r">红队 ${count("red")} 人</span>　·　<span class="b">蓝队 ${count("blue")} 人</span>`;
        return;
      }

      if (phase === "review") return;

      midTop.innerHTML = `<div class="q-tag">竞赛进行中　　每题限时 ${SECONDS} 秒</div>`;
      midBody.innerHTML = `
        <div class="race-progress">
          <div class="race-line red">红队 ${Math.min(cursor.red, TOTAL)} / ${TOTAL}</div>
          <div class="race-line blue">蓝队 ${Math.min(cursor.blue, TOTAL)} / ${TOTAL}</div>
        </div>`;
      buzzWrap.innerHTML = "";
      if (winnerTeam && !(isDone("red") && isDone("blue"))) {
        buzzStatus.textContent = teamLabel(winnerTeam) + "已率先完赛，对方继续作答";
        buzzStatus.className = "buzz-status ok";
      } else {
        buzzStatus.textContent = "点选后立即进入下一题，先全部答完的一方获胜";
        buzzStatus.className = "buzz-status";
      }
      audBox.innerHTML = `台下完赛　<span class="r">红队 ${tot.red.finished}/${tot.red.n}</span>　·　<span class="b">蓝队 ${tot.blue.finished}/${tot.blue.n}</span>`;
    }

    function isWrongFor(i, team) {
      const a = stageLog[team][i];
      return !a || !a.ok;
    }

    function paintReview() {
      const screen = $("#review-screen");
      const q = QUESTIONS[reviewIndex];
      const tot = aud();
      const w = raceWinnerInfo(winnerTeam, finishedAt, raceStartedAt, { red: correctOf("red"), blue: correctOf("blue") });
      const usedR = finishedAt.red && raceStartedAt ? finishedAt.red - raceStartedAt : 0;
      const usedB = finishedAt.blue && raceStartedAt ? finishedAt.blue - raceStartedAt : 0;

      const nav = QUESTIONS.map((item, i) => {
        const rw = isWrongFor(i, "red");
        const bw = isWrongFor(i, "blue");
        const wrong = rw || bw;
        const cls = ["review-item"];
        if (i === reviewIndex) cls.push("is-on");
        if (wrong) cls.push("is-wrong");
        else cls.push("is-ok");
        return `<button type="button" class="${cls.join(" ")}" data-i="${i}">
          <span class="n">第 ${i + 1} 题</span>
          <span class="marks"><span class="${rw ? "bad" : "good"}">红${rw ? "错" : "对"}</span><span class="${bw ? "bad" : "good"}">蓝${bw ? "错" : "对"}</span></span>
        </button>`;
      }).join("");

      const rAns = stageLog.red[reviewIndex] || { choice: null, ok: false };
      const bAns = stageLog.blue[reviewIndex] || { choice: null, ok: false };
      const opts = optionItems(q).map((it) => {
        const cls = ["review-opt"];
        if (it.k === q.answer) cls.push("correct");
        if (rAns.choice === it.k && !rAns.ok) cls.push("red-wrong");
        if (bAns.choice === it.k && !bAns.ok) cls.push("blue-wrong");
        const tags = [];
        if (it.k === q.answer) tags.push("正确答案");
        if (rAns.choice === it.k) tags.push("红队所选");
        if (bAns.choice === it.k) tags.push("蓝队所选");
        return `<div class="${cls.join(" ")}"><b>${esc(it.k === "T" ? "对" : it.k === "F" ? "错" : it.k)}</b><span>${it.k === "T" || it.k === "F" ? esc(it.lab) : esc(q.options[it.k])}</span>${tags.length ? `<i>${tags.join(" · ")}</i>` : ""}</div>`;
      }).join("");

      screen.innerHTML = `
        <div class="review-head">
          <div class="winner" style="color:${w.color}">${esc(w.text)}</div>
          <div class="review-stats">
            <span class="r">红队答对 ${correctOf("red")} / ${TOTAL}　用时 ${fmtUsed(usedR)}</span>
            <span class="b">蓝队答对 ${correctOf("blue")} / ${TOTAL}　用时 ${fmtUsed(usedB)}</span>
            <span>台下正确率　<span class="r">红队 ${tot.red.rate}%</span>　·　<span class="b">蓝队 ${tot.blue.rate}%</span></span>
          </div>
        </div>
        <div class="review-body">
          <div class="review-nav">${nav}</div>
          <div class="review-detail">
            <div class="q-tag">第 ${reviewIndex + 1} / ${TOTAL} 题　　${esc(q.tag)}${(isWrongFor(reviewIndex, "red") || isWrongFor(reviewIndex, "blue")) ? "　　错题" : ""}</div>
            <div class="q-stem" style="font-size:clamp(22px,2.4vw,34px)">${esc(q.stem)}</div>
            <div class="review-opts">${opts}</div>
            <div class="team-ans">
              <span class="r">红队：${esc(choiceLabel(q, rAns.choice))}（${rAns.ok ? "正确" : "错误"}）</span>
              <span class="b">蓝队：${esc(choiceLabel(q, bAns.choice))}（${bAns.ok ? "正确" : "错误"}）</span>
            </div>
            <div class="explain"><b>解析　</b>${esc(q.explain)}</div>
          </div>
        </div>`;
      screen.querySelectorAll("[data-i]").forEach((btn) => {
        btn.onclick = () => {
          reviewIndex = Number(btn.getAttribute("data-i"));
          paintAll();
        };
      });
    }

    function nextWrong() {
      for (let step = 1; step <= TOTAL; step++) {
        const i = (reviewIndex + step) % TOTAL;
        if (isWrongFor(i, "red") || isWrongFor(i, "blue")) {
          reviewIndex = i;
          paintAll();
          return;
        }
      }
    }

    function paintBar() {
      const bar = $("#teacher-bar");
      let actions = "";
      if (phase === "lobby") {
        actions = `<button type="button" class="btn btn-teach btn-gold" id="btn-start">开始答题</button>`;
      } else if (phase === "race") {
        actions = `<button type="button" class="btn btn-teach btn-gold" id="btn-end">结束并讲解</button>`;
      } else {
        actions += `<button type="button" class="btn btn-teach" id="btn-prev">上一题</button>`;
        actions += `<button type="button" class="btn btn-teach" id="btn-nextq">下一题</button>`;
        actions += `<button type="button" class="btn btn-teach btn-ok" id="btn-wrong">下一道错题</button>`;
        actions += `<button type="button" class="btn btn-teach btn-ghost" id="btn-again">再来一局（同一房间）</button>`;
      }
      bar.innerHTML = `
        <div class="bar-left">
          <span class="bar-lab">教师操作</span>
          <span class="net" id="net-status">${esc(netText)}</span>
        </div>
        <div class="bar-right">${actions}</div>`;
      const start = $("#btn-start"); if (start) start.onclick = startRace;
      const end = $("#btn-end"); if (end) end.onclick = goReview;
      const prev = $("#btn-prev"); if (prev) prev.onclick = () => { reviewIndex = (reviewIndex + TOTAL - 1) % TOTAL; paintAll(); };
      const nx = $("#btn-nextq"); if (nx) nx.onclick = () => { reviewIndex = (reviewIndex + 1) % TOTAL; paintAll(); };
      const wr = $("#btn-wrong"); if (wr) wr.onclick = nextWrong;
      const ag = $("#btn-again"); if (ag) ag.onclick = restartSameRoom;
    }

    function paintAll() {
      const board = $("#host-board");
      const review = $("#review-screen");
      if (phase === "review") {
        if (board) board.classList.add("hidden");
        if (review) review.classList.remove("hidden");
        paintReview();
      } else {
        if (board) board.classList.remove("hidden");
        if (review) review.classList.add("hidden");
        paintSides();
        paintMid();
      }
      paintBar();
    }

    function onChat(msg) {
      if (!msg || !msg.type) return;
      if (msg.type === "join" && msg.id && (msg.team === "red" || msg.team === "blue")) {
        players[msg.id] = { id: msg.id, name: String(msg.name || "同学").slice(0, 12), team: msg.team, at: Date.now() };
        paintAll();
        publish();
      }
      if (msg.type === "leave" && msg.id) {
        delete players[msg.id];
        delete answers[msg.id];
        paintAll();
        publish();
      }
      if (msg.type === "answer" && msg.id && players[msg.id] && (phase === "race" || phase === "review")) {
        const q = QUESTIONS.find((item) => item.id === msg.qId);
        if (!q) return;
        if (!answers[msg.id]) answers[msg.id] = {};
        if (answers[msg.id][q.id]) return;
        const choice = msg.choice ? String(msg.choice) : null;
        const ok = !!(choice && choice === q.answer);
        answers[msg.id][q.id] = { choice, ok, at: Date.now() };
        if (phase === "race") {
          const tot = aud();
          const box = $("#mid-audience");
          if (box) box.innerHTML = `台下完赛　<span class="r">红队 ${tot.red.finished}/${tot.red.n}</span>　·　<span class="b">蓝队 ${tot.blue.finished}/${tot.blue.n}</span>`;
        }
        publish();
      }
      if (msg.type === "hello") publish();
    }

    paintAll();
    bus = connectBus(room, (msg) => {
      if (msg && msg.type === "state") return;
      onChat(msg);
    }, (st) => {
      if (st === "on") {
        demo = false;
        setDot(true, "答题通道已接通，台下学生扫码即可加入。");
        paintBar();
        publish();
      } else if (st === "connecting") {
        setDot(false, "正在连接答题通道…");
        paintBar();
      } else if (st === "error" || st === "off") {
        demo = true;
        setDot(false, "答题通道暂时连不上。大屏仍可出题、作答与讲评；请检查网络后刷新本页重试。");
        paintBar();
      }
    });

    window.addEventListener("beforeunload", () => bus && bus.end());
  }

  /* ---------------- student ---------------- */
  function renderPlay(room) {
    if (!/^\d{4}$/.test(room)) {
      location.hash = "#";
      return;
    }
    document.body.classList.remove("is-host");
    let me = JSON.parse(localStorage.getItem("gxpk-me") || "null") || { id: uid("s") };
    if (!me.id) me.id = uid("s");
    let state = null;
    let bus = null;
    let tick = null;
    let lastPaintKey = "";
    let raceRound = -1;
    let localIndex = 0;
    let localRemain = SECONDS;
    const myAnswers = {};

    function stopTick() { if (tick) { clearInterval(tick); tick = null; } }
    function startTick() {
      stopTick();
      tick = setInterval(() => {
        if (!state || state.phase !== "race") return;
        if (localIndex >= TOTAL) return;
        if (localRemain > 0) localRemain -= 1;
        const lab = document.getElementById("remain-lab");
        if (lab) lab.textContent = "还剩 " + localRemain + " 秒";
        if (localRemain <= 0) submitLocal(null);
      }, 1000);
    }

    $app.innerHTML = "";
    $app.appendChild(el(`
      <div class="play">
        <div class="play-hd">
          <div class="kicker">房间 ${esc(room)}</div>
          <h2>快问快答</h2>
          <p class="sub" id="play-sub">先选队伍，再等待老师开始</p>
        </div>
        <div id="play-body"></div>
      </div>
    `));

    function saveMe() { localStorage.setItem("gxpk-me", JSON.stringify({ id: me.id, name: me.name, team: me.team })); }

    function resetRace(round) {
      raceRound = round;
      localIndex = 0;
      localRemain = SECONDS;
      Object.keys(myAnswers).forEach((k) => delete myAnswers[k]);
    }

    function submitLocal(choice) {
      if (!state || state.phase !== "race") return;
      if (localIndex >= TOTAL) return;
      const q = QUESTIONS[localIndex];
      if (!q || myAnswers[q.id]) return;
      const ok = !!(choice && choice === q.answer);
      myAnswers[q.id] = { choice: choice || null, ok };
      if (bus) bus.pubChat({ type: "answer", id: me.id, qId: q.id, choice: choice || "", round: state.round });
      localIndex += 1;
      localRemain = SECONDS;
      lastPaintKey = "";
      if (localIndex >= TOTAL) stopTick();
      paint();
    }

    function myCorrect() {
      return Object.values(myAnswers).filter((a) => a.ok).length;
    }

    function paint() {
      const body = $("#play-body");
      if (!me.team) {
        body.innerHTML = `
          <div class="card">
            <div style="font-weight:700;margin-bottom:8px">选一个队，加入 PK</div>
            <div class="name-row">
              <input id="nick" maxlength="12" placeholder="可选：填写昵称" value="${esc(me.name || "")}" />
            </div>
            <div class="team-pick">
              <button class="team-btn" style="background:linear-gradient(180deg,#ff5b6e,#d7263d)" data-team="red">加入红队</button>
              <button class="team-btn" style="background:linear-gradient(180deg,#6ea0ff,#2e6bff)" data-team="blue">加入蓝队</button>
            </div>
          </div>`;
        body.querySelectorAll("[data-team]").forEach((btn) => {
          btn.onclick = () => {
            me.name = ($("#nick").value || "同学").trim().slice(0, 12);
            me.team = btn.getAttribute("data-team");
            saveMe();
            if (bus) bus.pubChat({ type: "join", id: me.id, name: me.name, team: me.team });
            paint();
          };
        });
        return;
      }

      $("#play-sub").textContent = (me.team === "red" ? "你在红队" : "你在蓝队") + (me.name ? " · " + me.name : "");

      if (!state || state.phase === "lobby") {
        stopTick();
        body.innerHTML = `<div class="wait">已加入${me.team === "red" ? "红队" : "蓝队"}，等待老师开始…</div>`;
        return;
      }

      if (state.phase === "review") {
        stopTick();
        const tot = state.rates || { red: { rate: 0 }, blue: { rate: 0 } };
        const w = raceWinnerInfo(state.winnerTeam, state.finishedAt || {}, state.raceStartedAt, state.correct || { red: 0, blue: 0 });
        const ss = state.correct || { red: 0, blue: 0 };
        body.innerHTML = `
          <div class="card final">
            <div class="winner" style="color:${w.color}">${esc(w.text)}</div>
            <div class="scoreline" style="color:var(--red-2)">红队台上答对 ${ss.red} / ${TOTAL}</div>
            <div class="scoreline" style="color:var(--blue-2)">蓝队台上答对 ${ss.blue} / ${TOTAL}</div>
            <p class="sub" style="margin-top:16px">你答对 ${myCorrect()} / ${TOTAL}</p>
            <p class="sub">台下正确率　红队 ${tot.red.rate}%　·　蓝队 ${tot.blue.rate}%</p>
            <p class="tiny" style="margin-top:18px">请看大屏幕，老师正在讲评题目，尤其是错题。</p>
          </div>`;
        return;
      }

      if (localIndex >= TOTAL) {
        stopTick();
        body.innerHTML = `<div class="card final"><div class="winner" style="color:var(--gold)">你已全部作答</div><div class="scoreline">答对 ${myCorrect()} / ${TOTAL}</div><p class="sub" style="margin-top:16px">请等待双方完赛，看大屏幕讲评。</p></div>`;
        return;
      }

      const q = QUESTIONS[localIndex];
      if (!q) return;
      let grid = "";
      if (q.type === "tf") {
        grid = `<div class="choice-grid tf">
          <button class="choice" data-k="T">正确</button>
          <button class="choice" data-k="F">错误</button>
        </div>`;
      } else {
        grid = `<div class="choice-grid">` + Object.keys(q.options).map((k) =>
          `<button class="choice" data-k="${k}"><b>${k}</b>　${esc(q.options[k])}</button>`
        ).join("") + `</div>`;
      }
      body.innerHTML = `
        <div class="card">
          <div class="q-tag">第 ${localIndex + 1} / ${TOTAL} 题　　${esc(q.tag)}</div>
          <div class="q-stem" style="font-size:26px">${esc(q.stem)}</div>
          <p class="tiny" id="remain-lab" style="text-align:left;margin:10px 0 0">还剩 ${localRemain} 秒</p>
          ${grid}
        </div>`;
      body.querySelectorAll(".choice").forEach((btn) => {
        btn.onclick = () => {
          if (!state || state.phase !== "race") return;
          submitLocal(btn.getAttribute("data-k"));
        };
      });
      startTick();
    }

    paint();
    bus = connectBus(room, (msg) => {
      if (msg && msg.type === "state") {
        state = msg;
        if (state.phase === "race" && state.round !== raceRound) resetRace(state.round);
        if (state.phase === "lobby") resetRace(-1);
        const key = [state.phase, state.round, localIndex, localRemain > 0 ? "t" : "x", me.team].join(":");
        if (key === lastPaintKey) return;
        lastPaintKey = key;
        paint();
      }
    }, (st) => {
      if (st === "on") {
        if (me.team) bus.pubChat({ type: "join", id: me.id, name: me.name || "同学", team: me.team });
        else bus.pubChat({ type: "hello", id: me.id });
      } else if (st === "error") {
        $("#play-sub").textContent = "连不上答题通道，请检查网络后刷新重试";
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && me.team && bus) {
        bus.pubChat({ type: "join", id: me.id, name: me.name || "同学", team: me.team });
      }
    });
  }

  function route() {
    const r = parseHash();
    if (r.role === "host") renderHost(r.room);
    else if (r.role === "play") renderPlay(r.room);
    else renderLanding();
  }
  window.addEventListener("hashchange", route);
  route();
})();
