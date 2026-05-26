import {
    parseLockfile,
    checkVulnerabilitiesBatch,
    type VulnCheckResult,
} from "../core";

async function scan() {
    const projectDir = process.argv[2] || process.cwd();

    let parseResult;
    try {
        parseResult = await parseLockfile(projectDir);
    } catch (err) {
        console.error(
            `Failed to parse lockfile: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
    }

    const { packages, lockfiles } = parseResult;
    if (lockfiles.length === 1 && lockfiles[0]) {
        console.log(
            `Found ${packages.length} packages in ${lockfiles[0].path}\n`
        );
    } else {
        console.log(
            `Found ${packages.length} unique packages across ${lockfiles.length} lockfiles:`
        );
        for (const lf of lockfiles) {
            console.log(`  • ${lf.path} (${lf.packageCount} packages)`);
        }
        console.log();
    }

    const vulnerable: VulnCheckResult[] = [];
    const errors: { name: string; version: string; error: string }[] = [];
    let scanned = 0;

    process.stdout.write(`  Checking ${packages.length} packages against OSV API...\r`);

    try {
        const results = await checkVulnerabilitiesBatch(packages);
        scanned = packages.length;
        for (const res of results) {
            if (res.vulns.length > 0) {
                vulnerable.push(res);
            }
        }
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        for (const pkg of packages) {
            errors.push({
                name: pkg.name,
                version: pkg.version,
                error: errMsg,
            });
        }
    }
    process.stdout.write(" ".repeat(80) + "\r");
    console.log("═".repeat(70));
    console.log("  SCAN SUMMARY");
    console.log("═".repeat(70));
    console.log(`  Packages scanned : ${scanned}`);
    console.log(`  Vulnerabilities  : ${vulnerable.length > 0 ? `${vulnerable.length} package(s) affected` : "None found"}`);
    if (errors.length > 0) {
        console.log(`  Errors           : ${errors.length} package(s) failed to check`);
    }
    console.log("═".repeat(70));

    if (vulnerable.length > 0) {
        console.log("\nVULNERABLE PACKAGES:\n");

        for (const result of vulnerable) {
            const pkgInfo = packages.find((p) => p.name === result.name && p.version === result.version);
            const lockfilesStr = pkgInfo?.lockfiles ? ` (found in: ${pkgInfo.lockfiles.join(", ")})` : "";
            console.log(`  ┌─ ${result.name}@${result.version}${lockfilesStr}  (${result.vulns.length} advisory/ies)`);

            for (const vuln of result.vulns) {
                const title =
                    vuln.summary ||
                    vuln.details?.split("\n")[0] ||
                    "No summary available";

                console.log(`  │  [${vuln.id}] ${title}`);

                if (vuln.aliases && vuln.aliases.length > 0) {
                    console.log(`  │    Aliases: ${vuln.aliases.join(", ")}`);
                }

                console.log(
                    `  │    Published: ${vuln.published ?? "N/A"} | Modified: ${vuln.modified ?? "N/A"}`
                );
            }

            console.log("  └" + "─".repeat(68));
        }
    }

    if (errors.length > 0) {
        console.log("\nPACKAGES THAT FAILED TO CHECK:\n");
        for (const e of errors) {
            console.log(`  • ${e.name}@${e.version} — ${e.error}`);
        }
    }

    console.log();

    if (vulnerable.length > 0 || errors.length > 0) {
        process.exit(1);
    }
}

scan().catch((err) => {
    console.error("Unhandled error during scan:", err);
    process.exit(1);
});
