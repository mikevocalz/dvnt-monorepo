/**
 * Release regression gate.
 *
 * The first version of this script could not fail on code. It called access()
 * on ten hardcoded paths and substring-matched six headings inside the markdown
 * the same PR wrote. An empty file passed. A test file with every case deleted
 * passed. All ten paths already existed on master, so it asserted nothing the
 * pre-PR tree did not already satisfy, and a reviewer confirmed it by
 * truncating all ten anchors to zero bytes and watching it print
 * "Release regression contract OK".
 *
 * It also ignored docs/workstreams/release-regression-manifest.json, the only
 * machine-readable list of the critical scenarios, so those entries could rot
 * or point nowhere unnoticed.
 *
 * This version makes the manifest load-bearing and asserts the property that
 * actually matters: every critical scenario is covered by something that runs
 * in CI. For each entry it proves, in order:
 *
 *   1. the target exists
 *   2. a test target contains at least one assertion, so a gutted file fails
 *   3. the target is REACHABLE — an npm script matches it, and a workflow runs
 *      that script. Coverage that nothing executes is the failure mode this
 *      repo already has a history of.
 *
 * Modelled on scripts/verify-issuance-invariants.mjs, including its three-way
 * verdict: things that cannot be proven from here become warnings and never
 * affect the exit code, because a gate that is red for unprovable reasons is a
 * gate nobody runs.
 *
 * Usage: node scripts/verify-release-regression.mjs [--json]
 */
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const MANIFEST = "docs/workstreams/release-regression-manifest.json";
const CONTRACT = "docs/workstreams/17-release-regression-gate.md";
const GATE_WORKFLOW = ".github/workflows/release-regression-gate.yml";
const WORKFLOW_DIR = ".github/workflows";

const failures = [];
const warnings = [];
const fail = (check, where, detail) => failures.push({ check, where, detail });
const warn = (check, where, detail) => warnings.push({ check, where, detail });

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

