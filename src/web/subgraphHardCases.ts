import type { AtomSpec, CompoundSpec, GoldSpec, LinkSpec, SubgraphCaseSpec } from "./subgraphExperiment.js";

type GroupSpec = { id: string; label: string; facts: AtomSpec[] };
type HardCaseInput = Omit<SubgraphCaseSpec, "atoms" | "compounds" | "links"> & { groups: GroupSpec[]; ordinary?: AtomSpec[]; links?: LinkSpec[]; overlaps?: { atomKey: string; groupIds: string[] }[] };

const fact = (key: string, text: string, status: AtomSpec["status"] = "active", authority: AtomSpec["authority"] = "verified"): AtomSpec => ({ key, text, status, authority });
const group = (id: string, label: string, facts: AtomSpec[]): GroupSpec => ({ id, label, facts });

function hardCase(input: HardCaseInput): SubgraphCaseSpec {
  const anchors = input.groups.map((item) => fact(`${item.id}_anchor`, `Authoritative ${item.label} record.`));
  const compounds: CompoundSpec[] = input.groups.map((item, index) => ({
    id: `cmp_${item.id}`,
    label: item.label,
    anchor: anchors[index]!.key,
    members: [anchors[index]!.key, ...item.facts.map((itemFact) => itemFact.key)]
  }));
  for (const overlap of input.overlaps ?? []) {
    for (const groupId of overlap.groupIds) {
      const owner = compounds.find((candidate) => candidate.id === `cmp_${groupId}`);
      if (owner && !owner.members.includes(overlap.atomKey)) owner.members.push(overlap.atomKey);
    }
  }
  const chain: LinkSpec[] = anchors.slice(0, -1).map((anchor, index) => ({ from: anchor.key, to: anchors[index + 1]!.key, relation: "feeds" }));
  return {
    id: input.id,
    title: input.title,
    category: input.category,
    question: input.question,
    atoms: [...anchors, ...input.groups.flatMap((item) => item.facts), ...(input.ordinary ?? [])],
    compounds,
    links: [...chain, ...(input.links ?? [])],
    gold: input.gold
  };
}

