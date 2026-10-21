import { randomBytes, pbkdf2Sync } from "node:crypto";

if (!process.stdin.isTTY) {
  console.error("Run this command in an interactive terminal so the password stays hidden.");
  process.exit(1);
}

const terminal = process.stdin;
terminal.setRawMode(true);
terminal.resume();
terminal.setEncoding("utf8");

function readHidden(question) {
  return new Promise((resolve) => {
    let value = "";
    process.stdout.write(question);
    function onData(chunk) {
      for (const char of chunk) {
        if (char === "\u0003") process.exit(130);
        if (char === "\r" || char === "\n") {
          terminal.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    }
    terminal.on("data", onData);
  });
}

const password = await readHidden("Admin password (input hidden): ");
terminal.setRawMode(false);
if (password.length < 12) {
  console.error("Use a password with at least 12 characters.");
  process.exit(1);
}
const iterations = 100000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");
console.log(`ADMIN_PASSWORD_HASH=pbkdf2$${iterations}$${salt.toString("base64")}$${hash.toString("base64")}`);
console.log(`SESSION_SECRET=${randomBytes(32).toString("base64")}`);
