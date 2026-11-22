#!/usr/bin/env node
// Headless-Chrome screenshot over the DevTools protocol (no Puppeteer needed:
// Node 22+ has a global WebSocket). Used by scripts/screenshot.sh.
//
//   node scripts/screenshot.js <url> <out.png> [--cookie name=value]
//        [--width 1280] [--height 900] [--wait 1500] [--dark]
//
// --cookie is set for the URL's origin under path /api (where the app's
// session cookie lives), so a logged-in page can be captured.
// --wait is extra time after the load event, for the React app's API calls.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const findChrome = () => {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("No Chrome found (set CHROME_PATH)");
  return found;
};

const parseArgs = (argv) => {
  const opts = { width: 1280, height: 900, wait: 1500, dark: false, cookie: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dark") opts.dark = true;
    else if (a.startsWith("--")) opts[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  if (pos.length !== 2) {
    throw new Error("Usage: screenshot.js <url> <out.png> [--cookie name=value] [--width N] [--height N] [--wait ms] [--dark]");
  }
  return { url: pos[0], out: pos[1], ...opts };
};

const waitFor = async (fn, ms, what) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const main = async () => {
  const o = parseArgs(process.argv.slice(2));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hn-shot-"));
  const chrome = spawn(findChrome(), [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    // Root in a container/VM has no usable sandbox.
    ...(process.getuid && process.getuid() === 0 ? ["--no-sandbox"] : []),
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    const port = await waitFor(
      () => fs.existsSync(portFile) && fs.readFileSync(portFile, "utf8").split("\n")[0],
      20000, "Chrome to start");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let nextId = 1;
    const pending = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: Number(o.width), height: Number(o.height), deviceScaleFactor: 1, mobile: false,
    });
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: o.dark ? "dark" : "light" }],
    });
    if (o.cookie) {
      const eq = o.cookie.indexOf("=");
      const origin = new URL(o.url).origin;
      await send("Network.setCookie", {
        name: o.cookie.slice(0, eq), value: o.cookie.slice(eq + 1), url: `${origin}/api`, path: "/api",
      });
    }
    await send("Page.navigate", { url: o.url });
    await waitFor(() => events.some((e) => e.method === "Page.loadEventFired"), 30000, "page load");
    await new Promise((r) => setTimeout(r, Number(o.wait)));

    const errors = events
      .filter((e) => e.method === "Runtime.exceptionThrown" ||
        (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"))
      .map((e) => e.params.exceptionDetails?.text ?? e.params.args?.map((a) => a.value ?? a.description).join(" "));
    for (const err of errors) console.error(`[page error] ${err}`);

    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(o.out, Buffer.from(data, "base64"));
    console.log(`Saved ${o.out}`);
    ws.close();
  } finally {
    chrome.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(profile, { recursive: true, force: true });
  }
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
