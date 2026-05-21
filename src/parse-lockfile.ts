import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PackageEntry {
    name: string;
    version: string;
}

export interface ParseResult {
    packages: PackageEntry[];
    lockfileType: "bun.lock" | "package-lock.json";
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Bun.lock uses trailing commas which are invalid JSON.
 * Strip them so JSON.parse succeeds.
 */
function stripTrailingCommas(jsonString: string): string {
    let insideString = false;
    let result = "";
    for (let i = 0; i < jsonString.length; i++) {
        const char = jsonString[i];

        // Handle quotes, avoiding escaped quotes
        if (char === '"' && (i === 0 || jsonString[i - 1] !== '\\')) {
            insideString = !insideString;
        }

        if (!insideString && char === ',') {
            // Look ahead to check if the next non-whitespace character is a closing brace/bracket
            let j = i + 1;
            while (j < jsonString.length && /\s/.test(jsonString[j]!)) {
                j++;
            }
            if (j < jsonString.length && (jsonString[j] === '}' || jsonString[j] === ']')) {
                // Found a trailing comma — skip it
                continue;
            }
        }
        result += char;
    }
    return result;
}

function parseBunLockPackages(packages: Record<string, unknown>): PackageEntry[] {
    const entries: PackageEntry[] = [];

    for (const [pkgName, pkgData] of Object.entries(packages)) {
        // Skip the root workspace entry (empty string key)
        if (pkgName === "") continue;

        if (!Array.isArray(pkgData) || pkgData.length === 0) continue;

        const specifier = pkgData[0];
        if (typeof specifier !== "string") continue;

        // Scoped packages like @types/bun@1.3.14 — version is after the *last* @
        const lastAtIndex = specifier.lastIndexOf("@");
        if (lastAtIndex > 0) {
            entries.push({
                name: pkgName,
                version: specifier.slice(lastAtIndex + 1),
            });
        } else {
            // Fallback: treat the whole specifier as the version
            entries.push({ name: pkgName, version: specifier });
        }
    }

    return entries;
}

function parseNpmLockPackages(packages: Record<string, unknown>): PackageEntry[] {
    const entries: PackageEntry[] = [];

    for (const [pkgPath, pkgData] of Object.entries(packages)) {
        // Skip root entry
        if (pkgPath === "") continue;

        // Path is like "node_modules/zod" or "node_modules/@types/bun"
        const cleanName = pkgPath.replace(/^node_modules\//, "");

        if (pkgData && typeof pkgData === "object" && "version" in pkgData) {
            const { version } = pkgData as { version?: unknown };
            if (typeof version === "string") {
                entries.push({ name: cleanName, version });
            }
        }
    }

    return entries;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reads the lockfile in `projectDir` (bun.lock or package-lock.json),
 * parses it, and returns a flat list of {name, version} for every
 * resolved dependency.
 *
 * Throws on any error — callers decide how to handle failures.
 */
export async function parseLockfile(projectDir: string): Promise<ParseResult> {
    const bunLockPath = join(projectDir, "bun.lock");
    const npmLockPath = join(projectDir, "package-lock.json");

    let lockfilePath: string;
    let lockfileType: ParseResult["lockfileType"];

    // Prefer bun.lock, fall back to package-lock.json
    if (await Bun.file(bunLockPath).exists()) {
        lockfilePath = bunLockPath;
        lockfileType = "bun.lock";
    } else if (await Bun.file(npmLockPath).exists()) {
        lockfilePath = npmLockPath;
        lockfileType = "package-lock.json";
    } else {
        throw new Error(
            `No lockfile found in ${projectDir}. Expected bun.lock or package-lock.json.`
        );
    }

    const lockfileText = await Bun.file(lockfilePath).text();
    const cleanedText = stripTrailingCommas(lockfileText);

    let lockfile: Record<string, unknown>;
    try {
        lockfile = JSON.parse(cleanedText);
    } catch (err) {
        throw new Error(
            `Failed to parse JSON in ${lockfilePath}: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    const packages = lockfile.packages;
    if (!packages || typeof packages !== "object") {
        throw new Error(
            `Invalid lockfile format: "packages" field missing or not an object in ${lockfilePath}.`
        );
    }

    const parsed =
        lockfileType === "bun.lock"
            ? parseBunLockPackages(packages as Record<string, unknown>)
            : parseNpmLockPackages(packages as Record<string, unknown>);

    return { packages: parsed, lockfileType };
}
