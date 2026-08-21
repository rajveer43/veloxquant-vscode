# Contributing

## Commit messages

Versioning and `CHANGELOG.md` are automated by
[release-please](https://github.com/googleapis/release-please), which reads
[Conventional Commits](https://www.conventionalcommits.org/) on `master` to
decide the next version:

| Prefix                          | Effect                                  |
| -------------------------------- | ---------------------------------------- |
| `fix: ...`                       | patch bump (0.1.0 -> 0.1.1)              |
| `feat: ...`                      | minor bump (0.1.0 -> 0.2.0, pre-1.0)     |
| `feat!: ...` or `BREAKING CHANGE:` footer | major bump (once past 1.0.0)    |
| `chore:`, `docs:`, `refactor:`, `test:`, `ci:` | no release, no version bump |

Examples:

```
fix: snap detected RAM to the nearest supported step
feat: add M5 chip and higher RAM options to the Recommend form
feat!: drop support for VeloxQuant-MLX < 0.42.0

BREAKING CHANGE: the `--legacy-json` flag is no longer recognized.
```

## Release flow

1. Merge Conventional Commits into `master` as normal.
2. The `release-please` workflow opens/updates a "Release PR" that bumps
   `package.json`'s version and appends to `CHANGELOG.md`. It keeps itself
   up to date as you merge more commits — no manual editing needed.
3. Merging that PR creates a `vX.Y.Z` tag and GitHub Release automatically.
4. The tag push triggers `release.yml`, which builds, packages, and
   publishes to the VS Code Marketplace and Open VSX.

No one should hand-edit `package.json`'s `version` or `CHANGELOG.md`
directly — release-please owns both.
