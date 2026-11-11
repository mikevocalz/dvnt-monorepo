import path from 'node:path';

/** Match a concrete test file, never merely its directory or a sibling file. */
export function scriptReferencesTarget(command, target) {
  const tokens = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  return tokens.some((raw) => {
    const token = raw.replace(/^(["'])(.*)\1$/, '$2').replace(/^\.\//, '');
    if (token === target) return true;
    // These are shell file globs, not command names, flags or npm script names.
    if (!token.includes('/') || !/[?*\[{}]/.test(token) || token.startsWith('-')) return false;
    return path.posix.matchesGlob(target, token);
  });
}
