import WebSocket from "ws";

const MESSAGE_INTENTS = 1 | 512 | 32_768;

export class DiscordGatewayClient {
  constructor({ gatewayUrl, token, onDispatch, WebSocketClass = WebSocket, reconnectDelayMilliseconds = 5_000 }) {
    if (!gatewayUrl || !token) throw new Error("Discord Gateway URL and bot token are required.");
    this.gatewayUrl = gatewayUrl;
    this.token = token;
    this.onDispatch = onDispatch;
    this.WebSocketClass = WebSocketClass;
    this.reconnectDelayMilliseconds = reconnectDelayMilliseconds;
    this.sequence = null;
    this.socket = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.heartbeatAcknowledged = true;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this.#connect();
  }

  #connect() {
    if (this.stopped) return;
    const separator = this.gatewayUrl.includes("?") ? "&" : "?";
    const socket = new this.WebSocketClass(`${this.gatewayUrl}${separator}v=10&encoding=json`);
    this.socket = socket;
    socket.on("message", (bytes) => void this.#message(bytes).catch((error) => this.onDispatch?.({ type: "gateway.error", error })));
    socket.on("close", () => this.#reconnect());
    socket.on("error", (error) => this.onDispatch?.({ type: "gateway.error", error }));
  }

  async #message(bytes) {
    let payload;
    try {
      payload = JSON.parse(bytes.toString());
    } catch {
      return;
    }
    if (payload.s != null) this.sequence = payload.s;
    if (payload.op === 10) {
      this.#startHeartbeat(payload.d.heartbeat_interval);
      this.#send({
        op: 2,
        d: {
          token: this.token,
          intents: MESSAGE_INTENTS,
          properties: { os: process.platform, browser: "companion-core-lite", device: "companion-core-lite" },
          presence: { status: "online", since: 0, activities: [], afk: false },
        },
      });
      return;
    }
    if (payload.op === 1) return this.#heartbeat();
    if (payload.op === 11) {
      this.heartbeatAcknowledged = true;
      return;
    }
    if (payload.op === 7 || payload.op === 9) return this.#forceReconnect();
    if (payload.op === 0 && payload.t) await this.onDispatch?.({ type: payload.t, data: payload.d });
  }

  #send(payload) {
    if (this.socket?.readyState === this.WebSocketClass.OPEN) this.socket.send(JSON.stringify(payload));
  }

  #heartbeat() {
    if (!this.heartbeatAcknowledged) {
      this.#forceReconnect();
      return;
    }
    this.heartbeatAcknowledged = false;
    this.#send({ op: 1, d: this.sequence });
  }

  #startHeartbeat(interval) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.#heartbeat();
    this.heartbeatTimer = setInterval(() => this.#heartbeat(), Math.max(1_000, Number(interval) || 45_000));
    this.heartbeatTimer.unref?.();
  }

  #forceReconnect() {
    try { this.socket?.close(); } catch {}
    this.#reconnect();
  }

  #reconnect() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatAcknowledged = true;
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#connect();
    }, this.reconnectDelayMilliseconds);
    this.reconnectTimer.unref?.();
  }

  close() {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    try { this.socket?.close(); } catch {}
  }
}
