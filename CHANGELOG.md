# Changelog

## 0.1.0

First release.

- Probe `node`, `python3`, `git` (or any command) in five shell contexts: `terminal`, `login`, `non-interactive`, `cron`, `gui`.
- Group results by resolved path and version; classify differences as error / warning / info.
- Explain differences by locating the startup-file line responsible, detecting interactive guards in `.bashrc`, and recognising nvm, pyenv, rbenv, asdf, mise, fnm, Volta, SDKMAN, conda and Homebrew.
- `pathfork path` shows PATH entries that are not present in every context.
- `--project` checks `.nvmrc`, `.node-version`, `.tool-versions`, `.python-version`, `.ruby-version`, `package.json` engines and `go.mod` against every context.
- `--demo` runs against a throwaway sandbox HOME.
- `--json` and `--md` output. zsh, bash and sh supported.
