// Simple static server with HTTPS self-signed support (optional) for localhost.
// Usage:
//   1) npm install
//   2) npm start   (serves http://localhost:5500)
// For HTTPS (optional): node server.js --https  (auto-generates self-signed cert in ./.selfsigned)
const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();

const PORT = process.env.PORT || 5500;
const useHttps = process.argv.includes("--https");

function ensureSelfSignedCert() {
  const dir = path.join(__dirname, ".selfsigned");
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return { keyPath, certPath };
  fs.mkdirSync(dir, { recursive: true });
  // Generate with openssl if available
  const { spawnSync } = require("child_process");
  const subj = "/C=US/ST=State/L=City/O=LocalDev/OU=QR/CN=localhost";
  const res = spawnSync("openssl", ["req","-x509","-nodes","-days","365","-newkey","rsa:2048","-keyout",keyPath,"-out",certPath,"-subj",subj], { stdio: "inherit" });
  if (res.error) console.log("OpenSSL not found; HTTPS will not start.");
  return { keyPath, certPath };
}

app.use((req,res,next)=>{
  // Long cache for cdn-less assets if needed; here we just disable caching for simplicity
  res.setHeader("Cache-Control","no-store");
  next();
});

app.use(express.static(__dirname));

app.get("*", (req,res) => res.sendFile(path.join(__dirname,"index.html")));

if (useHttps) {
  try {
    const { keyPath, certPath } = ensureSelfSignedCert();
    const https = require("https");
    const options = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    https.createServer(options, app).listen(PORT, () => {
      console.log(`HTTPS server running at https://localhost:${PORT}`);
      console.log("If the browser warns about self-signed certificate, proceed for local testing.");
    });
  } catch (e) {
    console.error("HTTPS start failed:", e);
    console.log("Falling back to HTTP.");
    app.listen(PORT, () => console.log(`HTTP server running at http://localhost:${PORT}`));
  }
} else {
  app.listen(PORT, () => console.log(`HTTP server running at http://localhost:${PORT}`));
}
