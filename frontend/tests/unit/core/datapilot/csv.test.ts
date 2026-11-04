import { expect, test } from "@rstest/core";

import {
  buildAnalysisPrompt,
  inspectCsv,
  SAMPLE_CSV,
} from "@/core/datapilot/csv";

test("CSV preview preserves quoting and computes actual missing values", () => {
  const result = inspectCsv('\ufeffname,value\n"a,b",2\nx,\n');
  expect(result.rowCount).toBe(2);
  expect(result.rows[0]?.[0]).toBe("a,b");
  expect(result.missing).toBe(1);
});

test("CSV preview rejects malformed shapes and duplicate headers", () => {
  for (const csv of ["a,a\n1,2", "a,b\n1", 'a\n"unfinished', "a,\n1,2"]) {
    expect(() => inspectCsv(csv)).toThrow();
  }
});

test("large CSV data is not silently embedded in a model prompt", () => {
  expect(() => buildAnalysisPrompt("x".repeat(12_001))).toThrow();
  expect(buildAnalysisPrompt(SAMPLE_CSV)).toContain("analyze_csv");
});

test("preview limits are enforced", () => {
  expect(() => inspectCsv("a\n" + "1\n".repeat(10_001))).toThrow();
  expect(() => inspectCsv("a\n" + "中".repeat(70_000))).toThrow();
});
