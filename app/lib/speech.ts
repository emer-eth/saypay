type SpeechCtor = new () => SpeechRecognition;

function ctor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen() {
  return ctor() !== null;
}

export function listen(options: {
  lang: string;
  onText: (text: string, final: boolean) => void;
}): { stop: () => void } {
  const Recognition = ctor();
  if (!Recognition) throw new Error("This browser cannot transcribe speech. Type instead.");
  const rec = new Recognition();
  rec.lang = options.lang || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (event: SpeechRecognitionEvent) => {
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i][0]?.transcript ?? "";
      if (event.results[i].isFinal) finalText += piece;
      else interim += piece;
    }
    options.onText((finalText || interim).trim(), Boolean(finalText));
  };
  rec.start();
  return {
    stop: () => {
      try { rec.stop(); } catch { /* already stopped */ }
    },
  };
}
