import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import crossSpawn from "cross-spawn";
import { readNative, writeNative } from "./native-protocol.ts";
import { installNative, NATIVE_HOST } from "./native-install.ts";
import { createSkillMarkdown } from "@show-me-once/shared";

test("native framing supports fragmented UTF-8 and rejects oversized or concatenated requests", async () => {
  const output = new PassThrough(),
    chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(chunk));
  writeNative(output, { request: "тест" });
  const packet = Buffer.concat(chunks),
    input = new PassThrough();
  const received = readNative(input);
  input.write(packet.subarray(0, 2));
  input.write(packet.subarray(2, 7));
  input.write(packet.subarray(7));
  assert.deepEqual(await received, { request: "тест" });
  input.destroy();
  const oversized = new PassThrough();
  const rejected = readNative(oversized);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(200001);
  oversized.end(header);
  await assert.rejects(rejected, /size/);
  const extra = new PassThrough();
  const duplicate = readNative(extra);
  extra.end(Buffer.concat([packet, packet]));
  await assert.rejects(duplicate, /one native/);
});

test("native installation pins one extension and registers only its per-user Chrome host", async () => {
  const home = await mkdtemp(join(tmpdir(), "smo-native-install-"));
  try {
    const source = join(home, "source.mjs");
    await writeFile(source, "// bundled host");
    const calls: string[] = [];
    const result = await installNative(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source,
      {
        home,
        platform: "win32",
        executable: "C:/Codex/codex.exe",
        node: "C:/Program Files/node.exe",
        register: async (file) => {
          calls.push(file);
        },
      },
    );
    const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
    assert.equal(manifest.name, NATIVE_HOST);
    assert.deepEqual(manifest.allowed_origins, [
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
    ]);
    assert.deepEqual(calls, [result.manifest]);
    assert.match(
      await readFile(result.launcher, "utf8"),
      /"C:\/Program Files\/node.exe"/,
    );
    await assert.rejects(
      installNative("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", source, { home }),
      /Another extension/,
    );
    assert.equal(JSON.stringify(manifest).includes("token"), false);
  } finally {
    assert(resolve(home).startsWith(resolve(tmpdir())));
    await rm(home, { recursive: true, force: true });
  }
});

test("real native host process authenticates its origin, checks sign-in and returns one guarded decision", async () => {
  const home = await mkdtemp(join(tmpdir(), "smo-native-process-"));
  try {
    const config = join(home, "settings.json"),
      preload = join(home, "fake-cli.mjs");
    await writeFile(
      config,
      JSON.stringify({
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        executable: process.execPath,
      }),
    );
    await writeFile(
      preload,
      `import {basename} from 'node:path';const command=basename(process.argv[1]||'');if(command==='login'){console.log(process.env.SMO_FAKE_API_MODE==='1'?'Logged in using an API key':'Logged in using ChatGPT');process.exit(0);}if(command==='exec'){process.stdin.resume();await new Promise(()=>process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({action:'fill',targetId:'c1',parameter:'text_1',value:'Foundation'})}})+String.fromCharCode(10),()=>process.exit(0));}));}`,
    );
    const markdown = createSkillMarkdown(
      {
        id: "fixture",
        active: false,
        tabId: 1,
        startedAt: "2026-01-01",
        actions: [
          {
            id: "1",
            at: "2026-01-01",
            kind: "input",
            inputKind: "text",
            url: "https://example.com",
            selector: "input:nth-of-type(1)",
          },
        ],
      },
      "search-books",
      "Search for a book.",
    );
    const call = (
      message: object,
      origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
      apiMode = false,
    ) =>
      new Promise<Record<string, unknown>>((resolveResult, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--experimental-strip-types",
            resolve(process.env.SMO_NATIVE_HOST_PATH ?? "src/native-host.ts"),
            origin,
          ],
          {
            env: {
              ...process.env,
              SMO_NATIVE_SETTINGS: config,
              SMO_FAKE_API_MODE: apiMode ? "1" : "0",
              NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
            },
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error("Native test timed out"));
        }, 10000);
        child.on("error", reject);
        child.stderr.resume();
        void readNative(child.stdout).then(
          (value) => {
            clearTimeout(timeout);
            child.stdin.end();
            resolveResult(value as Record<string, unknown>);
          },
          (error) => {
            clearTimeout(timeout);
            child.kill();
            reject(error);
          },
        );
        writeNative(child.stdin, message);
      });
    assert.deepEqual(await call({ type: "status" }), { ready: true });
    assert.deepEqual(
      await call(
        { type: "status" },
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
        true,
      ),
      { ready: false },
    );
    const result = await call({
      type: "decide",
      input: {
        markdown,
        request: "Search Foundation",
        stepIndex: 0,
        observation: {
          id: "fresh",
          url: "https://example.com",
          controls: [
            {
              id: "c1",
              role: "input",
              label: "Title",
              selector: "input:nth-of-type(1)",
              inputKind: "text",
            },
          ],
        },
        supplied: [],
      },
    });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.decision, {
      action: "fill",
      targetId: "c1",
      parameter: "text_1",
      value: "Foundation",
    });
    assert.match(
      String(
        (
          await call(
            { type: "status" },
            "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/",
          )
        ).error,
      ),
      /not authorized/,
    );
    assert.match(String((await call({ type: "shell" })).error), /Unsupported/);
  } finally {
    assert(resolve(home).startsWith(resolve(tmpdir())));
    await rm(home, { recursive: true, force: true });
  }
});

test(
  "Windows launcher forwards binary native messages through paths containing spaces and ampersands",
  { skip: process.platform !== "win32" },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "smo native & launcher "));
    try {
      const source = join(home, "source.mjs");
      await writeFile(
        source,
        `process.stdin.once('data',()=>{const data=Buffer.from(JSON.stringify({ready:true})),header=Buffer.alloc(4);header.writeUInt32LE(data.length);process.stdout.write(Buffer.concat([header,data]));});process.stdin.on('end',()=>process.exit(0));`,
      );
      const result = await installNative(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        source,
        { home, executable: process.execPath, register: async () => {} },
      );
      const child = crossSpawn(
        result.launcher,
        ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      const closed = once(child, "close");
      child.stderr!.resume();
      writeNative(child.stdin!, { type: "status" });
      assert.deepEqual(await readNative(child.stdout!), { ready: true });
      child.stdin!.end();
      await closed;
    } finally {
      assert(resolve(home).startsWith(resolve(tmpdir())));
      await rm(home, { recursive: true, force: true });
    }
  },
);
