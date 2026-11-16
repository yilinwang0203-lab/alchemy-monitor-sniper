// B 版：不建表、不算排名。逐屏逐格读，够近就地守、到点打，打完刷新。
import {connect, tap, swipe, seq, shot, ocr} from './dev.mjs';
import {parseSeconds, readOnce} from './timer.mjs';

const F=/[0Oo]\.\d{5,6}/, norm=s=>(s||'').replace(/^[Oo]/,'0');
const CELLS=[[0.251,0.295],[0.522,0.295],[0.251,0.505],[0.522,0.505],[0.251,0.716],[0.522,0.716]];
const MAIN=[0.804,0.864], DLG=[0.6668,0.7271], STAR=[0.886,0.189], REFRESH=[0.647,0.108];
const NEAR=45, MAXSCREEN=8;   // 每次 2 行，8 次覆盖 16 行
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
import {existsSync} from 'node:fs';
const PAUSED='.runtime/PAUSED';
async function waitIfPaused(){
  let n=0;
  while(existsSync(PAUSED)){ if(n++===0) log('⏸ 已暂停（点击按钮继续）'); await sleep(500); }
  if(n) log('▶️ 继续');
}
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const ts=()=>new Date().toISOString().slice(11,23);   // 毫秒级时刻
const up=async()=>{await swipe([0.40,0.21],[0.40,0.82],1000);await sleep(400);};
const down=async()=>{await swipe([0.40,0.82],[0.40,0.305],1000);await sleep(900);};  // 2 行 / 4 件（0.515）

await connect();

async function panel(t='s'){
  const o=await ocr(await shot(t));
  const lines=(o.lines||[]).map(x=>x.text);
  return {float:lines.map(x=>norm((x.match(F)||[])[0])).find(Boolean)||null,
          seconds:parseSeconds((o.timerLines||[]).map(x=>x.text).join(' ')),
          locked:lines.some(x=>x.includes('公示中')), starGold:o.starGold||0,
          watch:(o.headerLines||[]).some(x=>x.text.includes('我的关注'))};
}

async function fire(sec){
  const t0=Date.now();
  const fresh = await readOnce('f');
  const s2 = (fresh && fresh.seconds!==null && fresh.seconds>0) ? fresh.seconds : sec;
  const unlockAt = Date.now() + s2*1000;
  const startAt  = unlockAt - 5100;
  log(`   读到时剩余 ${s2}s，推算解锁于 ${new Date(unlockAt).toISOString().slice(11,23)}`);
  const w = startAt - Date.now();
  if(w>0) await sleep(w);
  // 一个请求里：主按钮开弹窗 → pause 2 秒 → 200 下狂点
  log(`   下发 ${ts()}（相对解锁 ${((Date.now()-unlockAt)/1000).toFixed(2)}s）`);
  const burst=[{at:MAIN},{wait:300},{at:MAIN},{wait:300},{at:MAIN},{wait:200},{at:MAIN},{wait:300}];
  for(let i=0;i<123;i++) burst.push({at:DLG,hold:20},{wait:33});   // 实测约 68ms/下（试过 39 反而 64ms，这个 driver 不线性）
  const tBurst=Date.now();
  await seq(burst,20);
  const dur=Date.now()-tBurst;
  log(`   下发结束 ${ts()}（相对解锁 ${((Date.now()-unlockAt)/1000).toFixed(2)}s），123 下 / ${(dur/1000).toFixed(1)}s / 约 ${Math.round(dur/123)}ms 一下`);
  await sleep(1100);
  const p=await panel('v');
  const ok=/随机|查看结果|队列中/.test((p.lines||[]).join(' ')) || false;
  // 关结果弹窗
  let q=p;
  for(let k=0;k<2 && !q.watch;k++){
    await tap(0.786,0.166); await sleep(600); q=await panel('c');
  }
  // 不动收藏（用户手动管理关注）
  // 抢完按两次刷新，确保列表状态真的更新
  await tap(...REFRESH); await sleep(600);
  await tap(...REFRESH); await sleep(800);
  return ok;
}

// 刷新前必读第 5、6 格（最后剩的件常常只出现在这两格）
async function readTail(){
  for(const c2 of CELLS.slice(4)){
    await waitIfPaused();
    await tap(...c2); await sleep(250);
    const q = await panel('r');
    log(`   补读 ${q.float||'-'} / ${q.seconds===null?'无':Math.round(q.seconds)+'s'}`);
    if(q.float && q.seconds!==null && q.seconds>7 && q.seconds<=NEAR){
      log(`打 ${q.float} 剩 ${q.seconds}s`);
      const ok=await fire(q.seconds);
      log(`   ${ok?'✅ 进队列':'❌ 没进'}`);
      return true;
    }
  }
  return false;
}

for(;;){
  await waitIfPaused();
  await tap(...REFRESH); await sleep(900);
  let fired=false;
  let passReads=0;                   // 本轮读到多少件
  let prev=[];                       // 上一屏的 6 个成色
  for(let sc=0; sc<40 && !fired; sc++){   // 不限屏数，一直扫到底为止（40 只是保险）
    const cur=[];
    let bottom=false;
    let cellIdx=0;
    for(const c of CELLS.slice(0,4)){   // 每屏只读前 4 格（后 2 格下一屏会读到）
      cellIdx++;
      await waitIfPaused();
      await tap(...c); await sleep(250);
      let p=await panel('r');
      log(`   读 ${p.float||'-'} / ${p.seconds===null?'无':Math.round(p.seconds)+'s'}`);
      if(!p.float){
        // 第一屏前 3 格都空 → 关注里没货，直接退出，不用扫完 8 屏
        if(sc===0 && cellIdx>=3 && cur.length===0){
          log('   第一屏前 3 格都是空 → 关注里没货了，退出');
          process.exit(0);
        }
        continue;
      }
      cur.push(p.float); passReads++;

      // ① 先判断这一格能不能打（能打立刻打，不再往下读）
      await waitIfPaused();
      if(p.seconds!==null && p.seconds>7 && p.seconds<=NEAR){
        log(`打 ${p.float} 剩 ${p.seconds}s`);
        const ok=await fire(p.seconds);
        log(`   ${ok?'✅ 进队列':'❌ 没进'}`);
        fired=true; break;
      }

      // ② 不能打，再判断是不是到底（第 3、4 格与上一屏重复）
      if(cur.length===4 && prev.length>=4 && prev.includes(cur[2]) && prev.includes(cur[3])){
        log('   第3、4格与上一屏重复 → 到底，补读第5、6格');
        fired = await readTail();
        if(fired) break;
        bottom=true;
      }
    }
    if(fired) break;
    if(bottom){
      const r=[];
      for(let i=0;i<10;i++) r.push({at:REFRESH,hold:20},{wait:33});
      await seq(r,20);
      await sleep(900);
      break;
    }
    prev=cur;
    await waitIfPaused(); await down();
  }
  if(!fired && passReads===0){
    log('关注里没货了（整轮读不到任何件）→ 退出');
    process.exit(0);
  }
  if(!fired){
    // 刷新前先补读第 5、6 格
    fired = await readTail();
  }
  if(!fired){
    // 到底了：不往回滑，直接一次性下发 10 下刷新
    const r=[];
    for(let i=0;i<10;i++) r.push({at:REFRESH,hold:20},{wait:33});
    await seq(r,20);
    await sleep(900);
  }
}
