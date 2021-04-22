# Diff coverage

Checks that the added and modified lines are covered by unit tests

The line numbers are obtained by parsing the patch chunks of each file given by `git diff`

The coverage is obtained from an artifact previously uploaded. It must be an artifact named `coverageArtifact` containing the file `coverage-final.json`.

NOTE: Requires having used `actions/checkout@v2` in a previous step.

## Inputs

### `include`

**Optional** JSON array. Only process paths that match a regular expression in `include`. By default includes all.

### `ignore`

**Optional** JSON array. Do not process paths that match a regular expression in `ignore`. By default ignores none.

### `repoDirectory`

**Optional** The directory where the tests were run. Defaults to `${{ github.workspace }}`

## Example usage

```yml
name: example
on:
  pull_request:
  push:
    branches:
      - main
      - master
      - develop
jobs:
  example:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Check coverage
        uses: Equip-Collaboration/diff-coverage@v1
        with:
          include: '["\\.js$", "\\.jsx$"]'
          ignore: '["^dist/", "\\.test\\.js$", "^www/"]'
          repoDirectory: ${{ github.workspace }}
```
