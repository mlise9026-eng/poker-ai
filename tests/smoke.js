"use strict";
/* 界面编排冒烟测试：用 DOM 桩 + 同步 setTimeout 驱动 app.js 打完一局 */
const fs = require("fs");
const vm = require("vm");

// ---------- DOM 桩 ----------
const elCache = {};
function stubEl(id) {
  if (elCache[id]) return elCache[id];
  const t = { id, _children: [], _style: {}, _class: new Set(),
    value: "", checked: false, innerHTML: "", textContent: "", onclick: null, oninput: null,
    scrollTop: 0, scrollHeight: 0, firstElementChild: null };
  const proxy = new Proxy(t, {
    get(o, prop) {
      if (prop in o) return o[prop];
      if (prop === "classList") return {
        add: (...c) => c.forEach(x => o._class.add(x)),
        remove: (...c) => c.forEach(x => o._class.delete(x)),
        toggle: (c, f) => { if (f === undefined) { o._class.has(c) ? o._class.delete(c) : o._class.add(c); } else if (f) o._class.add(c); else o._class.delete(c); },
        contains: c => o._class.has(c)
      };
      if (prop === "style") return o._style;
      if (prop === "firstElementChild") { if (!o.firstElementChild) o.firstElementChild = stubEl(id + ":first"); return o.firstElementChild; }
      if (prop === "appendChild") return ch => { o._children.push(ch); return ch; };
      if (prop === "querySelector") return () => stubEl(id + ":q");
      if (prop === "querySelectorAll") return () => [];
      if (prop === "addEventListener" || prop === "removeEventListener" || prop === "setAttribute") return () => {};
      if (prop === "getAttribute") return () => null;
      return stubEl(id + "." + prop);
    },
    set(o, prop, val) { o[prop] = val; return true; }
  });
  elCache[id] = proxy;
  return proxy;
}
const document = {
  getElementById: id => stubEl(id),
  createElement: () => stubEl("el" + Math.random()),
  querySelector: () => stubEl("doc:q"),
  querySelectorAll: () => [],
  addEventListener: () => {}
};
const lsStore = {};
const localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; }
};

// ---------- 沙箱 ----------
const sandbox = {
  console, Date, Math, JSON, parseInt, parseFloat, isNaN,
  encodeURIComponent, decodeURIComponent,
  setTimeout: (fn) => { fn(); return 0; },  // 同步执行，加速
  clearTimeout: () => {},
  document, localStorage
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.PokerCore = require("../www/core.js");
sandbox.PokerOdds = require("../www/odds.js");
sandbox.PokerAI = require("../www/ai.js");
sandbox.PokerCoach = require("../www/coach.js");
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(__dirname + "/../www/app.js", "utf8"), sandbox);

const App = sandbox.__pokerApp;
const C = sandbox.PokerCore;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("OK  " + name); } else { fail++; console.log("FAIL " + name); } }

// 开局
App.newGame();
let game = App.getGame();
ok("开局后已发牌", game && game.handNumber === 1 && game.players.every(p => p.holeCards.length === 2));
ok("AI 自动打到轮到你或结束", !game.handOver || game.gameOver || C.currentPlayer(game).isHuman);

// 打完整局（同步 setTimeout 下无延迟）
let guard = 0;
while (!game.handOver && !game.gameOver && guard < 200) {
  guard++;
  const p = C.currentPlayer(game);
  if (p && p.isHuman) {
    App.humanAction(C.canCheck(game, p) ? "check" : "call", 0);
  } else if (p) {
    // 理论不会走到这（sync 会玩掉所有 AI），走到说明有 bug
    ok("AI 未托管完成", false);
    break;
  }
}
ok("完整一局结束", game.handOver === true);
ok("筹码守恒", game.players.reduce((s, p) => s + p.chips, 0) === 6000);

// 续局：存档存在，回菜单再继续
ok("有存档", !!localStorage.getItem("poker_save"));
App.backToMenu();
App.continueGame();
const g2 = App.getGame();
ok("续局恢复同一手牌数", g2 && g2.handNumber === game.handNumber);

// 弃牌：立即结算，且不自动开下一局
C.startHand(g2);
let gd = 0;
while (C.currentPlayer(g2) && !C.currentPlayer(g2).isHuman && !g2.handOver && gd < 300) {
  gd++;
  const d = sandbox.PokerAI.decide(g2);
  C.doAction(g2, d.type, d.amount);
}
if (C.currentPlayer(g2) && C.currentPlayer(g2).isHuman) App.humanAction("fold", 0);
ok("弃牌后立即结算", g2.handOver === true);
ok("弃牌后未自动开下一局(局号不变)", g2.handNumber === 2);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
