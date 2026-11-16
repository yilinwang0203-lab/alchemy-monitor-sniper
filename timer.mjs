// 读倒计时的可信版本：连读两次，差值必须和真实耗时接近，否则重读。
// 旧 OCR 会把倒计时前的图标认成数字（2分6秒 → 62分6秒），单次读数不可信。
import {connect, shot, ocr} from './dev.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function parseSeconds(text) {
  const t = text.normalize('NFKC').replace(/\s/g, '');
  if (/天/.test(t)) return null; // 远期的先不管
  const m = t.match(/(\d+)分(\d+)秒/) || t.match(/(\d+)秒/);
  if (!m) return null;
  let mm = m.length === 3 ? Number(m[1]) : 0;
  const ss = Number(m[m.length - 1]);
  if (ss > 59) return null;
  // 图标被认成数字，会在分钟位前多插一个 6：0分5秒→60分5秒、2分6秒→62分6秒。
  // 超过 1 小时游戏会显示「小时/天」，所以 ≥60 分一律回退 60。
  if (mm >= 60) mm -= 60;
  return mm * 60 + ss;
}

// 读一次：取 timer 与 panel 两个来源里最合理的那个
export async function readOnce(tag = 'live') {
  const f = await shot(tag);
  const o = await ocr(f);
  const cands = [];
  for (const line of [...(o.timerLines || []), ...(o.lines || [])]) {
    if (!/后解锁购买|剩余/.test(line.text) && !/秒/.test(line.text)) continue;
    const s = parseSeconds(line.text);
    if (s !== null) cands.push({s, text: line.text.trim()});
  }
  const locked = [...(o.lines || []), ...(o.timerLines || [])].some(x => x.text.includes('公示中'));
  const texts = (o.lines || []).map(x => x.text);
  const watch = (o.headerLines || []).some(x => x.text.includes('我的关注'));
  const head = (o.headerLines || []).map(x => x.text).join(' ');
  if (!cands.length) return {seconds: null, locked, lines: texts, watch, head, raw: [...(o.timerLines || []).map(x => x.text)]};
  cands.sort((a, b) => a.s - b.s); // 多个候选取最小：污染通常是"多加一位"
  return {seconds: cands[0].s, text: cands[0].text, locked, lines: texts, watch, head, all: cands};
}

// 可信读数：两次读数差值应≈真实耗时（容差 2.5s）
export async function readTrusted(gapMs = 4000) {
  const a = await readOnce('trust_a');
  const tA = Date.now();
  await sleep(gapMs);
  const b = await readOnce('trust_b');
  const tB = Date.now();
  const elapsed = (tB - tA) / 1000;
  if (a.seconds === null || b.seconds === null) return {ok: false, a, b, reason: '读取失败'};
  const drop = a.seconds - b.seconds;
  const ok = Math.abs(drop - elapsed) <= 2.5 && b.seconds >= 0;
  return {ok, a, b, elapsed, drop, reason: ok ? null : `两次读数不自洽 (差 ${drop}s / 实耗 ${elapsed.toFixed(1)}s)`};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await connect();
  console.log(JSON.stringify(await readTrusted(), null, 2));
}
