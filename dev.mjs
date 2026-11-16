// 设备层：Appium / WDA 的最小封装。只做四件事：取屏、点、连点、OCR。
// 所有坐标都是归一化 (0..1)，内部换算成 WDA 的 point 坐标系（横屏 932x430）。
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const RUNTIME = join(ROOT, '.runtime');

const SESSION_DIR = process.env.SESSION_DIR || join(ROOT, '.runtime');
const OCR_BIN = process.env.OCR_BIN || join(ROOT, 'ocrl');
const BASE = 'http://127.0.0.1:4723';

let sessionId = null;
let rect = null;

// ==== 自愈：会话失效时自动重建 ====
// 设备：优先环境变量，其次 .runtime/devices.json 里的 active
function resolveUdid() {
  if (process.env.UDID) return process.env.UDID;
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, '.runtime/devices.json'), 'utf8'));
    const cur = cfg[cfg.active];
    if (cur && cur.udid) return cur.udid;
  } catch {}
  throw new Error('未配置设备：请填 .runtime/devices.json，或用 UDID 环境变量');
}
const UDID = resolveUdid();
const TEAM = process.env.DEV_TEAM || '';            // 你的 Apple 开发者团队 ID（10 位）
const WDA_BUNDLE = process.env.WDA_BUNDLE || 'local.webdriveragent.runner';  // 自定义 WDA 包名，必须唯一
let recovering = false;

async function createSession() {
  const body = {capabilities: {alwaysMatch: {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': UDID,
    'appium:xcodeOrgId': TEAM,
    'appium:xcodeSigningId': 'Apple Development',
    'appium:updatedWDABundleId': WDA_BUNDLE,
    'appium:allowProvisioningDeviceRegistration': true,
    'appium:showXcodeLog': false,
    'appium:newCommandTimeout': 0,
    'appium:wdaLaunchTimeout': 180000,
    'appium:wdaConnectionTimeout': 180000,
    'appium:useNewWDA': false,
    'appium:noReset': true,
    'appium:shouldUseSingletonTestManager': false,
  }}};
  const r = await fetch(`${BASE}/session`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body), signal: AbortSignal.timeout(300000),
  });
  const j = await r.json();
  const id = j.value?.sessionId;
  if (!id) throw new Error('重建会话失败: ' + (j.value?.message || r.status));
  sessionId = id;
  try {
    await writeFile(join(SESSION_DIR, 'session.json'),
      JSON.stringify({sessionId: id, phase: 'connected', connectedAt: new Date().toISOString()}, null, 2));
  } catch {}
  rect = null;
  return id;
}

export async function recover() {
  if (recovering) return false;
  recovering = true;
  try {
    sessionId = null; rect = null;
    await createSession();
    rect = await call('/window/rect');
    console.log(new Date().toISOString().slice(11,19), '♻️ 会话已自动重建');
    return true;
  } catch (e) {
    console.log(new Date().toISOString().slice(11,19), '❌ 自动重建失败:', e.message);
    return false;
  } finally { recovering = false; }
}

const SESSION_ERR = /session|terminated|not started|invalid|no such|disconnected/i;

export async function connect() {
  if (sessionId) return sessionId;
  const j = JSON.parse(await readFile(join(SESSION_DIR, 'session.json'), 'utf8'));
  if (!j.sessionId) throw new Error('没有活动会话：先跑 connect.mjs connect');
  sessionId = j.sessionId;
  rect = await call('/window/rect');
  return sessionId;
}

