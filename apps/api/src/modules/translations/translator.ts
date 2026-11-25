import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { loadEnv } from "@kebo/config";
import { cleanTranslation, translatePrompt } from "@kebo/shared";

/**
 * The translation model on this server (docker-compose: translate, llama.cpp's server with Tencent's Hy-MT2
 * 1.8B, Apache-2.0): nothing leaves the server. TRANSLATE_URL empty: no translator (texts wait, papers print
 * the English and the Chinese people typed).
 */
const translateEnv = z.object({
  TRANSLATE_URL: z.string().url().optional().or(z.literal("")),
  /** How long one text may take (seconds): one CPU writes about 5 Chinese words a second. */
  TRANSLATE_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(120),
});

/** The model's own settings for translating (its model card: 1.8B). */
const SAMPLING = { temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05 };

export type TranslatorState = "off" | "ready" | "starting" | "unreachable";

@Injectable()
export class Translator {
  private readonly log = new Logger("Translator");
  readonly url: string | null;
  private readonly timeoutMs: number;

  constructor() {
    const env = loadEnv(translateEnv);
    this.url = env.TRANSLATE_URL ? env.TRANSLATE_URL.replace(/\/+$/, "") : null;
    this.timeoutMs = env.TRANSLATE_TIMEOUT_SECONDS * 1000;
  }

  /** ready; starting (loading or still downloading its model); unreachable; off (no TRANSLATE_URL). */
  async state(): Promise<TranslatorState> {
    if (!this.url) return "off";
    try {
      const r = await fetch(`${this.url}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return "ready";
      return r.status === 503 ? "starting" : "unreachable";
    } catch {
      return "unreachable";
    }
  }

  /** One text into Chinese, with the glossary's words it has; null when the answer is no Chinese. Throws when the translator cannot answer. */
  async toChinese(text: string, terms: { en: string; zh: string }[]): Promise<string | null> {
    if (!this.url) throw new Error("No translator (TRANSLATE_URL is empty).");
    const started = Date.now();
    const r = await fetch(`${this.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: translatePrompt(text, terms) }],
        ...SAMPLING,
        // Chinese takes about as many tokens as English has words; long spec lists have room.
        max_tokens: Math.min(2048, 64 + text.length * 2),
        stream: false,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) throw new Error(`The translator answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const body = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const zh = cleanTranslation(body.choices?.[0]?.message?.content, text);
    this.log.debug(`${text.length} characters in ${Date.now() - started} ms`);
    return zh;
  }
}
