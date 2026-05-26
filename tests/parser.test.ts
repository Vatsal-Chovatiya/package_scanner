import { test, expect } from "bun:test";
import { join } from "path";
import { parseLockfile } from "../core";

test("parseLockfile correctly parses nested and aliased dependencies", async () => {
    const fixtureDir = join(__dirname, "fixtures", "mock-nested-project");
    const result = await parseLockfile(fixtureDir);

    // Should find the 3 dependencies (excluding the root package itself)
    expect(result.packages).toHaveLength(3);

    // Verify 'foo'
    const foo = result.packages.find(p => p.name === "foo");
    expect(foo).toBeDefined();
    expect(foo?.version).toBe("1.0.0");

    // Verify nested dependency 'bar' is parsed with name 'bar', not 'foo/node_modules/bar'
    const bar = result.packages.find(p => p.name === "bar");
    expect(bar).toBeDefined();
    expect(bar?.version).toBe("1.1.0");

    // Verify aliased dependency 'real-pkg-name' is resolved by its name field
    const aliased = result.packages.find(p => p.name === "real-pkg-name");
    expect(aliased).toBeDefined();
    expect(aliased?.version).toBe("2.0.0");

    // Verify 'aliased-pkg' does not exist as a package name
    const rawAlias = result.packages.find(p => p.name === "aliased-pkg");
    expect(rawAlias).toBeUndefined();
});
