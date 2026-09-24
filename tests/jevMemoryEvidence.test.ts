import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {expect,it} from "vitest";

it("preserves the unsuccessful gate and fresh-case graph evidence without relabeling",()=>{
 const root=new URL("../evaluations/",import.meta.url);
 const load=(p:string)=>JSON.parse(readFileSync(new URL(p,root),"utf8"));
 const first=load("jev-memory-links-v1/summary.json"),fresh=load("jev-memory-links-v2/summary.json");
 expect(first.links.metrics.equivalent).toMatchObject({tp:1,fp:0,fn:11});
 expect(fresh.links.metrics.equivalent).toMatchObject({tp:15,fp:0,fn:1});
 expect(fresh.rows.filter((r:{arm:string})=>r.arm==="jev").map((r:{covered:number})=>r.covered)).toEqual([8,8,13]);
 expect(fresh.rows.every((r:{preserved:boolean;status:string;modelCalls:number})=>r.preserved&&r.status==="done"&&r.modelCalls===1)).toBe(true);
 for(const [file,sha]of [
  ["jev-memory-links-v1/evidence/strict-calibration.tar.gz","fd38f945e240209fd373a41051fcf125a6cc6b242f28c75618edc2cb9fc8adf6"],
  ["jev-memory-links-v2/evidence/fresh-validation.tar.gz","e05515d49a4c3203a39f1883ae369a017e5a33158f656c9eda863eb0be59b4b4"]
 ])expect(createHash("sha256").update(readFileSync(new URL(file!,root))).digest("hex")).toBe(sha);
});
