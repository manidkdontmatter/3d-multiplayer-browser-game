import process from "node:process";
import net from "node:net";
import { chromium } from "playwright";

const CLIENT_URL = "http://127.0.0.1:5173";
const SERVER_PORT = 9001;
const CLIENT_PORT = 5173;

function isPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function main() {
  const serverUp = await isPortOpen("127.0.0.1", SERVER_PORT);
  const clientUp = await isPortOpen("127.0.0.1", CLIENT_PORT);
  if (!serverUp || !clientUp) {
    console.error(
      `[smoke-fast] FAIL expected running services on ws://127.0.0.1:${SERVER_PORT} and http://127.0.0.1:${CLIENT_PORT}`
    );
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const logs = [];
    page.on("console", (msg) => {
      logs.push({ type: msg.type(), text: msg.text() });
    });

    await page.goto(CLIENT_URL, { waitUntil: "networkidle", timeout: 12000 });
    await page.mouse.click(640, 360);
    await page.waitForTimeout(900);

    const stateText = await page.evaluate(() => {
      return typeof window.render_game_to_text === "function"
        ? window.render_game_to_text()
        : "missing render_game_to_text";
    });
    if (stateText === "missing render_game_to_text") {
      throw new Error("Client did not expose window.render_game_to_text");
    }

    const parsed = JSON.parse(stateText);
    if (parsed.mode !== "connected") {
      throw new Error(`Expected connected mode, got ${parsed.mode}`);
    }

    const hasFatalConsoleError = logs.some(
      (entry) =>
        entry.type === "error" &&
        !entry.text.includes("ERR_CONNECTION_REFUSED") &&
        !entry.text.includes("WebSocket connection")
    );
    if (hasFatalConsoleError) {
      throw new Error("Console contained runtime errors.");
    }

    console.log("[smoke-fast] PASS");
  } catch (error) {
    console.error("[smoke-fast] FAIL", error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

void main();