export function hardSubgraphCases(): SubgraphCaseSpec[] {
  return [
    hardCase({
      id: "hard-polaris-yield",
      title: "Four-stage yield with rework and reserve",
      category: "multi-stage arithmetic",
      question: "For Polaris, how many finished units remain available after processing, rework, and the shipping reserve?",
      groups: [
        group("polaris_intake", "Polaris intake", [fact("polaris_input", "Polaris starts with 240 units."), fact("polaris_old_yield", "An obsolete draft assumed 95 percent yield.", "stale", "claim")]),
        group("polaris_processing", "Polaris processing", [fact("polaris_loss", "Verified processing loss is 10 percent of starting units."), fact("polaris_rejects", "Inspection rejects 18 processed units.")]),
        group("polaris_rework", "Polaris rework", [fact("polaris_recovered", "Rework recovers 6 of the rejected units."), fact("polaris_claim_recovered", "A supervisor claimed 9 recoveries.", "active", "claim")]),
        group("polaris_shipping", "Polaris shipping", [fact("polaris_reserve", "Shipping must reserve 24 finished units.")])
      ],
      gold: gold(["180 units", "180"], ["180"], ["polaris_input", "polaris_loss", "polaris_rejects", "polaris_recovered", "polaris_reserve"], ["polaris_old_yield", "polaris_claim_recovered"])
    }),
    hardCase({
      id: "hard-vega-selection",
      title: "Constrained vendor ranking with exclusions",
      category: "comparative ranking",
      question: "Which Vega vendor is eligible and has the highest quality-plus-delivery-minus-risk score?",
      groups: [
        group("vega_alpha", "Vega vendor Alpha", [fact("vega_a_quality", "Alpha quality score is 92."), fact("vega_a_delivery", "Alpha delivery score is 78."), fact("vega_a_risk", "Alpha risk penalty is 8.")]),
        group("vega_beta", "Vega vendor Beta", [fact("vega_b_quality", "Beta quality score is 88."), fact("vega_b_delivery", "Beta delivery score is 86."), fact("vega_b_risk", "Beta risk penalty is 5.")]),
        group("vega_gamma", "Vega vendor Gamma", [fact("vega_c_quality", "Gamma quality score is 95."), fact("vega_c_delivery", "Gamma delivery score is 70."), fact("vega_c_risk", "Gamma risk penalty is 3.")]),
        group("vega_policy", "Vega eligibility policy", [fact("vega_delivery_floor", "Eligible vendors require a delivery score of at least 75.")])
      ],
      gold: gold(["Beta", "Vendor Beta"], ["beta"], ["vega_a_quality", "vega_a_delivery", "vega_a_risk", "vega_b_quality", "vega_b_delivery", "vega_b_risk", "vega_c_delivery", "vega_delivery_floor"])
    }),
    hardCase({
      id: "hard-lumen-window",
      title: "Only feasible day across four calendars",
      category: "constraint intersection",
      question: "On which day can the Lumen shipment legally depart when all current constraints are intersected?",
      groups: [
        group("lumen_cert", "Lumen certification", [fact("lumen_cert_window", "Certification is valid Tuesday through Friday."), fact("lumen_cert_old", "The former certificate expired Monday.", "stale")]),
        group("lumen_carrier", "Lumen carrier", [fact("lumen_carrier_days", "The carrier is available Tuesday and Thursday only.")]),
        group("lumen_maintenance", "Lumen maintenance", [fact("lumen_maintenance_day", "Mandatory loading-dock maintenance blocks Tuesday.")]),
        group("lumen_weather", "Lumen weather", [fact("lumen_thursday_clear", "Thursday is verified clear for departure."), fact("lumen_claim_friday", "A dispatcher claimed Friday was preferred.", "active", "claim")])
      ],
      gold: gold(["Thursday"], ["thursday"], ["lumen_cert_window", "lumen_carrier_days", "lumen_maintenance_day", "lumen_thursday_clear"], ["lumen_cert_old", "lumen_claim_friday"])
    }),
    hardCase({
      id: "hard-orion-access",
      title: "Delegated authority after expiry and revocation",
      category: "authorization logic",
      question: "Who alone currently has valid authority to approve the Orion release?",
      groups: [
        group("orion_alice", "Orion Alice authority", [fact("orion_alice_role", "Alice is an approver."), fact("orion_alice_delegation_revoke", "Alice's release delegation was revoked.")]),
        group("orion_bob", "Orion Bob authority", [fact("orion_bob_role", "Bob is an approver."), fact("orion_bob_clearance_expired", "Bob's required clearance expired yesterday.")]),
        group("orion_carol", "Orion Carol authority", [fact("orion_carol_delegate", "Carol holds an active delegation from Dana."), fact("orion_carol_clearance", "Carol's clearance is active.")]),
        group("orion_dana", "Orion Dana authority", [fact("orion_dana_role", "Dana is an active delegation sponsor but does not hold direct Orion release approval."), fact("orion_dana_clearance", "Dana's clearance is active."), fact("orion_policy", "A delegated approval is valid only when both delegator and delegate have active clearance.")])
      ],
      gold: gold(["Carol", "Carol alone"], ["carol"], ["orion_alice_delegation_revoke", "orion_bob_clearance_expired", "orion_carol_delegate", "orion_carol_clearance", "orion_dana_role", "orion_dana_clearance", "orion_policy"])
    }),
    hardCase({
      id: "hard-sable-invoice",
      title: "Invoice with scoped discount and tax",
      category: "scoped financial calculation",
      question: "What is Sable's final invoice after the goods discount, insurance, and correctly scoped tax?",
      groups: [
        group("sable_goods", "Sable goods", [fact("sable_quantity", "Sable purchases 8 units."), fact("sable_unit_price", "Each unit costs 125 dollars.")]),
        group("sable_discount", "Sable discount", [fact("sable_discount_rate", "The approved volume discount is 12 percent of goods."), fact("sable_old_discount", "A stale quote used 10 percent.", "stale")]),
        group("sable_insurance", "Sable insurance", [fact("sable_insurance_fee", "Insurance adds 70 dollars and is not taxable.")]),
        group("sable_tax", "Sable tax", [fact("sable_tax_rate", "Tax is 5 percent of post-discount goods only.")])
      ],
      gold: gold(["994 dollars", "$994", "994"], ["994"], ["sable_quantity", "sable_unit_price", "sable_discount_rate", "sable_insurance_fee", "sable_tax_rate"], ["sable_old_discount"])
    }),
    hardCase({
      id: "hard-apex-critical-path",
      title: "Parallel dependency critical path",
      category: "dependency scheduling",
      question: "What is the earliest Apex release day when all dependency and parallelism rules are respected?",
      groups: [
        group("apex_design", "Apex design", [fact("apex_design_days", "Design takes 4 days.")]),
        group("apex_branches", "Apex parallel branches", [fact("apex_legal_days", "Legal review takes 6 days after design."), fact("apex_prototype_days", "Prototype takes 7 days after design."), fact("apex_parallel_rule", "Legal review and prototype run in parallel.")]),
        group("apex_security", "Apex security", [fact("apex_security_days", "Security takes 3 days after prototype and may run in parallel with integration.")]),
        group("apex_integration", "Apex integration", [fact("apex_integration_days", "Integration takes 5 days and starts only after legal review and prototype both finish."), fact("apex_release_gate", "Release waits for both integration and security.")])
      ],
      gold: gold(["Day 16", "16 days", "16"], ["16"], ["apex_design_days", "apex_legal_days", "apex_prototype_days", "apex_parallel_rule", "apex_security_days", "apex_integration_days", "apex_release_gate"])
    }),
    hardCase({
      id: "hard-ember-availability",
      title: "Inventory after allocations, return, damage, and reserve",
      category: "ledger reconciliation",
      question: "How many Ember units are currently available for new orders after every validated adjustment?",
      groups: [
        group("ember_stock", "Ember opening stock", [fact("ember_opening", "Opening stock is 120 units."), fact("ember_claim_stock", "A warehouse note claimed 126 units.", "active", "claim")]),
        group("ember_allocations", "Ember allocations", [fact("ember_alloc_a", "Allocation A reserves 38 units."), fact("ember_alloc_b", "Allocation B reserves 27 units.")]),
        group("ember_adjustments", "Ember adjustments", [fact("ember_return", "Five units from allocation A were returned to available stock."), fact("ember_damage", "Eight unallocated units were damaged.")]),
        group("ember_reserve", "Ember operating reserve", [fact("ember_reserve", "A 20-unit operating reserve cannot be sold.")])
      ],
      gold: gold(["32 units", "32"], ["32"], ["ember_opening", "ember_alloc_a", "ember_alloc_b", "ember_return", "ember_damage", "ember_reserve"], ["ember_claim_stock"])
    }),
    hardCase({
      id: "hard-nova-config",
      title: "Signed configuration over stale and claimed values",
      category: "version authority",
      question: "What timeout and endpoint are in Nova's current checksum-verified configuration?",
      groups: [
        group("nova_v2", "Nova version two", [fact("nova_v2_timeout", "Version two timeout was 30 seconds.", "stale"), fact("nova_v2_endpoint", "Version two endpoint was us-1.", "stale")]),
        group("nova_v3", "Nova version three", [fact("nova_v3_timeout", "Signed version three timeout is 45 seconds."), fact("nova_v3_endpoint", "Signed version three endpoint is eu-3.")]),
        group("nova_claims", "Nova operator claims", [fact("nova_manager_claim", "A manager claimed the timeout should be 60 seconds.", "active", "claim")]),
        group("nova_checksum", "Nova checksum", [fact("nova_checksum_verified", "The deployed checksum verifies signed version three.")])
      ],
      gold: gold(["45 seconds, eu-3", "45, eu-3"], ["45", "eu", "3"], ["nova_v3_timeout", "nova_v3_endpoint", "nova_checksum_verified"], ["nova_v2_timeout", "nova_v2_endpoint", "nova_manager_claim"])
    }),
    hardCase({
      id: "hard-helix-candidate",
      title: "Unique candidate from four-way set intersection",
      category: "set intersection",
      question: "Who is the only Helix candidate satisfying region, skill, and Wednesday availability requirements?",
      groups: [
        group("helix_requirements", "Helix requirements", [fact("helix_required_region", "The role requires Europe region."), fact("helix_required_skill", "The role requires Rust skill."), fact("helix_required_day", "The role requires Wednesday availability.")]),
        group("helix_pair_one", "Helix candidates Ana and Ben", [fact("helix_ana", "Ana is in Europe, knows Rust, and is available Wednesday."), fact("helix_ben", "Ben is in Europe and knows Rust but is unavailable Wednesday.")]),
        group("helix_pair_two", "Helix candidates Cara and Dion", [fact("helix_cara", "Cara knows Rust and is available Wednesday but is in the United States."), fact("helix_dion", "Dion is in Europe and available Wednesday but knows Go, not Rust.")])
      ],
      gold: gold(["Ana", "Ana only"], ["ana"], ["helix_required_region", "helix_required_skill", "helix_required_day", "helix_ana", "helix_ben", "helix_cara", "helix_dion"])
    }),
    hardCase({
      id: "hard-quorum-veto",
      title: "Supermajority defeated by an active veto",
      category: "policy precedence",
      question: "Did the current Quorum motion pass, and what rule determines the result?",
      groups: [
        group("quorum_attendance", "Quorum attendance", [fact("quorum_present", "Members A, B, C, D, and E are present; F is recused and G is absent."), fact("quorum_minimum", "Five non-recused members present satisfies quorum.")]),
        group("quorum_votes", "Quorum votes", [fact("quorum_yes", "A, B, and C vote yes."), fact("quorum_no", "D votes no."), fact("quorum_abstain", "E abstains.")]),
        group("quorum_threshold", "Quorum threshold", [fact("quorum_two_thirds", "Passage normally requires at least two thirds of non-abstaining votes.")]),
        group("quorum_veto", "Quorum veto", [fact("quorum_risk_chair", "D is the active risk chair."), fact("quorum_veto_rule", "A no vote by the active risk chair vetoes the motion even if the numeric threshold passes.")])
      ],
      gold: gold(["No, risk-chair veto", "Rejected by D's veto", "No"], ["no", "veto"], ["quorum_present", "quorum_minimum", "quorum_yes", "quorum_no", "quorum_abstain", "quorum_two_thirds", "quorum_risk_chair", "quorum_veto_rule"])
    }),
    hardCase({
      id: "hard-atlas-energy",
      title: "Energy total with overhead and offset",
      category: "multi-hop unit arithmetic",
      question: "What net grid energy does Atlas consume for the run after cooling overhead and battery offset?",
      groups: [
        group("atlas_machines", "Atlas machines", [fact("atlas_machine_count", "Four machines run."), fact("atlas_machine_power", "Each machine draws 3.5 kilowatts.")]),
        group("atlas_duration", "Atlas duration", [fact("atlas_run_hours", "The run lasts 6 hours.")]),
        group("atlas_cooling", "Atlas cooling", [fact("atlas_cooling_rate", "Cooling adds 25 percent of machine energy.")]),
        group("atlas_battery", "Atlas battery", [fact("atlas_battery_offset", "The battery supplies 15 kilowatt-hours during the run.")])
      ],
      gold: gold(["90 kWh", "90 kilowatt-hours", "90"], ["90"], ["atlas_machine_count", "atlas_machine_power", "atlas_run_hours", "atlas_cooling_rate", "atlas_battery_offset"])
    }),
    hardCase({
      id: "hard-birch-retention",
      title: "Retention under hold, regulation, and false incident claim",
      category: "exception hierarchy",
      question: "What is Birch's minimum retention period after applying all current authoritative rules?",
      groups: [
        group("birch_default", "Birch default retention", [fact("birch_default_days", "Default retention is 90 days.")]),
        group("birch_hold", "Birch legal hold", [fact("birch_hold_release", "The legal hold was released on day 40."), fact("birch_hold_rule", "A legal hold preserves records until release but does not shorten another minimum.")]),
        group("birch_regulation", "Birch regulation", [fact("birch_regulatory_min", "The regulated record class requires at least 120 days.")]),
        group("birch_incident", "Birch incident status", [fact("birch_incident_extension", "A confirmed breach would add 30 days."), fact("birch_breach_claim", "An analyst claimed a breach occurred.", "active", "claim"), fact("birch_no_breach", "The verified incident review found no breach.")])
      ],
      gold: gold(["120 days", "120"], ["120"], ["birch_default_days", "birch_hold_release", "birch_hold_rule", "birch_regulatory_min", "birch_incident_extension", "birch_no_breach"], ["birch_breach_claim"])
    }),
    hardCase({
      id: "hard-cedar-union",
      title: "Overlapping assets without double counting",
      category: "overlap deduplication",
      question: "How many unique Cedar assets exist across all three teams after removing overlaps?",
      groups: [
        group("cedar_team_a", "Cedar team A", [fact("cedar_assets_a", "Team A assets are a, b, c, d, e, f, and g.")]),
        group("cedar_team_b", "Cedar team B", [fact("cedar_assets_b", "Team B assets are c, d, h, i, j, and k.")]),
        group("cedar_team_c", "Cedar team C", [fact("cedar_assets_c", "Team C assets are a, h, l, m, n, o, p, and q.")]),
        group("cedar_count_rule", "Cedar counting rule", [fact("cedar_unique_rule", "Shared asset names represent the same asset and must be counted once.")])
      ],
      gold: gold(["17 assets", "17"], ["17"], ["cedar_assets_a", "cedar_assets_b", "cedar_assets_c", "cedar_unique_rule"])
    }),
    hardCase({
      id: "hard-delta-trucks",
      title: "Capacity ceiling with cancellations and mandatory spare",
      category: "integer optimization",
      question: "How many Delta trucks must be dispatched after cancellations, including the mandatory spare truck?",
      groups: [
        group("delta_orders", "Delta orders", [fact("delta_order_units", "Confirmed orders contain 173 units."), fact("delta_cancellations", "Eleven ordered units were cancelled before dispatch.")]),
        group("delta_capacity", "Delta capacity", [fact("delta_truck_capacity", "Each truck carries at most 24 units.")]),
        group("delta_rounding", "Delta rounding", [fact("delta_ceiling_rule", "Any partially needed truck must be dispatched as a whole truck.")])
      ],
      ordinary: [fact("delta_spare_rule", "Delta dispatch requires one additional empty spare truck beyond cargo trucks.")],
      links: [{ from: "delta_rounding_anchor", to: "delta_spare_rule", relation: "requires" }],
      gold: gold(["8 trucks", "8"], ["8"], ["delta_order_units", "delta_cancellations", "delta_truck_capacity", "delta_ceiling_rule", "delta_spare_rule"])
    }),
    hardCase({
      id: "hard-echo-ranking",
      title: "Eligibility first, then score and latency tie-break",
      category: "lexicographic selection",
      question: "Which Echo applicant wins after eligibility, score, and latency tie-breaks are applied in order?",
      groups: [
        group("echo_policy", "Echo selection policy", [fact("echo_policy_order", "First exclude audit failures, then maximize score, then minimize latency on ties.")]),
        group("echo_a_b", "Echo applicants A and B", [fact("echo_a", "Applicant A scores 91 but failed audit."), fact("echo_b", "Applicant B passes audit, scores 88, and has latency 120.")]),
        group("echo_c_d", "Echo applicants C and D", [fact("echo_c", "Applicant C passes audit, scores 88, and has latency 105."), fact("echo_d_claim", "Applicant D claims a passing audit and score 89.", "active", "claim"), fact("echo_d_verified", "Applicant D's verified audit result is fail.")])
      ],
      gold: gold(["Applicant C", "C"], ["c"], ["echo_policy_order", "echo_a", "echo_b", "echo_c", "echo_d_verified"], ["echo_d_claim"])
    }),
    hardCase({
      id: "hard-fjord-balance",
      title: "Balance with reversed stale debit",
      category: "transaction chronology",
      question: "What is Fjord's current verified balance after all posted transactions and the reversal?",
      groups: [
        group("fjord_opening", "Fjord opening balance", [fact("fjord_opening_balance", "Opening balance is 500 dollars.")]),
        group("fjord_postings", "Fjord valid postings", [fact("fjord_deposit", "A posted deposit adds 180 dollars."), fact("fjord_debit", "A posted debit removes 75 dollars."), fact("fjord_fee", "A posted fee removes 15 dollars."), fact("fjord_refund", "A posted refund adds 20 dollars.")]),
        group("fjord_reversal", "Fjord reversal", [fact("fjord_bad_debit", "An erroneous 40-dollar debit was posted.", "stale"), fact("fjord_bad_debit_reversal", "The erroneous 40-dollar debit was fully reversed.")])
      ],
      gold: gold(["610 dollars", "$610", "610"], ["610"], ["fjord_opening_balance", "fjord_deposit", "fjord_debit", "fjord_fee", "fjord_refund", "fjord_bad_debit", "fjord_bad_debit_reversal"])
    }),
    hardCase({
      id: "hard-grove-route",
      title: "Shortest feasible route under closure and capacity",
      category: "constrained pathfinding",
      question: "Which Grove route is the shortest feasible path for the 10-unit shipment, and what is its travel time?",
      groups: [
        group("grove_north", "Grove northern route", [fact("grove_ab", "Edge A-B takes 4 hours and is open."), fact("grove_bd", "Edge B-D takes 7 hours but is closed.")]),
        group("grove_central", "Grove central route", [fact("grove_ac", "Edge A-C takes 6 hours and is open."), fact("grove_cd", "Edge C-D takes 5 hours and is open.")]),
        group("grove_south", "Grove southern route", [fact("grove_ae", "Edge A-E takes 3 hours and is open."), fact("grove_ed", "Edge E-D takes 9 hours but has capacity 8 units.")]),
        group("grove_load", "Grove shipment", [fact("grove_shipment_size", "The shipment contains 10 units."), fact("grove_route_rule", "Closed edges and edges below shipment capacity are infeasible.")])
      ],
      gold: gold(["A-C-D, 11 hours", "A to C to D in 11 hours"], ["a", "c", "d", "11"], ["grove_ab", "grove_bd", "grove_ac", "grove_cd", "grove_ae", "grove_ed", "grove_shipment_size", "grove_route_rule"])
    }),
    hardCase({
      id: "hard-harbor-sampling",
      title: "Tiered sampling with certified reduction",
      category: "conditional aggregation",
      question: "How many Harbor items must be inspected across all batches after the certified reduction?",
      groups: [
        group("harbor_batch_one", "Harbor batch one", [fact("harbor_b1_size", "Batch one has 80 items."), fact("harbor_b1_rate", "Batch one samples 10 percent.")]),
        group("harbor_batch_two", "Harbor batch two", [fact("harbor_b2_size", "Batch two has 120 items."), fact("harbor_b2_rate", "Batch two normally samples 15 percent."), fact("harbor_b2_certified", "Batch two is certified, reducing its sample count by one third.")]),
        group("harbor_batch_three", "Harbor batch three", [fact("harbor_b3_size", "Batch three has 50 items."), fact("harbor_b3_rate", "Batch three samples 20 percent.")]),
        group("harbor_rounding", "Harbor sampling rule", [fact("harbor_whole_rule", "All resulting sample counts are whole items.")])
      ],
      gold: gold(["30 items", "30"], ["30"], ["harbor_b1_size", "harbor_b1_rate", "harbor_b2_size", "harbor_b2_rate", "harbor_b2_certified", "harbor_b3_size", "harbor_b3_rate"])
    }),
    hardCase({
      id: "hard-ion-bom",
      title: "Bill of materials with partial substitution and rebate",
      category: "cost composition",
      question: "What is Ion's final material cost for ten builds after substitution and rebate?",
      groups: [
        group("ion_chips", "Ion chips", [fact("ion_build_count", "Ion will build 10 units."), fact("ion_chip_requirement", "Each build requires 2 standard chips at 8 dollars each."), fact("ion_chip_substitution", "Four of the 20 total chips are replaced by premium chips costing 10 dollars each.")]),
        group("ion_sensors", "Ion sensors", [fact("ion_sensor_requirement", "Each build requires 3 current sensors at 5 dollars each."), fact("ion_sensor_old_price", "An obsolete sensor quote was 6 dollars.", "stale")]),
        group("ion_casings", "Ion casings", [fact("ion_casing_requirement", "Each build requires one 12-dollar casing.")]),
        group("ion_rebate", "Ion rebate", [fact("ion_rebate_amount", "The final order receives an 18-dollar rebate.")])
      ],
      gold: gold(["420 dollars", "$420", "420"], ["420"], ["ion_build_count", "ion_chip_requirement", "ion_chip_substitution", "ion_sensor_requirement", "ion_casing_requirement", "ion_rebate_amount"], ["ion_sensor_old_price"])
    }),
    hardCase({
      id: "hard-juniper-tournament",
      title: "Tournament winner after active penalty and stale appeal",
      category: "ordered tie-break",
      question: "Who is Juniper's current tournament winner after penalties, before any unnecessary tie-break?",
      groups: [
        group("juniper_points", "Juniper standings", [fact("juniper_red_points", "Red has 6 points."), fact("juniper_blue_points", "Blue has 6 points."), fact("juniper_green_points", "Green has 3 points.")]),
        group("juniper_penalty", "Juniper penalty", [fact("juniper_blue_penalty", "Blue has an active one-point penalty."), fact("juniper_penalty_claim", "A coach claimed the penalty was withdrawn.", "active", "claim")]),
        group("juniper_appeal", "Juniper appeal", [fact("juniper_appeal_denied", "The verified appeal decision denied withdrawal of the penalty."), fact("juniper_old_appeal", "A draft appeal expected approval.", "stale", "claim")]),
        group("juniper_tiebreak", "Juniper tie-break", [fact("juniper_head_to_head", "Blue defeated Red head-to-head, but head-to-head applies only after current points are tied.")])
      ],
      gold: gold(["Red", "Team Red"], ["red"], ["juniper_red_points", "juniper_blue_points", "juniper_blue_penalty", "juniper_appeal_denied", "juniper_head_to_head"], ["juniper_penalty_claim", "juniper_old_appeal"])
    }),
    hardCase({
      id: "hard-kestrel-capacity",
      title: "Capacity after nested reservations and shared backup",
      category: "shared-resource accounting",
      question: "How much Kestrel compute capacity remains sellable without double-counting the shared backup?",
      groups: [
        group("kestrel_pool", "Kestrel capacity pool", [fact("kestrel_total", "Kestrel has 200 compute units.")]),
        group("kestrel_primary", "Kestrel primary reservations", [fact("kestrel_alpha_reserved", "Alpha reserves 48 units."), fact("kestrel_beta_reserved", "Beta reserves 36 units.")]),
        group("kestrel_backup", "Kestrel shared backup", [fact("kestrel_shared_backup", "Alpha and Beta share the same 20-unit backup pool; it is reserved once, not once per tenant."), fact("kestrel_old_backup", "An obsolete worksheet counted 40 backup units.", "stale")]),
        group("kestrel_operations", "Kestrel operations", [fact("kestrel_ops", "Operations reserves 25 additional units."), fact("kestrel_release", "Nine previously reserved operations units were released.")])
      ],
      overlaps: [{ atomKey: "kestrel_shared_backup", groupIds: ["kestrel_primary", "kestrel_backup"] }],
      gold: gold(["80 units", "80"], ["80"], ["kestrel_total", "kestrel_alpha_reserved", "kestrel_beta_reserved", "kestrel_shared_backup", "kestrel_ops", "kestrel_release"], ["kestrel_old_backup"])
    }),
    hardCase({
      id: "hard-mosaic-service-level",
      title: "Service-level result from weighted current windows",
      category: "weighted aggregation",
      question: "What is Mosaic's current weighted success percentage across the three traffic windows?",
      groups: [
        group("mosaic_morning", "Mosaic morning", [fact("mosaic_morning_total", "Morning handled 100 requests."), fact("mosaic_morning_success", "Morning succeeded on 96 requests.")]),
        group("mosaic_midday", "Mosaic midday", [fact("mosaic_midday_total", "Midday handled 200 requests."), fact("mosaic_midday_success", "Midday succeeded on 180 requests."), fact("mosaic_midday_old", "A stale dashboard showed 188 successes.", "stale")]),
        group("mosaic_evening", "Mosaic evening", [fact("mosaic_evening_total", "Evening handled 100 requests."), fact("mosaic_evening_success", "Evening succeeded on 84 requests.")]),
        group("mosaic_rule", "Mosaic aggregation rule", [fact("mosaic_weight_rule", "Use total successes divided by total requests, not the unweighted mean of window percentages.")])
      ],
      gold: gold(["90 percent", "90%", "90"], ["90"], ["mosaic_morning_total", "mosaic_morning_success", "mosaic_midday_total", "mosaic_midday_success", "mosaic_evening_total", "mosaic_evening_success", "mosaic_weight_rule"], ["mosaic_midday_old"])
    })
  ];
}

function gold(answers: string[], answerContains: string[], requiredEvidence: string[], forbiddenEvidence: string[] = [], answerExcludes: string[] = []): GoldSpec {
  return { answers, answerContains, requiredEvidence, ...(forbiddenEvidence.length ? { forbiddenEvidence } : {}), ...(answerExcludes.length ? { answerExcludes } : {}) };
}
