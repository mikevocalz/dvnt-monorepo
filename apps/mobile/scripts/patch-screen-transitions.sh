#!/usr/bin/env bash
# Patch react-native-screen-transitions 3.5.2 TypeScript source so app
# typecheck is not blocked by its exported source typings.

set -euo pipefail

TARGET="node_modules/react-native-screen-transitions/src/shared/configs/presets.ts"

if [ ! -f "$TARGET" ]; then
  echo "[patch-screen-transitions] WARNING: $TARGET not found, skipping"
  exit 0
fi

python3 - "$TARGET" <<'PYEOF'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
original = text

if 'import type { ScreenStyleInterpolator } from "../types/animation.types";' not in text:
    text = text.replace(
        'import type { ScreenTransitionConfig } from "../types/screen.types";',
        'import type { ScreenStyleInterpolator } from "../types/animation.types";\n'
        'import type { ScreenTransitionConfig } from "../types/screen.types";',
    )

marker = "export const SharedIGImage = ("
start = text.find(marker)
if start != -1:
    shared = text[start:]
    shared = shared.replace(
        "screenStyleInterpolator: ({\n\t\t\tcurrent,",
        "screenStyleInterpolator: (({\n\t\t\tcurrent,",
        1,
    )
    shared = shared.replace(
        "\t\t},\n\t\ttransitionSpec: {\n\t\t\topen: {\n\t\t\t\tstiffness: 1500,",
        "\t\t}) as ScreenStyleInterpolator,\n\t\ttransitionSpec: {\n\t\t\topen: {\n\t\t\t\tstiffness: 1500,",
        1,
    )
    text = text[:start] + shared

if text != original:
    path.write_text(text)
    print("[patch-screen-transitions] Patched react-native-screen-transitions typings")
else:
    print("[patch-screen-transitions] Already patched")
PYEOF
