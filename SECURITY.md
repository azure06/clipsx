# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through [GitHub's vulnerability reporting
form](https://github.com/azure06/clipsx/security/advisories/new). If you cannot use
GitHub, email [support@clipsx.app](mailto:support@clipsx.app) with the subject
`ClipsX security report`.

Do not open a public issue or pull request containing vulnerability details,
exploit code, credentials, or private clipboard content. Ordinary bugs and help
requests belong in the [public issue tracker](https://github.com/azure06/clipsx/issues).

Include what you can safely provide:

- The affected ClipsX version or commit, operating system, and relevant extension versions.
- The affected component and steps to reproduce using synthetic clipboard data.
- Expected and observed behavior, potential impact, and any prerequisites.
- A minimal proof of concept or sanitized diagnostics, if available.

Reports may concern the desktop application, its update or release process, or
the first-party extension ecosystem. Identify the affected repository when the
problem involves extensions, the registry, or the website so it can be routed
to the appropriate component.

Only test systems and data you own or have permission to test. Do not access
other people's clipboard history, accounts, credentials, or files to demonstrate
impact.

## Supported versions

Security fixes target the latest published desktop release and the current
development branch. Older releases do not receive routine security backports;
upgrade to the latest release when a fix is available. You can still report an
issue found in an older version, especially if it may affect current versions.

## Coordinated disclosure

The maintainer will assess the report and coordinate remediation and public
disclosure with the reporter. Please keep details private until a fix is
available or a disclosure date has been agreed upon.

ClipsX is independently maintained. There is no guaranteed response time or
paid bug bounty. Responsible reports are welcome, including reports with
incomplete information.
