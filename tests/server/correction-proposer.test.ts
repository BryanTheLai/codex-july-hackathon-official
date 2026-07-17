import { describe, expect, it, vi } from "vitest";

import { createCorrectionProposer } from "../../server/correction-proposer";

const input = {
  files: [
    {
      id: "file-aircon-service-selection",
      path: "playbooks/aircon-service-selection.md",
      content:
        "For poor cooling and a musty smell, quote the RM99 general service.",
    },
  ],
  failure: {
    caseId: "case-aircon-selection-train",
    candidateResponse: "General service is RM99.",
    criteria: [
      {
        id: "crit-aircon-selection",
        reason: "Chemical wash was required.",
        evidence: "General service is RM99.",
      },
    ],
  },
};

describe("correction proposer", () => {
  it("retries one invalid structured response", async () => {
    const proposal = {
      fileId: "file-aircon-service-selection",
      oldText:
        "For poor cooling and a musty smell, quote the RM99 general service.",
      newText:
        "For poor cooling and a musty smell, quote the RM160 chemical wash.",
      rationale: "Corrects the package-selection rule.",
    };
    const responsesCreate = vi
      .fn()
      .mockResolvedValueOnce({ output_text: "not-json" })
      .mockResolvedValueOnce({ output_text: JSON.stringify(proposal) });
    const proposer = createCorrectionProposer(
      {
        apiKey: "test-key",
        apiMode: "responses",
        baseUrl: "https://provider.example/v1",
        liveEnabled: true,
        model: "test-model",
      },
      {
        responses: { create: responsesCreate },
        chat: { completions: { create: vi.fn() } },
      } as never,
    );

    await expect(proposer.propose(input)).resolves.toEqual(proposal);
    expect(responsesCreate).toHaveBeenCalledTimes(2);
  });
});
