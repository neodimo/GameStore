import { existsSync, readFileSync } from "node:fs";

const required = [
  "ios/App/App.xcodeproj/project.pbxproj",
  "ios/App/App/Info.plist",
  "ios/App/App/public/index.html",
  "ios/App/CapApp-SPM/Package.swift",
];

for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing iOS foundation file: ${file}`);
}

const project = readFileSync(required[0], "utf8");
if (!project.includes("PRODUCT_BUNDLE_IDENTIFIER = com.neodimo.gamestore")) {
  throw new Error("The iOS bundle identifier does not match GameStore");
}

const plist = readFileSync(required[1], "utf8");
if (!plist.includes("GameStore needs local network access to find and transfer games to your MiSTer or SuperStation.")) {
  throw new Error("The local-network privacy description is missing");
}

console.log("iOS foundation is synced and structurally valid.");
