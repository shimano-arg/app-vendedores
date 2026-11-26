# CI Deploy Pipeline: Functions + Rules

**Status**: Deployed in dry-run mode (no credentials yet)
**Last Updated**: 2026-11-25
**Workflow**: `.github/workflows/deploy-functions-rules.yml`

## Overview

This workflow automates deployment of Firebase Functions and Firestore/Storage Rules to production or staging environments. It includes:

- **Lint & Validation**: Checks syntax on functions and rules files
- **Dry-Run**: Preview deployment without credentials (always enabled by default)
- **Deploy**: Deploys to Firebase when `dry_run=false` and `FIREBASE_TOKEN` is set
- **Smoke Tests**: Post-deployment verification (functions list)
- **Rollback**: Instructions for manual rollback via GCP/git

## Triggers

### Manual Dispatch (workflow_dispatch)
```bash
# From GitHub Actions tab, click "Deploy Functions + Rules"
# Input parameters:
#   - environment: production | staging
#   - dry_run: true (default) | false
```

### Automatic on Push
```bash
# Triggered on push to main when these paths change:
#   - functions/**
#   - firestore.rules
#   - storage.rules
```

**Note**: Auto-triggered runs default to `dry_run=true`. No real deployment occurs until manually enabled.

## Setup Instructions

### 1. Generate Firebase Token (One-time)

```bash
# Local machine (requires Firebase CLI installed)
firebase login:ci

# Output will be a long token like:
# 1//0gKXX...ABC123...XYZ789...
```

### 2. Add to Repository Secrets

1. Go to: **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `FIREBASE_TOKEN`
4. Value: (paste the token from step 1)
5. Click **Add secret**

### 3. Verify Deployment Config

Ensure `.firebaserc` exists and is valid:

```bash
cat .firebaserc | jq .
```

Expected output:
```json
{
  "projects": {
    "default": "app-vendedores-prod",
    "staging": "app-vendedores-staging"
  }
}
```

## Workflow Stages

### Stage 1: Lint & Validate
- Runs on all triggers
- Checks function syntax: `npm run lint:functions`
- Validates Firestore rules: `grep "^service cloud.firestore"`
- Validates Storage rules: `grep "^service firebase.storage"`
- **Fail**: Blocks deployment

### Stage 2: Dry-Run (Default)
- **Always runs** when `dry_run=true` (default input)
- Displays functions and rules that would be deployed
- Checks `.firebaserc` and directory structure
- **No actual deployment** occurs
- **No secrets required**

### Stage 3: Deploy (Conditional)
- **Only runs** when `dry_run=false` AND `FIREBASE_TOKEN` secret exists
- Deploys to Firebase project specified in environment
- Uses `firebase deploy --only functions,firestore:rules,storage`
- Logs output to `deploy.log`
- **Requires GitHub environment approval** (if configured)

### Stage 4: Smoke Tests
- Runs after deploy success
- Lists deployed functions: `firebase functions:list`
- Verifies CLI connectivity
- **Note**: Full integration tests should run in staging first

### Stage 5: Rollback Instructions
- Triggered only if deploy fails
- Provides manual rollback commands
- Instructions for reverting via git or GCP

## Example Workflows

### Scenario A: Preview Deployment (Safe)
```
1. Go to GitHub Actions → Deploy Functions + Rules
2. Click "Run workflow"
3. Leave inputs as default (dry_run=true, environment=production)
4. Click "Run workflow"
5. Review logs, see what would deploy
6. No changes made to Firebase
```

### Scenario B: Deploy to Production
```
1. Ensure FIREBASE_TOKEN secret is set
2. Go to GitHub Actions → Deploy Functions + Rules
3. Set inputs:
   - environment: production
   - dry_run: false
4. Click "Run workflow"
5. ⚠️ This triggers REAL deployment
6. Monitor logs for success/failure
```

### Scenario C: Deploy to Staging (Test First)
```
1. Same as Scenario B, but select:
   - environment: staging
   - dry_run: false
2. Use staging to validate before production
```

## Manual Rollback

If deployment fails or needs rollback:

### Option 1: GCP Console (Fastest)
```bash
gcloud run services update-traffic FUNCTION_NAME \
  --to-revisions=REVISION_NAME=100 \
  --region=us-central1
```

### Option 2: Revert via Git
```bash
git revert <COMMIT_HASH>
git push origin main
# Workflow auto-triggers on push to main
# Redeploy from last good revision
```

### Option 3: Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select project (app-vendedores-prod or staging)
3. Functions → Select function → Revisions
4. Promote previous "stable" revision to 100% traffic

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `NODE_VERSION` | `20.x` | Node.js version for build |
| `DRY_RUN` | `true` | Set to `false` to enable real deployment |
| `TARGET_ENV` | `production` | `production` or `staging` |

## Secrets Required

| Secret | Required | Setup | Notes |
|--------|----------|-------|-------|
| `FIREBASE_TOKEN` | No (dry-run) / Yes (deploy) | `firebase login:ci` → repo settings | Obtained locally, never commit |

## Artifact Retention

- **deploy.log**: Retained for 30 days after each run
- Accessible via: GitHub Actions → Artifacts (run details)

## Troubleshooting

### "FIREBASE_TOKEN secret not configured"
**Solution**: Follow Step 2 of Setup Instructions above.

### "Invalid .firebaserc JSON"
**Solution**: Verify `.firebaserc` syntax:
```bash
cat .firebaserc | jq .
```

### Lint fails on functions
**Solution**: Run locally and fix:
```bash
npm run lint:functions -- --fix
```

### Deployment hangs or times out
**Solution**: 
1. Check Firebase project quota in Console
2. Verify Firebase CLI version: `firebase --version`
3. Check network connectivity

### Rules deployment fails with "Permission denied"
**Solution**: 
1. Verify `FIREBASE_TOKEN` user has Editor+ role in Firebase project
2. Regenerate token: `firebase login:ci --no-localhost`

## Security Notes

- ✅ Workflow does NOT commit credentials to repo
- ✅ Dry-run mode requires NO secrets
- ✅ Secrets masked in logs automatically
- ✅ GitHub environment gates require approval (optional config)
- ⚠️ Never hardcode `FIREBASE_TOKEN` in YAML or `.env` files

## References

- [Firebase CLI Documentation](https://firebase.google.com/docs/cli)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/start)

## Next Steps

1. ✅ Workflow created and merged to `main`
2. ⏳ Waiting for: Local `firebase login:ci` token generation
3. ⏳ Waiting for: Token added to repository secrets
4. ⏳ Waiting for: First manual deployment test run

---
**Owner**: DevOps / Platform Engineering
**Last Reviewed**: 2026-11-25
