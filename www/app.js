"use strict";

/* =========================================================
 * 单机 AI 德州 —— 界面编排：渲染牌桌、驱动 AI、概率、教练、存档
 * ========================================================= */
(function () {
  const C = window.PokerCore;
  const O = window.PokerOdds;
  const AI = window.PokerAI;
  const Coach = window.PokerCoach;

  const $ = id => document.getElementById(id);
  window.onerror = function (msg, src, line) {
    try {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;top:0;left:0;right:0;background:#b23b3b;color:#fff;padding:10px 14px;font-size:13px;z-index:99999;white-space:pre-wrap";
      d.textContent = "⚠️ 出错了：" + msg + (line ? "（第 " + line + " 行）" : "");
      document.body.appendChild(d);
    } catch (e) {}
  };
  let game = null;
  let busy = false;
  let raiseMode = false, raiseAmount = 0;
  let oddsCache = null, oddsKey = "";
  let settings = loadSettings();

  /* ---------------- 工具 ---------------- */
  function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function cardHTML(c) {
    const red = C.SUIT_RED[c.suit];
    return '<div class="card' + (red ? " red" : "") + '">' +
      '<span class="c-top">' + C.RANK_STR[c.rank] + '<span class="s">' + C.SUIT_SYM[c.suit] + '</span></span>' +
      '<span class="c-mid">' + C.SUIT_SYM[c.suit] + '</span></div>';
  }
  function cardBack() { return '<div class="card back"></div>'; }

  /* ---------------- 设置 ---------------- */
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function storeDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function loadSettings() {
    try {
      const s = JSON.parse(storeGet("poker_settings"));
      if (s) return s;
    } catch (e) {}
    return { chips: 1000, sb: 10, bb: 20, ante: 0, level: "medium" };
  }
  function saveSettings() {
    storeSet("poker_settings", JSON.stringify(settings));
  }

  /* ---------------- 存档 ---------------- */
  function save() {
    if (game && !game.gameOver) storeSet("poker_save", C.serialize(game));
    else storeDel("poker_save");
  }
  function hasSave() { return !!storeGet("poker_save"); }

  /* ---------------- 开局 / 续局 ---------------- */
  function readSettingsFromUI() {
    settings = {
      chips: clampInt($("setChips").value, 100, 1000000, 1000),
      sb: clampInt($("setSB").value, 1, 100000, 10),
      bb: clampInt($("setBB").value, 1, 100000, 20),
      ante: clampInt($("setAnte").value, 0, 100000, 0),
      level: document.querySelector("#aiLevel .on").getAttribute("data-level") || "medium"
    };
    if (settings.bb < settings.sb) settings.bb = settings.sb;
    if (settings.chips < settings.bb) settings.chips = settings.bb;
    saveSettings();
  }
  function clampInt(v, min, max, fb) { const n = parseInt(v, 10); return isNaN(n) ? fb : Math.max(min, Math.min(max, n)); }

  function newGame() {
    readSettingsFromUI();
    game = C.createGame({
      startingChips: settings.chips,
      smallBlind: settings.sb,
      bigBlind: settings.bb,
      ante: settings.ante,
      aiLevels: [settings.level, settings.level, settings.level, settings.level, settings.level]
    });
    C.startHand(game);
    raiseMode = false;
    $("menu").classList.remove("on");
    $("game").classList.add("on");
    $("blindInfo").textContent = (settings.ante > 0 ? settings.ante + "+" : "") + settings.sb + "/" + settings.bb;
    save();
    render();
    sync();
  }

  function continueGame() {
    const json = storeGet("poker_save");
    if (!json) return;
    game = C.deserialize(json);
    readSettingsFromUI();
    $("menu").classList.remove("on");
    $("game").classList.add("on");
    $("blindInfo").textContent = (game.config.ante > 0 ? game.config.ante + "+" : "") + game.config.smallBlind + "/" + game.config.bigBlind;
    render();
    sync();
  }

  function backToMenu() {
    save();
    $("game").classList.remove("on");
    $("overlay").classList.remove("on");
    $("menu").classList.add("on");
    $("continueBtn").style.display = hasSave() ? "block" : "none";
  }

  /* ---------------- 驱动 AI ---------------- */
  function sync() {
    if (busy) return;
    busy = true;
    stepAI();
  }
  function stepAI() {
    if (!game || game.handOver || game.gameOver) { busy = false; render(); save(); return; }
    const p = C.currentPlayer(game);
    if (!p) { busy = false; return; }
    if (p.isHuman) {
      busy = false;
      oddsCache = null; oddsKey = "";
      render();
      return;
    }
    render();
    const d = AI.decide(game);
    C.doAction(game, d.type, d.amount);
    render();
    setTimeout(stepAI, 650);
  }

  function humanAction(type, amount) {
    if (busy || !game || game.handOver || game.gameOver) return;
    const p = C.currentPlayer(game);
    if (!p || !p.isHuman) return;
    const analysis = Coach.analyze(game, type, amount);
    C.doAction(game, type, amount);
    raiseMode = false;
    showCoach(analysis);
    render();
    save();
    if (type === "fold") fastForward();
    else sync();
  }

  // 弃牌后立即结算（不再逐条动画播放 AI 对局），避免“看起来像自动开下一局”
  function fastForward() {
    busy = true;
    let guard = 0;
    while (!game.handOver && !game.gameOver && guard < 1000) {
      guard++;
      const p = C.currentPlayer(game);
      if (!p || p.isHuman) break;
      const d = AI.decide(game);
      C.doAction(game, d.type, d.amount);
    }
    busy = false;
    render();
    save();
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!game) return;
    const view = C.getView(game, 0);
    $("handNo").textContent = game.handNumber;
    renderCenter(view);
    renderSeats(view);
    renderInfo();
    renderActions();
    renderOverlay();
  }

  function renderCenter(view) {
    let html = "";
    for (let i = 0; i < 5; i++) {
      html += view.community[i] ? cardHTML(view.community[i]) : '<div class="slot"></div>';
    }
    $("community").innerHTML = html;
    $("pot").innerHTML = "底池 <b>" + view.pot + "</b>";
  }

  function renderSeats(view) {
    const n = view.players.length;
    let html = "";
    for (let i = 0; i < n; i++) {
      const p = view.players[i];
      const angle = Math.PI / 2 + p.seatIndex * (2 * Math.PI / n);
      const x = 50 + 40 * Math.cos(angle);
      const y = 50 + 38 * Math.sin(angle);
      const below = y < 50;

      let cls = "seat" + (below ? "" : " below");
      if (p.folded) cls += " folded";
      else if (p.allIn) cls += " allin";
      else if (p.busted) cls += " busted";
      if (p.isHuman) cls += " you";
      if (!view.handOver && !view.gameOver && view.currentIndex === p.seatIndex && !p.folded && !p.busted) cls += " turn";

      const badges = [];
      if (view.dealerIndex === p.seatIndex) badges.push('<span class="badge">D</span>');
      if (view.sbIndex === p.seatIndex) badges.push('<span class="badge sb">SB</span>');
      if (view.bbIndex === p.seatIndex) badges.push('<span class="badge bb">BB</span>');

      let status = p.folded ? "弃牌" : (p.allIn ? "全下" : (p.busted ? "出局" : ""));

      const cards = p.holeCards ? p.holeCards.map(cardHTML).join("") : cardBack() + cardBack();

      html +=
        '<div class="' + cls + '" style="left:' + x + '%;top:' + y + '%">' +
          '<div class="who">' +
            '<div class="badges">' + badges.join("") + '</div>' +
            '<div class="name">' + esc(p.name) + '</div>' +
            '<div class="chips">🪙 ' + p.chips + '</div>' +
            (p.handName ? '<div style="font-size:10px;color:#ffd9a0">' + esc(p.handName) + '</div>' : '') +
          '</div>' +
          '<div class="hole">' + cards + '</div>' +
          '<div class="bet' + (p.currentBet > 0 ? " on" : "") + '">注 ' + p.currentBet + '</div>' +
          '<div class="status">' + status + '</div>' +
        '</div>';
    }
    $("seats").innerHTML = html;
  }

  /* 信息面板：成牌概率 + 胜率 */
  function renderInfo() {
    if (game.handOver || game.gameOver) { $("oddsList").textContent = "—"; $("equityText").textContent = "—"; return; }
    const p = C.currentPlayer(game);
    if (!p || !p.isHuman) { $("oddsList").textContent = "计算中…"; return; }

    const key = game.handNumber + ":" + game.street + ":" + JSON.stringify(game.players[0].holeCards) + ":" + JSON.stringify(game.community);
    if (!oddsCache || oddsKey !== key) {
      oddsKey = key;
      const opps = game.players.filter(q => q !== game.players[0] && !q.busted && !q.folded).length;
      oddsCache = {
        cat: O.handCategoryProbabilities(game.players[0].holeCards, game.community, 8000),
        eq: O.equity(game.players[0].holeCards, game.community, opps, 2000)
      };
    }

    const rows = Object.entries(oddsCache.cat)
      .map(([name, prob]) => ({ name, prob }))
      .sort((a, b) => b.prob - a.prob)
      .filter(r => r.prob > 0.005)
      .slice(0, 4);
    $("oddsList").innerHTML = rows.map(r =>
      '<div class="row"><span>' + r.name + '</span><span class="pct">' + (r.prob * 100).toFixed(1) + '%</span></div>'
    ).join("") || "—";

    const eq = oddsCache.eq;
    $("equityText").textContent = (eq.equity * 100).toFixed(1) + "%";
    $("equityCard").querySelector(".ic-title").textContent =
      "当前胜率（对 " + game.players.filter(q => q !== game.players[0] && !q.busted && !q.folded).length + " 个对手，估算）";
  }

  /* 操作栏 */
  function renderActions() {
    const p = C.currentPlayer(game);
    const human = game.players[0];

    if (game.gameOver) { $("btnRow").innerHTML = ""; $("curName").textContent = "已结束"; return; }

    if (game.handOver) {
      $("curName").textContent = game.players[0].folded ? "你已弃牌 · 本局结束" : "本局结束";
      $("btnRow").innerHTML = '<button class="act-btn call" id="nextBtn">下一局 ▶</button>';
      $("nextBtn").onclick = () => { C.startHand(game); raiseMode = false; render(); save(); sync(); };
      $("raisePanel").classList.remove("on");
      return;
    }

    if (!p) { $("btnRow").innerHTML = ""; return; }
    const myTurn = p.isHuman;
    $("curName").textContent = myTurn ? "你" : (busy ? "AI 思考中…（" + p.name + "）" : p.name);

    if (!myTurn) { $("btnRow").innerHTML = ""; $("raisePanel").classList.remove("on"); return; }

    const canChk = C.canCheck(game, human);
    const toCall = C.callAmount(game, human);
    const minR = C.minRaiseTotal(game, human);
    const maxR = C.maxRaiseTotal(game, human);
    const canRaise = maxR >= minR;

    let html = '<button class="act-btn fold" data-a="fold">弃牌</button>';
    if (canChk) html += '<button class="act-btn check" data-a="check">过牌</button>';
    else html += '<button class="act-btn call" data-a="call">跟注 ' + toCall + '</button>';
    if (canRaise) html += '<button class="act-btn raise" data-a="raise">' + (game.streetHighBet === 0 ? "下注" : "加注") + '</button>';
    if (human.chips > 0) html += '<button class="act-btn allin" data-a="allin">全下 ' + human.chips + '</button>';
    $("btnRow").innerHTML = html;

    document.querySelectorAll("#btnRow [data-a]").forEach(b => {
      b.onclick = () => {
        const a = b.getAttribute("data-a");
        if (a === "raise") { openRaise(); }
        else humanAction(a, 0);
      };
    });

    if (raiseMode) renderRaisePanel();
    else $("raisePanel").classList.remove("on");
  }

  function openRaise() {
    raiseAmount = C.minRaiseTotal(game, game.players[0]);
    raiseMode = true;
    renderRaisePanel();
  }
  function renderRaisePanel() {
    const human = game.players[0];
    const rp = $("raisePanel");
    rp.classList.add("on");
    const step = Math.max(1, game.config.smallBlind);
    const minTotal = C.minRaiseTotal(game, human);
    const maxTotal = C.maxRaiseTotal(game, human);
    raiseAmount = Math.max(minTotal, Math.min(maxTotal, Math.round(raiseAmount / step) * step));

    const pot = C.totalPot(game);
    const call = C.callAmount(game, human);
    const potRaise = game.streetHighBet + pot + call;
    const halfRaise = game.streetHighBet + Math.round((pot + call) / 2);
    const verb = game.streetHighBet === 0 ? "下注" : "加注";

    rp.innerHTML =
      '<div class="r-top"><span class="r-amount">' + raiseAmount + '</span>' +
        '<input type="range" min="' + minTotal + '" max="' + maxTotal + '" step="' + step + '" value="' + raiseAmount + '" id="raiseRange" /></div>' +
      '<div class="quicks">' +
        '<button class="q-btn" data-q="min">最小 ' + minTotal + '</button>' +
        '<button class="q-btn" data-q="half">½ 底池 ' + Math.min(maxTotal, halfRaise) + '</button>' +
        '<button class="q-btn" data-q="pot">底池 ' + Math.min(maxTotal, potRaise) + '</button>' +
        '<button class="q-btn" data-q="max">全下 ' + maxTotal + '</button>' +
      '</div>' +
      '<div class="r-actions">' +
        '<button class="ghost" id="cancelRaise">取消</button>' +
        '<button class="primary confirm" id="confirmRaise" style="margin-top:0">确认' + verb + '到 ' + raiseAmount + '</button>' +
      '</div>';

    $("raiseRange").oninput = function () { raiseAmount = parseInt(this.value, 10); renderRaisePanel(); };
    $("cancelRaise").onclick = () => { raiseMode = false; $("raisePanel").classList.remove("on"); };
    $("confirmRaise").onclick = () => { humanAction("raise", raiseAmount); };
    rp.querySelectorAll("[data-q]").forEach(b => {
      b.onclick = () => {
        const q = b.getAttribute("data-q");
        if (q === "min") raiseAmount = minTotal;
        else if (q === "half") raiseAmount = Math.min(maxTotal, halfRaise);
        else if (q === "pot") raiseAmount = Math.min(maxTotal, potRaise);
        else if (q === "max") raiseAmount = maxTotal;
        renderRaisePanel();
      };
    });
  }

  /* 教练反馈 */
  function showCoach(analysis) {
    const banner = $("coachBanner");
    banner.style.display = "block";
    let ctx = "";
    if (analysis.context) {
      if (analysis.context.chen !== undefined) ctx = "起手牌强度 " + analysis.context.chen + " 分。";
      else if (analysis.context.equity !== undefined) {
        ctx = "胜率 " + (analysis.context.equity * 100).toFixed(1) + "%" +
          (analysis.context.potOdds ? "，底池赔率 " + (analysis.context.potOdds * 100).toFixed(1) + "%" : "") + "。";
      }
    }
    $("coachText").textContent = (analysis.feedback || "") + (ctx ? " " + ctx : "");
  }

  /* 结算浮层 */
  function renderOverlay() {
    if (!game.gameOver) return;
    const w = game.players[game.winnerIndex];
    const youWin = w && w.isHuman;
    $("ovTitle").textContent = youWin ? "🏆 你赢了！" : "😞 对局结束";
    $("ovMsg").textContent = (w ? w.name : "") + " 赢得全部筹码。";
    $("ovActions").innerHTML =
      '<button class="primary" id="ovAgain">再来一局</button>' +
      '<button class="ghost" id="ovMenu">回菜单</button>';
    $("ovAgain").onclick = () => { $("overlay").classList.remove("on"); newGame(); };
    $("ovMenu").onclick = () => { $("overlay").classList.remove("on"); backToMenu(); };
    $("overlay").classList.add("on");
    storeDel("poker_save");
  }

  /* 日志 */
  function renderLog() {
    $("logList").innerHTML = game.log.map(m =>
      (m.text.indexOf("——") === 0 ? '<div class="sep">' : '<div>') + esc(m.text) + '</div>'
    ).join("");
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    // 关键按钮先绑定，避免任何后续错误导致“点了没反应”
    $("newGameBtn").onclick = newGame;
    $("continueBtn").onclick = continueGame;
    $("backBtn").onclick = backToMenu;
    $("logBtn").onclick = () => { if (game) { renderLog(); $("logModal").classList.add("on"); } };
    $("logClose").onclick = () => $("logModal").classList.remove("on");

    try {
      $("setChips").value = settings.chips;
      $("setSB").value = settings.sb;
      $("setBB").value = settings.bb;
      $("setAnte").value = settings.ante;
      document.querySelectorAll("#aiLevel button").forEach(b => {
        b.classList.toggle("on", b.getAttribute("data-level") === settings.level);
        b.onclick = () => {
          document.querySelectorAll("#aiLevel button").forEach(x => x.classList.remove("on"));
          b.classList.add("on");
        };
      });
      $("continueBtn").style.display = hasSave() ? "block" : "none";
    } catch (e) {
      console.error(e);
    }
  }

  // 调试/测试钩子
  window.__pokerApp = { newGame, continueGame, humanAction, backToMenu, getGame: () => game, setSettings: s => { settings = s; } };

  init();
})();
