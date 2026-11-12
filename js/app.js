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
        const body = JSON.stringify(obj);
        if (body.length > 3900) {
          if (obj.players && obj.players.length > 20) {
            obj = Object.assign({}, obj, { players: obj.players.slice(0, 80).map((p) => ({ id: p.id, name: (p.name || "").slice(0, 8), team: p.team })) });
          }
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

  /* ---------------- scoring ---------------- */
  function teamStats(players, answers, qid) {
    const res = { red: { n: 0, ok: 0, answered: 0 }, blue: { n: 0, ok: 0, answered: 0 } };
    Object.values(players).forEach((p) => {
      if (!res[p.team]) return;
      res[p.team].n += 1;
      const a = answers[p.id];
      if (a && a.qId === qid) {
        res[p.team].answered += 1;
        if (a.ok) res[p.team].ok += 1;
      }
    });
    ["red", "blue"].forEach((t) => {
      const s = res[t];
      s.rate = s.n ? Math.round((s.ok / s.n) * 1000) / 10 : 0;
    });
    return res;
  }

  function avgRates(history) {
    if (!history.length) return { red: 0, blue: 0 };
    const sum = history.reduce((acc, h) => {
      acc.red += h.red; acc.blue += h.blue; return acc;
    }, { red: 0, blue: 0 });
    return {
      red: Math.round((sum.red / history.length) * 10) / 10,
      blue: Math.round((sum.blue / history.length) * 10) / 10
    };
  }

  /* ---------------- landing ---------------- */
  function renderLanding() {
    $app.innerHTML = "";
    $app.appendChild(el(`
      <div class="landing">
        <div class="hero">
          <div class="kicker">高三一轮复习公开课</div>
          <h1>基因的表达<br>快问快答 · 红蓝 PK</h1>
          <p class="sub">转录 · 翻译 · 途径 1　　共 ${TOTAL} 题　　台上抢答计分，台下按正确率统计</p>
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
          <p class="hint">教师用一体机或投影打开本页，点击「我是教师，发起 PK」。台上两位同学看左右两边的题目：先按中间「抢答」，再在自己一侧点选答案。台下同学用手机或平板扫码（或输入房间号），选择红队或蓝队，在座位上同步作答。台上按抢答与补答计分；台下看各队正确率，人数不等也同样公平。</p>
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

  function freshBuzz() {
    return {
      step: "wait-buzz", // wait-buzz | wait-answer | answered | revealed-wrong | wait-rebound | done
      team: null,
      choice: null,
      ok: null,
      reboundTeam: null,
      reboundChoice: null,
      reboundOk: null,
      awarded: { red: 0, blue: 0 },
      historyPushed: false
    };
  }

  function stageWinnerLabel(score) {
    if (score.red === score.blue) return { text: "台上平局", color: "var(--gold)" };
    if (score.red > score.blue) return { text: "台上胜出：红队", color: "var(--red-2)" };
    return { text: "台上胜出：蓝队", color: "var(--blue-2)" };
  }

  /* ---------------- host ---------------- */
  function renderHost(presetRoom) {
    const room = presetRoom || roomCode();
    if (!presetRoom) location.hash = "#/host/" + room;
    const players = {};
    const answers = {}; // playerId -> {qId, choice, ok, round}
    const history = []; // {qid, red, blue}
    const stageScore = { red: 0, blue: 0 };
    let buzz = freshBuzz();
    let phase = "lobby"; // lobby | question | reveal | final
    let qIndex = 0;
    let remain = SECONDS;
    let timer = null;
    let bus = null;
    let demo = false;
    let questionRound = 0;
    let netText = "正在连接答题通道…";

    $app.innerHTML = "";
    $app.appendChild(el(`
      <div class="host host-fill is-lobby" id="host-root">
        <div class="board">
          <section class="side-panel red" id="panel-red"></section>
          <section class="mid-panel" id="panel-mid">
            <div class="mid-top" id="mid-top"></div>
            <div class="mid-scores" id="mid-scores"></div>
            <div id="mid-body"></div>
            <div class="buzz-wrap" id="buzz-wrap"></div>
            <div class="buzz-status" id="buzz-status"></div>
            <div class="mid-explain hidden" id="mid-explain"></div>
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
        <div class="teacher-bar" id="teacher-bar"></div>
      </div>
    `));

    const url = studentUrl(room);
    try { new QRCode($("#qrbox"), { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M }); }
    catch (e) { $("#qrbox").textContent = url; }

    function setDot(on, text) {
      const d = $("#dot");
      d.classList.toggle("on", on);
      d.classList.toggle("off", !on);
      if (text) netText = text;
      const net = $("#net-status");
      if (net) net.textContent = netText;
    }

    function count(team) {
      return Object.values(players).filter((p) => p.team === team).length;
    }
    function currentRates() {
      if (phase === "lobby") return { red: { n: count("red"), ok: 0, answered: 0, rate: 0 }, blue: { n: count("blue"), ok: 0, answered: 0, rate: 0 } };
      const q = QUESTIONS[Math.min(qIndex, TOTAL - 1)];
      return teamStats(players, answers, q.id);
    }

    function snapshot() {
      const q = QUESTIONS[qIndex] || QUESTIONS[0];
      return {
        type: "state",
        phase,
        qIndex,
        qId: q.id,
        remain,
        deadline: Date.now() + remain * 1000,
        total: TOTAL,
        round: questionRound,
        players: Object.values(players).map((p) => ({ id: p.id, name: p.name, team: p.team })),
        rates: currentRates(),
        history,
        totals: avgRates(history),
        stageScore: { red: stageScore.red, blue: stageScore.blue },
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

    function startTicker() {
      stopTimer();
      remain = SECONDS;
      timer = setInterval(() => {
        if (remain > 0) remain -= 1;
        const tEl = $("#timer");
        if (tEl) {
          tEl.textContent = remain;
          tEl.classList.toggle("warn", remain <= 5);
        }
        // 计时仅作提示，到 0 不自动揭晓，节奏由教师控制
      }, 1000);
    }

    function answersClearForCurrent() {
      const qid = QUESTIONS[qIndex].id;
      Object.keys(answers).forEach((id) => {
        if (answers[id].qId === qid) delete answers[id];
      });
    }

    function startQuestion() {
      stopTimer();
      phase = "question";
      buzz = freshBuzz();
      answersClearForCurrent();
      questionRound += 1;
      startTicker();
      paintAll();
      publish(true);
    }

    function undoAwardsAndHistory() {
      stageScore.red -= buzz.awarded.red;
      stageScore.blue -= buzz.awarded.blue;
      buzz.awarded = { red: 0, blue: 0 };
      if (buzz.historyPushed) {
        const last = history[history.length - 1];
        if (last && last.qid === QUESTIONS[qIndex].id) history.pop();
        buzz.historyPushed = false;
      }
    }

    function pushAudienceHistory() {
      if (buzz.historyPushed) return;
      const st = currentRates();
      history.push({ qid: QUESTIONS[qIndex].id, red: st.red.rate, blue: st.blue.rate });
      buzz.historyPushed = true;
    }

    function award(team, pts) {
      if (!team || !pts) return;
      stageScore[team] += pts;
      buzz.awarded[team] += pts;
    }

    function reveal() {
      const q = QUESTIONS[qIndex];
      if (phase === "question" && buzz.step === "answered") {
        stopTimer();
        phase = "reveal";
        pushAudienceHistory();
        if (buzz.ok) {
          award(buzz.team, 10);
          buzz.step = "done";
        } else {
          buzz.step = "revealed-wrong";
        }
        paintAll();
        publish(true);
        return;
      }
      if (phase === "question") {
        // 尚未抢答或尚未点选，教师仍可直接揭晓讲评（台上本题不得分）
        stopTimer();
        phase = "reveal";
        pushAudienceHistory();
        buzz.step = "done";
        paintAll();
        publish(true);
        return;
      }
      if (phase === "reveal" && buzz.step === "revealed-wrong") {
        // 跳过补答，公布答案与解析
        buzz.step = "done";
        paintAll();
        publish(true);
      }
    }

    function offerRebound() {
      if (buzz.step !== "revealed-wrong" || !buzz.team) return;
      buzz.reboundTeam = buzz.team === "red" ? "blue" : "red";
      buzz.reboundChoice = null;
      buzz.reboundOk = null;
      buzz.step = "wait-rebound";
      paintAll();
    }

    function onStageChoice(team, choice) {
      const q = QUESTIONS[qIndex];
      if (buzz.step === "wait-answer" && phase === "question") {
        buzz.team = team;
        buzz.choice = choice;
        buzz.ok = choice === q.answer;
        buzz.step = "answered";
        paintAll();
        return;
      }
      if (buzz.step === "wait-rebound" && team === buzz.reboundTeam) {
        buzz.reboundChoice = choice;
        buzz.reboundOk = choice === q.answer;
        if (buzz.reboundOk) award(team, 5);
        buzz.step = "done";
        paintAll();
        publish(true);
      }
    }

    function reBuzz() {
      if (phase === "lobby" || phase === "final") return;
      undoAwardsAndHistory();
      stopTimer();
      phase = "question";
      answersClearForCurrent();
      questionRound += 1;
      buzz = freshBuzz();
      startTicker();
      paintAll();
      publish(true);
    }

    function next() {
      if (qIndex >= TOTAL - 1) {
        stopTimer();
        phase = "final";
        paintAll();
        publish(true);
        return;
      }
      qIndex += 1;
      startQuestion();
    }

    function restartSameRoom() {
      history.length = 0;
      Object.keys(answers).forEach((k) => delete answers[k]);
      stageScore.red = 0;
      stageScore.blue = 0;
      buzz = freshBuzz();
      qIndex = 0;
      questionRound += 1;
      phase = "lobby";
      remain = SECONDS;
      stopTimer();
      paintAll();
      publish(true);
    }

    function optionClass(team, key, q) {
      const picked = (buzz.team === team && buzz.choice === key);
      const reboundPicked = (buzz.reboundTeam === team && buzz.reboundChoice === key);
      const showAnswer = buzz.step === "done";
      const showFirstWrong = (buzz.step === "revealed-wrong" || buzz.step === "wait-rebound" || buzz.step === "done") && picked && buzz.ok === false;
      let mode = "locked";
      if (phase === "question" && buzz.step === "wait-buzz") mode = "idle";
      else if (phase === "question" && buzz.step === "wait-answer") mode = "ready";
      else if (buzz.step === "wait-rebound" && team === buzz.reboundTeam && !buzz.reboundChoice) mode = "ready";
      else mode = "locked";

      const cls = ["opt-btn", mode];
      if (picked || reboundPicked) cls.push("picked");
      if (showFirstWrong || (showAnswer && reboundPicked && buzz.reboundOk === false)) cls.push("wrong");
      if (showAnswer && key === q.answer) cls.push("correct");
      return cls.join(" ");
    }

    function optionModeAllowsClick(team) {
      if (phase === "question" && buzz.step === "wait-answer") return true;
      if (buzz.step === "wait-rebound" && team === buzz.reboundTeam && !buzz.reboundChoice) return true;
      return false;
    }

    function renderOptions(team, q) {
      const items = q.type === "tf"
        ? [{ k: "T", lab: "对" }, { k: "F", lab: "错" }]
        : Object.keys(q.options).map((k) => ({ k, lab: k + "　" + q.options[k] }));
      return `<div class="panel-opts">` + items.map((it) =>
        `<button type="button" class="${optionClass(team, it.k, q)}" data-team="${team}" data-k="${it.k}">
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
          if (!optionModeAllowsClick(team)) return;
          onStageChoice(team, btn.getAttribute("data-k"));
        };
      });
    }

    function teamLabel(t) { return t === "red" ? "红队" : "蓝队"; }

    function paintSides() {
      const red = $("#panel-red");
      const blue = $("#panel-blue");
      const cur = currentRates();
      const tot = avgRates(history);

      function waitCopy(team) {
        const n = count(team);
        return `<div class="panel-wait">台上同学本题将在此作答。<br>台下已加入 ${n} 人，请扫中间二维码入队。</div>`;
      }

      if (phase === "lobby") {
        red.innerHTML = `<div class="panel-hd"><div class="team-name">红队</div><div class="stage-pts"><div class="lab">台上得分</div><div class="num">0</div></div></div>${waitCopy("red")}`;
        blue.innerHTML = `<div class="panel-hd"><div class="team-name">蓝队</div><div class="stage-pts"><div class="lab">台上得分</div><div class="num">0</div></div></div>${waitCopy("blue")}`;
        red.classList.remove("is-active", "is-dim");
        blue.classList.remove("is-active", "is-dim");
        return;
      }

      if (phase === "final") {
        red.innerHTML = `
          <div class="panel-hd"><div class="team-name">红队</div><div class="stage-pts"><div class="lab">台上得分</div><div class="num">${stageScore.red}</div></div></div>
          <div class="final-side-note">台下正确率<br><b>${tot.red}%</b><br><span style="opacity:.85;font-size:16px">${count("red")} 人 · 未作答记入不正确</span></div>`;
        blue.innerHTML = `
          <div class="panel-hd"><div class="team-name">蓝队</div><div class="stage-pts"><div class="lab">台上得分</div><div class="num">${stageScore.blue}</div></div></div>
          <div class="final-side-note">台下正确率<br><b>${tot.blue}%</b><br><span style="opacity:.85;font-size:16px">${count("blue")} 人 · 未作答记入不正确</span></div>`;
        const wr = stageScore.red > stageScore.blue;
        const wb = stageScore.blue > stageScore.red;
        red.classList.toggle("is-active", wr);
        blue.classList.toggle("is-active", wb);
        red.classList.toggle("is-dim", wb);
        blue.classList.toggle("is-dim", wr);
        return;
      }

      const q = QUESTIONS[qIndex];
      const activeTeam = buzz.step === "wait-rebound" ? buzz.reboundTeam : buzz.team;
      const showActive = !!(activeTeam && buzz.step !== "wait-buzz");
      ["red", "blue"].forEach((team) => {
        const panel = team === "red" ? red : blue;
        panel.innerHTML = `
          <div class="panel-hd">
            <div class="team-name">${teamLabel(team)}</div>
            <div class="stage-pts"><div class="lab">台上得分</div><div class="num">${stageScore[team]}</div></div>
          </div>
          <div class="panel-stem">${esc(q.stem)}</div>
          ${renderOptions(team, q)}`;
        bindOptions(panel, team);
        const isOn = showActive && activeTeam === team;
        const isOff = showActive && activeTeam !== team && (buzz.step === "answered" || buzz.step === "revealed-wrong" || buzz.step === "wait-rebound" || buzz.step === "done");
        panel.classList.toggle("is-active", isOn);
        panel.classList.toggle("is-dim", isOff);
      });
    }

    function paintMid() {
      const root = $("#host-root");
      root.classList.toggle("is-lobby", phase === "lobby");
      root.classList.toggle("is-play", phase === "question" || phase === "reveal");
      root.classList.toggle("is-final", phase === "final");

      const midTop = $("#mid-top");
      const midBody = $("#mid-body");
      const midScores = $("#mid-scores");
      const buzzWrap = $("#buzz-wrap");
      const buzzStatus = $("#buzz-status");
      const expl = $("#mid-explain");
      const aud = $("#mid-audience");
      const q = QUESTIONS[Math.min(qIndex, TOTAL - 1)];
      const cur = currentRates();
      const tot = avgRates(history);

      midScores.innerHTML = `
        <div class="mid-score red"><div class="lab">红队台上得分</div><div class="num">${stageScore.red}</div></div>
        <div class="mid-score blue"><div class="lab">蓝队台上得分</div><div class="num">${stageScore.blue}</div></div>`;

      if (phase === "lobby") {
        midTop.innerHTML = `<div class="q-tag">准备就绪</div>`;
        midBody.innerHTML = `
          <div class="lobby-copy">
            <h2>请台下同学扫码加入</h2>
            <p>台上两位同学分别站在红队、蓝队一侧。开始后，先按中间「抢答」，再在本队一侧点选答案。<br>台下同学扫码或输入房间号，选队后在手机上同步作答。</p>
          </div>`;
        buzzWrap.innerHTML = "";
        buzzStatus.textContent = "";
        buzzStatus.className = "buzz-status";
        expl.classList.add("hidden");
        expl.innerHTML = "";
        aud.innerHTML = `台下已加入　<span class="r">红队 ${count("red")} 人</span>　·　<span class="b">蓝队 ${count("blue")} 人</span>`;
        return;
      }

      if (phase === "final") {
        const w = stageWinnerLabel(stageScore);
        midTop.innerHTML = `<div class="q-tag">全程结束</div>`;
        midBody.innerHTML = `
          <div class="final-mid">
            <div class="winner" style="color:${w.color}">${w.text}</div>
            <div class="scoreline" style="color:var(--red-2)">红队台上 ${stageScore.red} 分</div>
            <div class="scoreline" style="color:var(--blue-2)">蓝队台上 ${stageScore.blue} 分</div>
          </div>`;
        buzzWrap.innerHTML = "";
        buzzStatus.textContent = "";
        buzzStatus.className = "buzz-status";
        expl.classList.add("hidden");
        aud.innerHTML = `台下正确率　<span class="r">红队 <b>${tot.red}%</b></span>　·　<span class="b">蓝队 <b>${tot.blue}%</b></span><br>未作答记入不正确，已扣除人数差的影响。`;
        return;
      }

      midTop.innerHTML = `
        <div class="q-tag">第 ${qIndex + 1} / ${TOTAL} 题　　${esc(q.tag)}</div>
        ${phase === "question" ? `<div class="timer ${remain <= 5 ? "warn" : ""}" id="timer">${remain}</div>` : `<div class="timer idle">揭晓</div>`}`;
      midBody.innerHTML = "";

      const canBuzz = phase === "question" && buzz.step === "wait-buzz";
      let buzzLabel = "抢答";
      let buzzCls = "buzz-btn";
      if (canBuzz) buzzCls += " is-ready";
      if (buzz.step === "wait-answer") { buzzLabel = "请作答"; buzzCls += " is-wait"; }
      else if (buzz.step === "answered") buzzLabel = teamLabel(buzz.team) + "已作答";
      else if (buzz.step === "revealed-wrong") buzzLabel = teamLabel(buzz.team) + "抢答错误";
      else if (buzz.step === "wait-rebound") buzzLabel = teamLabel(buzz.reboundTeam) + "补答中";
      else if (buzz.step === "done" && buzz.team) buzzLabel = "本题结束";
      else if (buzz.step === "done") buzzLabel = "已揭晓";

      buzzWrap.innerHTML = `<button type="button" class="${buzzCls}" id="btn-buzz" ${canBuzz ? "" : "disabled"}>${buzzLabel}</button>`;
      const bz = $("#btn-buzz");
      if (bz) bz.onclick = () => {
        if (!(phase === "question" && buzz.step === "wait-buzz")) return;
        buzz.step = "wait-answer";
        paintAll();
      };

      buzzStatus.className = "buzz-status";
      if (buzz.step === "wait-buzz") {
        buzzStatus.textContent = "先按「抢答」，再在本队一侧作答";
      } else if (buzz.step === "wait-answer") {
        buzzStatus.textContent = "请作答：左右两侧均可点选，先点中的一队锁定答案";
        buzzStatus.classList.add("ok");
      } else if (buzz.step === "answered") {
        buzzStatus.textContent = teamLabel(buzz.team) + "已作答，请教师揭晓";
        buzzStatus.classList.add(buzz.team);
      } else if (buzz.step === "revealed-wrong") {
        buzzStatus.textContent = teamLabel(buzz.team) + "抢答错误，得 0 分。可请对方补答。";
        buzzStatus.classList.add("no");
      } else if (buzz.step === "wait-rebound") {
        buzzStatus.textContent = teamLabel(buzz.reboundTeam) + "补答中，请在该队一侧点选";
        buzzStatus.classList.add(buzz.reboundTeam);
      } else if (buzz.team && buzz.ok) {
        buzzStatus.textContent = teamLabel(buzz.team) + "抢答正确，+10 分";
        buzzStatus.classList.add("ok");
      } else if (buzz.reboundTeam && buzz.reboundOk) {
        buzzStatus.textContent = teamLabel(buzz.team) + "抢答错误；" + teamLabel(buzz.reboundTeam) + "补答正确，+5 分";
        buzzStatus.classList.add("ok");
      } else if (buzz.reboundTeam && buzz.reboundOk === false) {
        buzzStatus.textContent = teamLabel(buzz.team) + "抢答错误；" + teamLabel(buzz.reboundTeam) + "补答错误，均得 0 分";
        buzzStatus.classList.add("no");
      } else if (buzz.team && buzz.ok === false) {
        buzzStatus.textContent = teamLabel(buzz.team) + "抢答错误，得 0 分";
        buzzStatus.classList.add("no");
      } else {
        buzzStatus.textContent = "本题台上未抢答，台上不得分";
      }

      const showExplain = buzz.step === "done";
      if (showExplain) {
        expl.classList.remove("hidden");
        expl.innerHTML = `<b>解析　</b>${esc(q.explain)}`;
      } else {
        expl.classList.add("hidden");
        expl.innerHTML = "";
      }

      if (phase === "question") {
        aud.innerHTML = `台下已作答　<span class="r">红队 <b>${cur.red.answered}/${cur.red.n}</b></span>　·　<span class="b">蓝队 <b>${cur.blue.answered}/${cur.blue.n}</b></span><br>揭晓后公布台下正确率，未作答记入不正确。`;
      } else {
        aud.innerHTML = `台下正确率　<span class="r">红队 <b>${cur.red.rate}%</b>（${cur.red.ok}/${cur.red.n}）</span>　·　<span class="b">蓝队 <b>${cur.blue.rate}%</b>（${cur.blue.ok}/${cur.blue.n}）</span>`;
      }
    }

    function paintBar() {
      const bar = $("#teacher-bar");
      let actions = "";
      if (phase === "lobby") {
        actions = `<button type="button" class="btn btn-teach btn-gold" id="btn-start">开始本题</button>`;
      } else if (phase === "final") {
        actions = `<button type="button" class="btn btn-teach btn-ghost" id="btn-again">再来一局（同一房间）</button>`;
      } else {
        if (buzz.step === "revealed-wrong") {
          actions += `<button type="button" class="btn btn-teach btn-ok" id="btn-rebound">对方补答</button>`;
          actions += `<button type="button" class="btn btn-teach btn-gold" id="btn-lock">揭晓</button>`;
        } else if (buzz.step !== "done") {
          actions += `<button type="button" class="btn btn-teach btn-gold" id="btn-lock">揭晓</button>`;
        }
        if (buzz.step === "done") {
          actions += `<button type="button" class="btn btn-teach btn-gold" id="btn-next">${qIndex >= TOTAL - 1 ? "查看最终得分" : "下一题"}</button>`;
        }
        actions += `<button type="button" class="btn btn-teach" id="btn-rebuzz">重抢</button>`;
      }
      bar.innerHTML = `
        <div class="bar-left">
          <span class="bar-lab">教师操作</span>
          <span class="net" id="net-status">${esc(netText)}</span>
        </div>
        <div class="bar-right">${actions}</div>`;
      const start = $("#btn-start"); if (start) start.onclick = startQuestion;
      const lock = $("#btn-lock"); if (lock) lock.onclick = reveal;
      const nx = $("#btn-next"); if (nx) nx.onclick = next;
      const rb = $("#btn-rebuzz"); if (rb) rb.onclick = reBuzz;
      const bd = $("#btn-rebound"); if (bd) bd.onclick = offerRebound;
      const ag = $("#btn-again"); if (ag) ag.onclick = restartSameRoom;
    }

    function paintAll() {
      paintSides();
      paintMid();
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
      if (msg.type === "answer" && msg.id && players[msg.id] && phase === "question") {
        const q = QUESTIONS[qIndex];
        if (msg.qId !== q.id) return;
        const choice = String(msg.choice || "");
        const ok = choice === q.answer;
        answers[msg.id] = { qId: q.id, choice, ok, round: questionRound };
        paintAll();
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
        setDot(false, "答题通道暂时连不上。大屏仍可出题、抢答与讲评；请检查网络后刷新本页重试。");
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
    let me = JSON.parse(localStorage.getItem("gxpk-me") || "null") || { id: uid("s") };
    if (!me.id) me.id = uid("s");
    let state = null;
    let myAnswer = null;
    let bus = null;
    let tick = null;
    let lastPaintKey = "";

    function remainNow() {
      if (!state || state.phase !== "question") return 0;
      if (state.deadline) return Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
      return state.remain ?? 0;
    }
    function stopTick() { if (tick) { clearInterval(tick); tick = null; } }
    function startTick() {
      stopTick();
      tick = setInterval(() => {
        const lab = document.getElementById("remain-lab");
        if (!lab || !state || state.phase !== "question") return;
        lab.textContent = "还剩 " + remainNow() + " 秒";
      }, 250);
    }

    $app.innerHTML = "";
    $app.appendChild(el(`
      <div class="play">
        <div class="play-hd">
          <div class="kicker">房间 ${esc(room)}</div>
          <h2>快问快答</h2>
          <p class="sub" id="play-sub">先选队伍，再等待老师出题</p>
        </div>
        <div id="play-body"></div>
      </div>
    `));

    function saveMe() { localStorage.setItem("gxpk-me", JSON.stringify({ id: me.id, name: me.name, team: me.team })); }

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
      if (state.phase === "final") {
        stopTick();
        const tot = state.totals || { red: 0, blue: 0 };
        const ss = state.stageScore || { red: 0, blue: 0 };
        const w = stageWinnerLabel(ss);
        body.innerHTML = `
          <div class="card final">
            <div class="winner" style="color:${w.color}">${w.text}</div>
            <div class="scoreline" style="color:var(--red-2)">红队台上 ${ss.red} 分</div>
            <div class="scoreline" style="color:var(--blue-2)">蓝队台上 ${ss.blue} 分</div>
            <p class="sub" style="margin-top:16px">台下正确率</p>
            <div class="scoreline" style="color:var(--red-2);font-size:22px">红队 ${tot.red}%</div>
            <div class="scoreline" style="color:var(--blue-2);font-size:22px">蓝队 ${tot.blue}%</div>
          </div>`;
        return;
      }

      const q = QUESTIONS[state.qIndex];
      if (!q) return;
      const revealed = state.phase === "reveal";
      const mine = myAnswer && myAnswer.qId === q.id && myAnswer.round === state.round ? myAnswer : null;
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
      const fb = revealed && mine
        ? `<div class="feedback ${mine.choice === q.answer ? "ok" : "no"}">${mine.choice === q.answer ? "回答正确" : "本轮未答对"}</div>`
        : (revealed ? `<div class="feedback no">本题未作答</div>` : "");
      const exp = revealed ? `<div class="explain"><b>解析　</b>${esc(q.explain)}</div>` : "";
      body.innerHTML = `
        <div class="card">
          <div class="q-tag">第 ${state.qIndex + 1} / ${TOTAL} 题　　${esc(q.tag)}</div>
          <div class="q-stem" style="font-size:26px">${esc(q.stem)}</div>
          ${!revealed ? `<p class="tiny" id="remain-lab" style="text-align:left;margin:10px 0 0">还剩 ${remainNow()} 秒</p>` : ""}
          ${grid}
          ${fb}
          ${exp}
        </div>`;
      body.querySelectorAll(".choice").forEach((btn) => {
        const k = btn.getAttribute("data-k");
        if (mine && mine.choice === k) btn.classList.add("picked");
        if (revealed && k === q.answer) btn.classList.add("ok");
        if (revealed && mine && mine.choice === k && k !== q.answer) btn.classList.add("no");
        btn.disabled = revealed;
        btn.onclick = () => {
          if (revealed || (state && state.phase !== "question")) return;
          myAnswer = { qId: q.id, choice: k, round: state.round };
          if (bus) bus.pubChat({ type: "answer", id: me.id, qId: q.id, choice: k, round: state.round });
          lastPaintKey = "";
          paint();
        };
      });
      if (!revealed) startTick();
      else stopTick();
    }

    paint();
    bus = connectBus(room, (msg) => {
      if (msg && msg.type === "state") {
        state = msg;
        if (state.phase === "question") {
          const q = QUESTIONS[state.qIndex];
          if (q && myAnswer && (myAnswer.qId !== q.id || myAnswer.round !== state.round)) myAnswer = null;
        }
        const key = [state.phase, state.qIndex, state.round, myAnswer && myAnswer.choice].join(":");
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
