# Handoff — Release 2026.4.1 / VPS Recovery / Limbo Config Regression

Date: 2026-04-10

## Summary

Se arregló el pipeline de release de GitLab, se publicó `limbo-ai@2026.4.1`, y después hubo que recuperar manualmente una instalación real en la VPS `aios-prod`.

El problema de fondo no fue sólo “la VPS está rara”. Hay un bug general de producto alrededor de:

- `~/.limbo/config/.env` escrito con permisos host-side incompatibles con el usuario `limbo` del contenedor
- `~/.limbo/config/` necesitando escritura para `setup_token`
- secrets restaurados/copiados con ownership incorrecto para `openclaw-state/secrets`
- pérdida parcial del `.env` dejando la instancia en setup mode aunque el auth/profile viejo seguía existiendo

## 1. Release pipeline

### Lo que se corrigió

- `package.json`
  - `prepare` ya no rompe en CI cuando `husky` no está disponible
- `.gitlab-ci.yml`
  - el release job ahora es reintentable
  - si npm ya publicó la versión, sigue reconciliando tag + GitLab Release
  - la GitLab Release se crea o actualiza idempotentemente
- `package.json` + `mcp-server/.npmignore`
  - se limpió fuerte el tarball publicado a npm

### MRs relevantes

- `!36` — fix puntual de `husky`
- `!38` — fix completo de release rerunnable + packaging

### Estado final del release

- npm: `limbo-ai@2026.4.1` publicado
- tag: `v2026.4.1` creado
- GitLab Release: creada correctamente
- pipeline de release: OK

## 2. Qué pasó en la VPS

### Síntoma inicial

Después de `limbo update`, la instancia real quedó en loop con:

```text
/entrypoint.sh: 114: .: cannot open /data/config/.env: Permission denied
```

Luego, al corregir eso, pasó a:

```text
Error: EACCES: permission denied, open '/data/config/setup_token'
```

### Root cause real

La instalación en `aios-prod` tenía:

- `~/.limbo/config/.env` parcial
- `~/.limbo/config/` no escribible para el usuario del contenedor
- `~/.limbo/openclaw-state/secrets/*` sin ownership legible por `uid=999`
- auth vieja todavía presente en:
  - `/home/aios/.limbo/auth-profiles.json`
  - `/home/aios/.limbo/zeroclaw-state/auth-profiles.json`
- features viejos todavía presentes en:
  - `/home/aios/.limbo/zeroclaw-state/secrets/telegram_bot_token`
  - `/home/aios/.limbo/zeroclaw-state/secrets/groq_api_key`
  - `/home/aios/.limbo/zeroclaw-state/secrets/brave_api_key`

La instancia no había “perdido todo”; había perdido parte del `.env` y permisos correctos.

## 3. Particularidad operativa de esa VPS

Importante: en `aios-prod` hay **dos instalaciones de OpenClaw**.

Se observó un proceso host-side separado:

- proceso: `openclaw-gateway`
- puerto: `127.0.0.1:18789`
- no pertenece a la instancia de Limbo en Docker que estaba siendo reparada

No matar a ciegas ese proceso en automatizaciones futuras.

La instancia de Limbo reparada quedó en:

- compose path: `/home/aios/.limbo/docker-compose.yml`
- puerto: `127.0.0.1:18900`

## 4. Qué se restauró manualmente

### Config mínima de brain

Se reconstruyó `~/.limbo/config/.env` con:

```env
CLI_LANGUAGE=en
LIMBO_PORT=18900
USER_TIMEZONE=America/Argentina/Buenos_Aires
AUTH_MODE=subscription
MODEL_PROVIDER=openai-codex
MODEL_NAME=gpt-5.4
TELEGRAM_ENABLED=true
VOICE_ENABLED=true
WEB_SEARCH_ENABLED=true
```

### Secrets/features

Se copiaron desde `zeroclaw-state/secrets/` hacia:

- `/home/aios/.limbo/secrets/`
- `/home/aios/.limbo/openclaw-state/secrets/`

Archivos relevantes:

- `telegram_bot_token`
- `groq_api_key`
- `brave_api_key`

### Permisos necesarios para que funcione

Para salir del loop se terminó necesitando:

- `chmod 777 /home/aios/.limbo/config`
- `.env` legible por el contenedor
- `openclaw-state/secrets/*` con:
  - owner `999:999`
  - mode `600`

Sin ese `chown 999:999`, el entrypoint seguía logueando:

```text
Telegram not enabled — skipping wakeup routine
```

aunque `TELEGRAM_ENABLED=true` estuviera en `.env`, porque el fallback a `~/.openclaw/secrets` no podía leer los archivos.

## 5. Estado final de la VPS

Logs verificados al final:

