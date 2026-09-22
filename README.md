# 德州扑克 · AI 单机版（安卓）

离线可用的 6 人桌德州扑克，你 1 人对战 5 个分档 AI，本地保存进度，附教练分析与概率显示。

## 功能
- **标准 6 人桌**：自动发牌、轮转庄家、收小盲/大盲、完整下注（弃牌/过牌/跟注/加注/全下）、边池结算、淘汰制。
- **5 个分档 AI**：简单 / 中等 / 困难；翻牌前用 Chen 公式起手牌力，翻牌后用胜率 + 底池赔率决策，困难档会偶发诈唬。
- **开局 / 续局**：随时退出，下次启动点「继续上一局」精确回到上次状态（存档在本地）。
- **日志**：完整对局记录。
- **教练分析**：每次你行动后，对比「标准打法」给出差异与原因（如“AA 应该加注”“胜率低于底池赔率应弃牌”）。
- **概率显示**：你的成牌概率（同花/顺子等精确枚举）+ 当前胜率（蒙特卡洛估算，按对手随机范围，不偷看 AI 手牌）。

## 目录结构
```
www/            # 应用本体（会被打进 APK）
  index.html    页面结构
  style.css     样式
  app.js        界面编排：渲染 + 驱动 AI + 存档
  core.js       引擎：发牌/牌型/边池/下注状态机
  odds.js       概率：成牌概率 + 胜率
  ai.js         AI 决策 + 标准打法基线
  coach.js      教练对比分析
tests/          Node 测试（不参与打包）
  test.js       引擎/AI/概率/教练单元测试
  smoke.js      界面编排冒烟测试
capacitor.config.json
package.json
```

## 本地测试（可选，无需安卓环境）
```bash
npm test
```
会跑 21 项逻辑测试 + 6 项界面编排测试。

## 直接在浏览器预览
双击打开 `www/index.html` 即可玩（纯本地，无网络）。

## 打包成安卓 APK
前置：安装 [Node.js](https://nodejs.org)（≥18）和 [Android Studio](https://developer.android.com/studio)（含 Android SDK）。

```bash
npm install              # 安装 Capacitor
npx cap add android      # 生成 android 原生工程（首次）
npx cap sync android     # 把 www 同步进原生工程
npx cap open android     # 用 Android Studio 打开
```

在 Android Studio 里：
1. 等 Gradle 同步完成；
2. 菜单 **Build → Build Bundle(s) / APK(s) → Build APK(s)**；
3. 完成后右下角「locate」找到 `app-debug.apk`，传到手机安装即可。

（命令行也可：`cd android && gradlew.bat assembleDebug`，产物在 `android/app/build/outputs/apk/debug/`。）

### 安装注意
- 手机需允许「安装未知来源应用」；
- 若用 debug APK 正式长期用，可再出 release 签名版（Android Studio 里配置签名即可）。

## 说明
- 教练里的“标准打法”是**入门级标准**（起手牌范围表 + 底池赔率），不是真正的 GTO 求解器结果，重在给出可解释的对比与学习。
- 胜率是**对随机范围**的估算，不会偷看 AI 真实手牌，公平且有学习价值。
