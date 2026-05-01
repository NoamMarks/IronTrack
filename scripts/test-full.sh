#!/bin/bash
# ─── IronTrack Master Test Suite ─────────────────────────────────────────────
# Runs all test layers and prints an executive summary.
# Usage: npm run test:full

set -e

PASS=0
FAIL=0
RESULTS=()

run_layer() {
  local name="$1"
  shift
  echo ""
  echo "━━━ $name ━━━"
  if "$@" 2>&1; then
    RESULTS+=("  ✅ $name: Pass")
    PASS=$((PASS + 1))
  else
    RESULTS+=("  ❌ $name: FAIL")
    FAIL=$((FAIL + 1))
  fi
}

echo "╔══════════════════════════════════════════════════════╗"
echo "║        IRONTRACK — MASTER TEST SUITE                ║"
echo "╚══════════════════════════════════════════════════════╝"

# Layer 1: Regression (Vitest unit + integration)
run_layer "Regression (Vitest)" npx vitest run --run

# Layer 2: Type Check (frontend + serverless API)
run_layer "Type Check (tsc)" npx tsc --noEmit
run_layer "Type Check (api)" npx tsc -p api/tsconfig.json --noEmit

# Layer 3: Lint
run_layer "Lint (ESLint)" npx eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0

# Layer 4: Playwright E2E
run_layer "Smoke/Sanity (Playwright)" npx playwright test --grep "Smoke|Sanity"
run_layer "Coach Creation Flow (Playwright)" npx playwright test --grep "Coach Creation"
run_layer "Trainee Logging Flow (Playwright)" npx playwright test --grep "Trainee Logging"

# ─── Executive Summary ───────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║           EXECUTIVE SUMMARY                         ║"
echo "╠══════════════════════════════════════════════════════╣"
for r in "${RESULTS[@]}"; do
  echo "║ $r"
done
echo "╠══════════════════════════════════════════════════════╣"
TOTAL=$((PASS + FAIL))
echo "║  Total: $PASS/$TOTAL passed"
if [ $FAIL -eq 0 ]; then
  echo "║  🏆 ALL LAYERS GREEN — Ship it!"
else
  echo "║  ⚠️  $FAIL layer(s) failed — investigate above."
fi
echo "╚══════════════════════════════════════════════════════╝"

# Exit with failure if any layer failed
[ $FAIL -eq 0 ]