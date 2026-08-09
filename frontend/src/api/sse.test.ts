import { describe, expect, it } from "vitest";

import { parseSseStream } from "@/api/sse";

function createChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("parseSseStream", () => {
  it("parses ordered log and terminal frames across chunk boundaries", async () => {
    const stream = createChunkedStream([
      'event: log\ndata: {"type":"line","line":"first"}\n\n',
      'event: log\ndata: {"type":"line","line":"sec',
      'ond"}\n\n',
      'event: terminal\ndata: {"type":"terminal","status":"failed","exitCode":2}\n\n',
    ]);

    const frames = [];
    for await (const frame of parseSseStream(stream)) {
      frames.push(frame);
    }

    expect(frames).toEqual([
      {
        data: '{"type":"line","line":"first"}',
        event: "log",
      },
      {
        data: '{"type":"line","line":"second"}',
        event: "log",
      },
      {
        data: '{"type":"terminal","status":"failed","exitCode":2}',
        event: "terminal",
      },
    ]);
  });
});
