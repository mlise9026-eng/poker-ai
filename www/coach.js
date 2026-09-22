"use strict";

/* =========================================================
 * 教练模块：把“你的选择”和“标准打法”对比，给出差异与解释
 * 注意：需在“你行动之前”的状态下调用（game 处于轮到你时）。
 * ========================================================= */
(function (root) {
  const C = (typeof module === "object" && module.exports) ? require("./core.js") : root.PokerCore;
  const AI = (typeof module === "object" && module.exports) ? require("./ai.js") : root.PokerAI;
  const O = (typeof module === "object" && module.exports) ? require("./odds.js") : root.PokerOdds;

  const TYPE_CN = { fold: "弃牌", check: "过牌", call: "跟注", raise: "加注", allin: "全下" };

  /* 同一类“宽泛动作”归类，用于判断是否一致 */
  function family(type) {
    if (type === "fold") return "fold";
    if (type === "check") return "check";
    if (type === "call" || type === "allin") return "call";
    return "raise";
  }

  function analyze(game, yourType, yourAmount) {
    const p = C.currentPlayer(game);
    if (!p) return { error: "无当前玩家" };

    const standard = AI.standardDecision(game);
    const ctx = contextInfo(game, p);

    const sameFamily = family(yourType) === family(standard.type);
    const exactSame = sameFamily &&
      !(standard.type === "raise" && yourType !== "raise" && yourType !== "allin");

    let feedback;
    if (exactSame) {
      feedback = "✅ 选择与标准一致：" + (standard.reason || TYPE_CN[standard.type]);
    } else {
      feedback = "⚠️ 标准建议是「" + TYPE_CN[standard.type] + "」，你选择了「" + TYPE_CN[yourType] + "」。"
        + (standard.reason ? " 原因：" + standard.reason : "");
    }

    return {
      your: { type: yourType, amount: yourAmount || 0 },
      standard: { type: standard.type, amount: standard.amount || 0, reason: standard.reason || "" },
      match: exactSame,
      feedback,
      context: ctx
    };
  }

  /* 附加上下文信息（给玩家看的数据） */
  function contextInfo(game, p) {
    const info = {};
    if (game.street === "preflop") {
      info.chen = AI.chenScore(p.holeCards[0], p.holeCards[1]);
    } else {
      const opps = game.players.filter(q => q !== p && !q.busted && !q.folded).length;
      const eq = O.equity(p.holeCards, game.community, opps, 1200);
      const pot = C.totalPot(game);
      const toCall = C.callAmount(game, p);
      info.equity = eq.equity;
      info.win = eq.win;
      info.potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    }
    return info;
  }

  const api = { analyze, TYPE_CN };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PokerCoach = api;

})(typeof self !== "undefined" ? self : this);
