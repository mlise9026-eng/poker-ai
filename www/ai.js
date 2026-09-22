"use strict";

/* =========================================================
 * AI 模块：规则启发式（Chen 公式翻牌前 + 胜率/底池赔率翻牌后）
 * decide(game)        —— 按玩家难度档位决策
 * standardDecision(game) —— 确定性“标准打法”基线（供教练对比）
 * ========================================================= */
(function (root) {
  const C = (typeof module === "object" && module.exports) ? require("./core.js") : root.PokerCore;
  const O = (typeof module === "object" && module.exports) ? require("./odds.js") : root.PokerOdds;

  /* Chen 起手牌强度（近似，0~20 分） */
  const BASE = { 14: 10, 13: 8, 12: 7, 11: 6, 10: 5, 9: 4.5, 8: 4, 7: 3.5, 6: 3, 5: 2.5, 4: 2, 3: 1.5, 2: 1 };
  function chenScore(a, b) {
    if (!a || !b) return 0;
    const hi = Math.max(a.rank, b.rank), lo = Math.min(a.rank, b.rank);
    let s;
    if (a.rank === b.rank) {
      s = Math.max(BASE[hi] * 2, 5);
    } else {
      s = BASE[hi];
      const gap = (hi - lo) - 1;
      if (gap === 1) s -= 1;
      else if (gap === 2) s -= 2;
      else if (gap === 3) s -= 4;
      else if (gap >= 4) s -= 5;
      if (gap <= 1 && hi < 12) s += 1;   // 连张且小于 Q，加分
      if (a.suit === b.suit) s += 2;      // 同花加分
    }
    return Math.round(s * 2) / 2;
  }

  function activeOpponents(game, p) {
    return game.players.filter(q => q !== p && !q.busted && !q.folded).length;
  }

  function playersBehind(game, p) {
    let count = 0, j = p.seatIndex;
    for (let k = 0; k < 6; k++) {
      j = (j + 1) % 6;
      const q = game.players[j];
      if (q !== p && !q.busted && !q.folded && !q.allIn) count++;
    }
    return count;
  }

  /* 核心决策：返回 {type, amount, reason} */
  function decideFor(game, p, level, withReason) {
    const reason = [];
    const street = game.street;
    const toCall = C.callAmount(game, p);
    const canChk = C.canCheck(game, p);
    const minR = C.minRaiseTotal(game, p);
    const maxR = C.maxRaiseTotal(game, p);
    const bb = game.config.bigBlind;
    let out;

    if (street === "preflop") {
      const score = chenScore(p.holeCards[0], p.holeCards[1]);
      const raised = game.streetHighBet > bb;
      const behind = playersBehind(game, p);
      const late = behind <= 2;

      let openStrong = 8, openMid = 5, callVsRaise = 6, threeBet = 9;
      if (level === "easy") { openStrong += 1.5; openMid += 1; callVsRaise += 1; threeBet += 1; }
      if (level === "hard") { openStrong -= 0.5; openMid -= 0.5; callVsRaise -= 0.5; threeBet -= 0.5; }

      if (!raised) {
        if (score >= openStrong) {
          const to = Math.min(maxR, Math.max(minR, bb * 3));
          out = { type: "raise", amount: to };
          reason.push("起手牌强度 " + score + " 分属强牌");
          reason.push("加注到 " + to + " 抢底池、建立牌力");
        } else if (score >= openMid && late) {
          const to = Math.min(maxR, Math.max(minR, bb * 3));
          out = { type: "raise", amount: to };
          reason.push("中等牌（" + score + " 分）且在靠后位置，加注偷盲");
        } else if (score >= 3) {
          out = canChk ? { type: "check" } : { type: "call", amount: toCall };
          reason.push("牌力一般（" + score + " 分），便宜看牌");
        } else {
          out = canChk ? { type: "check" } : { type: "fold" };
          reason.push("起手太弱（" + score + " 分），" + (canChk ? "免费过牌" : "弃牌"));
        }
      } else {
        if (score >= threeBet) {
          const to = Math.min(maxR, Math.max(minR, game.streetHighBet * 2));
          out = { type: "raise", amount: to };
          reason.push("面对加注，强牌（" + score + " 分）3-bet");
        } else if (score >= callVsRaise) {
          out = { type: "call", amount: toCall };
          reason.push("牌力尚可（" + score + " 分），跟注看翻牌");
        } else {
          out = { type: "fold" };
          reason.push("牌力不足（" + score + " 分），放弃");
        }
      }
    } else {
      // 翻牌后：胜率 + 底池赔率
      const opps = activeOpponents(game, p);
      const eq = O.equity(p.holeCards, game.community, opps, 1000);
      const pot = C.totalPot(game);
      const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
      const madeCat = C.bestHand(p.holeCards.concat(game.community)).cat;

      let raiseMargin = 0.10, callMargin = 0, valueEq = 0.62, betEq = 0.58, madeBet = 6;
      if (level === "easy") { raiseMargin = 0.15; valueEq = 0.70; betEq = 0.65; madeBet = 7; }
      if (level === "hard") { raiseMargin = 0.06; valueEq = 0.58; betEq = 0.55; madeBet = 5; }

      if (toCall > 0) {
        if (eq.equity >= potOdds + raiseMargin) {
          if (eq.equity >= valueEq) {
            const to = Math.min(maxR, Math.max(minR, Math.round((pot + toCall) * 0.75)));
            out = { type: "raise", amount: to };
            reason.push("胜率 " + pct(eq.equity) + " 远高于底池赔率 " + pct(potOdds));
            reason.push("成牌 " + C.handName({ cat: madeCat }) + "，加注价值下注");
          } else {
            out = { type: "call", amount: toCall };
            reason.push("胜率 " + pct(eq.equity) + " 高于底池赔率 " + pct(potOdds) + "，跟注有利可图");
          }
        } else if (eq.equity >= potOdds + callMargin) {
          out = { type: "call", amount: toCall };
          reason.push("胜率 " + pct(eq.equity) + " 略高于底池赔率 " + pct(potOdds) + "，勉强跟注");
        } else {
          out = { type: "fold" };
          reason.push("胜率 " + pct(eq.equity) + " 低于底池赔率 " + pct(potOdds) + "，弃牌更划算");
        }
      } else {
        const wantBet = eq.equity >= betEq || madeCat >= madeBet;
        // 困难档偶发诈唬
        const bluff = level === "hard" && madeCat <= 2 && Math.random() < 0.08;
        if (wantBet || bluff) {
          const to = Math.min(maxR, Math.max(minR, Math.round(pot * 0.6)));
          out = { type: "raise", amount: to };
          if (bluff) reason.push("偶尔诈唬，下注 " + to);
          else reason.push("胜率 " + pct(eq.equity) + " / 成牌 " + C.handName({ cat: madeCat }) + "，主动下注");
        } else {
          out = { type: "check" };
          reason.push("牌力一般（胜率 " + pct(eq.equity) + "），过牌控制底池");
        }
      }
    }

    if (out.type === "raise" && out.amount >= maxR) out = { type: "allin" };
    if (out.type === "call" && toCall >= p.chips) out = { type: "allin" };
    const res = { type: out.type, amount: out.amount || 0 };
    if (withReason) res.reason = reason.join("；");
    return res;
  }

  function pct(x) { return Math.round(x * 100) + "%"; }

  /* 对当前 AI 玩家决策 */
  function decide(game) {
    const p = C.currentPlayer(game);
    if (!p) return { type: "fold" };
    return decideFor(game, p, p.aiLevel || "medium", false);
  }

  /* 标准打法基线（供教练），始终用 hard 档的确定性逻辑 */
  function standardDecision(game) {
    const p = C.currentPlayer(game);
    if (!p) return { type: "fold", amount: 0, reason: "" };
    return decideFor(game, p, "hard", true);
  }

  const api = { chenScore, decide, standardDecision };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PokerAI = api;

})(typeof self !== "undefined" ? self : this);
