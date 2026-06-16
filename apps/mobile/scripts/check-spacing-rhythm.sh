#!/usr/bin/env bash
# Surfaces inline padding/margin values that aren't on the spacing grid
# (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64). Does NOT fail the build —
# print-only, intended as a polish-debt scoreboard.
#
# Usage:  bash scripts/check-spacing-rhythm.sh
#
# Aligns with lib/theme/ and the master polish prompt's spacing scale.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ON_GRID='^(0|2|4|8|12|16|24|32|48|64)$'

echo "Off-grid padding/margin literals (NativeWind class equivalents preferred):"
echo "  on-grid scale = 0 2 4 8 12 16 24 32 48 64"
echo "─────────────────────────────────────────────"

grep -rEon "(padding|margin)(Top|Bottom|Left|Right|Horizontal|Vertical)?: ?[0-9]+" \
  --include="*.tsx" --include="*.ts" \
  app components src lib 2>/dev/null \
  | awk -F: -v ON_GRID="$ON_GRID" '
      {
        match($0, /[0-9]+$/)
        n = substr($0, RSTART, RLENGTH)
        if (n !~ ON_GRID) print $1 ":" $2 "  " $3
      }
    ' \
  | sort \
  | uniq -c \
  | sort -rn \
  | head -40

echo "─────────────────────────────────────────────"
echo "(Top 40 only.)"
