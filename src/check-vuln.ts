// ─── Types ───────────────────────────────────────────────────────────────────

export interface OSVVulnerability {
    id: string;
    summary?: string;
    details?: string;
    modified?: string;
    published?: string;
    aliases?: string[];
}

export interface VulnCheckResult {
    name: string;
    version: string;
    vulns: OSVVulnerability[];
}

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

interface OSVQueryResponse {
    vulns?: OSVVulnerability[];
}

export async function checkVulnerabilities(
    name: string,
    version: string,
    ecosystem: string = "npm",
): Promise<VulnCheckResult> {
    const payload = {
        version,
        package: { name, ecosystem },
    };

    const response = await fetch(OSV_QUERY_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `OSV API returned HTTP ${response.status} for ${name}@${version}: ${body}`
        );
    }

    const data = (await response.json()) as OSVQueryResponse;

    return {
        name,
        version,
        vulns: data.vulns ?? [],
    };
}
