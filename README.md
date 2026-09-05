# web-server-integration-e2e

Overall status: **contract-only** for the full public/customer/admin and deployed
dual-environment acceptance contract. Executable **public synthetic browser tests**
are now available; these do not establish the remaining capabilities.

This repository is an executable acceptance-suite boundary, not evidence that the corresponding product capability is complete. The suite must target both `ores-chat` and the isolated `ores-chat-test` fixture. Promotion to `live` requires hosted execution, deterministic assertions, and redacted retained evidence.

The machine-readable plan is in `suite.json` and is validated by the organization policy action pinned to an immutable commit. Public, customer, administrator, and internal-service identities are never interchangeable.

## Public browser acceptance

`tests/public-support.spec.js` exercises desktop and mobile Chromium using a real
Rust web process and its real public HTTP SDK against a synthetic API:

- Replies, continuation, and absence of browser credentials or transcript storage.
- Upstream failures, safe errors, retry, cancellation, and in-flight draft edits.
- Prompt controls, clear draft, new conversation, and escaped untrusted markup.
- Native forms without JavaScript and public origin/credential rejection.
- Viewport overflow, keyboard navigation, and axe checks with no disabled rules.

All prompts and responses are synthetic. Tests require
`http://127.0.0.1:4311/readyz` to return `204` and
`X-ORES-Chat-Fixture: synthetic-public-v1`. The origin is deliberately not an
environment option. Do not use a tunnel or proxy to a real service.

The browser receives the exact locked HTMX npm distribution at its production CDN
URL; the suite verifies its SHA-384 and the browser enforces the page's SRI. This
isolates application behavior from CDN availability, not proof of CDN uptime.

```sh
npm ci --ignore-scripts
zed validate
zed task run check
npx --no-install playwright install --with-deps chromium
# In an authorized private source checkout, start `cargo run --locked --example preview`.
zed task run browser
```

The public repository CI validates lint, formatting, test discovery, and the suite
manifest. Actual browser execution is performed by the private
`ores-chat/ores-chat-web-server.rs` workflow, which checks out an immutable commit
of this test suite. This keeps private application source out of the public test
repository and avoids granting a public job access to private repository tokens.
Synthetic failure traces, screenshots, and results stay in that private run under
`tmp/`. A green discovery check is **not** a passing browser run.

Customer/admin authentication, secure-session lifecycle, streaming, actual model
providers, persisted support records, and deployed main-org/test-org environments
still need separate runtime acceptance. Track this slice in
[issue #1](https://github.com/ores-chat-test/web-server-integration-e2e/issues/1) and
the complete platform work in the
[parity milestone](https://github.com/ores-chat/ores-chat-docs/issues/4).
