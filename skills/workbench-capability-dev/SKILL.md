---
name: workbench-capability-dev
description: Develop or update an installable Nooki capability package with the official Host contract, matching UI, and ZIP packaging tools. Use when asked to create a Nooki capability or a .capability.zip.
---

# Nooki capability development

Deliver an independent React capability project and a `.capability.zip` for the user to import and manually install in Nooki. Development happens in the user's coding tool. Follow the user's requested scope and output location.

1. Read [the contract](references/contract.md) and [UI guidance](references/ui.md). The bundled `kit.json` identifies the kit and target Nooki versions. Use the bundled types as the interface source of truth.
2. For a new package, run `node scripts/create-capability.mjs <new-project-directory> <reverse.domain.id>` from this skill directory. The destination must not exist. This copies the starter, types, UI, and build tools; development then needs no Nooki checkout. For an existing package, preserve its identity and user changes.
3. Implement the requested behavior in that project. The starter's `package.json` declares its environment and commands. Use `npm install`, then `npm run dev` for preview. Preview uses simulated data; AI and native sources are unavailable there. Use the platform's task runner for long work, and declared Host permissions for side effects.
4. Run `npm run check` and `npm run pack`. Verify the actual page in light/dark themes, Chinese/English, and wide/narrow windows. Check empty, loading, error, and successful states relevant to the feature. Fix failures before reporting the package as built.
5. Deliver the source directory, generated archive path, requested permissions, and what was verified. Desktop installation and real Host behavior must be reported separately from browser preview. The user imports the archive and clicks Install in Nooki; producing the package does not authorize installing it.

Package v1 supports Page and optional jobs. Nooki supplies React and the JSX runtime. Keep module initialization free of business side effects, scope CSS to the capability root, and use CapabilityHost instead of importing Nooki internals, Tauri, credentials, or another capability's private storage. Packages run trusted code in the same environment as Nooki; checks are not an untrusted-code sandbox.

For unfamiliar coding tools, reading this file and its references directly is sufficient; no tool-specific commands or MCP connections are required. Resolve relative paths from this skill directory, and keep generated work outside the installed skill.
