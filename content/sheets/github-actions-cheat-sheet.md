+++
title = "GitHub Actions Cheat Sheet"
date = 2026-10-02
description = "Write and manage GitHub Actions workflows: triggers, jobs, steps, secrets, matrix builds and caching, plus the gh CLI commands for watching, re-running and debugging runs from the terminal."
tags = ["github", "ci-cd", "automation", "devops"]
+++

GitHub Actions workflows live as YAML files under `.github/workflows/`, one file per workflow. This sheet covers the syntax for writing them, and the `gh` CLI commands for watching and managing the runs they produce without leaving the terminal.

## Workflow file basics

```yaml
# .github/workflows/deploy.yml
name: Build and deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Run a command
        run: echo "hello"
```

Every workflow needs `name` (shown in the Actions tab), `on` (what triggers it), and at least one entry under `jobs`. Each job runs on a fresh virtual machine (`runs-on`) and executes its `steps` in order.

## Common triggers

```yaml
on:
  push:
    branches: [main]            # only when main is pushed to
    paths: ["src/**"]              # only if files under src/ actually changed
  pull_request:
    branches: [main]                 # runs on PRs targeting main
  schedule:
    - cron: "0 3 * * *"                 # 03:00 UTC every day - cron syntax, always UTC
  workflow_dispatch:                       # adds a manual "Run workflow" button in the UI
  release:
    types: [published]                        # when a GitHub release is published
```

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Target environment"
        required: true
        default: "staging"
```

`workflow_dispatch` with `inputs` adds a form in the Actions UI, so a manual run can take parameters instead of being hardcoded.

## Jobs, steps, and dependencies between jobs

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo "running tests"

  deploy:
    needs: test                    # wait for the test job to succeed before starting
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploying"
```

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4          # clone the repo into the runner
      - uses: actions/setup-node@v4          # install a specific Node version
        with:
          node-version: "20"
      - run: npm ci                              # install dependencies from a committed lockfile
      - run: npm test                               # run the test suite
```

`uses:` runs a prebuilt action (reusable, versioned, usually pinned to `@v4` or a specific tag); `run:` executes a raw shell command directly on the runner.

## Environment variables and secrets

```yaml
env:
  NODE_ENV: production                 # available to every step in the job

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying to $TARGET"
        env:
          TARGET: production             # step-level env var, overrides the job-level one if named the same
```

```yaml
      - name: Deploy
        run: ./deploy.sh
        env:
          API_KEY: ${{ secrets.API_KEY }}    # pulled from the repo's configured Actions secrets, never printed in logs
```

Secrets are configured in **Settings → Secrets and variables → Actions** on GitHub - they're encrypted at rest, masked automatically in log output, and simply unavailable to workflows triggered from a fork's pull request by default (a deliberate security boundary, not a bug).

## Conditionals with `if`

```yaml
      - name: Only on main
        if: github.ref == 'refs/heads/main'
        run: echo "this is main"

      - name: Only run on failure
        if: failure()
        run: echo "something earlier failed"

      - name: Always run, even after a failure
        if: always()
        run: echo "cleanup"
```

`if: failure()` and `if: always()` are the two most common patterns for cleanup/notification steps that need to run regardless of whether earlier steps succeeded.

## Matrix builds

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]      # runs this job 3 times, once per version
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm test
```

```yaml
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node-version: [18, 20]
      fail-fast: false        # let every combination finish even if one fails, instead of canceling the rest
```

A matrix with two axes (`os` × `node-version` above) runs once for every combination - 2×2 = 4 jobs here.

## Caching dependencies

```yaml
      - uses: actions/cache@v4
        with:
          path: ~/.npm                                   # what to cache
          key: npm-${{ hashFiles('package-lock.json') }}    # cache invalidates automatically when the lockfile changes
          restore-keys: |
            npm-
```

Caching avoids re-downloading the same dependencies on every run - `restore-keys` lets a run fall back to the most recent matching cache even if the exact key (lockfile hash) doesn't match, which is usually still faster than a fully cold cache.

## Artifacts

```yaml
      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: dist/
          retention-days: 7       # auto-delete after this many days instead of the default 90

      - uses: actions/download-artifact@v4
        with:
          name: build-output
```

Artifacts pass files between jobs in the same workflow run (e.g. a `build` job uploads, a `deploy` job downloads), or let you grab build output from the GitHub UI after a run finishes.

## Managing runs with the `gh` CLI

```bash
gh run list                              # recent workflow runs, status at a glance
gh run list --limit 5                      # just the last 5
gh run list --workflow=deploy.yml            # only runs of one specific workflow file
```

```bash
gh run view <run-id>                   # summary of one run - jobs, steps, pass/fail
gh run view <run-id> --log                # full raw logs for every step
gh run watch <run-id> --exit-status         # follow a run live until it finishes; exit code reflects success/failure
```

```bash
gh run rerun <run-id>                  # re-run every job in a run
gh run rerun <run-id> --failed           # re-run only the jobs that failed, not the ones that already passed
gh run cancel <run-id>                     # stop a run that's still in progress
```

```bash
gh workflow list                   # every workflow file in the repo, and whether it's enabled
gh workflow run deploy.yml            # manually trigger a workflow that has workflow_dispatch
gh workflow disable deploy.yml          # turn a workflow off without deleting the file
```

## Common recipes

```bash
# Watch the deploy that was just triggered by your last push, right from the terminal
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status

# Only re-run the parts of a flaky run that actually failed
gh run rerun $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId') --failed

# Grep a run's full logs for the actual error, instead of scrolling the web UI
gh run view <run-id> --log | grep -i error
```

```yaml
# A minimal "deploy on push to main" workflow, end to end
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh
        env:
          DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
```

## Safety notes

- Pin third-party actions to a specific version tag (`@v4`) or, for anything security-sensitive, a full commit SHA - `@main`/`@master` on someone else's action means their next push changes what runs in your pipeline, with no review on your side.
- Secrets are masked in logs automatically, but only as literal string matches - echoing a secret after transforming it (base64, a substring, reversed) can leak it anyway. Never deliberately print a secret even "for debugging."
- A `workflow_dispatch`-triggered workflow with no branch restriction can be run against any branch that has the file - don't assume manual runs only ever happen against `main`.
- `dangerous-clean-slate`-style deploy steps (wiping a target before re-uploading) have no undo - keep a backup/rollback path outside the pipeline itself for anything deploying to a server you can't just redeploy your way out of.
