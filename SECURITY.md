# Security policy

## What pathfork executes

pathfork starts your shell several times so your own startup files (`~/.zshrc`, `~/.bash_profile`, ...) run, then runs `<command> --version` for each command you ask about. Commands are restricted to `[A-Za-z0-9._+-]` and never interpolated into a shell string supplied by a third party. It never writes to your home directory. `--demo` works inside a temporary directory that it deletes afterwards.

Because startup files run, do not point `--shell` or `HOME` at untrusted content.

## Reporting a vulnerability

Please open a private report via GitHub's "Report a vulnerability" button on the Security tab. If that is unavailable, open an issue asking for a private contact channel without including details. I aim to respond within a week.
