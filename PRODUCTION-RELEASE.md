# Production release procedure

1. A push to `staging` runs offline checks and publishes a retained artifact named `anise-website-staging-<sha>`. The artifact contains a release manifest and SHA-256 hashes.
2. Run **Website production release** from `main`, enter the exact successful staging run and artifact name, and use `check` first. Check mode performs no live connection.
3. Deploy mode requires the protected `production` environment reviewer, separate `PROD_FTPS_*` secrets, and repository variables `PROD_FTPS_HOST` and `PROD_FTPS_ROOT`. Existing configuration/runtime files are not in the artifact and remote files are never deleted.
4. Keep the previous artifact and deployment manifest for rollback; restore the previous approved artifact through the same guarded workflow after review.

Missing approval variables fail closed; no production hostname, path, credential, or database identity is guessed.

Approved FTPS mapping supplied by the owner: host `loveanise.co.uk`, account `livesiteftp`, remote root `/livesiteftp/wwwroot`. The workflow reads `LIVE_FTPS_HOST`, `LIVE_FTPS_USERNAME`, and `LIVE_FTPS_PASSWORD` from repository secrets and validates this exact root.
