import { crossFeatureGate, sharedToFeatureGate, unassignedGate } from "./cross-feature";
import { depcruiseGate } from "./depcruise";
import { featureMapGate } from "./feature-map";
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
  featureMapGate,
];
