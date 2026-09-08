# Installed capabilities

This source directory documents the installation layout and is separate from the built-in `capabilities/` catalog.

The desktop app keeps the authoritative registry at `<app-data>/installed-capabilities/capability-registry.json`. Each external package version is an immutable `<id>/<version>.json` payload containing the validated manifest, JavaScript entry and optional CSS. The registry selects the active and previous external versions. Failed activation preserves the old pointer; rollback selects the previous executable after validating it.

Uninstallation removes executable packages and the registry entry while retaining Capability data, task records and published documents. Browser preview simulates built-in installation state in local storage; external ZIP installation requires the desktop host.

See [INFRASTRUCTURE.md](../INFRASTRUCTURE.md) for details.
