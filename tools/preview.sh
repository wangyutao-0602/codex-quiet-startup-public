#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
printf 'Preview: http://127.0.0.1:8765\nCtrl+C to stop.\n'
python3 -m http.server 8765 --bind 127.0.0.1
