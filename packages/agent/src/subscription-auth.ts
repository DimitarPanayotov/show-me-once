import spawn from "cross-spawn";

export function subscriptionEnvironment() {
  const env = { ...process.env };
  for (const name of [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_ACCESS_TOKEN",
  ])
    delete env[name];
  return env;
}

export async function signedInWithChatGPT(executable: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(executable, ["login", "status"], {
      env: subscriptionEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 8000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 16000) {
        child.kill();
        resolve(false);
      }
    };
    child.stdout!.on("data", collect);
    child.stderr!.on("data", collect);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && /ChatGPT/i.test(output));
    });
  });
}
