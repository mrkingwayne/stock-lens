#!/usr/bin/env bash
# 每日更新全部代號（S&P500 + extra_tickers + 已存在的）→ 部署
cd /workspace/stocklens
EX=$(ls site/data | grep -v index.json | sed 's/\.json$//' | tr '\n' ' ')
python3 build.py $(python3 -c "import build;print(' '.join(build.universe()))") $EX > daily.log 2>&1
./deploy.sh