- `Loaded config from /data/config/.env`
- `Subscription mode — credentials resolved from secrets`
- `Telegram channel enabled in config`
- `Voice transcription enabled`
- `Web search enabled in config`
- `Running wakeup routine`
- `Starting OpenClaw gateway`

La instancia quedó funcional otra vez y el vault no fue tocado.

## 6. Qué hay que arreglar en código mañana

Esto no se debería resolver manualmente otra vez.

### A. Permisos de `config/`

Hay que revisar toda la cadena host -> contenedor para `~/.limbo/config`.

Hoy la CLI escribe `.env` con `0600` en varios lugares de `cli.js`. Eso es razonable para host-only, pero incompatible con bind-mount a un contenedor non-root que necesita:

- leer `/data/config/.env`
- escribir `/data/config/setup_token`

Puntos a revisar:

- [cli.js](/Users/tomasward/Desktop/Dev/limbo/cli.js#L800)
- [cli.js](/Users/tomasward/Desktop/Dev/limbo/cli.js#L1118)
- [cli.js](/Users/tomasward/Desktop/Dev/limbo/cli.js#L2272)
- [scripts/entrypoint.sh](/Users/tomasward/Desktop/Dev/limbo/scripts/entrypoint.sh#L107)
- [setup-server/server.js](/Users/tomasward/Desktop/Dev/limbo/setup-server/server.js#L143)

La dirección correcta probablemente sea:

- `config/` escribible por el contenedor
- `.env` legible por el contenedor
- no depender de permisos host-user específicos

### B. Secrets fallback

El `entrypoint` hoy lee:

1. `/run/secrets/*`
2. `~/.openclaw/secrets/*`

En la práctica, si `/run/secrets/*` no es legible por el usuario del contenedor, el fallback a `~/.openclaw/secrets` tiene que funcionar siempre. Para eso:

- cuando se copian secrets en boot, hay que garantizar ownership/mode correctos
- hoy se hace `cp "$src" "$dst"` pero sin `chown` posterior

Punto clave:

- [scripts/entrypoint.sh](/Users/tomasward/Desktop/Dev/limbo/scripts/entrypoint.sh#L176)

### C. Detección y recuperación en `limbo update`

`limbo update` debería detectar estos casos y dar un mensaje claro:

- puerto ocupado por otro `openclaw-gateway`
- `config/.env` no legible
- `config/` no escribible
- contenedor cayó a setup mode aunque existe auth previa

Idealmente, debería:

- no dejar la instancia medio rota
- sugerir o ejecutar un repair controlado

### D. Restauración desde auth/state existente

Si existe auth profile legacy y el `.env` quedó incompleto, la app debería poder reconstruir:

- `AUTH_MODE`
- `MODEL_PROVIDER`
- `MODEL_NAME`

sin mandar al usuario directo al wizard.

## 7. Datos de campo útiles

### VPS

- host: `aios-prod`
- user: `aios`

### Paths reales usados

- Limbo compose: `/home/aios/.limbo/docker-compose.yml`
- config: `/home/aios/.limbo/config/.env`
- current state: `/home/aios/.limbo/openclaw-state`
- legacy state: `/home/aios/.limbo/zeroclaw-state`
- legacy auth copy: `/home/aios/.limbo/auth-profiles.json`

### Another-installation warning

No asumir que `127.0.0.1:18789` pertenece a esta instancia.

En esta VPS había otro `openclaw-gateway` host-side escuchando ahí.

## 8. Recommended next task

Abrir branch nueva y arreglar esto de raíz en código:

1. permisos correctos de `config/`
2. ownership correcto de secrets copiados a `openclaw-state/secrets`
3. repair path para `.env` incompleto con auth profile existente
4. logs/errores operativos mucho más claros en `limbo update`

## 9. E2E state migration (post secrets-consolidation)

El work de secrets-consolidation movió `.env` a `~/.limbo/config/.env` y ajustó algunos bind-mount paths. Si ya tenés un setup e2e funcionando en `/tmp/limbo-e2e-test/`, después de pullear esta branch el container va a arrancar en setup mode porque el `.env` no está donde el nuevo `docker-compose.test.yml` lo espera.

One-shot migration para un state existente:

```bash
mkdir -p /tmp/limbo-e2e-test/config
mv /tmp/limbo-e2e-test/.env /tmp/limbo-e2e-test/config/.env
# If you had secrets files lying around, they can stay — the container
# will migrate them automatically via migrateLegacySecretsToEnv.
```

Google Calendar credentials: el archivo se movió de `/tmp/limbo-e2e-test/openclaw-state/secrets/google_calendar_credentials.json` a `/tmp/limbo-e2e-test/openclaw-state/google/credentials.json`. Si tu state existente todavía tiene el path viejo, sigue funcionando porque `scripts/entrypoint.sh` tiene un fallback, pero los setups nuevos deberían usar el path nuevo.
