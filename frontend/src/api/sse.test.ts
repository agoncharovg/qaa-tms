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
        id: null,
      },
      {
        data: '{"type":"line","line":"second"}',
        event: "log",
        id: null,
      },
      {
        data: '{"type":"terminal","status":"failed","exitCode":2}',
        event: "terminal",
        id: null,
      },
    ]);
  });

  it("captures the SSE id field and carries it forward per spec", async () => {
    const stream = createChunkedStream([
      'id: 7\nevent: STAGE_STARTED\ndata: {"sequence":7}\n\n',
      // No id on the next frame — the last id persists (SSE spec).
      'event: STAGE_COMPLETED\ndata: {"sequence":8}\n\n',
    ]);

    const frames = [];
    for await (const frame of parseSseStream(stream)) {
      frames.push(frame);
    }

    expect(frames).toEqual([
      { data: '{"sequence":7}', event: "STAGE_STARTED", id: "7" },
      { data: '{"sequence":8}', event: "STAGE_COMPLETED", id: "7" },
    ]);
  });
});
