// 切换使用哪台手机： node use.mjs main | spare
import {readFileSync, writeFileSync} from 'node:fs';
const f = '.runtime/devices.json';
const cfg = JSON.parse(readFileSync(f, 'utf8'));
const want = process.argv[2];
if (!want || !cfg[want]) {
  console.log('当前设备:', cfg.active, '→', cfg[cfg.active].name, cfg[cfg.active].udid || '(未登记)');
  console.log('可用:', Object.keys(cfg).filter(k => k !== 'active').join(' / '));
  process.exit(0);
}
if (!cfg[want].udid) { console.log(`❌ ${want} 还没登记 UDID，先插上手机并跑 node scan-devices.mjs`); process.exit(1); }
cfg.active = want;
writeFileSync(f, JSON.stringify(cfg, null, 2));
console.log(`✅ 已切换到 ${cfg[want].name}（${cfg[want].udid}）`);
