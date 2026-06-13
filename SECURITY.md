# Security Policy

## Supported versions

ForkDesign is pre-1.0. Security fixes are handled on the latest released version.

## Reporting a vulnerability

Please report security issues through GitHub private vulnerability reporting if
it is enabled for the repository. If private reporting is unavailable, open a
minimal public issue asking for a private contact path without including exploit
details.

Do not include secrets, customer data, or proprietary source code in a public
issue. A good report includes the affected version, reproduction steps, impact,
and whether the issue requires the Vite dev server to be exposed outside local
development.

## Trust boundary

ForkDesign is a local development tool. Its Vite middleware can read and write app
source files, write screenshots and iteration artifacts under `designs/`, and
run configured AI agents. Do not run it on an untrusted network or against
repositories whose source/screenshots cannot be shared with your configured AI
provider.

The middleware rejects non-loopback clients by default. Only set
`allowRemoteAccess: true` for a Vite dev server on a trusted network.
