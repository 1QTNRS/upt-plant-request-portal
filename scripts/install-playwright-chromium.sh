#!/usr/bin/env bash
# Install Playwright Chromium for CI. Retries apt-based --with-deps when Google's
# Chrome repo serves a transient Hash Sum mismatch, then falls back to the
# bundled browser download only (ubuntu-latest usually already has libs).
set -euo pipefail

clear_apt_cache() {
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get clean || true
    sudo rm -rf /var/lib/apt/lists/* || true
  fi
}

for attempt in 1 2 3; do
  if npx playwright install --with-deps chromium; then
    exit 0
  fi
  echo "Playwright --with-deps install failed (attempt ${attempt}/3)."
  clear_apt_cache
  if [[ "${attempt}" -lt 3 ]]; then
    sleep 15
  fi
done

echo "Falling back to browser-only install after repeated apt/deps failures."
npx playwright install chromium
