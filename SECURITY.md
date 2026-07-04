# Security Policy

StateWeave is an experimental SDK. Do not commit real provider keys, secrets, trace logs with sensitive prompts, or private data.

## Supported versions

Security fixes target the latest `main` branch until tagged releases exist.

## Reporting a vulnerability

When the public repository exists, please use GitHub Security Advisories to report vulnerabilities privately.

If you are evaluating the SDK locally, rotate any API key that was accidentally committed, pasted into traces, or shared in an issue.

## Secret handling

- `.env` and `.env.*` are ignored by git.
- `.env.example` contains placeholders only.
- Runtime trace JSON is ignored by git.
- The package entrypoint does not load `.env`; only CLI/demo commands load dotenv for local convenience.
