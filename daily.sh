#!/usr/bin/env bash
# 每日更新（可續跑）：跳過今天已更新的代號，分批 20 支、每批 timeout 12 分，最後部署
cd /workspace/stocklens
LOCK=/tmp/stocklens_daily.lock; exec 9>$LOCK; flock -n 9 || { echo "already running"; exit 0; }
START=$(date +%s); TODAY=$(date +%F)
ALL=$( { python3 -c "import build;print(' '.join(build.universe()))"; ls site/data | grep -v index.json | sed 's/\.json$//'; } | tr ' ' '\n' | grep . | sort -u)
TODO=$(for t in $ALL; do f=site/data/$t.json; [ -f "$f" ] && [ "$(date -r "$f" +%F)" = "$TODAY" ] || echo $t; done)
echo "$(date) start: $(echo $TODO | wc -w) todo" >> daily.log
echo "$TODO" | grep . | split -l 10 - /tmp/sldaily_chunk_ 2>/dev/null
for c in /tmp/sldaily_chunk_*; do [ -f "$c" ] || continue; timeout 12m python3 build.py $(cat $c) >> daily.log 2>&1 || echo "chunk $c err" >> daily.log; rm -f "$c"; done
./deploy.sh >> daily.log 2>&1 && echo "DEPLOY_OK $(( $(date +%s)-START ))s" >> daily.log
