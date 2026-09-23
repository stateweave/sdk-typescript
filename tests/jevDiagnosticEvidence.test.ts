import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

it("preserves the complete fixed diagnostic and its null quality result", () => {
 const root=new URL("../evaluations/jev-focus-v2/",import.meta.url);
 const summary=JSON.parse(readFileSync(new URL("summary.json",root),"utf8"));
 expect(summary.ledger).toHaveLength(12);
 for(const mode of ["deterministic","flat","hierarchical"]) expect(summary.arms[mode]).toMatchObject({attempts:12,completed:11,correct:11,fullPass:10,fallbacks:0});
 expect(summary.comparisons.every((c:{wins:number;losses:number;ties:number})=>c.wins===1&&c.losses===1&&c.ties===10)).toBe(true);
 expect(createHash("sha256").update(readFileSync(new URL("evidence/complete-diagnostic.tar.gz",root))).digest("hex")).toBe("c101f8f8e347746baa8d70282ed18ba1e86f013b3220cb12028150db3b3d6e45");
});
