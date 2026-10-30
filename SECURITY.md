# Security

Squabble handles portfolio records and integration credentials. Treat the
current release as a **public beta**: the controls described here are useful
boundaries, not an assurance that every deployment is ready for unrestricted
public use. See the [privacy and data-flow guide](docs/privacy.md)
([简体中文](docs/privacy.zh-CN.md)) for what the server and providers can access.

## Report a vulnerability privately

Use this repository's
[GitHub private vulnerability reporting](https://github.com/Lueyu/squabble/security/advisories/new).
Do not put credentials, real portfolio data, or exploit details in a public
issue. We do not publish an alternative security email or a guaranteed response
time here.

Include the affected version or commit, deployment mode, relevant endpoint or
file, reproduction steps, and impact. A minimal proof of concept with test data
helps; it is not required. Test only instances and accounts you are authorized
to assess.

## What is in scope?

- **Account isolation:** reading or changing another account's holdings,
  transactions, reports, settings, notifications, or agent sessions.
- **Authentication and authorization:** login, recovery, token validation and
  revocation, bypasses, and agent/MCP permission enforcement.
- **Secrets and private records:** exposure through APIs, logs, browser storage,
  imports, errors, backups, or provider requests.
- **Server and browser security:** injection, unsafe rendering, server-side
  requests, unsafe uploads, and exploitable dependencies.
- **Deployment defaults:** exposed services, sample credentials, proxy trust,
  configuration checks, and boundaries between demo and public deployments.

Fictional demo records are intentional. A way to access or modify someone
else's real records is still a security issue. An operator's configuration can
also matter to the report; include enough context to reproduce it.

## Existing controls and their limits

| Area | Current behavior and boundary |
|---|---|
| Accounts | Passwords use bcrypt; recovery codes are stored as SHA-256 hashes. Bearer access/refresh tokens are kept in browser local storage, so browser compromise or script injection can expose them. |
| Recovery | Account recovery changes the password and code and revokes prior account and agent sessions. Generating a replacement code revokes prior account sessions. There is no email recovery or MFA flow. |
| Record access | Business services use authenticated owner identifiers to scope records. This protects application-level account boundaries; it does not hide records from the server/database operator. |
| Saved provider keys | LLM/Finnhub credentials use AES-256-GCM at rest. The server possesses the decryption secret. This is not end-to-end encryption or zero knowledge, and it does not encrypt all database fields. |
| Other secrets | Notification configuration is stored without that application-layer encryption. Screenshot-recognition credentials are saved in browser local storage and sent through the server for recognition requests. |
| Abuse protection | Authentication has an in-memory, per-process IP rate limiter. It is not a shared rate limiter for multiple replicas or a complete public-service abuse-control system. |
| Auditability | Analysis run events exist. A comprehensive audit of administrator access, privacy-consent controls, account-wide export, and complete self-service account erasure are not yet available. |

## Deploy with the right trust boundary

For an internet-facing instance, start with the
[public deployment guide](docs/public-deployment.md)
([简体中文](docs/public-deployment.zh-CN.md)) and its dedicated Compose file.
The root Compose configuration is for a local demo and includes sample
credentials and a demo dataset; publishing it unchanged is not a secure setup.

- Use independent private database, JWT, and settings-encryption secrets. Keep
  secrets out of source control and logs. Protect and test backups, including
  the encryption key; rotating or losing that key requires saved provider keys
  to be re-entered.
- Serve the browser over HTTPS, keep PostgreSQL and the application port off
  the public network, and configure trusted proxies to match the actual setup.
  The supplied public deployment assumes one application process behind its
  reverse proxy.
- Restrict registration to the audience you can support. Keep the legacy agent
  gateway disabled unless needed, and grant connected agents only the access
  they need. Keep dependencies and the host updated.
- Review every enabled outbound integration and its credentials. The operator
  model fallback can send analysis context to a provider even when a user has
  not saved a personal key; a separate user consent gate is not implemented.
- Set and communicate your own retention and log practices. The repository
  does not implement a general deletion schedule or promise that proxies,
  hosts, and providers keep no request logs.

If you host for others, you operate the database and hold the server's secrets.
Publish instance-specific privacy information and a real contact route. This
document neither establishes an official hosted service nor transfers an
operator's responsibilities to repository maintainers.
