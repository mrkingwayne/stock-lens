#!/usr/bin/env bash
# 把 site/（含 data/）強制推到 gh-pages（單一 commit，不累積歷史）
set -e; cd /workspace/stocklens; rm -rf /tmp/slpub; cp -r site /tmp/slpub; touch /tmp/slpub/.nojekyll
cd /tmp/slpub && git init -q -b gh-pages && git add -A && git -c user.name=mrkingwayne -c user.email=mrkingwayne@users.noreply.github.com commit -qm "data $(date +%F)" && git push -qf https://github.com/mrkingwayne/stock-lens.git gh-pages
