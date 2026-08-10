function mentionsBot(message, botId) {
  return Array.isArray(message.mentions) && message.mentions.some((mention) => String(mention?.id ?? mention) === botId);
}

function normalizedMessage(message) {
  return {
    id: String(message.id),
    channelId: String(message.channel_id),
    guildId: String(message.guild_id ?? ""),
    timestamp: message.timestamp ?? new Date().toISOString(),
    author: {
      id: String(message.author?.id ?? ""),
      username: message.author?.global_name ?? message.author?.username ?? "unknown",
      bot: Boolean(message.author?.bot),
    },
    content: typeof message.content === "string" ? message.content : "",
    mentions: Array.isArray(message.mentions) ? message.mentions.map((mention) => String(mention?.id ?? mention)) : [],
    attachments: Array.isArray(message.attachments) ? message.attachments.map((attachment) => ({
      id: String(attachment.id),
      filename: attachment.filename ?? "attachment",
      contentType: attachment.content_type ?? null,
      size: attachment.size ?? null,
      url: attachment.url,
    })) : [],
    embeds: Array.isArray(message.embeds) ? message.embeds.map((embed) => ({
      url: embed.url ?? null,
      title: embed.title ?? null,
      description: embed.description ?? null,
      provider: embed.provider?.name ?? null,
    })) : [],
  };
}

export class PresenceBatcher {
  constructor({ botId, settingsProvider, coalesceMilliseconds = 20_000, maximumBatchMessages = 30, onReady }) {
    if (!botId) throw new Error("PresenceBatcher requires the Discord bot ID.");
    if (typeof settingsProvider !== "function") throw new Error("PresenceBatcher requires a settings provider.");
    if (typeof onReady !== "function") throw new Error("PresenceBatcher requires an onReady callback.");
    this.botId = String(botId);
    this.settingsProvider = settingsProvider;
    this.coalesceMilliseconds = Math.max(0, Number(coalesceMilliseconds) || 0);
    this.maximumBatchMessages = Math.max(1, Number(maximumBatchMessages) || 30);
    this.onReady = onReady;
    this.pending = new Map();
    this.lurkBuffers = new Map();
    this.timer = null;
  }

  async ingest(rawMessage) {
    const settings = await this.settingsProvider();
    const channelId = String(rawMessage?.channel_id ?? "");
    const policy = settings.channels?.[channelId];
    if (!policy || String(rawMessage?.guild_id ?? "") !== settings.discord.serverId) return { accepted: false, reason: "outside-policy" };
    if (rawMessage.author?.bot || String(rawMessage.author?.id ?? "") === this.botId) return { accepted: false, reason: "bot-message" };

    const ping = mentionsBot(rawMessage, this.botId);
    const message = normalizedMessage(rawMessage);
    let delivered = [];
    if (policy.mode === "strict") {
      if (!ping) return { accepted: false, reason: "strict-without-ping" };
      delivered = [message];
    } else if (policy.mode === "lurk") {
      const limit = Math.min(100, Math.max(1, policy.lurkBufferMessages || 25));
      const buffer = [...(this.lurkBuffers.get(channelId) ?? []), message].slice(-limit);
      this.lurkBuffers.set(channelId, buffer);
      if (!ping) return { accepted: false, reason: "lurk-buffered" };
      delivered = buffer;
      this.lurkBuffers.set(channelId, []);
    } else {
      delivered = [message];
    }

    const current = this.pending.get(channelId) ?? { channelId, policy: { ...policy }, directPing: false, messages: [] };
    const seen = new Set(current.messages.map((entry) => entry.id));
    for (const entry of delivered) if (!seen.has(entry.id)) current.messages.push(entry);
    current.messages = current.messages.slice(-this.maximumBatchMessages);
    current.directPing ||= ping;
    current.policy = { ...policy };
    this.pending.set(channelId, current);
    this.#schedule();
    return { accepted: true, directPing: current.directPing, queuedMessages: current.messages.length };
  }

  #schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, this.coalesceMilliseconds);
    this.timer.unref?.();
  }

  async flushNow() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.size) return null;
    const channels = [...this.pending.values()];
    this.pending.clear();
    const batch = {
      createdAt: new Date().toISOString(),
      directPing: channels.some((channel) => channel.directPing),
      messageCount: channels.reduce((total, channel) => total + channel.messages.length, 0),
      channels,
    };
    await this.onReady(batch);
    return batch;
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
