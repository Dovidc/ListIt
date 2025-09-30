# ListIt

## Installation notes

The `better-sqlite3` dependency provides prebuilt binaries on macOS and Windows.
To avoid unnecessary native compilation failures during `npm install`, the
postinstall script now skips the manual rebuild on those platforms. If you do
need to force a rebuild (for example on Linux or when building for a different
architecture), set `LISTIT_FORCE_REBUILD=1` before running `npm install`.
