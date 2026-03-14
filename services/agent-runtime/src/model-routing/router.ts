import { selectModel } from "@jeanbot/model-router";
import type { Capability, RiskLevel } from "@jeanbot/types";

export const routeModel = (risk: RiskLevel, capability: Capability) => {
  return selectModel({
    risk,
    capability
  });
};
