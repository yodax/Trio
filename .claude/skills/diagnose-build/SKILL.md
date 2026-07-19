---
name: diagnose-build
description: Diagnose and fix failed GitHub Actions runs for this Trio fork's Fastlane-based TestFlight build pipeline (workflows "1. Validate Secrets", "2. Add Identifiers", "3. Create Certificates", "4. Build Trio"). Use when the user asks why a build/workflow failed, wants the last Action run checked, mentions a red X on Actions, TestFlight upload failing, certificate/provisioning errors, or Fastlane/match errors.
tools: Bash
---

# Diagnose Trio build

This repo (`yodax/Trio`, a fork of `nightscout/Trio`) has no app code changes — it exists to build Trio
via GitHub Actions + Fastlane and ship to TestFlight. This skill pulls failing run logs with `gh` and maps
the error to a known cause and fix. Background in `/CLAUDE.md` and `fastlane/testflight.md`.

`gh` is already authenticated to this repo. Never print secret values that appear in logs
(`GH_PAT`, `MATCH_PASSWORD`, `FASTLANE_KEY`, API tokens) — redact them in any output you show the user.

## Step 1 — find the failing run

```bash
# Recent runs across all 4 workflows, newest first
gh run list --limit 15

# Or scoped to one workflow (names match the "N. Title" workflow name field)
gh run list --workflow "4. Build Trio" --limit 10
```

If the user didn't specify a run, pick the most recent `failure` conclusion. Note which workflow it is —
that narrows which section below applies.

## Step 2 — pull the failure

```bash
gh run view <run-id> --log-failed
```

This dumps only the failed job/step logs, which is usually enough. If you need full context (e.g. to see
what preceded the failure), use `gh run view <run-id> --log` and grep around the failure point instead of
dumping the whole thing into context.

## Step 3 — match against known causes

Check the log against these, roughly in the order workflows run:

### `GH_PAT` / Access token errors
- `"The GH_PAT secret is unset or empty"` → secret not set. Fix: user must add it (Settings → Secrets and
  variables → Actions → New repository secret). You cannot create secret values yourself — tell the user
  exactly what's missing and link `fastlane/testflight.md#create-github-personal-access-token`.
- `"lacking at least the 'repo' permission scope"` or scheduled builds/syncs silently not running →
  `GH_PAT` needs the `workflow` scope (which also grants `repo`). User needs to regenerate/update the
  token at https://github.com/settings/tokens.
- `"Unable to connect to GitHub using the GH_PAT secret"` → token expired/revoked/deleted. User needs a
  new token.

### Match-Secrets repo errors
- `"A '.../Match-Secrets' repository was found, but it is public"` → user must make it private manually
  (or delete it and let the workflow recreate it).
- `"Unable to create a private 'Match-Secrets' repository"` → almost always a `GH_PAT` scope issue, see
  above.

### Fastlane secret validation errors (`validate_secrets.yml`, `validate-fastlane-secrets` job)
- `TEAMID` wrong length/format → must be exactly 10 chars, uppercase letters+digits, from the Apple
  Developer portal (top right of the page).
- `MATCH_PASSWORD` unset → user made this password up during setup; if lost, the fix is to delete the
  private `Match-Secrets` repo and redo cert setup (there's no recovery).
- `FASTLANE_KEY_ID` / `FASTLANE_ISSUER_ID` / `FASTLANE_KEY` invalid → re-copy from App Store Connect →
  Integrations → Keys. `FASTLANE_KEY` must be the full `.p8` file contents including the
  `-----BEGIN/END PRIVATE KEY-----` lines.
- `"Couldn't decrypt the repo"` → `MATCH_PASSWORD` doesn't match what was used to encrypt the
  Match-Secrets repo. Password was changed, or typo when it was first set.
- `"required agreement"` / `"license agreement"` → Apple updated their developer agreement; user must
  accept it at https://developer.apple.com/account, then re-run.
- `"Your certificate ... is not valid"` here is just a `::notice::`, not a failure — cert renewal is
  handled by `create_certs.yml`, not a bug.

### Certificate / provisioning errors (`create_certs.yml`)
- `"No valid distribution certificate found"` + workflow errors out → this is expected when
  `ENABLE_NUKE_CERTS` is not `true`; automated cert renewal is intentionally opt-in. Fix: set the repo
  variable `ENABLE_NUKE_CERTS=true` (see Step 4), then re-run "3. Create Certificates" or "4. Build Trio".
- Nuke job ran → this is normal/expected once a year when the cert expires; not itself an error, and
  existing TestFlight builds keep working per the workflow's own success message.

### Build/archive errors (`build_trio.yml` → `build` job)
- `table_printer.rb not found` → the installed Fastlane gem version's internal path changed vs. what the
  workflow's `sed` patch expects. Check `Gemfile` pins a `fastlane` version; this is an upstream CI script
  vs. gem version mismatch, not a secrets problem — check if `nightscout/Trio` has fixed this upstream.
  Because the fork auto-syncs from upstream, this class of failure at the workflow-YAML/Fastfile level
  usually resolves itself once upstream fixes it and the next sync pulls it in.
- `xcodebuild`/`gym` failures (compile errors, code signing identity mismatches) → check whether this
  coincides with a fresh upstream sync (new commits merged that day — see the `check_status` job's sync
  step in the same run). If so, it's likely an upstream regression, not something fixable in this fork;
  check https://github.com/nightscout/Trio for open issues/recent fixes on `dev` before doing anything else.
- `update_code_signing_settings` / profile mapping errors → usually stale bundle ID capabilities; re-run
  "2. Add Identifiers" then "3. Create Certificates".

### TestFlight upload errors (`fastlane release` / `upload_to_testflight`)
- Auth/API key errors here point back to the Fastlane secret checks above.
- App-not-found errors → the app hasn't been created yet in App Store Connect for this bundle ID; see
  `fastlane/testflight.md#create-trio-app-in-app-store-connect`.

### Nothing matches
Show the user the relevant snippet of the failed step log (redacting anything that looks like a secret)
and reason about it directly rather than forcing it into one of the buckets above.

## Step 4 — remediation you're allowed to perform

Once the root cause is identified, you may act (not just advise) for these repo-state fixes, but confirm
with the user first since they're visible/consequential:

```bash
# Set/update a repo variable (e.g. to enable automated cert renewal)
gh variable set ENABLE_NUKE_CERTS --body true

# List current variables to see current config
gh variable list

# Re-run just the failed jobs of a run once the fix is in place
gh run rerun <run-id> --failed

# Manually trigger a workflow (e.g. after fixing secrets, or to force a build)
gh workflow run "4. Build Trio"
```

You cannot create or rotate secret *values* yourself (`GH_PAT`, `FASTLANE_KEY`, etc.) — those require the
user to go through the Apple/GitHub UI. Give them the precise step from `fastlane/testflight.md` rather
than re-deriving instructions from memory.

## Step 5 — summarize

Report: which run/workflow failed, the root cause, what you changed (if anything), and what the user still
needs to do manually (if anything). Keep it concrete — cite the actual log line, not a generic category.
