# Production release procedure

1. Run **Guarded staging upload** on `staging`. It builds a complete cumulative snapshot, uploads it, verifies the staging website, and publishes `anise-website-staging-release-<sha>` with a deployment record and SHA-256 manifest.
2. Run **Website production release** from `main`, enter only the staging Run ID, and use `check` first. The workflow resolves and downloads the exact approved artifact automatically; it never rebuilds from `main`.
3. Deploy mode requires the protected `production` environment reviewer. FTPS settings come from that environment's `PROD_FTPS_HOST`, `PROD_FTPS_ROOT`, `LIVE_FTPS_USERNAME`, and `LIVE_FTPS_PASSWORD`. Existing configuration/runtime files are not in the artifact and remote files are never deleted.
4. Keep the previous artifact and deployment manifest for rollback; restore the previous approved artifact through the same guarded workflow after review.

Missing or invalid settings, artifacts, hashes, workflow runs, or staging deployment evidence fail closed; no production hostname or path is guessed.

Approved FTPS mapping supplied by the owner: host `loveanise.co.uk`, account `livesiteftp`, remote root `/livesiteftp/wwwroot`. The workflow reads `LIVE_FTPS_HOST`, `LIVE_FTPS_USERNAME`, and `LIVE_FTPS_PASSWORD` from repository secrets and validates this exact root.
