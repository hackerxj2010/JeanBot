import { expect, test, describe } from "vitest";
import { embeddingContentHash, generateEmbedding } from "./index.js";

describe("AI Hashing and Vector Baseline", () => {
  test("contentHashFor produces consistent hex strings", () => {
    const input = "  test   input  ";
    const expected = "9dfe6f15d1ab73af898739394fd22fd72a03db01834582f24bb2e1c66c7aaeae"; // sha256 of "test input"
    expect(embeddingContentHash(input)).toBe(expected);
  });

  test("syntheticVector produces deterministic results", async () => {
    const input = "jeanbot";
    const result1 = await generateEmbedding(input, { forceSynthetic: true });
    const result2 = await generateEmbedding(input, { forceSynthetic: true });

    expect(result1.values).toHaveLength(1536);
    expect(result1.values).toEqual(result2.values);
    expect(result1.contentHash).toBe(embeddingContentHash(input));

    // Check specific values to ensure numerical stability
    expect(result1.values[0]).toBeCloseTo(-0.02630604, 6);
    expect(result1.values[1535]).toBeCloseTo(0.04193081, 6);
  });
});
