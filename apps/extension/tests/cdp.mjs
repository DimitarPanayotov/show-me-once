import { writeFile } from "node:fs/promises";
export const debugBase = process.env.SMO_CDP_BASE || "http://localhost:9226";
export async function targets() {
  return fetch(`${debugBase}/json/list`).then((r) => r.json());
}
export async function open(url) {
  const page = await connect(
    await fetch(`${debugBase}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
    }).then((r) => r.json()),
  );
  await page.until(
    `location.href.startsWith(${JSON.stringify(url)}) && document.readyState==='complete'`,
  );
  return page;
}
export async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    data.error
      ? entry.reject(new Error(data.error.message))
      : entry.resolve(data.result);
  });
  async function command(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  }
  async function until(expression, timeout = 25000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = await evaluate(expression).catch(() => null);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${expression}`);
  }
  async function click(selector) {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).click(); true`,
    );
  }
  async function navigate(url) {
    await command("Page.navigate", { url });
    await until(
      `document.readyState==='complete' && location.href===${JSON.stringify(url)}`,
    );
  }
  async function screenshot(path, width = 420, height = 600) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const shot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(shot.data, "base64"));
  }
  return {
    id: target.id,
    url: target.url,
    command,
    evaluate,
    until,
    click,
    navigate,
    screenshot,
    activate: () => fetch(`${debugBase}/json/activate/${target.id}`),
    close: async () => {
      socket.close();
      await fetch(`${debugBase}/json/close/${target.id}`);
    },
    disconnect: () => socket.close(),
  };
}
