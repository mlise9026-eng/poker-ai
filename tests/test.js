"use strict";
const C = require("../www/core.js");
const O = require("../www/odds.js");
const AI = require("../www/ai.js");
const Coach = require("../www/coach.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("OK  " + name); }
  else { fail++; console.log("FAIL " + name); }
}
function approx(name, got, lo, hi) {
  ok(name + " [" + got + "] in [" + lo + "," + hi + "]", got >= lo && got <= hi);
}

/* ---------- 牌型判定（复用旧测试） ---------- */
const c = (r, s) => ({ rank: r, suit: s });
const royal = C.bestHand([c(14,'s'),c(13,'s'),c(12,'s'),c(11,'s'),c(10,'s'),c(2,'d'),c(3,'c')]);
ok("皇家同花顺", royal.cat === 9 && royal.tie[0] === 14);
ok("四条", C.evaluate5([c(9,'s'),c(9,'h'),c(9,'d'),c(9,'c'),c(2,'s')]).cat === 8);
const wheel = C.evaluate5([c(14,'s'),c(2,'h'),c(3,'d'),c(4,'c'),c(5,'s')]);
ok("轮子顺子 A2345", wheel.cat === 5 && wheel.tie[0] === 5);
const tp1 = C.evaluate5([c(13,'s'),c(13,'h'),c(3,'d'),c(3,'c'),c(14,'s')]);
const tp2 = C.evaluate5([c(13,'s'),c(13,'h'),c(3,'d'),c(3,'c'),c(12,'s')]);
ok("两对踢脚", C.compareHands(tp1, tp2) > 0);
ok("葫芦>同花", C.compareHands(C.evaluate5([c(7,'s'),c(7,'h'),c(7,'d'),c(2,'c'),c(2,'s')]), C.evaluate5([c(2,'h'),c(5,'h'),c(8,'h'),c(11,'h'),c(13,'h')])) > 0);

/* ---------- Chen 公式 ---------- */
ok("chen AA=20", AI.chenScore(c(14,'s'), c(14,'d')) === 20);
ok("chen KK=16", AI.chenScore(c(13,'s'), c(13,'d')) === 16);
ok("chen 22=5", AI.chenScore(c(2,'s'), c(2,'d')) === 5);
ok("chen AKs=12", AI.chenScore(c(14,'s'), c(13,'s')) === 12);
ok("chen 72o<0", AI.chenScore(c(7,'s'), c(2,'d')) < 0);

/* ---------- 成牌概率：翻牌四张同花 → 同花 ~35% ---------- */
const fl = O.handCategoryProbabilities([c(14,'h'),c(13,'h')], [c(2,'h'),c(7,'h'),c(9,'d')], 0);
const sum = Object.values(fl).reduce((s, v) => s + v, 0);
ok("概率和为 1", Math.abs(sum - 1) < 1e-9);
approx("四张同花成同花概率", fl["同花"], 0.25, 0.42);

/* ---------- 胜率 equity ---------- */
const eqAA = O.equity([c(14,'s'),c(14,'d')], [], 1, 6000);
approx("AA vs 1 随机 ~85%", eqAA.equity, 0.78, 0.92);
const eq72 = O.equity([c(7,'s'),c(2,'d')], [], 1, 6000);
approx("72o vs 1 随机 ~33%", eq72.equity, 0.22, 0.45);

/* ---------- 整局 AI 对战：筹码守恒 + 能正常结束 ---------- */
function playHand(game) {
  let guard = 0;
  while (!game.handOver && !game.gameOver && guard < 600) {
    guard++;
    const p = C.currentPlayer(game);
    if (p.isHuman) {
      if (C.canCheck(game, p)) C.doAction(game, "check");
      else C.doAction(game, "call");
    } else {
      const d = AI.decide(game);
      if (!["fold","check","call","raise","allin"].includes(d.type)) { ok("AI 返回合法动作", false); return; }
      C.doAction(game, d.type, d.amount);
    }
  }
  if (guard >= 600) ok("AI 对局能终止", false);
}
const g = C.createGame({ startingChips: 1000, smallBlind: 10, bigBlind: 20, ante: 0 });
C.startHand(g);
playHand(g);
ok("AI 对局正常结束", g.handOver === true);
ok("AI 对局筹码守恒", g.players.reduce((s, p) => s + p.chips, 0) === 6000);
ok("AI 对局公共牌 5 张", g.community.length === 5);

/* 连打多局不崩、每局守恒 */
const g2 = C.createGame({ startingChips: 500, smallBlind: 5, bigBlind: 10 });
let conserved = true, hands = 0;
for (let i = 0; i < 25 && !g2.gameOver; i++) {
  C.startHand(g2);
  playHand(g2);
  hands++;
  if (g2.players.reduce((s, p) => s + p.chips, 0) !== 3000) conserved = false;
}
ok("连续 " + hands + " 局筹码始终守恒", conserved);

/* ---------- 教练：标准打法 + 分析 ---------- */
const gc = C.createGame({});
gc.players[0].holeCards = [c(14,'s'), c(14,'d')]; // AA
gc.players[0].chips = 1000; gc.players[0].currentBet = 0;
gc.street = "preflop"; gc.streetHighBet = gc.config.bigBlind; gc.minRaise = gc.config.bigBlind;
gc.currentIndex = 0;
for (let i = 1; i < 6; i++) { gc.players[i].chips = 1000; gc.players[i].currentBet = 0; }
const std = AI.standardDecision(gc);
ok("AA 标准打法是加注", std.type === "raise");
const ana = Coach.analyze(gc, "call", 0);
ok("教练分析给出反馈", typeof ana.feedback === "string" && ana.feedback.length > 0);
ok("教练判定不一致(AA 却跟注)", ana.match === false);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
