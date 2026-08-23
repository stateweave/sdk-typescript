import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);

describe("focused comparison lab", () => {
  it("keeps one clear objective and only primary comparison controls visible", async () => {
    const html = await readFile(new URL("web/index.html", root), "utf8");
    expect(html).toContain("Can graph memory outlast appended messages without context bloat?");
    expect(html).toContain('id="stateweave-context-label"');
    expect(html).toContain('id="traditional-context-label"');
    expect(html).toContain('id="session-browser"');
    expect(html).toContain('id="mobile-chat-pane"');
    expect(html).toContain('id="mobile-memory-pane"');
    expect(html).toContain('id="token-usage-view-tab"');
    expect(html).not.toContain("Parallel agent comparison");
    expect(html).not.toContain("Latest StateWeave loop: causal graph");

    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("binds sessions, arm context, mobile panes, and graph evidence without page overflow defaults", async () => {
    const [main, css] = await Promise.all([
      readFile(new URL("web/src/main.ts", root), "utf8"),
      readFile(new URL("web/src/styles.css", root), "utf8")
    ]);
    expect(main).toContain('function setMobilePane(pane: "chat" | "memory")');
    expect(main).toContain("function renderArmContextLabels()");
    expect(main).toContain("currentSessionMeta.textContent");
    expect(main).toContain('memoryViewTitle.textContent = stateSelected ? "Graph memory" : "Transcript memory"');
    expect(css).toContain("#state-page.memory-pane-active .chat-card");
    expect(css).toContain("#state-page:not(.memory-pane-active) .graph-workspace");
    expect(css).toContain("scroll-behavior: auto");
  });
});
