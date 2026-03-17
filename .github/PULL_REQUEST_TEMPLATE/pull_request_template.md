# Pull Request

## Summary

<!-- Describe what this PR changes and why. -->

## Change Class

<!-- Select the repository change class that best fits this PR. -->

- [ ] `protocolLaw`
- [ ] `conformanceCorpus`
- [ ] `referenceGuidance`
- [ ] `repositoryOperations`

## Change Type

- [ ] Spec clarification or tightening (authored Markdown)
- [ ] New or updated conformance fixture
- [ ] SSOT regeneration (`artifacts/*`)
- [ ] Validator or parser improvement
- [ ] Tooling or quality fix
- [ ] Documentation / editorial

## Checklist

### For spec or corpus changes

- [ ] Changed the authored Markdown source first
- [ ] Regenerated affected `artifacts/*` artifacts (`npm run sync:*`)
- [ ] Updated the enforcing validator or parser in the same PR
- [ ] Did not silently widen `AAP Open Core` public interoperability claims
- [ ] Reviewed `configs/repository.json` to confirm the expected co-update surfaces

### For all changes

- [ ] `npm run format` passes
- [ ] `npm run test:validator` passes
- [ ] `npm run validate` passes
- [ ] No hand-maintained drift introduced in generated `artifacts/*` files
- [ ] CI in `.github/workflows/validate.yml` should pass without workflow-specific exceptions

## Related Issues

<!-- Closes #... or References #... -->

## Notes for Reviewers

<!-- Anything that needs special attention during review. -->
