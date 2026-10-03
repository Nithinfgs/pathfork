# Contributing

Thanks for helping. The project has no runtime dependencies and aims to stay that way.

```bash
git clone https://github.com/Nithinfgs/pathfork && cd pathfork
npm install          # dev tools only: eslint, typescript
npm run check        # lint + typecheck + tests
npm run demo         # try it against the sandbox
```

## Good first contributions

- **A version manager hint.** Add an entry to `MANAGERS` in `src/explain.js` with a regex and one accurate sentence on how to make it work in non-interactive shells. Add a test.
- **A shell.** fish and nushell are not supported. Probing needs a script in their syntax (`src/probe.js`) and startup-file rules (`src/contexts.js`).
- **Linux GUI environment.** The `gui` context is an approximation. Reading the real session PATH from `systemctl --user show-environment` would be better.
- **A project file.** Teach `src/project.js` another version file (`rust-toolchain.toml`, `.sdkmanrc`, ...).

## Guidelines

- Tests must be hermetic: use a temporary `HOME` and fake executables, never the developer's real setup. See `test/zsh.test.js`.
- Claims in explanations must be true. If a hint depends on a tool's behaviour, say which behaviour.
- Keep output short. Anything printed per command should earn its line.
- Conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).
