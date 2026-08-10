import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { DiscordGatewayClient } from "../src/gateway-client.mjs";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

test("Gateway identifies, heartbeats, and dispatches Discord events", async () => {
  FakeWebSocket.instances = [];
  const dispatched = [];
  const client = new DiscordGatewayClient({
    gatewayUrl: "wss://gateway.discord.test",
    token: "secret-that-must-not-be-dispatched",
    WebSocketClass: FakeWebSocket,
    onDispatch: (event) => dispatched.push(event),
  });

  client.start();
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, "wss://gateway.discord.test?v=10&encoding=json");
  socket.emit("message", Buffer.from(JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.sent[0].op, 1);
  assert.equal(socket.sent[1].op, 2);
  assert.equal(socket.sent[1].d.token, "secret-that-must-not-be-dispatched");
  socket.emit("message", Buffer.from(JSON.stringify({ op: 11 })));

  socket.emit("message", Buffer.from(JSON.stringify({ op: 0, s: 42, t: "MESSAGE_CREATE", d: { id: "m1" } })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatched, [{ type: "MESSAGE_CREATE", data: { id: "m1" } }]);
  client.close();
});
