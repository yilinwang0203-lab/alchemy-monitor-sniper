// 三个入口 × (S≤650, A≤550) 全量采集
import {connect, tap, swipe, shot, ocr} from './dev.mjs';
import {parseSeconds} from './timer.mjs';
import {writeFile} from 'node:fs/promises';

const FLOAT=/[0Oo]\.\d{5,6}/, norm=s=>(s||'').replace(/^[Oo]/,'0');
const CELLS=[[0.251,0.295],[0.522,0.295],[0.251,0.505],[0.522,0.505],[0.251,0.716],[0.522,0.716]];
const S_BOX=[0.785,0.425], A_BOX=[0.649,0.505];
const BUY=[0.838,0.895], FILTER=[0.19,0.108], RESET=[0.706,0.908], OK=[0.858,0.908];
const ENTRIES=[[0.20,0.500,'AUG'],[0.20,0.650,'腾龙'],[0.20,0.790,'沙鹰']];   // 每张卡片的中心   // 纯赛季列表第 2/3/4 个
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

await connect();
const table=new Map();
const MAXN=50;   // 上限 50 件（条件只有 S 级 + ≤650）

async function panel(){
  const o=await ocr(await shot('p'));
  const lines=(o.lines||[]).map(x=>x.text);
  const seconds=parseSeconds((o.timerLines||[]).map(x=>x.text).join(' '));
  return {float:lines.map(t=>norm((t.match(FLOAT)||[])[0])).find(Boolean)||null,
          lines, seconds, starGold:o.starGold||0};
}

async function collectScreen(limit){
  let n=0, last=null;
  for(let sc=0; sc<8 && table.size<MAXN; sc++){
    const o=await ocr(await shot('col'));
    const items=[];
    for(const [k,col] of [['priceL',0],['priceR',1]])
      for(const t of (o[k]||[])){
        const m=(t.text||'').replace(/[^0-9]/g,'');
        if(!/^[0-9]{2,5}$/.test(m)) continue;
        const ty=t.y-0.12;
        if(ty<0.17||ty>0.80) continue;
        items.push({x:col?0.522:0.251, y:ty, col, price:Number(m)});
      }
    items.sort((a,b)=>a.price-b.price);
    log(`    屏${sc+1} 价格 ${items.map(x=>x.price).join(',')}`);
    if(items.length && items[0].price>limit){ log(`    整屏都超过 ${limit}，收工`); break; }
    for(const it of items){
      if(table.size>=MAXN) break;
      if(it.price>limit) continue;
      await tap(it.x, it.y); await sleep(320);
      let d=await panel();
      if(d.float&&d.float===last) continue;
      if(!d.float) continue;
      last=d.float;
      if((d.starGold||0)<50){ await tap(0.886,0.189); await sleep(280); }
      if(!table.has(d.float)){
        table.set(d.float,{float:d.float,price:it.price,seconds:d.seconds??null,unlockAt:d.seconds?Date.now()+d.seconds*1000:null});
        n++;
      }
    }
    await swipe([0.40,0.82],[0.40,0.305],1000); await sleep(600);  // 2 行 / 4 件（0.515）
  }
  return n;
}

// 先退到「市场」，再点左栏「典藏外观」
for(let i=0;i<6;i++){
  const o=await ocr(await shot('nav'));
  const h=(o.headerLines||[]).map(x=>x.text).join(' ');
  if(h.includes('市场')) break;
  await tap(0.085,0.045); await sleep(1400);
}
await tap(0.088,0.281); await sleep(1900);      // 左栏「典藏外观」
log('已到典藏外观页');

// 每次采集先把赛季选成「王者之剑」（重复选也没关系）
await tap(0.226, 0.208); await sleep(1400);            // 筛选
await tap(0.32, 0.222);  await sleep(1100);            // 赛季下拉
await swipe([0.33,0.62],[0.33,0.30],800); await sleep(700);
await swipe([0.33,0.62],[0.33,0.30],800); await sleep(700);
await tap(0.28, 0.650);  await sleep(1000);            // 王者之剑
await tap(0.5, 0.782);   await sleep(2000);            // 确认（等列表重绘）
log('已选好赛季：王者之剑');

const KEY={AUG:'AUG',腾龙:'腾龙',沙鹰:'鹰'};   // OCR 会把「沙」读成「炒」，只匹配「鹰」
// 每件都重新读左侧列表（采完一件列表位置会变，不能缓存）
async function posOf(k){
  const o=await ocr(await shot('list'));
  const r=(o.list||[]).find(x=>x.text.includes(k));
  return r? r.y+0.05 : null;
}

// 默认三把全采（按钮跑的就是这个）；命令行可用 ONLY=沙鹰 只采一把做测试
const ONLY=process.env.ONLY? process.env.ONLY.split(',') : null;
const TARGETS=ONLY|| ['AUG','腾龙','沙鹰'];
for(const name of TARGETS){
  if(table.size>=MAXN){ log(`表已满 ${MAXN} 件，停止采集`); break; }
  let ey=await posOf(KEY[name]);                       // 当前就在列表页，直接读
  if(ey===null){ log(`   列表里找不到 ${name}，跳过`); continue; }
  log(`   入口 ${name} 在 y=${ey.toFixed(3)}`);
  let hit=false;
  for(let t=0;t<3 && !hit;t++){
    await tap(0.20,ey); await sleep(900);
    const o=await ocr(await shot('entry'));
    const title=(o.title||[]).map(x=>x.text).join('');
    if(title.includes(KEY[name])) hit=true;
    else {
      log(`   ${name} 没选中（当前：${title||'空'}），按列表重新定位`);
      ey=await posOf(KEY[name]); if(ey===null) break;
    }
  }
  if(!hit){ log(`   ${name} 选中失败，跳过这个入口`); continue; }
  await tap(...BUY); await sleep(1900);
  for(const [box,limit,label] of [[S_BOX,650,'S']]){
    await tap(...FILTER); await sleep(900);
    await tap(...RESET);  await sleep(600);
    await tap(...box);    await sleep(450);
    await tap(...OK);     await sleep(1300);
    const n=await collectScreen(limit);
    log(`  ${name} ${label} 级 +${n} 件（累计 ${table.size}）`);
  }
  await tap(0.085,0.045); await sleep(1400);   // 回典藏外观
}
await writeFile('.runtime/table.json',JSON.stringify([...table.values()],null,1));
log(`=== 采集完成，共 ${table.size} 件`);

// 停在三个枪皮页面 → 打开关注页 → 待命
await tap(0.86, 0.13); await sleep(1800);       // 右上角「我的关注」
log('=== 已进入关注页，待命（等你按开始）');

// OCR 守护进程是子进程，不清掉的话 Node 不会自然退出，循环会卡住
process.exit(0);
