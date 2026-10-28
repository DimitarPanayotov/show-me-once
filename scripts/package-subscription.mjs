import { writeFile, copyFile } from "node:fs/promises";
await writeFile(
  "dist/subscription-helper/Install subscription helper.cmd",
  '@echo off\r\nwhere node >nul 2>&1\r\nif errorlevel 1 (\r\n echo Install Node.js 24, then reopen setup.\r\n pause\r\n exit /b 1\r\n)\r\nnode "%~dp0setup.mjs"\r\npause\r\n',
);
await copyFile("docs/agent.md", "dist/subscription-helper/SETUP.md");
