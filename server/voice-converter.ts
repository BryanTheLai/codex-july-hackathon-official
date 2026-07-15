import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 60_000;

export class VoiceConversionError extends Error {}

export type ConvertedVoice = {
  filePath: string;
  cleanup(): Promise<void>;
};

export interface VoiceConverter {
  convertToWebm(input: Uint8Array, signal?: AbortSignal): Promise<ConvertedVoice>;
  convertToOgg(input: Uint8Array, signal?: AbortSignal): Promise<ConvertedVoice>;
}

function runFfmpeg(
  inputPath: string,
  outputPath: string,
  outputFormat: "webm" | "ogg",
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(CONVERSION_TIMEOUT_MS);
    const executionSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    const child = spawn(
      "ffmpeg",
      [
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:a:0",
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        "-f",
        outputFormat,
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    const abort = () => child.kill();
    executionSignal.addEventListener("abort", abort, { once: true });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-500);
    });
    child.once("error", (error) => {
      executionSignal.removeEventListener("abort", abort);
      reject(new VoiceConversionError(`ffmpeg could not start: ${error.message}`));
    });
    child.once("close", (code) => {
      executionSignal.removeEventListener("abort", abort);
      if (executionSignal.aborted) {
        reject(
          new VoiceConversionError(
            signal?.aborted
              ? "Voice conversion was aborted"
              : "Voice conversion timed out",
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(new VoiceConversionError(`ffmpeg failed: ${stderr || "unknown error"}`));
        return;
      }
      resolve();
    });
  });
}

export function createVoiceConverter(): VoiceConverter {
  const convert = async (
    input: Uint8Array,
    inputName: string,
    outputName: string,
    outputFormat: "webm" | "ogg",
    outputError: string,
    signal?: AbortSignal,
  ): Promise<ConvertedVoice> => {
    if (input.byteLength === 0 || input.byteLength > MAX_INPUT_BYTES) {
      throw new VoiceConversionError("Voice file exceeds the supported size");
    }
    const directory = await mkdtemp(join(tmpdir(), "kaunter-voice-"));
    const inputPath = join(directory, inputName);
    const outputPath = join(directory, outputName);
    try {
      await writeFile(inputPath, input);
      await runFfmpeg(inputPath, outputPath, outputFormat, signal);
      const output = await stat(outputPath);
      if (output.size === 0 || output.size > MAX_OUTPUT_BYTES) {
        throw new VoiceConversionError(outputError);
      }
    } catch (error) {
      await rm(directory, { force: true, recursive: true });
      throw error;
    }
    return {
      filePath: outputPath,
      cleanup: () => rm(directory, { force: true, recursive: true }),
    };
  };

  return {
    async convertToWebm(input, signal) {
      return convert(
        input,
        "inbound.ogg",
        "inbound.webm",
        "webm",
        "Converted voice file exceeds the OpenAI upload limit",
        signal,
      );
    },

    async convertToOgg(input, signal) {
      return convert(
        input,
        "recording.webm",
        "recording.ogg",
        "ogg",
        "Converted voice file exceeds the Telegram upload limit",
        signal,
      );
    },
  };
}
