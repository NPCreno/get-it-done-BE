## Summary

## Checklist
- [ ] Contract changed (`src/common/api-contract.ts`)? Ran `pnpm contract:export`, committed `docs/api-contract.json`, and will run `pnpm contract:sync` in the FE repo
- [ ] Response shape changed? Re-captured fixtures (`WRITE_FIXTURES=1 pnpm test:int`)
- [ ] New `@Body()` is a fully decorated DTO (see `body-dtos.spec.ts`)
- [ ] New mutation checks the resource owner against the token, with a cross-user test
