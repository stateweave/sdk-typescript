export const oneShotSdkBuildPrompt = `You are a senior JavaScript engineer working in a fresh project workspace. Complete the entire assignment autonomously in this run. Inspect the workspace first, create every required source file, run the available checks, fix problems you find, and leave a working project behind. Do not stop at a plan or a partial scaffold.

## Objective

Build two things as one coherent project:

1. A reusable, dependency-light vanilla JavaScript SDK that wraps the Desmos Graphing Calculator API and provides higher-level primitives for interactive mathematical and economic models.
2. A complete two-chart Stackelberg duopoly application implemented through the public API of the SDK you created.

The application must demonstrate that the SDK is genuinely reusable. Model-specific code may declare functions, transformations, controls, and visualizations through the SDK, but it must not manipulate a Desmos calculator directly. Direct Desmos API calls belong inside the SDK adapter only.

## Technical constraints

- Use vanilla JavaScript with ES modules, semantic HTML, and CSS. Do not use React, Vue, Svelte, or another application framework.
- Keep the SDK separated from the model implementation and presentation styles.
- Expose a documented public API. Do not build one monolithic script specialized to this model.
- Use stable identifiers for graphs, inputs, expressions, controls, and derived values.
- Maintain a central expression registry so derived expressions can refer to earlier expressions by identifier rather than duplicating their formulas.
- Track dependencies and update affected derived expressions when an editable input changes.
- Support targeting one expression or control to one or more registered graphs.
- Use a browser-capable symbolic mathematics library such as Nerdamer when symbolic differentiation, solving, inversion, simplification, or substitution is required. Keep this integration behind an SDK service or adapter.
- Avoid eval and Function-based execution.
- Handle malformed formulas or unsolved symbolic operations without crashing the whole application. Show a useful inline error and preserve the last valid state when practical.
- Keep any Desmos API key or deployment-specific URL configurable. Do not commit a secret.

## Desmos API orientation

The Desmos browser API exposes the following core pattern. You may use equivalent supported calls where appropriate:

~~~js
const calculator = Desmos.GraphingCalculator(element, options);
calculator.setMathBounds({ left, right, bottom, top });
calculator.updateSettings({
  expressions: false,
  keypad: false,
  settingsMenu: false,
  showGrid: true,
  showXAxis: true,
  showYAxis: true,
  xAxisLabel: "Q",
  yAxisLabel: "P"
});
calculator.setExpression({
  id: "demand",
  latex: "P(Q)=60-\\frac{Q}{2}",
  color: "#d9485f",
  hidden: false
});

const helper = calculator.HelperExpression({ latex: "Q_s" });
helper.observe("numericValue", () => {
  console.log(helper.numericValue);
});

calculator.observeEvent("change", () => {
  // Synchronize graph-driven changes when needed.
});
~~~

Encapsulate these calls. The model module should only call your SDK.

## Required SDK capabilities

Design clear names and signatures for the public API. At minimum, the SDK must support:

### Graph management

- Create and register multiple Desmos graph instances.
- Configure dimensions, math bounds, axes, labels, grid, keypad, expression panel, zoom controls, and other common settings.
- Address graphs by stable identifier and target operations to any subset of graphs.
- Resize cleanly on desktop and mobile.

### Expressions and dependency graph

- Register a raw LaTeX expression with display options such as color, visibility, line style, width, opacity, point style, point size, label, label orientation, and drag mode.
- Store the canonical expression value and its dependencies in a central registry.
- Add a derived expression whose formula is produced from registered parent expressions.
- Recompute derived expressions in dependency order after an upstream change.
- Detect missing dependencies and dependency cycles and report them clearly.
- Allow an expression to be hidden computational state while remaining available to downstream expressions.

### Symbolic transformations

Provide reusable operations sufficient for this application:

- Differentiate a registered function with respect to a selected argument.
- Invert a single-variable function.
- Compose arithmetic expressions from registered functions and explicit variables.
- Substitute one registered function or solved expression into another.
- Compute and solve a first-order condition for a maximum, with a second-order check when possible.
- Solve a scalar intersection such as marginal revenue equals marginal cost.
- Convert safely between LaTeX and the symbolic engine's expression format.

These operations must be general SDK features, not functions named after this particular market model.

### Interactive controls

- Editable mathematical function input rendered with a math-aware field and synchronized to every target graph.
- Numeric slider with min, max, step, default value, and a synchronized number field.
- Boolean switch that shows or hides a group of expressions.
- Draggable graph point synchronized bidirectionally with numeric controls.
- Graph label whose text can interpolate current numeric values.
- A simple separator and an instruction/help system for explanatory sections.

### Lifecycle and diagnostics

- Initialize in a predictable order even when the DOM or external scripts load asynchronously.
- Expose current registered values for debugging.
- Keep errors local to the affected expression or control.
- Include concise API documentation and at least one small usage example separate from the final model.

## Stackelberg model

Create an interactive quantity-leadership duopoly model. The leader chooses quantity first. The follower observes the leader's choice and chooses its best response. Market price depends on total quantity.

Use these editable default functions:

- Inverse demand: "P(Q)=60-\\frac{Q}{2}", for "Q\\ge 0"
- Leader total cost: "C_L(q_L)=\\frac{q_L^2}{10}"
- Follower total cost: "C_F(q_F)=\\frac{q_F^2}{8}"

All equilibrium values must be derived from the active functions. Do not hard-code the answers as the model's computational implementation.

Construct:

- Total quantity: "Q=q_L+q_F"
- Leader profit: "\\pi_L(q_L,q_F)=P(q_L+q_F)q_L-C_L(q_L)"
- Follower profit: "\\pi_F(q_L,q_F)=P(q_L+q_F)q_F-C_F(q_F)"
- Follower best response from its first-order condition.
- Leader optimum after substituting the follower's best response into leader profit.
- Follower equilibrium quantity by evaluating the best response at the leader optimum.
- Equilibrium total quantity, price, and both profits.

For the default functions, the application must derive and display:

- Leader quantity: "q_L=45"
- Follower quantity: "q_F=30"
- Total quantity: "Q=75"
- Market price: "P=22.5"

## Chart one: market price and total quantity

Create a Desmos chart with total quantity on the horizontal axis and price or marginal value on the vertical axis. It must include:

- The editable inverse-demand curve.
- Market marginal revenue derived from total revenue.
- Each firm's marginal cost as computational expressions.
- Aggregate industry marginal cost derived from the horizontal sum of the firms' supply relationships, not from a hard-coded final line.
- A clearly labeled Stackelberg equilibrium point at total quantity and market price.
- A second point showing the market price implied by the currently selected alternative leader and follower quantities.
- Sensible initial bounds, axis labels, colors, line styles, and responsive sizing.

Add a “Display cartel solution” switch. When enabled, compute the joint-profit output from market marginal revenue and aggregate marginal cost, then show:

- The cartel total quantity and corresponding demand price.
- A labeled cartel point.
- A shaded revenue rectangle from the origin to the cartel quantity and price.

For the default functions, the cartel calculation should produce total quantity "54" and price "33".

## Chart two: leader and follower quantities

Create a Desmos chart with leader quantity on the horizontal axis and follower quantity on the vertical axis. It must include:

- A labeled point at the Stackelberg allocation "(45,30)" for the default functions.
- The leader's isoprofit contour through the Stackelberg allocation.
- The follower's isoprofit contour through the Stackelberg allocation.
- Two controls for an alternative leader and follower allocation. Initialize them to the computed Stackelberg values, not duplicated numeric constants.
- A draggable alternative-allocation point synchronized bidirectionally with both controls.
- Dashed leader and follower isoprofit contours through the alternative allocation.
- An optional shaded region containing allocations that make both firms better off than at the Stackelberg allocation.
- A “Display mutually better allocations” switch controlling that shaded region.
- Sensible bounds, axis labels, colors, and responsive sizing.

When an editable demand or cost function changes, recompute the equilibrium, labels, slider defaults or bounds where appropriate, isoprofit levels, and dependent chart expressions without reloading the page.

## Interface

Build a polished, understandable single-page interface containing:

- A compact control panel for the three editable functions.
- The cartel and mutually-better-allocation switches.
- Alternative leader and follower quantity controls.
- Both charts, readable at desktop and mobile widths.
- A help or instructions area explaining inverse demand, costs, backward induction, isoprofit curves, the alternative allocation, and the cartel comparison.
- A small diagnostics area that can reveal the current expression registry and derived equilibrium values.

Prioritize mathematical legibility and interaction clarity over decorative effects. Ensure keyboard focus is visible and controls have accessible labels.

## Project structure and deliverables

Leave a complete runnable project in the workspace. A good structure separates at least:

- SDK graph adapter and registry
- Symbolic transformation service
- SDK controls and UI helpers
- Stackelberg model declarations
- Application bootstrap
- Styles
- Tests
- README

You may choose the exact file names and build tooling. Include:

- A package manifest with clear development, test, and build commands.
- A README explaining setup, architecture, public SDK usage, and the model derivation.
- Focused automated tests for dependency ordering, cycle detection, symbolic operations, and the default economic results.
- No generated dependency directories or secret files in the deliverable.

## Verification

Before finishing:

1. Install or use the available dependencies and run the test suite.
2. Run the production build or equivalent static validation.
3. Verify that model code contains no direct Desmos calculator manipulation.
4. Verify that exactly two graph instances are created through the SDK.
5. Verify the default Stackelberg values "(q_L,q_F,Q,P)=(45,30,75,22.5)".
6. Verify the default cartel values "(Q,P)=(54,33)".
7. Verify edits to each of the three input functions trigger dependent recomputation.
8. Verify slider, number input, draggable point, labels, and switches remain synchronized.
9. Check the browser console for uncaught errors if browser tooling is available.
10. Review the README against the actual commands and file structure.

Finish only after the workspace contains the working implementation. In your final response, summarize what you built, list the important files, report the exact verification commands and results, and state any genuine limitation. Do not paste the full source code into the final response.`;

export function oneShotPromptStats(): { characters: number; words: number } {
  return {
    characters: oneShotSdkBuildPrompt.length,
    words: oneShotSdkBuildPrompt.trim().split(/\s+/).length
  };
}
