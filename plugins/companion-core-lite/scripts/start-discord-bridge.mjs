import process from "node:process";
import { startDiscordBridge } from "../bridge/discord-bridge.mjs";

async function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("A local interactive terminal is required for the hidden token prompt.");
  }
  process.stdout.write(prompt);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\u0003") {
            process.stdin.off("data", onData);
            reject(new Error("Token entry cancelled."));
            return;
          }
          if (character === "\r" || character === "\n") {
            process.stdin.off("data", onData);
            process.stdout.write("\n");
            resolve(value.trim());
            return;
          }
          if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
            continue;
          }
          if (character >= " ") value += character;
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

let token = await readHidden("Discord bot token (hidden; never saved): ");
if (!token) throw new Error("No Discord bot token was entered.");

const bridge = await startDiscordBridge({ token });
token = "";

process.stdout.write(`Connected ${bridge.identity.application.name} as ${bridge.identity.bot.username} in ${bridge.identity.guild.name}.\n`);
process.stdout.write("The token is held only in this process. Keep this window open; press Ctrl+C to disconnect.\n");

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  process.stdout.write("\nStopping Companion Core Lite Discord bridge...\n");
  await bridge.close();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
