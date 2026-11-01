# Releasing

1. Set the new version in `package.json` and
   `Packages/com.animama.avatar-converter/package.json`, and give it a
   `## <version>` heading in the package's `CHANGELOG.md`.
2. Push the tag `v<version>` on `main`, one tag at a time. The release workflow
   runs the checks, creates the GitHub release with the Unity package zip, and
   rebuilds the VPM listing on GitHub Pages from every release's zip.
3. After the release workflow succeeds, publish the command from a clean
   checkout of the tag: `npm publish`. Its `prepublishOnly` guard refuses
   anything else, since npm never reuses a version number.

A failed workflow job can be re-run on its own; an existing release is kept.
Never move or delete a published tag; ship a fix as a new patch version.

The repository must be public, with Actions enabled, Pages set to the
**GitHub Actions** source, the `github-pages` environment allowing `v*` tags,
and a tag ruleset that blocks updating and deleting `v*` tags.
