#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -d 'dist/Aemeath Startup.app' ]; then
  open 'dist/Aemeath Startup.app'
else
  bash tools/preview.sh
fi
