# Changelog

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-15)

### Features

* **cli:** limbo cloud activate/deactivate/status commands ([3b6161d](https://gitlab.com/tomas209/limbo/-/commit/3b6161d5691cd05cf7f661aa31204314373334a7))
* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* **cloud:** provisioning + OAuth relay Cloudflare Workers ([d830c5e](https://gitlab.com/tomas209/limbo/-/commit/d830c5ee3c336f80d6dc7926d28047183acc18d5))
* cron MCP tools + eval system cleanup ([63c80ce](https://gitlab.com/tomas209/limbo/-/commit/63c80cec469763dfaec1578e8b45b0c6d8a54a2e))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **setup-server:** use OAuth relay when LIMBO_PUBLIC_URL is set ([51ec122](https://gitlab.com/tomas209/limbo/-/commit/51ec122871b88b477ee97052671af6f5b7b4aa57))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** public server for Limbo Cloud instances ([069b5a3](https://gitlab.com/tomas209/limbo/-/commit/069b5a31204ce1e77c87edbf053928cb805ebb8e))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* chown /tmp/gws after mkdir so gws CLI can write as limbo ([d1e05e2](https://gitlab.com/tomas209/limbo/-/commit/d1e05e22167d0b5a395feda9b839dac28c2a72ae))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* cloud e2e bugs — Dockerfile git dep, LIMBO_PORT override, switch-brain API key ([e8dcf38](https://gitlab.com/tomas209/limbo/-/commit/e8dcf389a30de6088f06e388bc649c24e76e4812))
* detect sudo requirement for npm global self-update ([c7b9e0d](https://gitlab.com/tomas209/limbo/-/commit/c7b9e0dd39cb426a679739cce507e7c4fedc3df2))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* include Docker build scripts in npm package ([6d37a90](https://gitlab.com/tomas209/limbo/-/commit/6d37a90160accd180d9435f2947d3eef132ec35d))
* inject provider API key into openclaw.json env section ([68b6b73](https://gitlab.com/tomas209/limbo/-/commit/68b6b7372dd05920cf49abddf940180f1f7c9fb8))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* pin google workspace cli for amd64 glibc compatibility ([40c2ee1](https://gitlab.com/tomas209/limbo/-/commit/40c2ee118f2d11befff3ce56c5b01afc1e3b1963))
* pin google workspace cli for glibc compatibility ([711445d](https://gitlab.com/tomas209/limbo/-/commit/711445d36d867f0961d27e2a06ed418039d5af5c))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* quote .env values with spaces and resilient sourcing ([9252e78](https://gitlab.com/tomas209/limbo/-/commit/9252e785bf378fa35d735de9fe648235c7d340e3))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))
* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-15)

### Features

* **cli:** limbo cloud activate/deactivate/status commands ([3b6161d](https://gitlab.com/tomas209/limbo/-/commit/3b6161d5691cd05cf7f661aa31204314373334a7))
* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* **cloud:** provisioning + OAuth relay Cloudflare Workers ([d830c5e](https://gitlab.com/tomas209/limbo/-/commit/d830c5ee3c336f80d6dc7926d28047183acc18d5))
* cron MCP tools + eval system cleanup ([63c80ce](https://gitlab.com/tomas209/limbo/-/commit/63c80cec469763dfaec1578e8b45b0c6d8a54a2e))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **setup-server:** use OAuth relay when LIMBO_PUBLIC_URL is set ([51ec122](https://gitlab.com/tomas209/limbo/-/commit/51ec122871b88b477ee97052671af6f5b7b4aa57))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** public server for Limbo Cloud instances ([069b5a3](https://gitlab.com/tomas209/limbo/-/commit/069b5a31204ce1e77c87edbf053928cb805ebb8e))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* cloud e2e bugs — Dockerfile git dep, LIMBO_PORT override, switch-brain API key ([e8dcf38](https://gitlab.com/tomas209/limbo/-/commit/e8dcf389a30de6088f06e388bc649c24e76e4812))
* detect sudo requirement for npm global self-update ([c7b9e0d](https://gitlab.com/tomas209/limbo/-/commit/c7b9e0dd39cb426a679739cce507e7c4fedc3df2))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* include Docker build scripts in npm package ([6d37a90](https://gitlab.com/tomas209/limbo/-/commit/6d37a90160accd180d9435f2947d3eef132ec35d))
* inject provider API key into openclaw.json env section ([68b6b73](https://gitlab.com/tomas209/limbo/-/commit/68b6b7372dd05920cf49abddf940180f1f7c9fb8))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* pin google workspace cli for amd64 glibc compatibility ([40c2ee1](https://gitlab.com/tomas209/limbo/-/commit/40c2ee118f2d11befff3ce56c5b01afc1e3b1963))
* pin google workspace cli for glibc compatibility ([711445d](https://gitlab.com/tomas209/limbo/-/commit/711445d36d867f0961d27e2a06ed418039d5af5c))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* quote .env values with spaces and resilient sourcing ([9252e78](https://gitlab.com/tomas209/limbo/-/commit/9252e785bf378fa35d735de9fe648235c7d340e3))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))
* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-15)

### Features

* **cli:** limbo cloud activate/deactivate/status commands ([3b6161d](https://gitlab.com/tomas209/limbo/-/commit/3b6161d5691cd05cf7f661aa31204314373334a7))
* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* **cloud:** provisioning + OAuth relay Cloudflare Workers ([d830c5e](https://gitlab.com/tomas209/limbo/-/commit/d830c5ee3c336f80d6dc7926d28047183acc18d5))
* cron MCP tools + eval system cleanup ([63c80ce](https://gitlab.com/tomas209/limbo/-/commit/63c80cec469763dfaec1578e8b45b0c6d8a54a2e))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **setup-server:** use OAuth relay when LIMBO_PUBLIC_URL is set ([51ec122](https://gitlab.com/tomas209/limbo/-/commit/51ec122871b88b477ee97052671af6f5b7b4aa57))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** public server for Limbo Cloud instances ([069b5a3](https://gitlab.com/tomas209/limbo/-/commit/069b5a31204ce1e77c87edbf053928cb805ebb8e))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* cloud e2e bugs — Dockerfile git dep, LIMBO_PORT override, switch-brain API key ([e8dcf38](https://gitlab.com/tomas209/limbo/-/commit/e8dcf389a30de6088f06e388bc649c24e76e4812))
* detect sudo requirement for npm global self-update ([c7b9e0d](https://gitlab.com/tomas209/limbo/-/commit/c7b9e0dd39cb426a679739cce507e7c4fedc3df2))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* include Docker build scripts in npm package ([6d37a90](https://gitlab.com/tomas209/limbo/-/commit/6d37a90160accd180d9435f2947d3eef132ec35d))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* pin google workspace cli for amd64 glibc compatibility ([40c2ee1](https://gitlab.com/tomas209/limbo/-/commit/40c2ee118f2d11befff3ce56c5b01afc1e3b1963))
* pin google workspace cli for glibc compatibility ([711445d](https://gitlab.com/tomas209/limbo/-/commit/711445d36d867f0961d27e2a06ed418039d5af5c))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* quote .env values with spaces and resilient sourcing ([9252e78](https://gitlab.com/tomas209/limbo/-/commit/9252e785bf378fa35d735de9fe648235c7d340e3))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))
* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-15)

### Features

* **cli:** limbo cloud activate/deactivate/status commands ([3b6161d](https://gitlab.com/tomas209/limbo/-/commit/3b6161d5691cd05cf7f661aa31204314373334a7))
* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* **cloud:** provisioning + OAuth relay Cloudflare Workers ([d830c5e](https://gitlab.com/tomas209/limbo/-/commit/d830c5ee3c336f80d6dc7926d28047183acc18d5))
* cron MCP tools + eval system cleanup ([63c80ce](https://gitlab.com/tomas209/limbo/-/commit/63c80cec469763dfaec1578e8b45b0c6d8a54a2e))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **setup-server:** use OAuth relay when LIMBO_PUBLIC_URL is set ([51ec122](https://gitlab.com/tomas209/limbo/-/commit/51ec122871b88b477ee97052671af6f5b7b4aa57))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** public server for Limbo Cloud instances ([069b5a3](https://gitlab.com/tomas209/limbo/-/commit/069b5a31204ce1e77c87edbf053928cb805ebb8e))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* cloud e2e bugs — Dockerfile git dep, LIMBO_PORT override, switch-brain API key ([e8dcf38](https://gitlab.com/tomas209/limbo/-/commit/e8dcf389a30de6088f06e388bc649c24e76e4812))
* detect sudo requirement for npm global self-update ([c7b9e0d](https://gitlab.com/tomas209/limbo/-/commit/c7b9e0dd39cb426a679739cce507e7c4fedc3df2))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* include Docker build scripts in npm package ([6d37a90](https://gitlab.com/tomas209/limbo/-/commit/6d37a90160accd180d9435f2947d3eef132ec35d))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* pin google workspace cli for glibc compatibility ([711445d](https://gitlab.com/tomas209/limbo/-/commit/711445d36d867f0961d27e2a06ed418039d5af5c))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* quote .env values with spaces and resilient sourcing ([9252e78](https://gitlab.com/tomas209/limbo/-/commit/9252e785bf378fa35d735de9fe648235c7d340e3))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))
* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-15)

### Features

* **cli:** limbo cloud activate/deactivate/status commands ([3b6161d](https://gitlab.com/tomas209/limbo/-/commit/3b6161d5691cd05cf7f661aa31204314373334a7))
* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* **cloud:** provisioning + OAuth relay Cloudflare Workers ([d830c5e](https://gitlab.com/tomas209/limbo/-/commit/d830c5ee3c336f80d6dc7926d28047183acc18d5))
* cron MCP tools + eval system cleanup ([63c80ce](https://gitlab.com/tomas209/limbo/-/commit/63c80cec469763dfaec1578e8b45b0c6d8a54a2e))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **setup-server:** use OAuth relay when LIMBO_PUBLIC_URL is set ([51ec122](https://gitlab.com/tomas209/limbo/-/commit/51ec122871b88b477ee97052671af6f5b7b4aa57))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** public server for Limbo Cloud instances ([069b5a3](https://gitlab.com/tomas209/limbo/-/commit/069b5a31204ce1e77c87edbf053928cb805ebb8e))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* cloud e2e bugs — Dockerfile git dep, LIMBO_PORT override, switch-brain API key ([e8dcf38](https://gitlab.com/tomas209/limbo/-/commit/e8dcf389a30de6088f06e388bc649c24e76e4812))
* detect sudo requirement for npm global self-update ([c7b9e0d](https://gitlab.com/tomas209/limbo/-/commit/c7b9e0dd39cb426a679739cce507e7c4fedc3df2))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* include Docker build scripts in npm package ([6d37a90](https://gitlab.com/tomas209/limbo/-/commit/6d37a90160accd180d9435f2947d3eef132ec35d))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* quote .env values with spaces and resilient sourcing ([9252e78](https://gitlab.com/tomas209/limbo/-/commit/9252e785bf378fa35d735de9fe648235c7d340e3))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))
* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-15)

### Features

* **cli:** limbo cloud activate/deactivate/status commands ([3b6161d](https://gitlab.com/tomas209/limbo/-/commit/3b6161d5691cd05cf7f661aa31204314373334a7))
* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* **cloud:** provisioning + OAuth relay Cloudflare Workers ([d830c5e](https://gitlab.com/tomas209/limbo/-/commit/d830c5ee3c336f80d6dc7926d28047183acc18d5))
* cron MCP tools + eval system cleanup ([63c80ce](https://gitlab.com/tomas209/limbo/-/commit/63c80cec469763dfaec1578e8b45b0c6d8a54a2e))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **setup-server:** use OAuth relay when LIMBO_PUBLIC_URL is set ([51ec122](https://gitlab.com/tomas209/limbo/-/commit/51ec122871b88b477ee97052671af6f5b7b4aa57))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** public server for Limbo Cloud instances ([069b5a3](https://gitlab.com/tomas209/limbo/-/commit/069b5a31204ce1e77c87edbf053928cb805ebb8e))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* cloud e2e bugs — Dockerfile git dep, LIMBO_PORT override, switch-brain API key ([e8dcf38](https://gitlab.com/tomas209/limbo/-/commit/e8dcf389a30de6088f06e388bc649c24e76e4812))
* detect sudo requirement for npm global self-update ([c7b9e0d](https://gitlab.com/tomas209/limbo/-/commit/c7b9e0dd39cb426a679739cce507e7c4fedc3df2))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* quote .env values with spaces and resilient sourcing ([9252e78](https://gitlab.com/tomas209/limbo/-/commit/9252e785bf378fa35d735de9fe648235c7d340e3))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))
* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-13)

### Features

* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* detect sudo requirement for npm global self-update ([c7b9e0d](https://gitlab.com/tomas209/limbo/-/commit/c7b9e0dd39cb426a679739cce507e7c4fedc3df2))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* quote .env values with spaces and resilient sourcing ([9252e78](https://gitlab.com/tomas209/limbo/-/commit/9252e785bf378fa35d735de9fe648235c7d340e3))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))
* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-13)

### Features

* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* detect sudo requirement for npm global self-update ([c7b9e0d](https://gitlab.com/tomas209/limbo/-/commit/c7b9e0dd39cb426a679739cce507e7c4fedc3df2))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))
* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.4.6](https://gitlab.com/tomas209/limbo/-/compare/v2026.4.5...v2026.4.6) (2026-04-13)

### Bug Fixes

* wizard UX — auto-cancel stale sessions + embed Google OAuth ([c20f971](https://gitlab.com/tomas209/limbo/-/commit/c20f971035c4b0ab8f6d9aa91c83ac0b778001d1))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-13)

### Features

* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add CAP_DAC_OVERRIDE for root startup phase ([3a7d1d1](https://gitlab.com/tomas209/limbo/-/commit/3a7d1d18ba0163d6290efae147bfd66e798cb401))
* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-13)

### Features

* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* atomic update — version parity, chown order, legacy token paths ([846557f](https://gitlab.com/tomas209/limbo/-/commit/846557f0c3ff0121f42bd19b43c27d2b58ce1763))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-12)

### Features

* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* gosu pattern, npm timeout, fixed wizard port ([d920a68](https://gitlab.com/tomas209/limbo/-/commit/d920a685be70c43b229d8b43cf70243fe8759be6))
* make openclaw audio patch non-fatal when code shape changes ([e8f7352](https://gitlab.com/tomas209/limbo/-/commit/e8f735265e9e9648b2063c87133d713469ba7541))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))

## [2026.5.0](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.5.0) (2026-04-11)

### Features

* **cli:** migrate switch-brain to wizard supervisor control plane ([2b55d34](https://gitlab.com/tomas209/limbo/-/commit/2b55d34b023fbbc8f23024a112ed50e37b0a14b1))
* Google Calendar integration ([#227](https://gitlab.com/tomas209/limbo/-/issues/227)) ([e636a63](https://gitlab.com/tomas209/limbo/-/commit/e636a636baedeb354903dcc3a77eac837e2c7444))
* **supervisor:** control plane foundation (session store + router + HTTP server) ([135d7dc](https://gitlab.com/tomas209/limbo/-/commit/135d7dcc588e041f34e9090d4442bd3a64458774))
* **supervisor:** enforce single active wizard + CLI SIGINT cleanup ([cfd84e5](https://gitlab.com/tomas209/limbo/-/commit/cfd84e5d9fcf4d1b211f31f845451de3be24aa40))
* **supervisor:** move control plane from Unix socket to TCP 127.0.0.1 ([765a876](https://gitlab.com/tomas209/limbo/-/commit/765a8766379eed0d9b40e4c7db468fae74405648))
* **supervisor:** process integration (spawner, client, orchestrator) ([2ab8e22](https://gitlab.com/tomas209/limbo/-/commit/2ab8e223d457476e5177955b881a2cde989f5ba0))
* **supervisor:** wire integration — entrypoint, cli, compose, regen script ([f17374a](https://gitlab.com/tomas209/limbo/-/commit/f17374acc35fccddb89c0d125daf80b7ded55e80))

### Bug Fixes

* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* address code review findings (C1-C4, I1-I5) ([30808de](https://gitlab.com/tomas209/limbo/-/commit/30808de100d3f122368d9123a1b3b28d338ba76b))
* **cli:** cloudflare tunnel self-heals via blocking DNS check + fallback ([800d139](https://gitlab.com/tomas209/limbo/-/commit/800d1392f3b71edbceff7a58432987f02f659ede))
* follow-up callers that still read /run/secrets and secrets dir ([71be2a6](https://gitlab.com/tomas209/limbo/-/commit/71be2a6336d88197da2aac7c6d4eb324a8876a1a))
* make release reruns idempotent ([f9d5895](https://gitlab.com/tomas209/limbo/-/commit/f9d589501d0c756d84e51d9075f4ffe5912e2565))
* point conventional-changelog writerOpts to GitLab URLs ([b395e65](https://gitlab.com/tomas209/limbo/-/commit/b395e6521663077ba87220f3f340647c7b8d1bd2))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* skip husky prepare in CI ([231eee4](https://gitlab.com/tomas209/limbo/-/commit/231eee46dfc6efa6e99a8ea045e3f1d3d699b17c))
* **supervisor:** bind control plane to 0.0.0.0 inside container ([0039bdf](https://gitlab.com/tomas209/limbo/-/commit/0039bdf5a5350f4c432b3329ddd815c82556a8dd))
* **supervisor:** honour SETUP_TOKEN from env + wire e2e compose ([ea53159](https://gitlab.com/tomas209/limbo/-/commit/ea53159f1d0e8352517c51abe5c1ba170f11c0ae))
* **supervisor:** respawn OpenClaw on clean exit (self-restart loop) ([0402a97](https://gitlab.com/tomas209/limbo/-/commit/0402a9760284f6ded336e37e0a113cbd6dbc5530))
* **supervisor:** set OPENCLAW_NO_RESPAWN=1 in openclaw child env ([ce08f95](https://gitlab.com/tomas209/limbo/-/commit/ce08f95de1994e12ce1a1d79ce7aba6911bd244c))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))

## [2026.4.1](https://gitlab.com/tomas209/limbo/-/compare/v1.32.0...v2026.4.1) (2026-04-10)

### Bug Fixes

* add migration 006 to dedupe notes_fts index retroactively ([890f68d](https://gitlab.com/tomas209/limbo/-/commit/890f68d6391d6604d1372a053602cb2610060379))
* point conventional-changelog writerOpts to GitLab URLs ([ddb6471](https://gitlab.com/tomas209/limbo/-/commit/ddb6471e61a064bf1b88cd94170166f3d6aca818))
* remove duplicate migration 004-fts5-search.js ([5eb5dbb](https://gitlab.com/tomas209/limbo/-/commit/5eb5dbb91142bd78b71dfa06cbd225d843fa0a09))
* voice transcription regression (2 bugs + regression test) ([13cb5d6](https://gitlab.com/tomas209/limbo/-/commit/13cb5d630d44c12abffd33329b298bab49d49fd6))

All notable changes to Limbo will be documented in this file.

This project uses [Calendar Versioning](https://calver.org/) in the format `YYYY.M.N`:
- `YYYY` — year
- `M` — month (1-12)
- `N` — release counter within the month (resets to 0 each month)

Entries are generated automatically by `release-it` from [Conventional Commits](https://www.conventionalcommits.org/).
