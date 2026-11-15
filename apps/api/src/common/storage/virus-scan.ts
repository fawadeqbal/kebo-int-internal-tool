import { connect } from "node:net";

/** clamd's answer for one file. */
export type ScanResult = { clean: true } | { clean: false; virus: string };

/**
 * One file through clamd (ClamAV's scanner, the optional `clamav` service: CLAMAV_HOST=clamav:3310), by its
 * INSTREAM command: the bytes in chunks, each after its length. Answers clean, or the virus it found; throws when
 * clamd cannot be reached or says something else (the caller refuses the file then: a check that was switched
 * on never lets a file through unchecked).
 */
export function scanWithClamd(address: string, data: Buffer, timeoutMs = 20_000): Promise<ScanResult> {
  const [host, port] = address.includes(":") ? [address.slice(0, address.lastIndexOf(":")), Number(address.slice(address.lastIndexOf(":") + 1))] : [address, 3310];
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const answer: Buffer[] = [];
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("clamd did not answer in time")));
    socket.on("error", reject);
    socket.on("data", (d) => answer.push(d));
    socket.on("end", () => {
      const text = Buffer.concat(answer).toString("utf8").replace(/\0/g, "").trim();
      if (/:\s*OK$/.test(text)) return resolve({ clean: true });
      const found = /:\s*(.+) FOUND$/.exec(text);
      if (found) return resolve({ clean: false, virus: found[1]! });
      reject(new Error(`clamd said: ${text || "nothing"}`));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let at = 0; at < data.length; at += 64 * 1024) {
        const chunk = data.subarray(at, at + 64 * 1024);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}
