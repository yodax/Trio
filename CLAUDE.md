# Trio (personal build fork)

This repository is `yodax/Trio`, a personal fork of [nightscout/Trio](https://github.com/nightscout/Trio) —
an open-source automated insulin delivery (AID) iOS app. It exists solely so that GitHub Actions can
build the app and ship it to TestFlight for a family member with T1 diabetes.

**No manual code changes are made here.** The `dev` branch is kept in sync with upstream automatically.
Claude's job in this repo is to help diagnose and fix failed GitHub Actions workflow runs and Fastlane
build/signing issues — not to write app features.

## How the build pipeline works

Four workflows in `.github/workflows/`, chained together, using [Fastlane](https://fastlane.tools) lanes
defined in `fastlane/Fastfile`:

1. **`validate_secrets.yml`** ("1. Validate Secrets") — checks that `GH_PAT` is valid, that a private
   `Match-Secrets` repo exists (auto-created if missing), and validates the Fastlane/App Store Connect
   secrets (`TEAMID`, `FASTLANE_ISSUER_ID`, `FASTLANE_KEY_ID`, `FASTLANE_KEY`, `MATCH_PASSWORD`). Runs
   `fastlane validate_secrets`.
2. **`add_identifiers.yml`** ("2. Add Identifiers") — manual-only (`workflow_dispatch`). Creates the App
   Store Connect bundle IDs and capabilities via `fastlane identifiers`. One-time setup step, rarely needs
   re-running.
3. **`create_certs.yml`** ("3. Create Certificates") — checks/creates the distribution certificate and
   provisioning profiles via `fastlane certs`, then `fastlane check_and_renew_certificates`. If the cert is
   expired/missing and the repo variable `ENABLE_NUKE_CERTS=true`, it nukes and recreates everything via
   `fastlane nuke_certs`. Called by `build_trio.yml` as a prerequisite job.
4. **`build_trio.yml`** ("4. Build Trio") — the main pipeline:
   - `check_status` job: validates `GH_PAT`, syncs the fork's target branch from upstream
     (`aormsby/Fork-Sync-With-Upstream-action`), and figures out if this is the "2nd Sunday of the month"
     (forced monthly build).
   - `check_certs` job: calls `create_certs.yml`, gated on manual dispatch, monthly schedule, or new
     upstream commits being synced.
   - `build` job (macOS runner): applies any patches in `patches/`, runs `fastlane build_trio` (archives +
     signs the IPA via `match`/`gym`), then `fastlane release` (uploads to TestFlight via
     `upload_to_testflight`). Build artifacts (IPA, dSYM, logs) are always uploaded even on failure.
   - Runs on a schedule (`43 6 * * 0`, i.e. Sundays) — builds if there are new upstream commits, or
     unconditionally on the 2nd Sunday of the month. Can also be run manually.

**Two workflows never run on this fork and can be ignored:** `unit_tests.yml` and `auto_version_dev.yml`
are both explicitly gated with `if: github.repository_owner == 'nightscout'` — they only execute on the
upstream repo, not on forks. Don't chase failures there; they should simply show as skipped/not-triggered.

## Secrets & variables this repo depends on

Repository secrets (Settings → Secrets and variables → Actions → Secrets):
`GH_PAT`, `TEAMID`, `FASTLANE_ISSUER_ID`, `FASTLANE_KEY_ID`, `FASTLANE_KEY`, `MATCH_PASSWORD`.

Repository variables (Settings → Secrets and variables → Actions → Variables), all optional:
`ENABLE_NUKE_CERTS`, `FORCE_NUKE_CERTS`, `SCHEDULED_BUILD`, `SCHEDULED_SYNC`.

Full first-time setup instructions (what each secret is and how to generate it) live in
`fastlane/testflight.md` — point there for setup questions, not just failure diagnosis.

## Diagnosing failed workflows

Use the **`diagnose-build`** skill (`.claude/skills/diagnose-build/SKILL.md`) for any "why did the build
fail" / "check the last Action run" style request. It knows how to pull failed run logs with `gh` and map
common Fastlane/Match/App Store Connect error strings to their fix.

`gh` is already authenticated against this fork (`yodax/Trio`) — prefer `gh run list` / `gh run view --log-failed`
over guessing from memory.

## Working conventions

- This is a config/CI-only repo from Claude's perspective — do not propose Swift/app code changes.
- Prefer read diagnosis first; only change repo variables or re-run workflows once the root cause from the
  logs is clear.
- Never print or persist secret values (`GH_PAT`, `MATCH_PASSWORD`, `FASTLANE_KEY`, etc.) into logs, files,
  or commit messages.
