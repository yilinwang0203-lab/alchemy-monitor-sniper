#!/bin/bash
# 监控暂停按钮：一旦按下 PAUSED，就把当前日志的最后 80 行存成快照
cd "$(dirname "$0")/.." || exit 1
mkdir -p .runtime
while true; do
  if [ -f .runtime/PAUSED ]; then
    LOG=$(ls -t .runtime/*.log 2>/dev/null | grep -v last_pause | head -1)
    if [ -n "$LOG" ] && [ ! -f .runtime/.paused_flag ]; then
      { echo "=== 暂停快照 $(date '+%H:%M:%S') 来源: $LOG ==="; tail -80 "$LOG"; } > .runtime/last_pause.log
      touch .runtime/.paused_flag
    fi
  else
    rm -f .runtime/.paused_flag
  fi
  sleep 1
done
