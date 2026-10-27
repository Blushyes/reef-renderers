import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const architecture = process.argv[2] ?? process.arch;

if (process.platform === "darwin") {
  mkdirSync(".native-build", { recursive: true });
  execFileSync("xcrun", ["swiftc", "-O", "-module-cache-path", ".native-build/module-cache", "-target", `${architecture === "arm64" ? "arm64" : "x86_64"}-apple-macos15.0`, "-parse-as-library", "native/translate/main.swift",
    "-o", ".native-build/dialogue-translate"], { stdio: "inherit" });
}
