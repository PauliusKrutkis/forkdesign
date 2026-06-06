# Security Policy

## Supported versions

Redline is pre-1.0. Security fixes are handled on the latest released version.

## Reporting a vulnerability

Please report security issues privately by emailing the maintainer listed in
`package.json`, or by opening a private vulnerability report on GitHub if the
repository has that feature enabled.

Do not include secrets, customer data, or proprietary source code in a public
issue. A good report includes the affected version, reproduction steps, impact,
and whether the issue requires the Vite dev server to be exposed outside local
development.

## Trust boundary

Redline is a local development tool. Its Vite middleware can read and write app
source files, write screenshots and iteration artifacts under `designs/`, and
run configured AI agents. Do not run it on an untrusted network or against
repositories whose source/screenshots cannot be shared with your configured AI
provider.
