#!/usr/bin/env bash
# Installs the agent skills the DVNT door-POS prompt depends on, project-scoped.
# Run from the dvnt-monorepo root. Every command below was checked against the
# publisher's own docs on 2026-09-19 (links in README.md). Re-run to update.
set -euo pipefail

command -v claude >/dev/null || { echo "Claude Code CLI not found on PATH"; exit 1; }
[ -f pnpm-workspace.yaml ] || { echo "Run this from the dvnt-monorepo root"; exit 1; }

echo "1/6 Stripe: plugin + skills + MCP (official)"
npm install -g @stripe/cli@latest
stripe agent setup --client claude-code --skills --skills-scope local -y

echo "2/6 Anthropic design + engineering skills (official marketplace)"
claude plugin marketplace add anthropics/knowledge-work-plugins || true
claude plugin install design@knowledge-work-plugins
claude plugin install engineering@knowledge-work-plugins

echo "3/6 Anthropic frontend-design, code-review; Expo (official marketplace)"
claude plugin install frontend-design@claude-plugins-official
claude plugin install code-review@claude-plugins-official
claude plugin install expo@claude-plugins-official

echo "4/6 Supabase + Better Auth + Vercel web guidelines"
npx -y skills add supabase/agent-skills --skill supabase --skill supabase-postgres-best-practices -a claude-code -y
npx -y skills add better-auth/skills --skill better-auth-best-practices --skill better-auth-security-best-practices -a claude-code -y
npx -y skills add vercel-labs/agent-skills --skill vercel-react-best-practices --skill web-design-guidelines -a claude-code -y

echo "5/6 ECC verification skills, from the official repo only (not a mirror)"
npx -y skills add https://github.com/affaan-m/ecc --skill verification-loop --skill tdd-workflow --skill security-review --skill database-migrations -a claude-code -y

echo "6/6 no-ai-slop (prose only: UX copy, commit messages, docs)"
npx -y skills add petergyang/no-ai-slop --skill no-ai-slop -a claude-code -y

echo
echo "Done. In Claude Code run /plugin and /hooks to confirm everything loaded."
