// 扫描已连接的 iPhone，用硬件 UDID 登记备用机
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
execFileSync('xcrun', ['devicectl','list','devices','--json-output','/tmp/_dv.json'], {encoding:'utf8'});
const d = JSON.parse(readFileSync('/tmp/_dv.json','utf8'));
const list = d.result.devices
  .filter(x => (x.hardwareProperties?.platform||'').toLowerCase()==='ios')
  .map(x => ({
    name: x.deviceProperties?.name || '?',
    udid: x.hardwareProperties?.udid,
    ios: x.deviceProperties?.osVersionNumber,
    tunnel: x.connectionProperties?.tunnelState,
  }));
console.log(`发现 ${list.length} 台 iPhone:`);
list.forEach(x => console.log(` - ${x.name}  ${x.udid}  iOS ${x.ios}  ${x.tunnel}`));

const f = '.runtime/devices.json';
import {existsSync, mkdirSync, copyFileSync} from 'node:fs';
if (!existsSync('.runtime')) mkdirSync('.runtime', {recursive:true});
if (!existsSync(f)) copyFileSync('devices.example.json', f);
const cfg = JSON.parse(readFileSync(f,'utf8'));
cfg.main.udid = '00008130-001A3D2A1160001C';   // 主力机固定
const other = list.find(x => x.udid && x.udid !== cfg.main.udid);
if (other) {
  cfg.spare = {name: other.name, udid: other.udid, ios: other.ios};
  console.log('已登记备用机:', other.name, other.udid, 'iOS', other.ios);
} else {
  console.log('没有发现第二台设备');
}
writeFileSync(f, JSON.stringify(cfg, null, 2));
