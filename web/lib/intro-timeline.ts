export const EN_QUOTE = 'I have lifted the mist from your eyes,\nso you can clearly distinguish god from mortal.';
export const KO_QUOTE = '그대의 눈을 가리던 안개를 걷어냈다.\n신과 인간을 분명히 구별할 수 있도록.';
export const INTRO_END = 15100;
const portion = (text: string, progress: number) => text.slice(0, Math.floor(text.length * Math.max(0, Math.min(1, progress))));

export function introAt(ms: number) {
  const language = ms < 8600 ? 'en' : 'ko';
  const text = ms < 3300 ? '' : ms < 6000 ? portion(EN_QUOTE, (ms - 3300) / 2700)
    : ms < 7800 ? EN_QUOTE : ms < 8600 ? portion(EN_QUOTE, 1 - (ms - 7800) / 800)
    : portion(KO_QUOTE, (ms - 8900) / 2200);
  return {
    language, text,
    space: ms < 3300,
    citation: (ms >= 6000 && ms < 7800) || (ms >= 11100 && ms < 13500),
    clearing: ms >= 13500,
    done: ms >= INTRO_END,
  };
}
