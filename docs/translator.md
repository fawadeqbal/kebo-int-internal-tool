# The translator (papers in English + 中文)

Papers in **English + 中文** print the Chinese of what people type in English (item names, terms, notes,
sentences) under the English. The Chinese is written by a translation model **on our own server**: nothing is
sent to another company.

## What runs

- `translate` in `docker-compose.yml`: llama.cpp's server (`ghcr.io/ggml-org/llama.cpp:server-b12723`, ARM and
  Intel) with Tencent's **Hy-MT2 1.8B** translation model (Apache-2.0, `Q4_K_M`, about 1.1 GB).
- One CPU and 2 GB of memory at most (`TRANSLATE_CPUS`, `TRANSLATE_MEMORY`), so the app keeps the rest of the
  server (2 OCPU / 12 GB on Oracle's free tier).
- The model is downloaded the first time it starts, into the `translate` volume. After that it starts in a few
  seconds, also without the internet.
- The deploy does not wait for it: until it is ready, texts wait and papers print the English.

## How it works

1. A paper in English + 中文 asks for its texts (`POST /translations/lookup`). Known ones print in Chinese at once;
   the rest are asked for, and the toolbar says "中文 for 3 lines is being written".
2. The worker translates what waits, one text at a time (a few seconds each), every 20 seconds
   (`TRANSLATE_INTERVAL_SECONDS`).
3. Each text is translated **once** and kept (table `translations`). The order's items get their Chinese name
   from it (Documents › Names and HS codes).
4. A person's Chinese always wins: typed on the order's items, or corrected in **Settings › Chinese on papers**,
   where the translator's texts wait to be checked (Right / Change / Again).
5. **Our words** (Settings › Chinese on papers) are given to the translator with every text that has them, so
   the company's names always come out the same. Common machine, packing and shipping words are already in
   (`packages/shared/src/workflows/zh-terms.ts`).

Labels (Date, Port of loading…), units, packing, ports and countries have their Chinese in the app itself and
never wait for the translator. Shipping marks, numbers and codes are never translated.

## Switching it off or on

In `.env` on the server, then `sudo docker compose up -d`:

```
TRANSLATE_REPLICAS=0     # stop the translator
TRANSLATE_URL=           # and tell the app there is none
```

Remove both lines to switch it on again.

## Checking it

- Settings › Chinese on papers: Ready / Starting / Not reachable, and how many texts wait or failed.
- `sudo docker compose logs translate` (the download and the model loading).
- Dev tools › Jobs: "translations" runs when something was translated.

Speed measured on one CPU: 2–6 seconds per text (item names, payment sentences).
