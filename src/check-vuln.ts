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

// ─── Internal ────────────────────────────────────────────────────────────────

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

interface OSVQueryResponse {
    vulns?: OSVVulnerability[];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Query the OSV database for known vulnerabilities affecting a specific
 * package at a specific version.
 *
 * Returns a result object — never prints anything.
 * Throws on network / HTTP errors so the caller can decide on retry or
 * graceful degradation.
 */
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
