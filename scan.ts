import { parseLockfile } from "./src/parse-lockfile";
import { checkVulnerabilities, type VulnCheckResult } from "./src/check-vuln";


async function scan() {
    const projectDir = process.cwd();

    // ── Step 1: Parse the lockfile ───────────────────────────────────────────
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

    // ── Step 2: Check each package against OSV — sequentially ────────────────
    const vulnerable: VulnCheckResult[] = [];
    const errors: { name: string; version: string; error: string }[] = [];
    let scanned = 0;

    for (const pkg of packages) {
        scanned++;
        // Simple progress indicator without drowning clean packages in noise
        process.stdout.write(
            `  Checking ${pkg.name}@${pkg.version} (${scanned}/${packages.length})...\r`
        );

        try {
            const result = await checkVulnerabilities(pkg.name, pkg.version);

            if (result.vulns.length > 0) {
                vulnerable.push(result);
            }
        } catch (err) {
            errors.push({
                name: pkg.name,
                version: pkg.version,
                error: err instanceof Error ? err.message : String(err),
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

    // ── Detail: vulnerable packages ──────────────────────────────────────────

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
}

scan().catch((err) => {
    console.error("Unhandled error during scan:", err);
    process.exit(1);
});
