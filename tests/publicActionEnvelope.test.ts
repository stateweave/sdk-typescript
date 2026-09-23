import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent } from "../src/agent/agent.js";
import { parseToolCall } from "../src/agent/toolProtocol.js";
import type { Model } from "../src/llm/model.js";

function model(outputs: string[]): Model {
 let index=0;
 return { complete: async()=>({text:outputs[Math.min(index++,outputs.length-1)]!}), async *stream(){yield {type:"token",token:outputs[Math.min(index++,outputs.length-1)]!};} };
}
describe("public action envelope normalization",()=>{
 it.each(["TOOL_CALL:","TOOL_CALL :","TOOL_CALL"])("accepts an anchored unambiguous %s without changing frozen parsing",async envelope=>{
  let reads=0;
  const agent=new Agent({model:model([`${envelope} {"name":"read_file","args":{"file_path":"probe.txt"}}`,'FINAL: The answer is GREEN; probe marker PROBE-ONE.']),tools:[{name:"read_file",description:"Read file",schema:z.object({file_path:z.string()}),execute:async()=>{reads++;return {content:"PROBE-ONE"};}}]});
  const result=await agent.run("Read probe.txt and report the marker.");
  expect(reads).toBe(1);expect(result.metadata.toolCalls).toBe(1);expect(result.finalAnswer).toContain("PROBE-ONE");
  expect(parseToolCall('TOOL_CALL: {"name":"read_file","args":{}}')).toBeUndefined();
 });
 it("does not turn quoted or embedded action-looking prose into execution",async()=>{
  const agent=new Agent({model:model(['Example TOOL_CALL: {"name":"read_file","args":{}}']),tools:[],maxIterations:3});
  await expect(agent.run("Read the file.")).rejects.toThrow("invalid action");
 });
});
