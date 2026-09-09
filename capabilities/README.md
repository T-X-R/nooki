# Capability packages

Each child directory is an independently distributable Capability Package. A package in this catalog is discoverable and installable; it is not necessarily installed or enabled.

A package must contain at least:

- `manifest.json`: identity, version, entry point, and permission declarations.
- `index.tsx`: the package registration entry point and page implementation.
- `styles.css`: package-owned interface styles.

A Capability Package accesses platform services exclusively through `CapabilityHost`. It must not import `App.tsx`, the Tauri API, or the platform database. The built-in catalog is discovered during the Nooki build. To distribute a capability independently, run `npm run capability:pack -- <directory>` and import the ZIP in the desktop app; no Nooki rebuild is needed.

Only packages that create durable documents declare `documents.publish`. They publish through `host.documents.publish()` and do not depend on Document Library paths, storage, indexing, or UI code.

To follow the platform language and theme:

- Declare `locales.zh` and `locales.en` in `manifest.json` so the platform shell can display a localized capability name and description.
- Subscribe to `host.environment` in the capability page. Use `language` to select package-owned copy, `locale` to format dates and numbers, and `theme` to apply Light or Dark styles.
- Keep translations and theme adaptation inside the Capability Package. The platform publishes the current preferences but does not own the capability interface.

See [`packages/capability-contract/README.md`](../packages/capability-contract/README.md) for the full interface and an example.

Long-running work belongs in module `jobs`, submitted through `host.tasks`. See [INFRASTRUCTURE.md](../INFRASTRUCTURE.md) for task and package contracts.
