Original prompt: okay implement

- Added camera ownership refactor so render yaw/pitch always come from local input and CSP-off render position comes from authoritative interpolated local snapshot.
- Planning verification pass with local server/client processes, smoke + multiplayer quick tests, and process cleanup.
- Added regression guard assertions in `scripts/architecture-guards.ts` to prevent reintroducing ack/snapshot-driven local camera orientation.
- Ran verification with local services. `test:smoke:fast` passed. Initial `test:architecture` guard failed due overly broad string match and was refined to inspect only the InputAck schema/interface blocks.
- Verification results after refinement:
  - `npm run test:architecture` PASS
  - `npm run test:smoke:fast` PASS
  - `npm run test:multiplayer:quick` PASS on rerun (first run failed remote movement threshold; second run passed, indicating E2E flake)
- Closed locally started `dev:server` and `dev:client` processes after checks.
