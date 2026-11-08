import { inspectPrimitiveTask } from "./cli.js";

const result = await inspectPrimitiveTask("My name is Ada");
console.log("Offline primitive demo; mock output is a fixture, not a correctness result.");
console.log(JSON.stringify(result, null, 2));