async function call(path, method = 'GET', body, timeout = 20000) {
  const r = await fetch(`${BASE}/session/${sessionId}${path}`, {
    method,
    headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const j = await r.json();
  if (!r.ok || j.value?.error) {
    const msg = j.value?.message || `HTTP ${r.status}`;
    // 会话类错误 → 自动重建一次再重试
    if (SESSION_ERR.test(msg) && !recovering) {
      if (await recover()) return call(path, method, body, timeout);
    }
    throw new Error(msg);
  }
  return j.value;
}

// 保险：确认前台是三角洲，否则拒绝操作
export async function assertGame() {
  if (!sessionId) await connect();
  const j = await call('/execute/sync', 'POST', {script: 'mobile: activeAppInfo', args: []});
  if (j?.bundleId !== 'com.tencent.tmgp.dfm') throw new Error(`前台不是三角洲（${j?.bundleId}），已中止`);
  return true;
}

export function size() {
  if (!rect) throw new Error('未连接');
  return {w: rect.width, h: rect.height}; // 932 x 430 (points)
}

const px = (x, y) => ({x: Math.round(x * rect.width), y: Math.round(y * rect.height)});

// 单击
let wdaSid = null;
export async function wdaInit() {
  const j = await (await fetch('http://127.0.0.1:8100/status')).json();
  wdaSid = j.sessionId;
  return wdaSid;
}

export async function tap(x, y) {
  if (!rect) await connect();
  if (!wdaSid) await wdaInit();
  const px2 = {x: Math.round(x * rect.width), y: Math.round(y * rect.height)};
  const r = await fetch(`http://127.0.0.1:8100/session/${wdaSid}/wda/tap`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(px2),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt.slice(0, 120));
  return {value: null};
}

// 连点：一次 HTTP 请求下发 n 下，服务端按 W3C actions 顺序执行。
// 比逐次调 mobile: tap 少 n-1 个往返（每次往返 ~100-200ms）。
export async function spam(x, y, n = 8, gapMs = 130, holdMs = 30) {
  const p = px(x, y);
  const seq = [];
  for (let i = 0; i < n; i++) {
    seq.push({type: 'pointerMove', duration: 0, x: p.x, y: p.y, origin: 'viewport'});
    seq.push({type: 'pointerDown', button: 0});
    seq.push({type: 'pause', duration: holdMs});
    seq.push({type: 'pointerUp', button: 0});
    if (i < n - 1) seq.push({type: 'pause', duration: gapMs});
  }
  return call('/actions', 'POST', {
    actions: [{type: 'pointer', id: 'finger1', parameters: {pointerType: 'touch'}, actions: seq}],
  });
}

// 滑动（翻页/拖动列表）
export async function swipe(from, to, ms = 300) {
  const a = px(from[0], from[1]), b = px(to[0], to[1]);
  const seq = [
    {type: 'pointerMove', duration: 0, x: a.x, y: a.y, origin: 'viewport'},
    {type: 'pointerDown', button: 0},
    {type: 'pointerMove', duration: ms, x: b.x, y: b.y, origin: 'viewport'},
    {type: 'pause', duration: 350},                                // 到位后停住
    {type: 'pointerMove', duration: 0, x: b.x, y: b.y, origin: 'viewport'},  // 原地再报一次，速度归零
    {type: 'pause', duration: 120},                                // 再稳一下
    {type: 'pointerUp', button: 0},
  ];
  return call('/actions', 'POST', {
    actions: [{type: 'pointer', id: 'finger1', parameters: {pointerType: 'touch'}, actions: seq}],
  });
}

export async function shot(tag = 'frame') {
  await mkdir(RUNTIME, {recursive: true});
  const b64 = await call('/screenshot', 'GET', undefined, 30000);
  const path = join(RUNTIME, `${tag}.png`);
  await writeFile(path, Buffer.from(b64, 'base64'));
  return path;
}

// 常驻 OCR 守护进程：避免每次 spawn 的 ~200ms
let ocrChild = null, ocrBuf = '', ocrWaiters = [];
function ensureOcr() {
  if (ocrChild) return;
  const bin = process.env.OCR_BIN || join(ROOT, 'ocrd');
  ocrChild = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  ocrChild.stdout.setEncoding('utf8');
  ocrChild.stdout.on('data', d => {
    ocrBuf += d;
    let i;
    while ((i = ocrBuf.indexOf('\n')) >= 0) {
      const line = ocrBuf.slice(0, i); ocrBuf = ocrBuf.slice(i + 1);
      const w = ocrWaiters.shift();
      if (!w) continue;
      try { w.resolve(JSON.parse(line)); } catch (e) { w.reject(e); }
    }
  });
  ocrChild.on('exit', () => { ocrChild = null; });
}
export function ocr(path) {
  ensureOcr();
  return new Promise((resolve, reject) => {
    ocrWaiters.push({ resolve, reject });
    ocrChild.stdin.write(path + '\n');
  });
}
function ocrOld(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(OCR_BIN, [path]);
    let out = '', err = '';
    const t = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('OCR 超时')); }, 15000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(t); reject(e); });
    child.on('exit', c => {
      clearTimeout(t);
      if (c !== 0) return reject(new Error(err || 'OCR 失败'));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}


// 任意点击序列，一次请求下发。steps: [{at:[x,y]}|{wait:ms}]
export async function seq(steps, hold = 25) {
  if (!rect) await connect();
  const acts = [];
  let last = null;
  for (const s of steps) {
    if (s.wait !== undefined) { acts.push({type: 'pause', duration: s.wait}); continue; }
    const x = Math.round(s.at[0] * rect.width), y = Math.round(s.at[1] * rect.height);
    const key = x + ',' + y;
    if (key !== last) { acts.push({type: 'pointerMove', duration: 0, x, y, origin: 'viewport'}); last = key; }
    acts.push({type: 'pointerDown', button: 0});
    acts.push({type: 'pause', duration: s.hold ?? hold});
    acts.push({type: 'pointerUp', button: 0});
  }
  const t = Date.now();
  if (!wdaSid) await wdaInit();
  const r = await fetch(`http://127.0.0.1:8100/session/${wdaSid}/actions`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({actions: [{type: 'pointer', id: 'finger1', parameters: {pointerType: 'touch'}, actions: acts}]}),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt.slice(0, 120));
  return Date.now() - t;
}

// 页面判定：以「我的关注」页头为锚
export function isWatchlist(o) {
  return o.headerLines?.some(x => x.text.includes('我的关注'));
}
