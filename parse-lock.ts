import { join } from "path";

/**
 * Strips trailing commas from a JSON string to make it standard JSON.
 * This is necessary as bun.lock might contain trailing commas which JSON.parse does not support.
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
                // Found a trailing comma, skip adding it to the result
                continue;
            }
        }
        result += char;
    }
    return result;
}

async function parseLockfile() {
    const packageLockPath = join(process.cwd(), "package-lock.json");
    const bunLockPath = join(process.cwd(), "bun.lock");

    let lockfilePath = packageLockPath;
    let isBunLock = false;

    // Determine which lockfile exists
    if (await Bun.file(packageLockPath).exists()) {
        lockfilePath = packageLockPath;
    } else if (await Bun.file(bunLockPath).exists()) {
        lockfilePath = bunLockPath;
        isBunLock = true;
    } else {
        console.error("Neither package-lock.json nor bun.lock found in the current directory.");
        process.exit(1);
    }

    let lockfileText: string;
    try {
        lockfileText = await Bun.file(lockfilePath).text();
    } catch (err) {
        console.error(`Error reading lockfile at ${lockfilePath}:`, err);
        process.exit(1);
    }

    // Strip trailing commas before parsing
    const cleanedText = stripTrailingCommas(lockfileText);

    let lockfile: any;
    try {
        lockfile = JSON.parse(cleanedText);
    } catch (err) {
        console.error(`Error parsing JSON content of ${lockfilePath}:`, err);
        process.exit(1);
    }

    const packages = lockfile.packages;
    if (!packages || typeof packages !== "object") {
        console.error(`Invalid lockfile format: "packages" object is missing or invalid in ${lockfilePath}.`);
        process.exit(1);
    }

    console.log(`Parsed dependencies and resolved versions from ${isBunLock ? "bun.lock" : "package-lock.json"}:\n`);

    if (isBunLock) {
        // Bun.lock format: packages is an object where key is package name, 
        // and value is an array where the first element is "name@version"
        for (const [pkgName, pkgData] of Object.entries(packages)) {
            if (pkgName === "") continue;

            if (Array.isArray(pkgData) && pkgData.length > 0) {
                const specifier = pkgData[0];
                if (typeof specifier === "string") {
                    const lastAtIndex = specifier.lastIndexOf("@");
                    // Package names can be scoped (e.g. @types/bun@1.3.14), 
                    // so the version separator is the last '@' symbol
                    if (lastAtIndex > 0) {
                        const version = specifier.slice(lastAtIndex + 1);
                        console.log(`${pkgName} v${version}`);
                    } else {
                        console.log(`${pkgName} v${specifier}`);
                    }
                }
            }
        }
    } else {
        // Package-lock.json format: packages is an object where key is the folder path
        // (e.g. "node_modules/zod") and value is an object containing "version"
        for (const [pkgPath, pkgData] of Object.entries(packages)) {
            if (pkgPath === "") continue;

            const cleanName = pkgPath.replace(/^node_modules\//, "");

            if (pkgData && typeof pkgData === "object" && "version" in pkgData) {
                const pkgDataObj = pkgData as { version?: unknown };
                if (typeof pkgDataObj.version === "string") {
                    console.log(`${cleanName} v${pkgDataObj.version}`);
                }
            }
        }
    }
}

parseLockfile();