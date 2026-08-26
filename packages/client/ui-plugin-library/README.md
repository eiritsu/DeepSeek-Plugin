# @deepseek-ai/dsh-client-ui-plugin-library

English | [中文](README.zh.md)

Desktop-only plugin library for the macOS shell. The browser plugin treats `window.dshDesktopPluginBridge` as a capability signal: without that document-start native bridge it registers nothing. With the bridge it contributes one `sidebar.footer.action` icon and one `shell.overlay` surface through the existing additive slots; it does not replace or modify the sidebar owner. This package declares a sideloadable Bundle that replaces the existing `ui-plugin-library` configuration row with the same plugin name, so library updates do not change Harness source. Local-directory selection also requires the matching macOS desktop-shell native bridge.

The installed inventory lists out-of-tree Web profile dependencies and the built-in `Deepseek-Files` and `@deepseek-ai/dsh-model-catalog` Bundles. It marks both built-in Bundles as installed by default and non-removable through external dependency controls. Exact public npm dependencies are checked against the registry `latest` version; an available update appears on the installed card and must pass the same pinned-source review before installation. Git commits and local directories remain manually re-reviewed because they have no registry version channel. The browser locale presents the catalog as “Model Capabilities” in English and “模型能力目录” in Chinese. Its canvas follows the Settings modal contract: an `800px` width, a `min(800px, 100vh - 48px)` height, and internal body scrolling when content overflows. It offers a low rectangular detailed-card view, a square compact-card view, responsive column breakpoints, pinned-network-source or local-directory review and installation, uninstall, and a persistent native audit log.

Community discovery remains separate from manual source review and keeps two external sources distinct: GitHub's [`dsh-plugin` topic](https://github.com/topics/dsh-plugin) and the third-party [deepseek1024.com catalog](https://deepseek1024.com/plugins). Topic repositories receive local structural inspection and display one of the four review classifications. The third-party catalog contributes only names, categories, descriptions, counts, repository links, and detail links; this metadata is neither an endorsement nor an installability decision. A community Review action immediately opens Review & install. Native code pins a Topic repository to a commit, or parses the public `dsh plugin --profile web add` npm target from the fixed third-party host and resolves an exact version through the npm registry, before using the same structural and security preflight. An entry that has no parseable npm target, cannot be pinned, or does not exist in the registry receives no installation token.

Each source retains its own search term, page cursor, and scroll position. Opening the library prefetches both first pages in parallel. GitHub limits structural inspection to four concurrent items on the current page. The third-party source uses the catalog's paginated API and its published category counts and sort modes, while native code keeps a short page cache. Each page contains 12 items, the catalog viewport loads the next page near its end, and an explicit Load more button preserves keyboard access.

Direct installation is available only when `package.json` declares `dsh.bundle.patch` and that package-internal YAML entry exists. Network sources must be pinned to an exact npm version or Git commit. A local directory is normalized to an absolute path and its manifest and composition entry are checked again immediately before installation. A native review token expires after 15 minutes and can be consumed by one installation; installation delegates to the official `dsh plugin --profile web` command with `--save-exact --ignore-scripts`, then restarts the same runtime source. A local directory remains mutable trusted code after installation and is not confined by review.

Manual network sources, local directories, Topic discovery, and third-party-source submission use the same four classifications:

- **Direct install:** the root manifest has a valid package name, declares a safe package-internal YAML path through `dsh.bundle.patch`, and that entry exists. Only this class receives an installation token.
- **Needs adapter:** the root manifest is a valid npm package but does not declare `dsh.bundle.patch`; adding it as a dependency would not activate a Harness Profile Bundle.
- **External project:** the repository has no root `package.json`, so it is not directly consumable by the DSH plugin command.
- **Blocked:** the manifest, package name, bundle path, or referenced composition entry is invalid or unreadable. Inspection failures default to this class rather than permitting installation.

The source gate is deliberately described as a preflight, not a sandbox. Disabling dependency lifecycle scripts reduces installation-time execution, but an activated DSH plugin still runs as trusted local code and can use whatever file, network, process, or credential access its Harness composition provides.

## Model Experience

None, as the package contributes desktop management UI and does not add model tools, prompt text, or provider traffic.

#### KV Cache effect

None. This package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The library does not expose a package-level enable switch. Harness activation belongs to individual Cordis configuration entries, and one npm package can contribute several entries; presenting one package toggle would misstate that ownership.
- Catalog classification and source preflight validate the minimum DSH Bundle shape, immutable provenance, and the declared composition entry while suppressing lifecycle scripts. They do not yet download and display a dependency/license manifest, verify a publisher signature, or confine the plugin at runtime.
- A plugin whose package depends on `prepare` or another lifecycle script may not work when installed through this surface.
