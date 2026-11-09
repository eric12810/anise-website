
# Anise — Development Instructions

## Project overview
Anise is a Chinese takeaway business with two connected applications:

- anise-website: Customer-facing website and online ordering.
- anise-pos: Custom .NET POS, menu management, orders and API.

Both applications must be considered when changing shared functionality.

## Git repositories
The website and POS are separate Git repositories.
Preserve their independent Git histories and deployment workflows.

## Environments
Production:
- Website: https://www.loveanise.co.uk
- POS: https://pos.loveanise.co.uk

Staging:
- Website: https://www.staging.loveanise.co.uk
- POS: https://pos-staging.loveanise.co.uk

Verify all environment URLs and configuration before making changes.

## Development rules
1. Use staging as the default testing environment.
2. Never deploy to production without explicit permission.
3. Never alter production databases without explicit permission.
4. Keep staging and production data isolated.
5. Never copy customers, orders or payment records from production into staging.
6. Never expose or commit passwords, secrets, payment keys or connection strings.
7. Inspect existing code before modifying it.
8. Prefer minimal, targeted changes.
9. Do not overwrite working functionality unnecessarily.
10. Run relevant tests before recommending deployment.
11. Explain any required database migrations before applying them.

## Website and POS integration
- The website uses the POS API for menu, pricing, availability and ordering.
- Staging website must communicate with staging POS.
- Production website must communicate with production POS.
- Dish photos are stored in POS ProductImages database records.
- Staging images should come from POS staging, not production.
- Check API and frontend compatibility when changing either application.

## Deployment
- GitHub repositories are separate.
- Staging deployments must not accidentally target production.
- Review changed files before deployment.
- Avoid deleting remote files unless explicitly required.

## Working style
- Explain problems in straightforward language.
- Identify the root cause before applying fixes.
- Make changes in small, verifiable steps.
- Clearly distinguish completed changes from suggestions.
- Ask before destructive or irreversible operations.
