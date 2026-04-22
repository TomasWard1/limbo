'use strict';

/**
 * buildChannelsFromEnv — assemble the `channels` map that the supervisor
 * hands to the public server.
 *
 * Called from scripts/supervisor.js (container main) after .env is sourced
 * into process.env. Each feature flag turns on one adapter + pipeline.
 *
 * Factories are injectable for tests (stub adapter / stub pipeline).
 */

const { createWhatsAppKapsoAdapter } = require('./channel-adapters/whatsapp-kapso');
const { createChannelPipeline } = require('./channel-pipeline');
const { sendChat } = require('./openclaw-client');

/**
 * @param {Record<string, string | undefined>} env
 * @param {{
 *   adapterFactory?: (config: any) => any,
 *   pipelineFactory?: (opts: any) => any,
 *   openclawSend?: (args: any) => Promise<string>,
 *   logger?: {info: Function, warn: Function, error: Function}
 * }} [deps]
 */
function buildChannelsFromEnv(env, deps = {}) {
  const channels = {};

  if (env.CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED === 'true') {
    const apiKey = env.KAPSO_API_KEY;
    const phoneNumberId = env.KAPSO_PHONE_NUMBER_ID;
    const gatewayToken = env.GATEWAY_TOKEN;
    const limboPort = env.LIMBO_PORT || '18789';

    if (!apiKey) throw new Error('build-channels: KAPSO_API_KEY required when CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED=true');
    if (!phoneNumberId) throw new Error('build-channels: KAPSO_PHONE_NUMBER_ID required when CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED=true');
    if (!gatewayToken) throw new Error('build-channels: GATEWAY_TOKEN required when CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED=true');

    const adapterFactory = deps.adapterFactory || createWhatsAppKapsoAdapter;
    const pipelineFactory = deps.pipelineFactory || createChannelPipeline;
    const openclawSend = deps.openclawSend || ((args) => sendChat({
      gatewayUrl: `http://127.0.0.1:${limboPort}`,
      token: gatewayToken,
      ...args,
    }));

    const adapter = adapterFactory({ apiKey, phoneNumberId });
    const pipeline = pipelineFactory({
      adapter,
      openclaw: { sendChat: openclawSend },
      logger: deps.logger,
    });

    channels.whatsapp = {
      onInbound: async (payload, headers) => {
        const events = await adapter.receive(payload, headers);
        for (const event of events) {
          pipeline.enqueue(event);
        }
      },
      onStop: () => pipeline.stop(),
    };
  }

  return channels;
}

module.exports = { buildChannelsFromEnv };
