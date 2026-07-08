// synthetic audio generation for tests: a valid, decodable mono 16-bit
// PCM WAV file, either a sine tone (something a test can visibly play/
// decode) or silence (a minimal stand-in blob when only a valid file
// format matters, not its content).

export interface MakeWavOptions {
  /** tone frequency in Hz. ignored when `silent` is true. default 440. */
  freqHz?: number;
  /** samples per second. default 8000 - plenty for tests, keeps file size
   *  (and thus transfer/hash test runtime) small. */
  sampleRate?: number;
  /** produce silence instead of a sine tone. */
  silent?: boolean;
}

/**
 * builds a valid mono 16-bit PCM WAV file. `durationSec` controls both
 * file size and the decoded duration a real audio element would report.
 */
export function makeWav(durationSec = 1, options: MakeWavOptions = {}): Uint8Array {
  const { freqHz = 440, sampleRate = 8000, silent = false } = options;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const sample = silent ? 0 : Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
    view.setInt16(44 + i * 2, Math.floor(sample * 0x4fff), true);
  }

  return new Uint8Array(buf);
}
