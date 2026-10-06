import { crossFeatureGate, sharedToFeatureGate, unassignedGate } from "./cross-feature";
import { depcruiseGate } from "./depcruise";
import { knipGate } from "./knip";
import { suppressionsGate } from "./suppressions";
import { tableOwnershipGate } from "./table-ownership";
import type { Gate } from "./types";

export const GATES: Gate[] = [
  unassignedGate,
  crossFeatureGate,
  sharedToFeatureGate,
  depcruiseGate,
  knipGate,
  suppressionsGate,
  tableOwnershipGate,
];
