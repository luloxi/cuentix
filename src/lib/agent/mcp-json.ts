import {
  isAgentServiceError,
  type AgentServiceError,
} from "@/lib/agent/services";

/** MCP tool result: always text JSON so clients can parse numbers as-is. */
export function mcpJsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function mcpErrorResult(e: unknown) {
  if (isAgentServiceError(e)) {
    return {
      isError: true as const,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { error: e.error, code: e.code, status: e.status },
            null,
            2,
          ),
        },
      ],
    };
  }
  const msg = e instanceof Error ? e.message : "Error";
  const payload: AgentServiceError = {
    status: 500,
    error: msg,
    code: "internal",
  };
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
