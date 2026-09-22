"use strict";

/* =========================================================
 * 概率模块：成牌概率（精确/蒙特卡洛） + 胜率 equity（蒙特卡洛）
 * ========================================================= */
(function (root) {
  const C = (typeof module === "object" && module.exports) ? require("./core.js") : root.PokerCore;

  function key(c) { return c.rank + c.suit; }

  function remainingDeck(hole, community) {
    const used = new Set();
    hole.concat(community).forEach(c => used.add(key(c)));
    const deck = [];
    for (const s of ["s", "h", "d", "c"])
      for (let r = 2; r <= 14; r++) {
        const c = { rank: r, suit: s };
        if (!used.has(key(c))) deck.push(c);
      }
    return deck;
  }

  function pick(pool) {
    const i = Math.floor(Math.random() * pool.length);
    return pool.splice(i, 1)[0];
  }

  function tallyToNames(tally, total) {
    const out = {};
    for (let cat = 1; cat <= 9; cat++) {
      out[C.HAND_NAMES[cat]] = (tally[cat] || 0) / total;
    }
    return out;
  }

  /* 成牌概率：翻牌/转牌精确枚举，翻牌前蒙特卡洛，河牌=当前牌型 */
  function handCategoryProbabilities(hole, community, iterations) {
    iterations = iterations || 12000;
    const n = community.length;
    if (n >= 5) {
      const h = C.bestHand(hole.concat(community.slice(0, 5)));
      return tallyToNames({ [h.cat]: 1 }, 1);
    }
    const remaining = remainingDeck(hole, community);
    const tally = {};

    if (n === 4) { // 转牌：精确枚举 1 张
      for (const c of remaining) {
        const h = C.bestHand(hole.concat(community, [c]));
        tally[h.cat] = (tally[h.cat] || 0) + 1;
      }
      return tallyToNames(tally, remaining.length);
    }
    if (n === 3) { // 翻牌：精确枚举 2 张
      let total = 0;
      for (let i = 0; i < remaining.length; i++)
        for (let j = i + 1; j < remaining.length; j++) {
          const h = C.bestHand(hole.concat(community, [remaining[i], remaining[j]]));
          tally[h.cat] = (tally[h.cat] || 0) + 1;
          total++;
        }
      return tallyToNames(tally, total);
    }
    // 翻牌前：蒙特卡洛
    for (let it = 0; it < iterations; it++) {
      const pool = remaining.slice();
      const board = [];
      for (let k = 0; k < 5; k++) board.push(pick(pool));
      const h = C.bestHand(hole.concat(board));
      tally[h.cat] = (tally[h.cat] || 0) + 1;
    }
    return tallyToNames(tally, iterations);
  }

  /* 胜率 equity：蒙特卡洛，对手按“随机范围”发牌（不偷看真实手牌） */
  function equity(hole, community, numOpponents, iterations) {
    iterations = iterations || 3000;
    numOpponents = Math.max(0, Math.min(5, numOpponents | 0));
    const remaining = remainingDeck(hole, community);
    const toDeal = 5 - community.length;
    let win = 0, tie = 0;

    for (let it = 0; it < iterations; it++) {
      const pool = remaining.slice();
      const oppHands = [];
      for (let o = 0; o < numOpponents; o++) oppHands.push([pick(pool), pick(pool)]);
      const board = community.slice();
      for (let k = 0; k < toDeal; k++) board.push(pick(pool));

      const mine = C.bestHand(hole.concat(board));
      let beatAll = true, tieBest = false;
      for (const oh of oppHands) {
        const cmp = C.compareHands(mine, C.bestHand(oh.concat(board)));
        if (cmp < 0) { beatAll = false; tieBest = false; break; }
        if (cmp === 0) tieBest = true;
      }
      if (beatAll && tieBest) tie++;
      else if (beatAll) win++;
    }
    return {
      win: win / iterations,
      tie: tie / iterations,
      equity: (win + tie * 0.5) / iterations,
      iterations
    };
  }

  const api = { handCategoryProbabilities, equity, remainingDeck };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PokerOdds = api;

})(typeof self !== "undefined" ? self : this);
