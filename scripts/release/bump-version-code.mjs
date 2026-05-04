#!/usr/bin/env node
/**
 * Sync android/app/build.gradle versionCode + versionName from package.json.
 *
 * Play Store requires a strictly monotonic integer versionCode. Encoding the
 * three SemVer parts as `major*1_000_000 + minor*1_000 + patch` gives us
 * collision-free codes up to v999.999.999 without needing to track build
 * numbers separately. Examples: 1.0.1 → 1_000_001, 1.2.3 → 1_002_003.
 *
 * Wired into the npm `prebuild` script so every `npm run build` keeps the
 * Gradle config in lockstep with package.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const pkgPath = resolve(repoRoot, 'package.json');
const gradlePath = resolve(repoRoot, 'android', 'app', 'build.gradle');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!m) {
  console.error(`bump-version-code: cannot parse version "${version}" from package.json`);
  process.exit(1);
}
const [, majorStr, minorStr, patchStr] = m;
const major = Number(majorStr);
const minor = Number(minorStr);
const patch = Number(patchStr);
if (minor > 999 || patch > 999) {
  console.error(`bump-version-code: minor/patch exceeds 999 — increment major instead.`);
  process.exit(1);
}
const versionCode = major * 1_000_000 + minor * 1_000 + patch;
const versionName = `${major}.${minor}.${patch}`;

let gradle;
try {
  gradle = readFileSync(gradlePath, 'utf8');
} catch (err) {
  if (err && err.code === 'ENOENT') {
    // Android platform not yet scaffolded (`npx cap add android` not run).
    // The web-only build path doesn't need Gradle; skip silently.
    console.log('bump-version-code: no android/app/build.gradle yet — skipping.');
    process.exit(0);
  }
  throw err;
}

const updated = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);

if (updated === gradle) {
  console.warn('bump-version-code: no versionCode/versionName lines matched in build.gradle.');
  process.exit(0);
}

writeFileSync(gradlePath, updated);
console.log(`bump-version-code: ${version} → versionCode ${versionCode}, versionName ${versionName}`);
