const http = require("node:http");
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4178");
  const result = url.pathname === "/results";
  const value = (url.searchParams.get("q") || "").replace(/[<>&"']/g, "");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`<!doctype html><html><head><title>Browser test fixture</title><style>body{font:17px system-ui;max-width:700px;margin:40px auto}input,button,a{font:inherit;margin:10px;padding:12px}button{cursor:pointer}</style></head><body>
    <h1>${result ? "Search results" : "Browser test fixture"}</h1>
    ${
      result
        ? `<p id="result-query">${value}</p><a href="/">Back to search</a>`
        : `
    <form action="/results"><label>Search<input id="search" type="search" name="q"></label><button id="search-submit" type="submit">Search</button></form>
    <label>Password<input id="password" type="password"></label>
    <button id="delete-demo" type="button">Delete demo item</button><p id="action-status">No action executed.</p>
    <script>document.querySelector('#delete-demo').onclick=()=>{document.querySelector('#action-status').textContent='Demo delete executed.'}</script>`
    }
    </body></html>`);
});
server.listen(4178, "127.0.0.1", () =>
  console.log("Test fixture ready on http://127.0.0.1:4178"),
);
