import { describe, expect, it } from "vitest";
import { cleanTranslation, glossaryOf, termsFor, textKey, translatePrompt, wantsChinese } from "../src";

// The translator (25 Nov 2026): what it is asked, with which words, and what is kept of its answer.
describe("the translator's texts", () => {
  it("kept once: spaces run together, line breaks kept; only English words are asked for", () => {
    expect(textKey("  Vial  capping\tmachine \r\n  complete set  ")).toBe("Vial capping machine\ncomplete set");
    expect(wantsChinese("Shipped from Qingdao")).toBe(true);
    expect(wantsChinese("8422.30")).toBe(false);
    expect(wantsChinese("LC")).toBe(false);
    expect(wantsChinese("DPP-260")).toBe(false);
    expect(wantsChinese("泡罩包装机 DPP-260")).toBe(false);
    expect(wantsChinese("x".repeat(2001) + " words here")).toBe(false);
  });

  it("the company's words, one a line; with ours, as the text writes them, the company's first", () => {
    const mine = glossaryOf("Vision Pharmaceuticals = 维森制药\nnot a pair\nTunnel: 隧道烘箱\n= 空");
    expect(mine).toEqual([
      { en: "Vision Pharmaceuticals", zh: "维森制药" },
      { en: "Tunnel", zh: "隧道烘箱" },
    ]);
    const terms = termsFor("Sterilizing tunnel for VISION PHARMACEUTICALS, 4 heads", mine);
    expect(terms[0]).toEqual({ en: "VISION PHARMACEUTICALS", zh: "维森制药" });
    // The longer word first, and the company's "tunnel" over ours.
    expect(terms.map((t) => t.en)).toEqual(["VISION PHARMACEUTICALS", "tunnel", "Sterilizing tunnel", "heads"]);
    expect(terms.find((t) => t.en === "tunnel")!.zh).toBe("隧道烘箱");
    // A word inside another word is not it.
    expect(termsFor("Remillsheads")).toEqual([]);
  });

  it("asks in the model's own template; keeps only Chinese, as many lines as the English", () => {
    expect(translatePrompt("Mould set", [{ en: "Mould", zh: "模具" }])).toBe(
      "参考下面的翻译：\nMould 翻译成 模具\n\n将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\nMould set",
    );
    expect(cleanTranslation("译文：“模具一套”", "Mould set")).toBe("模具一套");
    expect(cleanTranslation("Sorry, I cannot.", "Mould set")).toBeNull();
    expect(cleanTranslation("模具一套\n注：这是翻译", "Mould set")).toBe("模具一套");
    expect(cleanTranslation("", "Mould set")).toBeNull();
  });
});
