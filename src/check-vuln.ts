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

interface BatchQuery {
    package: {
        name: string;
        ecosystem: string;
    };
    version: string;
    page_token?: string;
}

interface OSVBatchResponseItem {
    vulns?: {
        id: string;
        modified: string;
    }[];
    next_page_token?: string;
}

interface OSVBatchResponse {
    results: OSVBatchResponseItem[];
}

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";
const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
const OSV_GET_VULN_URL = "https://api.osv.dev/v1/vulns/";

function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

async function pool<T, R>(
    limit: number,
    array: T[],
    iteratorFn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(array.length);
    let index = 0;

    async function worker() {
        while (index < array.length) {
            const currentIndex = index++;
            const item = array[currentIndex]!;
            results[currentIndex] = await iteratorFn(item);
        }
    }

    const workers = Array.from({ length: Math.min(limit, array.length) }, worker);
    await Promise.all(workers);
    return results;
}


export async function fetchVulnerabilityDetails(id: string): Promise<OSVVulnerability> {
    const url = `${OSV_GET_VULN_URL}${id}`;
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Accept": "application/json",
        },
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `OSV API returned HTTP ${response.status} for vulnerability ID ${id}: ${body}`
        );
    }

    return (await response.json()) as OSVVulnerability;
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

    interface OSVQueryResponse {
        vulns?: OSVVulnerability[];
    }

    const data = (await response.json()) as OSVQueryResponse;

    return {
        name,
        version,
        vulns: data.vulns ?? [],
    };
}

export async function checkVulnerabilitiesBatch(
    packages: { name: string; version: string; ecosystem?: string }[],
    concurrencyLimit: number = 20,
    batchSize: number = 1000,
): Promise<VulnCheckResult[]> {
    if (packages.length === 0) {
        return [];
    }

    // 1. Map input packages to initial batch query items
    const queries: BatchQuery[] = packages.map((pkg) => ({
        package: {
            name: pkg.name,
            ecosystem: pkg.ecosystem ?? "npm",
        },
        version: pkg.version,
    }));

    // Chunk queries to respect OSV's 1000 query limit per batch request
    const queryChunks = chunkArray(queries, batchSize);

    // Map of package key ("name@version") to its Set of vulnerability IDs
    const vulnIdsMap = new Map<string, Set<string>>();

    for (const chunk of queryChunks) {
        let activeQueries = [...chunk];

        // Loop handles pagination if any query returns a page token
        while (activeQueries.length > 0) {
            const payload = { queries: activeQueries };
            const response = await fetch(OSV_BATCH_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(`OSV API returned HTTP ${response.status} for batch query: ${body}`);
            }

            const data = (await response.json()) as OSVBatchResponse;
            if (!data.results || data.results.length !== activeQueries.length) {
                throw new Error("OSV batch API returned invalid results structure.");
            }

            const nextQueries: BatchQuery[] = [];

            for (let i = 0; i < activeQueries.length; i++) {
                const query = activeQueries[i]!;
                const result = data.results[i]!;
                const key = `${query.package.name}@${query.version}`;

                if (result.vulns && result.vulns.length > 0) {
                    if (!vulnIdsMap.has(key)) {
                        vulnIdsMap.set(key, new Set());
                    }
                    const set = vulnIdsMap.get(key)!;
                    for (const v of result.vulns) {
                        set.add(v.id);
                    }
                }

                if (result.next_page_token) {
                    nextQueries.push({
                        ...query,
                        page_token: result.next_page_token,
                    });
                }
            }

            activeQueries = nextQueries;
        }
    }

    // 2. Gather unique vulnerability IDs across all affected packages
    const allUniqueVulnIds = new Set<string>();
    for (const idsSet of vulnIdsMap.values()) {
        for (const id of idsSet) {
            allUniqueVulnIds.add(id);
        }
    }

    // 3. Concurrently fetch the full details for each unique vulnerability ID
    const idList = Array.from(allUniqueVulnIds);
    const vulnDetailsMap = new Map<string, OSVVulnerability>();

    if (idList.length > 0) {
        const detailsResults = await pool(concurrencyLimit, idList, fetchVulnerabilityDetails);
        for (const detail of detailsResults) {
            vulnDetailsMap.set(detail.id, detail);
        }
    }

    // 4. Construct final results matching input packages
    const results: VulnCheckResult[] = [];
    for (const pkg of packages) {
        const key = `${pkg.name}@${pkg.version}`;
        const idsSet = vulnIdsMap.get(key);
        const pkgVulns: OSVVulnerability[] = [];

        if (idsSet) {
            for (const id of idsSet) {
                const details = vulnDetailsMap.get(id);
                if (details) {
                    pkgVulns.push(details);
                } else {
                    // Fallback to minimal info if details fetch failed
                    pkgVulns.push({ id });
                }
            }
        }

        results.push({
            name: pkg.name,
            version: pkg.version,
            vulns: pkgVulns,
        });
    }

    return results;
}
