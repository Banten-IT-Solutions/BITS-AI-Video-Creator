#!/usr/bin/env node
/**
 * Align every version-bearing file with the release tag before packaging.
 *
 * Usage: node scripts/set-release-version.mjs 1.2.3
 *
 * The release workflow checks out the exact tag first, then runs this script
 * in each build job. Keeping the version mutation here (instead of committing
 * it back to the tag) keeps the tag immutable while ensuring binaries,
 * installers, the updater manifest, and the About page all report the same
 * version.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const raw = process.argv[2] ?? "";
const version = raw.replace(/^v/, "");

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid release version: "${raw}". Expected MAJOR.MINOR.PATCH without a 'v' prefix.`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// package.json + package-lock.json (root package version only).
const pkg = readJson("package.json");
pkg.version = version;
writeJson("package.json", pkg);

const lock = readJson("package-lock.json");
lock.version = version;
if (lock.packages && lock.packages[""]) {
  lock.packages[""].version = version;
}
writeJson("package-lock.json", lock);

// Cargo workspace version.
const cargoPath = "Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8");
const cargoPattern = /(\[workspace\.package\][\s\S]*?^version = ")[^"]+(")/m;
if (!cargoPattern.test(cargo)) {
  console.error(`Could not find [workspace.package] version in ${cargoPath}`);
  process.exit(1);
}
const cargoNext = cargo.replace(cargoPattern, `$1${version}$2`);
writeFileSync(cargoPath, cargoNext);

// Cargo.lock workspace package entries (Cargo would update these on build,
// but keeping them in sync avoids a dirty lockfile in release logs).
const lockPath = "Cargo.lock";
if (existsSync(lockPath)) {
  let cargoLock = readFileSync(lockPath, "utf8");
  for (const name of ["bits-ai-video-creator", "bits-ai-video-creator-core"]) {
    const pattern = new RegExp(
      `(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")[^"]+(")`,
    );
    cargoLock = cargoLock.replace(pattern, `$1${version}$2`);
  }
  writeFileSync(lockPath, cargoLock);
}

// Tauri app version (used by the bundler, updater, and About page).
const tauriPath = "src-tauri/tauri.conf.json";
const tauri = readJson(tauriPath);
tauri.version = version;
writeJson(tauriPath, tauri);

// Android build metadata. Tauri regenerates this file, but writing it here
// makes the intent explicit and keeps local `tauri android build` runs stable.
const androidPropsPath = "src-tauri/gen/android/app/tauri.properties";
if (existsSync(androidPropsPath)) {
  const numeric = version.split("-")[0].split(".").map((part) => Number(part));
  if (numeric.length === 3 && numeric.every(Number.isInteger)) {
    const versionCode = numeric[0] * 1_000_000 + numeric[1] * 1_000 + numeric[2];
    const props = readFileSync(androidPropsPath, "utf8")
      .replace(/^tauri\.android\.versionName=.*$/m, `tauri.android.versionName=${version}`)
      .replace(/^tauri\.android\.versionCode=.*$/m, `tauri.android.versionCode=${versionCode}`);
    writeFileSync(androidPropsPath, props);
  }
}

console.log(`Release version set to ${version} in package.json, Cargo.toml, Cargo.lock, tauri.conf.json.`);
