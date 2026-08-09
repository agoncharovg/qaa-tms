export interface SseFrame {
  event: string;
  data: string;
}

function finalizeFrame(event: string | null, dataLines: string[]): SseFrame | null {
  if (dataLines.length === 0) {
    return null;
  }

  return {
    data: dataLines.join("\n"),
    event: event ?? "message",
  };
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let aborted = signal?.aborted ?? false;
  let buffer = "";
  let currentEvent: string | null = null;
  let currentDataLines: string[] = [];

  const handleAbort = () => {
    aborted = true;
    void reader.cancel();
  };

  signal?.addEventListener("abort", handleAbort);

  try {
    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replaceAll("\r", "");

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length === 0) {
          const frame = finalizeFrame(currentEvent, currentDataLines);
          if (frame) {
            yield frame;
          }
          currentEvent = null;
          currentDataLines = [];
          continue;
        }

        if (line.startsWith(":")) {
          continue;
        }

        const separatorIndex = line.indexOf(":");
        const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
        const valuePart =
          separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).replace(/^\s/, "");

        if (field === "event") {
          currentEvent = valuePart;
          continue;
        }

        if (field === "data") {
          currentDataLines.push(valuePart);
        }
      }
    }

    if (!aborted) {
      buffer += decoder.decode();
      const trailingLine = buffer.replaceAll("\r", "");
      if (trailingLine.length > 0) {
        const separatorIndex = trailingLine.indexOf(":");
        const field = separatorIndex === -1 ? trailingLine : trailingLine.slice(0, separatorIndex);
        const valuePart =
          separatorIndex === -1 ? "" : trailingLine.slice(separatorIndex + 1).replace(/^\s/, "");

        if (field === "event") {
          currentEvent = valuePart;
        } else if (field === "data") {
          currentDataLines.push(valuePart);
        }
      }

      const trailingFrame = finalizeFrame(currentEvent, currentDataLines);
      if (trailingFrame) {
        yield trailingFrame;
      }
    }
  } finally {
    signal?.removeEventListener("abort", handleAbort);
    reader.releaseLock();
  }
}