/** Assertion shapes used across this repo: node:test, Deno.test, bare assert. */
const ASSERTION = /\b(test|it|Deno\.test)\s*\(|\bassert(Equals|Strict|\.)?\s*\(/;

async function main() {
  const json = process.argv.includes("--json");

  if (!(await exists(MANIFEST))) {
    fail("manifest-missing", MANIFEST, "The gate reads this file. Without it there is no scenario list to enforce.");
    return report({}, json);
  }

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const scenarios = Array.isArray(manifest.criticalScenarios) ? manifest.criticalScenarios : [];
  if (scenarios.length === 0) {
    fail("manifest-empty", MANIFEST, "criticalScenarios is empty, so this gate would pass vacuously.");
    return report({}, json);
  }

  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const scripts = pkg.scripts ?? {};

  // Every run: line across every workflow, so "does CI execute this" is a
  // lookup rather than an assumption.
  const workflows = new Map();
  for (const name of await workflowFiles()) {
    workflows.set(name, await readFile(path.join(WORKFLOW_DIR, name), "utf8"));
  }
  const allWorkflowText = [...workflows.values()].join("\n");

  /** npm scripts whose command text mentions `needle`. */
  const scriptsMatching = (needle) =>
    Object.entries(scripts)
      .filter(([, cmd]) => cmd.includes(needle))
      .map(([name]) => name);

  /** Is this npm script run by any workflow, directly or via pnpm/npm run? */
  const scriptRunByCI = (name) =>
    new RegExp(`(pnpm|npm|yarn)\\s+(run\\s+)?${name.replace(/[:/]/g, "\\$&")}\\b`).test(allWorkflowText);

  const seenIds = new Set();
  let covered = 0;

  for (const s of scenarios) {
    const where = `${MANIFEST} → ${s.id ?? "(no id)"}`;
    if (!s.id) {
      fail("scenario-no-id", MANIFEST, "A scenario has no id, so a failure could not be attributed.");
      continue;
    }
    if (seenIds.has(s.id)) {
      fail("scenario-duplicate-id", where, `Duplicate id "${s.id}".`);
      continue;
    }
    seenIds.add(s.id);

    if (!s.owner) warn("scenario-no-owner", where, "No owner recorded, so nobody is on the hook for it.");
    if (!s.automation) {
      fail("scenario-no-automation", where, "No automation recorded. A scenario with no automation is a promise, not a gate.");
      continue;
    }

    const kind = s.kind ?? (s.automation.includes(" ") || scripts[s.automation] ? "command" : "test");

    if (kind === "command") {
      const cmd = s.automation.replace(/^pnpm\s+/, "");
      if (!scripts[cmd]) {
        fail("command-not-a-script", where, `"${cmd}" is not a script in package.json. Nothing can run it.`);
        continue;
      }
      if (!scriptRunByCI(cmd)) {
        fail(
          "command-not-in-ci",
          where,
          `pnpm ${cmd} exists but no workflow in ${WORKFLOW_DIR} runs it. ` +
            `Add it as a run: step in ${GATE_WORKFLOW}.`,
        );
        continue;
      }
      covered += 1;
      continue;
    }

    // test and script kinds are both file targets.
    if (!(await exists(s.automation))) {
      fail("target-missing", where, `${s.automation} does not exist.`);
      continue;
    }

    const src = await readFile(s.automation, "utf8");
    if (kind === "test" && !ASSERTION.test(src)) {
      fail(
        "test-has-no-assertion",
        `${s.automation}`,
        "Exists but contains no test() / it() / Deno.test() / assert(). " +
          "This is the hole the previous gate had: presence proves nothing.",
      );
      continue;
    }

    const runners = scriptsMatching(s.automation) ;
    const dirRunners = runners.length
      ? runners
      : scriptsMatching(path.dirname(s.automation));
    if (dirRunners.length === 0) {
      fail(
        "target-unreachable",
        `${s.automation}`,
        "No npm script references it, so no amount of CI runs it. " +
          "Add it to a test script, then make sure a workflow runs that script.",
      );
      continue;
    }
    const inCI = dirRunners.filter(scriptRunByCI);
    if (inCI.length === 0) {
      fail(
        "target-not-in-ci",
        `${s.automation}`,
        `Reached by npm script(s) ${dirRunners.join(", ")}, but no workflow runs any of them. ` +
          `Add one as a run: step in ${GATE_WORKFLOW}.`,
      );
      continue;
    }
    covered += 1;
  }

  // The gate's own wiring. A release gate that never fires on the release
  // branch cannot gate a release, which is the exact lesson the two sibling
  // workflows carry a standing comment about.
  if (!(await exists(GATE_WORKFLOW))) {
    fail("gate-workflow-missing", GATE_WORKFLOW, "The workflow that runs this gate does not exist.");
  } else {
    const wf = await readFile(GATE_WORKFLOW, "utf8");
    const onPush = /^\s{2}push:/m.test(wf);
    if (!onPush) {
      fail(
        "gate-no-push-trigger",
        GATE_WORKFLOW,
        "No push: trigger, so this never runs on master or main. " +
          "bundle-budget.yml and verify-edge-functions.yml both document why: " +
          "listing only pull_request meant merged work was never checked.",
      );
    } else {
      for (const branch of ["master", "main"]) {
        if (!new RegExp(`branches:.*\\b${branch}\\b`).test(wf)) {
          fail("gate-push-branch-missing", GATE_WORKFLOW, `push.branches does not include ${branch}.`);
        }
      }
    }
    // verify:routes reads apps/web, so the filter has to include it or the
    // /feed-prefix regression class never triggers the gate that checks it.
    if (/verify:routes/.test(wf) && !/apps\/web\/\*\*/.test(wf)) {
      fail(
        "gate-paths-missing-web",
        GATE_WORKFLOW,
        "Runs pnpm verify:routes, whose APP_DIR is apps/web/src/app/(frontend), " +
          'but paths: does not include "apps/web/**". A web route change cannot trigger it.',
      );
    }
    if (!/docs\/workstreams\/\*\*|release-regression-manifest\.json/.test(wf)) {
      warn(
        "gate-paths-missing-manifest",
        GATE_WORKFLOW,
        "Editing the manifest does not trigger the gate that validates it.",
      );
    }
  }

  if (!(await exists(CONTRACT))) {
    warn("contract-missing", CONTRACT, "The written contract is gone. Not a code failure, but the scenarios lose their prose.");
  }

  return report(
    {
      scenarios: scenarios.length,
      covered,
      manualChecks: Array.isArray(manifest.releaseCandidateManual) ? manifest.releaseCandidateManual.length : 0,
      workflows: workflows.size,
    },
    json,
  );
}

async function workflowFiles() {
  const { readdir } = await import("node:fs/promises");
  try {
    return (await readdir(WORKFLOW_DIR)).filter((f) => /\.ya?ml$/.test(f));
  } catch {
    return [];
  }
}

function report(summary, json) {
  if (json) {
    console.log(JSON.stringify({ ok: failures.length === 0, summary, failures, warnings }, null, 2));
  } else {
    console.log(
      `release regression gate — ${summary.scenarios ?? 0} critical scenarios, ` +
        `${summary.covered ?? 0} proven to run in CI, ` +
        `${summary.manualChecks ?? 0} manual release checks, ` +
        `${summary.workflows ?? 0} workflows scanned`,
    );
    if (failures.length === 0) {
      console.log("✓ every critical scenario has automation that exists, asserts, and runs in CI");
      console.log("✓ the gate workflow fires on the release branches it guards");
    } else {
      for (const f of failures) console.error(`\n✖ [${f.check}] ${f.where}\n  ${f.detail}`);
      console.error(`\n${failures.length} violation(s).`);
    }
    if (warnings.length > 0) {
      console.log(`\n${warnings.length} warning(s), not fatal:`);
      for (const w of warnings) console.log(`  · ${w.where} — ${w.detail}`);
    }
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

await main();
