'use client';

import { useEffect, useState } from 'react';

const word = 'ATHENA';

export function TypedWordmark() {
  const [length, setLength] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;

    const start = () => {
      clearTimeout(timer);
      if (disposed) return;
      if (reduced.matches) {
        setLength(word.length);
        return;
      }
      let count = 0;
      setLength(0);
      const type = () => {
        if (disposed) return;
        count += 1;
        setLength(count);
        if (count < word.length) timer = setTimeout(type, 210);
      };
      timer = setTimeout(type, 450);
    };

    void document.fonts.load('300 132px "Daki Light"').then(start, start);
    reduced.addEventListener('change', start);
    return () => {
      disposed = true;
      clearTimeout(timer);
      reduced.removeEventListener('change', start);
    };
  }, []);

  return (
    <div className="typed-wordmark">
      <span className="sr-only">ATHENA</span>
      <span className="typed-track" aria-hidden="true">
        <span className="typed-guide">{word}</span>
        <span className="typed-ink">
          <span className="typed-prefix">
            {word.slice(0, length)}
            <i
              className={
                length === word.length
                  ? 'typing-caret complete'
                  : 'typing-caret'
              }
            />
          </span>
        </span>
      </span>
    </div>
  );
}
