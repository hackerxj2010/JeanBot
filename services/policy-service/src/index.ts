import { createLogger } from "@jeanbot/logger";
import { riskFromText } from "@jeanbot/security";
import type {
  MissionObjective,
  PolicyDecision,
  PolicyRuleHit,
  ServiceHealth,
  ToolDescriptor
} from "@jeanbot/types";

interface MissionRule {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  test(input: string, objective: MissionObjective): boolean;
  blockedActions?: string[];
}

const missionRules: MissionRule[] = [
  {
    id: "financial-action",
    severity: "critical",
    message: "Financial language detected. Approval is mandatory.",
    blockedActions: ["send-payment", "purchase"],
    test: (input, objective) =>
      input.includes("payment") ||
      input.includes("invoice") ||
      input.includes("purchase") ||
      objective.requiredCapabilities.includes("finance")
  },
  {
    id: "external-communication",
    severity: "high",
    message: "External communication detected. Human review is recommended.",
    blockedActions: ["send-email", "post-message"],
    test: (input, objective) =>
      input.includes("email") ||
      input.includes("slack") ||
      input.includes("telegram") ||
      objective.requiredCapabilities.includes("communication")
  },
  {
    id: "production-change",
    severity: "high",
    message: "Production-impacting change detected. Checkpoint and approval required.",
    blockedActions: ["production-deploy", "data-delete"],
    test: (input) =>
      input.includes("production") ||
      input.includes("deploy") ||
      input.includes("delete") ||
      input.includes("restore")
  },
  {
    id: "sensitive-data",
    severity: "high",
    message: "Sensitive data or credentials may be involved.",
    blockedActions: ["expose-secrets"],
    test: (input) =>
      input.includes("credential") ||
      input.includes("secret") ||
      input.includes("token") ||
      input.includes("pii")
  }
];

export class PolicyService {
  private readonly logger = createLogger("policy-service");

  evaluateMission(objective: MissionObjective): PolicyDecision {
    const input = `${objective.title}\n${objective.objective}\n${objective.context}\n${objective.constraints.join("\n")}`.toLowerCase();
    const ruleHits: PolicyRuleHit[] = missionRules
      .filter((rule) => rule.test(input, objective))
      .map((rule) => ({
        id: rule.id,
        severity: rule.severity,
        message: rule.message,
        matchedText: objective.objective
      }));

    const inferredRisk = riskFromText(input);
    const highestRuleSeverity = ruleHits.reduce<PolicyDecision["risk"]>(
      (highest, hit) => {
        const order = ["low", "medium", "high", "critical"];
        return order.indexOf(hit.severity) > order.indexOf(highest) ? hit.severity : highest;
      },
      inferredRisk
    );
    const risk = objective.risk === "low" ? highestRuleSeverity : objective.risk;

    const approvalRequired =
      risk === "critical" ||
      risk === "high" ||
      ruleHits.length > 0 ||
      objective.requiredCapabilities.includes("finance") ||
      objective.requiredCapabilities.includes("communication");

    const blockedActions = [...new Set(ruleHits.flatMap((hit) => {
      const rule = missionRules.find((candidate) => candidate.id === hit.id);
      return rule?.blockedActions ?? [];
    }))];

    const decision: PolicyDecision = {
      allowed: true,
      reason: approvalRequired
        ? "Mission can proceed but requires approval gates for risky actions."
        : "Mission is allowed to proceed automatically.",
      approvalRequired,
      risk,
      ruleHits,
      blockedActions
    };

    this.logger.info("Mission policy evaluated", {
      missionId: objective.id,
      risk,
      approvalRequired
    });

    return decision;
  }

  evaluateTool(tool: ToolDescriptor, action: string): PolicyDecision {
    const normalized = action.toLowerCase();
    const approvalRequired =
      tool.requiresApproval ||
      normalized.includes("delete") ||
      normalized.includes("deploy") ||
      normalized.includes("send");

    return {
      allowed: true,
      reason: approvalRequired
        ? "Tool execution requires approval."
        : "Tool execution allowed.",
      approvalRequired,
      risk: approvalRequired ? "high" : "low",
      ruleHits: approvalRequired
        ? [
            {
              id: "tool-approval",
              severity: "high",
              message: `Tool ${tool.id} requires elevated review for action ${action}.`,
              matchedText: action
            }
          ]
        : [],
      blockedActions: []
    };
  }

  health(): ServiceHealth {
    return {
      name: "policy-service",
      ok: true,
      details: {}
    };
  }
}
