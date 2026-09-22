"use strict";

/* =========================================================
 * 核心引擎：发牌 / 牌型判定 / 边池 / 下注状态机（单机 6 人桌）
 * 玩家固定坐 0 号位，5 个 AI 坐 1~5 号位。
 * 纯逻辑、无 UI、无 I/O，可用 Node 直接测试。
 * 通用模块（浏览器挂 window.PokerCore，Node 走 module.exports）。
 * ========================================================= */
(function (root) {

  const RANK_STR = { 14: "A", 13: "K", 12: "Q", 11: "J", 10: "10", 9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2" };
  const SUIT_SYM = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const SUIT_RED = { h: true, d: true, s: false, c: false };
  const HAND_NAMES = { 9: "同花顺", 8: "四条", 7: "葫芦", 6: "同花", 5: "顺子", 4: "三条", 3: "两对", 2: "一对", 1: "高牌" };

  function buildDeck() {
    const d = [];
    for (const s of ["s", "h", "d", "c"])
      for (let r = 2; r <= 14; r++) d.push({ rank: r, suit: s });
    return d;
  }
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function handName(h) { return HAND_NAMES[h.cat]; }

  function evaluate5(cards) {
    const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const flush = suits.every(s => s === suits[0]);
    const counts = new Map();
    ranks.forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
    const groups = [...counts.entries()].map(([r, c]) => ({ rank: r, count: c })).sort((a, b) => b.count - a.count || b.rank - a.rank);
    const uniq = [...new Set(ranks)].sort((a, b) => b - a);
    let straight = false, high = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) { straight = true; high = uniq[0]; }
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) { straight = true; high = 5; }
    }
    const kickers = () => groups.filter(g => g.count === 1).map(g => g.rank).sort((a, b) => b - a);
    if (flush && straight) return { cat: 9, tie: [high] };
    if (groups[0].count === 4) return { cat: 8, tie: [groups[0].rank, groups[1].rank] };
    if (groups[0].count === 3 && groups[1] && groups[1].count === 2) return { cat: 7, tie: [groups[0].rank, groups[1].rank] };
    if (flush) return { cat: 6, tie: [...ranks] };
    if (straight) return { cat: 5, tie: [high] };
    if (groups[0].count === 3) return { cat: 4, tie: [groups[0].rank, ...kickers()] };
    if (groups[0].count === 2 && groups[1] && groups[1].count === 2) {
      const pairs = groups.filter(g => g.count === 2).map(g => g.rank).sort((a, b) => b - a);
      return { cat: 3, tie: [...pairs, groups.find(g => g.count === 1).rank] };
    }
    if (groups[0].count === 2) return { cat: 2, tie: [groups[0].rank, ...kickers()] };
    return { cat: 1, tie: [...ranks] };
  }
  function compareHands(a, b) {
    if (a.cat !== b.cat) return a.cat - b.cat;
    for (let i = 0; i < a.tie.length; i++) if (a.tie[i] !== b.tie[i]) return a.tie[i] - b.tie[i];
    return 0;
  }
  function bestHand(cards) {
    let best = null;
    const n = cards.length;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
      for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
        const h = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
        if (!best || compareHands(h, best) > 0) best = h;
      }
    return best;
  }
  function computeSidePots(rows) {
    const levels = [...new Set(rows.map(r => r.contribution).filter(a => a > 0))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      const contributors = rows.filter(r => r.contribution >= level);
      const eligible = contributors.filter(r => !r.folded);
      const amount = (level - prev) * contributors.length;
      if (amount > 0) pots.push({ amount, eligible: eligible.map(r => r.id) });
      prev = level;
    }
    return pots;
  }

  /* ---------------- 牌局状态 ---------------- */
  const AI_LEVELS = ["easy", "medium", "hard"];

  function createGame(config) {
    config = config || {};
    const players = [];
    for (let i = 0; i < 6; i++) {
      players.push({
        seatIndex: i,
        name: i === 0 ? "你" : ("AI·" + (["甲", "乙", "丙", "丁", "戊"][i - 1])),
        isHuman: i === 0,
        aiLevel: i === 0 ? null : (config.aiLevels && config.aiLevels[i - 1] ? config.aiLevels[i - 1] : "medium"),
        chips: config.startingChips || 1000,
        holeCards: [], folded: false, allIn: false, busted: false,
        currentBet: 0, totalContribution: 0, hand: null
      });
    }
    const game = {
      config: {
        startingChips: config.startingChips || 1000,
        smallBlind: config.smallBlind || 10,
        bigBlind: config.bigBlind || 20,
        ante: config.ante || 0
      },
      players,
      community: [],
      deck: [],
      street: "preflop",
      handNumber: 0,
      dealerIndex: -1,
      sbIndex: -1,
      bbIndex: -1,
      currentIndex: -1,
      toAct: [],
      streetHighBet: 0,
      minRaise: 0,
      handOver: false,
      gameOver: false,
      winnerIndex: -1,
      log: []
    };
    return game;
  }

  function log(game, msg) {
    game.log.push({ hand: game.handNumber, street: game.street, text: msg, at: Date.now() });
    if (game.log.length > 500) game.log.splice(0, game.log.length - 500);
  }

  /* ---------------- 工具 ---------------- */
  function activePlayers(game) { return game.players.filter(p => !p.busted); }
  function canAct(p) { return !p.folded && !p.allIn && !p.busted; }
  function currentPlayer(game) { return game.currentIndex >= 0 ? game.players[game.currentIndex] : null; }
  function totalPot(game) { return game.players.reduce((s, p) => s + p.totalContribution, 0); }
  function nextIndex(game, i) { return (i + 1) % game.players.length; }
  function nextActive(game, i) {
    let j = nextIndex(game, i);
    while (game.players[j].busted) j = nextIndex(game, j);
    return j;
  }
  function canCheck(game, p) { return p.currentBet === game.streetHighBet; }
  function callAmount(game, p) { return Math.min(game.streetHighBet - p.currentBet, p.chips); }
  function minRaiseTotal(game, p) { return game.streetHighBet + game.minRaise; }
  function maxRaiseTotal(game, p) { return p.currentBet + p.chips; }

  /* ---------------- 开局与发牌 ---------------- */
  function startHand(game) {
    game.handNumber++;
    game.deck = shuffle(buildDeck());
    game.community = [];
    game.street = "preflop";
    game.handOver = false;
    game.currentIndex = -1;
    game.toAct = [];
    game.streetHighBet = 0;
    game.minRaise = game.config.bigBlind;
    game.players.forEach(p => {
      p.holeCards = []; p.folded = false; p.allIn = false;
      p.currentBet = 0; p.totalContribution = 0; p.hand = null;
    });
    log(game, "—— 第 " + game.handNumber + " 局 ——");

    if (game.dealerIndex === -1) game.dealerIndex = Math.floor(Math.random() * 6);
    else game.dealerIndex = nextActive(game, game.dealerIndex);

    const active = activePlayers(game);
    let sb, bb;
    if (active.length === 2) { sb = game.dealerIndex; bb = nextActive(game, sb); }
    else { sb = nextActive(game, game.dealerIndex); bb = nextActive(game, sb); }
    game.sbIndex = sb; game.bbIndex = bb;

    active.forEach(p => { p.holeCards = [game.deck.pop(), game.deck.pop()]; });

    if (game.config.ante > 0) {
      active.forEach(p => {
        const amt = Math.min(game.config.ante, p.chips);
        p.chips -= amt; p.totalContribution += amt;
        if (p.chips === 0) p.allIn = true;
      });
      log(game, "每人交前注 " + game.config.ante);
    }

    const sbP = game.players[sb], bbP = game.players[bb];
    const sbAmt = Math.min(game.config.smallBlind, sbP.chips);
    sbP.chips -= sbAmt; sbP.currentBet += sbAmt; sbP.totalContribution += sbAmt;
    if (sbP.chips === 0) sbP.allIn = true;
    log(game, sbP.name + " 小盲 " + sbAmt);

    const bbAmt = Math.min(game.config.bigBlind, bbP.chips);
    bbP.chips -= bbAmt; bbP.currentBet += bbAmt; bbP.totalContribution += bbAmt;
    if (bbP.chips === 0) bbP.allIn = true;
    log(game, bbP.name + " 大盲 " + bbAmt);

    game.streetHighBet = Math.max(sbAmt, bbAmt);

    const utg = (active.length === 2) ? sb : nextActive(game, bb);
    setupStreet(game, utg);
    if (game.toAct.length === 0) advanceStreet(game);
  }

  function setupStreet(game, first) {
    game.toAct = game.players.filter(canAct).map(p => p.seatIndex);
    game.currentIndex = game.toAct.length ? nextInToAct(game, first - 1) : -1;
  }
  function nextInToAct(game, from) {
    let j = from;
    for (let k = 0; k < game.players.length; k++) {
      j = nextIndex(game, j);
      if (game.toAct.indexOf(j) !== -1) return j;
    }
    return -1;
  }
  function beginStreetBetting(game) {
    game.players.forEach(p => { p.currentBet = 0; });
    game.streetHighBet = 0;
    game.minRaise = game.config.bigBlind;
  }

  /* ---------------- 行动 ---------------- */
  function doAction(game, type, amount) {
    if (game.handOver || game.gameOver) return { error: "本局已结束" };
    const p = currentPlayer(game);
    if (!p) return { error: "无当前玩家" };
    applyAction(game, type, amount || 0);
    return {};
  }

  function applyAction(game, type, amount) {
    const p = currentPlayer(game);
    switch (type) {
      case "fold":
        p.folded = true;
        log(game, p.name + " 弃牌");
        removeFromToAct(game, p.seatIndex);
        break;
      case "check":
        log(game, p.name + " 过牌");
        removeFromToAct(game, p.seatIndex);
        break;
      case "call": {
        const toCall = callAmount(game, p);
        putChips(game, p, toCall);
        if (p.chips === 0) p.allIn = true;
        log(game, p.name + " 跟注 " + toCall + (p.allIn ? "（全下）" : ""));
        removeFromToAct(game, p.seatIndex);
        break;
      }
      case "raise": {
        const before = p.currentBet;
        putChips(game, p, amount - before);
        if (p.chips === 0) p.allIn = true;
        const raiseSize = amount - game.streetHighBet;
        game.minRaise = raiseSize;
        game.streetHighBet = amount;
        log(game, p.name + " 加注到 " + amount + (p.allIn ? "（全下）" : ""));
        game.toAct = activeExcept(game, p).map(q => q.seatIndex);
        break;
      }
      case "allin": {
        putChips(game, p, p.chips);
        p.allIn = true;
        const total = p.currentBet;
        log(game, p.name + " 全下 " + total);
        if (total > game.streetHighBet) {
          game.streetHighBet = total;
          game.toAct = activeExcept(game, p).map(q => q.seatIndex);
        } else {
          removeFromToAct(game, p.seatIndex);
        }
        break;
      }
    }
    afterAction(game);
  }

  function removeFromToAct(game, seat) { game.toAct = game.toAct.filter(i => i !== seat); }
  function activeExcept(game, p) { return game.players.filter(q => q !== p && canAct(q)); }
  function putChips(game, p, amount) {
    amount = Math.max(0, Math.min(amount, p.chips));
    p.chips -= amount;
    p.currentBet += amount;
    p.totalContribution += amount;
    return amount;
  }

  function afterAction(game) {
    const contenders = game.players.filter(p => !p.folded && !p.busted);
    if (contenders.length === 1) { awardTo(game, contenders[0]); return; }
    if (game.toAct.length === 0) {
      if (game.street === "river") showdown(game);
      else advanceStreet(game);
      return;
    }
    advanceTurn(game);
  }

  function advanceTurn(game) {
    if (game.toAct.length === 0) return;
    game.currentIndex = nextInToAct(game, game.currentIndex);
  }

  function advanceStreet(game) {
    if (game.street === "preflop") { game.street = "flop"; game.community.push(game.deck.pop(), game.deck.pop(), game.deck.pop()); }
    else if (game.street === "flop") { game.street = "turn"; game.community.push(game.deck.pop()); }
    else if (game.street === "turn") { game.street = "river"; game.community.push(game.deck.pop()); }
    else { showdown(game); return; }
    beginStreetBetting(game);
    setupStreet(game, nextActive(game, game.dealerIndex));
    if (game.toAct.length < 2) advanceStreet(game);
  }

  function awardTo(game, player) {
    const amt = totalPot(game);
    player.chips += amt;
    log(game, player.name + " 赢得底池 " + amt);
    game.players.forEach(p => { p.totalContribution = 0; });
    endHand(game);
  }

  function showdown(game) {
    game.street = "showdown";
    const contenders = game.players.filter(p => !p.folded && !p.busted);
    contenders.forEach(p => { p.hand = bestHand([...p.holeCards, ...game.community]); });

    const rows = game.players.map(p => ({ id: p.seatIndex, folded: p.folded, contribution: p.totalContribution }));
    const pots = computeSidePots(rows);

    contenders.forEach(c => log(game, c.name + ": " + handName(c.hand)));
    for (const pot of pots) {
      let eligible = contenders.filter(c => pot.eligible.indexOf(c.seatIndex) !== -1);
      if (eligible.length === 0) eligible = contenders;
      let best = eligible[0].hand;
      for (const c of eligible) if (compareHands(c.hand, best) > 0) best = c.hand;
      const winners = eligible.filter(c => compareHands(c.hand, best) === 0);
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      winners.forEach((w, i) => { w.chips += share + (i < rem ? 1 : 0); });
      log(game, winners.map(w => w.name).join("、") + " 赢得底池 " + pot.amount + "（" + handName(best) + "）");
    }
    game.players.forEach(p => { p.totalContribution = 0; });
    endHand(game);
  }

  function endHand(game) {
    game.handOver = true;
    game.players.forEach(p => {
      if (p.chips === 0 && !p.busted) { p.busted = true; log(game, "💀 " + p.name + " 出局！"); }
    });
    const active = game.players.filter(p => !p.busted);
    if (active.length === 1) {
      game.gameOver = true;
      game.winnerIndex = active[0].seatIndex;
      log(game, "🏆 " + active[0].name + " 赢得全部筹码！");
    }
  }

  /* ---------------- 视图（隐私过滤） ---------------- */
  function getView(game, seatIndex) {
    const revealAll = game.street === "showdown" || game.handOver;
    return {
      handNumber: game.handNumber,
      street: game.street,
      community: game.community.slice(),
      dealerIndex: game.dealerIndex,
      sbIndex: game.sbIndex,
      bbIndex: game.bbIndex,
      currentIndex: game.currentIndex,
      handOver: game.handOver,
      gameOver: game.gameOver,
      winnerIndex: game.winnerIndex,
      pot: totalPot(game),
      streetHighBet: game.streetHighBet,
      minRaise: game.minRaise,
      config: { ...game.config },
      players: game.players.map(p => ({
        seatIndex: p.seatIndex,
        name: p.name,
        isHuman: p.isHuman,
        chips: p.chips,
        folded: p.folded,
        allIn: p.allIn,
        busted: p.busted,
        currentBet: p.currentBet,
        holeCards: (p.seatIndex === seatIndex) || (revealAll && !p.folded) ? p.holeCards : null,
        handName: revealAll && !p.folded && p.hand ? handName(p.hand) : null
      }))
    };
  }

  /* ---------------- 存档 ---------------- */
  function serialize(game) {
    return JSON.stringify(game);
  }
  function deserialize(json) {
    return JSON.parse(json);
  }

  const api = {
    RANK_STR, SUIT_SYM, SUIT_RED, HAND_NAMES, AI_LEVELS,
    buildDeck, shuffle, handName,
    evaluate5, compareHands, bestHand, computeSidePots,
    createGame, startHand, doAction,
    currentPlayer, activePlayers, canAct, totalPot,
    canCheck, callAmount, minRaiseTotal, maxRaiseTotal,
    getView, serialize, deserialize, log
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PokerCore = api;

})(typeof self !== "undefined" ? self : this);
