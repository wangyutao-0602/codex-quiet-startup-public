#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d 'dist/Aemeath Startup.app' ]; then bash tools/build-macos.sh; fi
open 'dist/Aemeath Startup.app' --args --launch
