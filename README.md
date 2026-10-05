# Nicole Cloudflare Worker

Cloudflare Worker backend for the Nicole astronomy applications.

## Deployment

Production deployment is automated with GitHub Actions.

- Worker: `astro-nicole`
- Source: `src/worker.js`
- Config: `wrangler.jsonc`
- Deploy workflow: `.github/workflows/deploy.yml`

Required GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Do not commit Cloudflare credentials to this repository.
