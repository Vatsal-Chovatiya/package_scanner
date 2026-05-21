async function checksinglePackage() {
    const url = "https://api.osv.dev/v1/query";

    // Allow package, version and ecosystem to be passed as CLI arguments
    const args = process.argv.slice(2);
    const name = args[0] || "lodash";
    const version = args[1] || "4.17.15";
    const ecosystem = args[2] || "npm";

    const payload = {
        version,
        package: {
            name,
            ecosystem
        },
    };

    console.log(`Querying OSV for ${payload.package.name}@${payload.version} in ecosystem "${payload.package.ecosystem}"...`);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            console.error(`HTTP error! status: ${response.status}`);
            const text = await response.text();
            console.error(`Response body: ${text}`);
            return;
        }

        interface OSVVulnerability {
            id: string;
            summary?: string;
            details?: string;
            modified?: string;
            published?: string;
            aliases?: string[];
        }

        interface OSVResponse {
            vulns?: OSVVulnerability[];
        }

        const data = await response.json() as OSVResponse;

        if (data && data.vulns && data.vulns.length > 0) {
            console.log(`\n Found ${data.vulns.length} vulnerabilities for ${name}@${version}:`);
            console.log("=".repeat(80));
            data.vulns.forEach((vuln, index) => {
                const title = vuln.summary || vuln.details?.split("\n")[0] || "No summary available";
                console.log(`${index + 1}. [${vuln.id}] ${title}`);
                if (vuln.aliases && vuln.aliases.length > 0) {
                    console.log(`   Aliases: ${vuln.aliases.join(", ")}`);
                }
                console.log(`   Published: ${vuln.published || "N/A"} | Modified: ${vuln.modified || "N/A"}`);
                console.log("-".repeat(80));
            });
        } else {
            console.log(`\n No vulnerabilities found for ${name}@${version}.`);
            console.log("OSV Response:", JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error("Error fetching package info from OSV:", error);
    }
}

checksinglePackage().catch(error => {
    console.error("Unhandled error in checksinglePackage:", error);
});