# Limbo — Project Instructions

## Git Workflow

- **Integration branch: `staging`** — ALL pull requests MUST target `staging`, never `main`
- `main` is the production/release branch — only receives merges from `staging`
- Feature branches are created from `staging`
- Always use `--base staging` when creating PRs with `gh pr create`
