# Nooki UI contract

Use the starter's `ui` modules for page layout, headings, panels, buttons and empty/error states. They follow Nooki colors and dimensions through host CSS variables. Custom UI can compose these primitives without importing platform pages or global classes.

- The capability occupies the content area. Nooki owns navigation, the window shell and global settings.
- Subscribe to `host.environment` with `useSyncExternalStore`. Select package-owned Chinese/English copy and follow the host theme and locale. Keep local form and execution state when the environment changes.
- Use `--surface`, `--surface-strong`, `--ink`, `--ink-muted`, `--line`, `--accent`, and the `--workbench-page-*` layout tokens. Match the starter's typography, restrained borders, button sizes and spacing. Use the bundled Radix icon dependency for extra icons.
- Scope every custom CSS selector under `.wb-cap-page.your-package-class`. Avoid global element selectors, `:root`, `body`, remote fonts and changes to host DOM. Starter `ui/style.css` is scoped under `.wb-cap-page`.
- Provide meaningful empty, busy, success and error states. Keep a visible main action and keyboard focus. Use semantic labels and prevent accidental duplicate submissions.
- Use remaining-height scroll panels for editors/readers. Avoid nested full-window layouts. Validate at 480 px and 1000 px content widths and both themes/languages using the preview toolbar.

The `preview` folder is a development-only harness. Its theme file is derived from Nooki; do not import it into the package entry. Preview storage is namespaced by capability ID. Task checkpoints, AI, source grants and native lifecycle require desktop verification.
