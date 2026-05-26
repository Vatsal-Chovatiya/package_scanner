import { join, relative } from "path";
import { readdir } from "fs/promises";

export interface PackageEntry {
    name: string;
    version: string;
    lockfiles?: string[];
}

export interface LockfileInfo {
    path: string;
    type: "bun.lock" | "package-lock.json";
    packageCount: number;
}

export interface ParseResult {
    packages: PackageEntry[];
    lockfiles: LockfileInfo[];
}

function stripTrailingCommas(jsonString: string): string {
    let insideString = false;
    let result = "";
    for (let i = 0; i < jsonString.length; i++) {
        const char = jsonString[i];
        if (char === '"' && (i === 0 || jsonString[i - 1] !== '\\')) {
            insideString = !insideString;
        }

        if (!insideString && char === ',') {
            let j = i + 1;
            while (j < jsonString.length && /\s/.test(jsonString[j]!)) {
                j++;
            }
            if (j < jsonString.length && (jsonString[j] === '}' || jsonString[j] === ']')) {
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
        if (pkgName === "") continue;

        if (!Array.isArray(pkgData) || pkgData.length === 0) continue;

        const specifier = pkgData[0];
        if (typeof specifier !== "string") continue;

        const lastAtIndex = specifier.lastIndexOf("@");
        if (lastAtIndex > 0) {
            entries.push({
                name: pkgName,
                version: specifier.slice(lastAtIndex + 1),
            });
        } else {
            entries.push({ name: pkgName, version: specifier });
        }
    }

    return entries;
}

function parseNpmLockPackages(packages: Record<string, unknown>): PackageEntry[] {
    const entries: PackageEntry[] = [];

    for (const [pkgPath, pkgData] of Object.entries(packages)) {
        if (pkgPath === "") continue;

        let cleanName = pkgPath;
        if (pkgData && typeof pkgData === "object") {
            const dataObj = pkgData as Record<string, unknown>;
            if (typeof dataObj.name === "string") {
                cleanName = dataObj.name;
            } else {
                const lastNodeModulesIndex = pkgPath.lastIndexOf("node_modules/");
                if (lastNodeModulesIndex !== -1) {
                    cleanName = pkgPath.slice(lastNodeModulesIndex + "node_modules/".length);
                } else {
                    cleanName = pkgPath.replace(/^node_modules\//, "");
                }
            }
        }

        if (pkgData && typeof pkgData === "object" && "version" in pkgData) {
            const { version } = pkgData as { version?: unknown };
            if (typeof version === "string") {
                entries.push({ name: cleanName, version });
            }
        }
    }

    return entries;
}

async function findLockfiles( dir: string,  baseDir: string = dir): Promise<{ absolutePath: string; relativePath: string; type: "bun.lock" | "package-lock.json" }[]> {
    const results: { absolutePath: string; relativePath: string; type: "bun.lock" | "package-lock.json" }[] = [];
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
        return [];
    }

    const bunLockExists = entries.some(e => e.isFile() && e.name === "bun.lock");
    const npmLockExists = entries.some(e => e.isFile() && e.name === "package-lock.json");

    if (bunLockExists) {
        const abs = join(dir, "bun.lock");
        results.push({
            absolutePath: abs,
            relativePath: relative(baseDir, abs),
            type: "bun.lock"
        });
    } else if (npmLockExists) {
        const abs = join(dir, "package-lock.json");
        results.push({
            absolutePath: abs,
            relativePath: relative(baseDir, abs),
            type: "package-lock.json"
        });
    }

    for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            const name = entry.name;
            if (name === "node_modules" || name.startsWith(".")) {
                continue;
            }
            const subresults = await findLockfiles(join(dir, name), baseDir);
            results.push(...subresults);
        }
    }

    return results;
}


export async function parseLockfile(projectDir: string): Promise<ParseResult> {
    const lockfiles = await findLockfiles(projectDir);
    if (lockfiles.length === 0) {
        throw new Error(
            `No lockfile found in ${projectDir} or its subdirectories. Expected bun.lock or package-lock.json.`
        );
    }

    const allPackagesMap = new Map<string, { name: string; version: string; lockfiles: string[] }>();
    const lockfileInfos: LockfileInfo[] = [];

    for (const lf of lockfiles) {
        const lockfileText = await Bun.file(lf.absolutePath).text();
        const cleanedText = stripTrailingCommas(lockfileText);

        let lockfile: Record<string, unknown>;
        try {
            lockfile = JSON.parse(cleanedText);
        } catch (err) {
            throw new Error(
                `Failed to parse JSON in ${lf.relativePath}: ${err instanceof Error ? err.message : String(err)}`
            );
        }

        const packages = lockfile.packages;
        if (!packages || typeof packages !== "object") {
            throw new Error(
                `Invalid lockfile format: "packages" field missing or not an object in ${lf.relativePath}.`
            );
        }

        const parsedEntries =
            lf.type === "bun.lock"
                ? parseBunLockPackages(packages as Record<string, unknown>)
                : parseNpmLockPackages(packages as Record<string, unknown>);

        lockfileInfos.push({
            path: lf.relativePath,
            type: lf.type,
            packageCount: parsedEntries.length,
        });

        for (const entry of parsedEntries) {
            const key = `${entry.name}@${entry.version}`;
            const existing = allPackagesMap.get(key);
            if (existing) {
                if (!existing.lockfiles.includes(lf.relativePath)) {
                    existing.lockfiles.push(lf.relativePath);
                }
            } else {
                allPackagesMap.set(key, {
                    name: entry.name,
                    version: entry.version,
                    lockfiles: [lf.relativePath]
                });
            }
        }
    }

    return {
        packages: Array.from(allPackagesMap.values()),
        lockfiles: lockfileInfos,
    };
}
