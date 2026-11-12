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
          <p class="sub">转录 · 翻译 · 途径 1　　共 ${TOTAL} 题　　按正确率计分</p>
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
          <p class="hint">教师用大屏出题并展示二维码。学生用手机或平板扫码，选红队或蓝队作答。没有 iPad 的同学也可以用手机参加。计分看正确率，两队人数不等也同样公平。</p>
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

  /* ---------------- host ---------------- */
  function renderHost(presetRoom) {
    const room = presetRoom || roomCode();
    if (!presetRoom) location.hash = "#/host/" + room;
    const players = {};
    const answers = {}; // playerId -> {qId, choice, ok}
    const history = []; // {qid, red, blue}
    let phase = "lobby"; // lobby | question | reveal | final
    let qIndex = 0;
    let remain = SECONDS;
    let timer = null;
    let bus = null;
    let demo = false;

    $app.innerHTML = "";
    $app.appendChild(el(`
      <div class="host">
        <div class="topbar">
          <div class="brand">基因的表达 · 快问快答<small>教师大屏　　房间号用于学生扫码加入</small></div>
          <div class="room-chip">
            <span class="status-dot off" id="dot"></span>
            <span>房间</span><b id="room-no">${esc(room)}</b>
          </div>
        </div>
        <div class="host-grid">
          <aside class="side">
            <div class="card">
              <div id="qrbox"></div>
              <p class="tiny" id="stu-url"></p>
              <p>学生扫码后选择红队或蓝队即可作答</p>
            </div>
            <div class="score-row">
              <div class="team-card red">
                <div class="lab">红队正确率</div>
                <div class="big" id="red-big">0%</div>
                <div class="meta" id="red-meta">0 人</div>
              </div>
              <div class="team-card blue">
                <div class="lab">蓝队正确率</div>
                <div class="big" id="blue-big">0%</div>
                <div class="meta" id="blue-meta">0 人</div>
              </div>
            </div>
            <div class="card" style="padding:14px 16px">
              <div class="tiny" id="net-status" style="text-align:left">正在连接答题通道…</div>
            </div>
          </aside>
          <section class="card stage" id="stage"></section>
        </div>
      </div>
    `));

    const url = studentUrl(room);
    $("#stu-url").textContent = url;
    try { new QRCode($("#qrbox"), { text: url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M }); }
    catch (e) { $("#qrbox").textContent = url; }

    function setDot(on, text) {
      const d = $("#dot");
      d.classList.toggle("on", on);
      d.classList.toggle("off", !on);
      if (text) $("#net-status").textContent = text;
    }

    function currentRates() {
      if (phase === "lobby") return { red: { n: count("red"), ok: 0, answered: 0, rate: 0 }, blue: { n: count("blue"), ok: 0, answered: 0, rate: 0 } };
      const q = QUESTIONS[Math.min(qIndex, TOTAL - 1)];
      return teamStats(players, answers, q.id);
    }
    function count(team) {
      return Object.values(players).filter((p) => p.team === team).length;
    }
    function totals() {
      const cur = (phase === "reveal" || phase === "question") ? currentRates() : null;
      const hist = history.slice();
      if (phase === "reveal" && cur) {
        // already pushed after reveal; don't double
      }
      return avgRates(history);
    }
    function paintScores() {
      const cur = currentRates();
      const tot = avgRates(history);
      if (phase === "lobby") {
        $("#red-big").textContent = count("red") + " 人";
        $("#blue-big").textContent = count("blue") + " 人";
        $("#red-meta").textContent = "已加入，等待开始";
        $("#blue-meta").textContent = "已加入，等待开始";
      } else if (phase === "question") {
        $("#red-big").textContent = cur.red.answered + "/" + cur.red.n;
        $("#blue-big").textContent = cur.blue.answered + "/" + cur.blue.n;
        $("#red-meta").textContent = "已作答（揭晓后计算正确率）";
        $("#blue-meta").textContent = "已作答（揭晓后计算正确率）";
      } else if (phase === "reveal") {
        $("#red-big").textContent = cur.red.rate + "%";
        $("#blue-big").textContent = cur.blue.rate + "%";
        $("#red-meta").textContent = cur.red.ok + "/" + cur.red.n + " 答对 · 未作答记入不正确";
        $("#blue-meta").textContent = cur.blue.ok + "/" + cur.blue.n + " 答对 · 未作答记入不正确";
      } else {
        $("#red-big").textContent = tot.red + "%";
        $("#blue-big").textContent = tot.blue + "%";
        $("#red-meta").textContent = "全程平均正确率 · " + count("red") + " 人";
        $("#blue-meta").textContent = "全程平均正确率 · " + count("blue") + " 人";
      }
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
        players: Object.values(players).map((p) => ({ id: p.id, name: p.name, team: p.team })),
        rates: currentRates(),
        history,
        totals: avgRates(history),
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

    function startQuestion() {
      stopTimer();
      phase = "question";
      answersClearForCurrent();
      remain = SECONDS;
      paintStage();
      publish(true);
      timer = setInterval(() => {
        remain -= 1;
        const tEl = $("#timer");
        if (tEl) {
          tEl.textContent = remain;
          tEl.classList.toggle("warn", remain <= 5);
        }
        if (remain <= 0) reveal();
      }, 1000);
    }
    function answersClearForCurrent() {
      const qid = QUESTIONS[qIndex].id;
      Object.keys(answers).forEach((id) => {
        if (answers[id].qId === qid) delete answers[id];
      });
    }

    function reveal() {
      if (phase !== "question") return;
      stopTimer();
      phase = "reveal";
      const st = currentRates();
      history.push({ qid: QUESTIONS[qIndex].id, red: st.red.rate, blue: st.blue.rate });
      paintStage();
      publish(true);
    }

    function next() {
      if (qIndex >= TOTAL - 1) {
        phase = "final";
        paintStage();
        publish(true);
        return;
      }
      qIndex += 1;
      startQuestion();
    }

    function optClass(key, q, revealed) {
      if (!revealed) return "";
      return key === q.answer ? "correct" : "";
    }

    function paintStage() {
      const stage = $("#stage");
      paintScores();
      if (phase === "lobby") {
        stage.innerHTML = `
          <div class="q-tag">准备就绪</div>
          <div class="q-stem">请学生扫左侧二维码，选择红队或蓝队。</div>
          <p class="sub" style="margin-top:16px">共 ${TOTAL} 道题，每题 ${SECONDS} 秒。计分看各队正确率（答对人数 ÷ 本队人数），未作答记为不正确，人数不等也不吃亏。</p>
          <div class="controls">
            <button class="btn btn-gold" id="btn-start">人数到齐，开始第 1 题</button>
          </div>`;
        $("#btn-start").onclick = startQuestion;
        return;
      }
      if (phase === "final") {
        const tot = avgRates(history);
        const winner = tot.red === tot.blue ? "平局！" : (tot.red > tot.blue ? "红队胜出！" : "蓝队胜出！");
        const wcolor = tot.red === tot.blue ? "var(--gold)" : (tot.red > tot.blue ? "var(--red-2)" : "var(--blue-2)");
        stage.innerHTML = `
          <div class="final">
            <div class="q-tag">全程结束</div>
            <div class="winner" style="color:${wcolor}">${winner}</div>
            <div class="scoreline" style="color:var(--red-2)">红队平均正确率 ${tot.red}%</div>
            <div class="scoreline" style="color:var(--blue-2)">蓝队平均正确率 ${tot.blue}%</div>
            <p class="sub" style="margin-top:18px">按正确率计分，已经扣除了人数差的影响。</p>
            <div class="controls" style="justify-content:center">
              <button class="btn btn-ghost" id="btn-again">再来一局（同一房间）</button>
            </div>
          </div>`;
        $("#btn-again").onclick = () => {
          history.length = 0;
          Object.keys(answers).forEach((k) => delete answers[k]);
          qIndex = 0;
          phase = "lobby";
          paintStage();
          publish(true);
        };
        return;
      }

      const q = QUESTIONS[qIndex];
      const revealed = phase === "reveal";
      let opts = "";
      if (q.type === "tf") {
        opts = `
          <div class="options">
            <div class="tf-opt ${revealed && q.answer === "T" ? "correct" : ""}"><span class="key">√</span><span>正确</span></div>
            <div class="tf-opt ${revealed && q.answer === "F" ? "correct" : ""}"><span class="key">×</span><span>错误</span></div>
          </div>`;
      } else {
        opts = `<div class="options">` + Object.keys(q.options).map((k) =>
          `<div class="opt ${optClass(k, q, revealed)}"><span class="key">${k}</span><span>${esc(q.options[k])}</span></div>`
        ).join("") + `</div>`;
      }
      stage.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px">
          <div class="q-tag">第 ${qIndex + 1} / ${TOTAL} 题　　${esc(q.tag)}</div>
          ${phase === "question" ? `<div class="timer ${remain <= 5 ? "warn" : ""}" id="timer">${remain}</div>` : ""}
        </div>
        <div class="q-stem">${esc(q.stem)}</div>
        ${opts}
        ${revealed ? `<div class="explain"><b>解析　</b>${esc(q.explain)}</div>` : ""}
        <div class="controls">
          ${phase === "question" ? `<button class="btn btn-gold" id="btn-lock">提前锁定并揭晓</button>` : ""}
          ${phase === "reveal" ? `<button class="btn btn-gold" id="btn-next">${qIndex >= TOTAL - 1 ? "查看最终得分" : "下一题"}</button>` : ""}
        </div>`;
      const lock = $("#btn-lock"); if (lock) lock.onclick = reveal;
      const nx = $("#btn-next"); if (nx) nx.onclick = next;
    }

    function onChat(msg) {
      if (!msg || !msg.type) return;
      if (msg.type === "join" && msg.id && (msg.team === "red" || msg.team === "blue")) {
        players[msg.id] = { id: msg.id, name: String(msg.name || "同学").slice(0, 12), team: msg.team, at: Date.now() };
        paintScores();
        publish();
      }
      if (msg.type === "leave" && msg.id) {
        delete players[msg.id];
        delete answers[msg.id];
        paintScores();
        publish();
      }
      if (msg.type === "answer" && msg.id && players[msg.id] && phase === "question") {
        const q = QUESTIONS[qIndex];
        if (msg.qId !== q.id) return;
        const choice = String(msg.choice || "");
        const ok = choice === q.answer;
        answers[msg.id] = { qId: q.id, choice, ok };
        paintScores();
        // light publish so other screens update counts, but not too often
      }
      if (msg.type === "hello") publish();
    }

    paintStage();
    bus = connectBus(room, (msg) => {
      if (msg && msg.type === "state") return; // ignore own / others
      onChat(msg);
    }, (st, url) => {
      if (st === "on") {
        demo = false;
        setDot(true, "答题通道已接通，学生扫码即可加入。");
        publish();
      } else if (st === "connecting") {
        setDot(false, "正在连接答题通道…");
      } else if (st === "error" || st === "off") {
        demo = true;
        setDot(false, "答题通道暂时连不上。大屏仍可出题讲评；请检查网络后刷新本页重试。");
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
        const winner = tot.red === tot.blue ? "本局平局" : (tot.red > tot.blue ? "红队胜出" : "蓝队胜出");
        body.innerHTML = `
          <div class="card final">
            <div class="winner">${winner}</div>
            <div class="scoreline" style="color:var(--red-2)">红队 ${tot.red}%</div>
            <div class="scoreline" style="color:var(--blue-2)">蓝队 ${tot.blue}%</div>
          </div>`;
        return;
      }

      const q = QUESTIONS[state.qIndex];
      if (!q) return;
      const revealed = state.phase === "reveal";
      const mine = myAnswer && myAnswer.qId === q.id ? myAnswer : null;
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
          myAnswer = { qId: q.id, choice: k };
          if (bus) bus.pubChat({ type: "answer", id: me.id, qId: q.id, choice: k });
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
          if (q && myAnswer && myAnswer.qId !== q.id) myAnswer = null;
        }
        const key = [state.phase, state.qIndex, myAnswer && myAnswer.choice].join(":");
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
