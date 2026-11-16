#!/bin/bash
# 循环：抢购 → 关注没货 → 采集 → 再抢 → 无限循环（带体检与重试）
cd "$(dirname "$0")" || exit 1
export PATH="$(dirname "$(command -v node || echo /usr/local/bin/node)"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export OCR_BIN="$PWD/ocrl"
LOG=".runtime/loop.log"
log(){ echo "$(date '+%H:%M:%S') $*" >> "$LOG"; }

health(){
  if node check.mjs >> "$LOG" 2>&1; then return 0; fi
  log "WDA/会话异常，等 15 秒后重试"
  sleep 15
  node check.mjs >> "$LOG" 2>&1
}

run_phase(){   # $1=脚本名 $2=说明
  local tries=0
  while [ $tries -lt 3 ]; do
    health || { log "$2：会话仍不可用，等待 30 秒"; sleep 30; tries=$((tries+1)); continue; }
    log "--- 开始$2"
    node "$1" >> "$LOG" 2>&1
    local rc=$?
    log "--- $2结束（退出码 $rc）"
    [ $rc -eq 0 ] && return 0
    log "$2异常退出，重试"
    tries=$((tries+1)); sleep 10
  done
  return 1
}

log "=== 循环启动"
while true; do
  while [ -f .runtime/PAUSED ]; do sleep 2; done
  run_phase raidb.mjs "抢购"
  while [ -f .runtime/PAUSED ]; do sleep 2; done
  run_phase collect3.mjs "采集"
  sleep 3
done
