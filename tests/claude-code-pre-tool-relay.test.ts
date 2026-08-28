import { relayClaudeCodePreToolUse } from "@kratos/adapters";

import { describePreToolRelayConformance } from "./support/pre-tool-relay-cases.js";

describePreToolRelayConformance("claude-code", relayClaudeCodePreToolUse);
