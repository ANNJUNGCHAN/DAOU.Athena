'use client';

import { createPortal } from 'react-dom';
import { FileDown, LoaderCircle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import './presentation-print.css';

async function waitForPrintAssets(root: HTMLElement) {
  await document.fonts.ready;
  const images = Array.from(root.querySelectorAll('img'));
  for (const image of images) image.loading = 'eager';
  await Promise.all(
    images.map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener(
            'error',
            () => reject(new Error('print image failed')),
            { once: true },
          );
        });
      }
      if (!image.naturalWidth) throw new Error('print image is unavailable');
      await image.decode();
    }),
  );
}

async function waitForPrintAssetsWithTimeout(root: HTMLElement) {
  let timeout = 0;
  try {
    await Promise.race([
      waitForPrintAssets(root),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error('print preparation timed out')),
          20_000,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function PresentationPrint({ children }: { children: ReactNode }) {
  const [prepared, setPrepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!prepared || !busy) return;
    let cancelled = false;
    let fallback = 0;

    const finish = () => {
      window.clearTimeout(fallback);
      setBusy(false);
    };
    const print = async () => {
      const root = document.querySelector<HTMLElement>(
        '.presentation-print-root',
      );
      if (!root) return;
      try {
        await waitForPrintAssetsWithTimeout(root);
        if (cancelled) return;
        window.addEventListener('afterprint', finish, { once: true });
        window.print();
        fallback = window.setTimeout(finish, 1500);
      } catch {
        if (!cancelled) {
          setMessage('PDF 화면을 준비하지 못했습니다. 다시 시도해 주세요.');
          setBusy(false);
        }
      }
    };

    const frame = requestAnimationFrame(() => void print());
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      window.removeEventListener('afterprint', finish);
    };
  }, [busy, prepared]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMessage('');
          setPrepared(true);
          setBusy(true);
        }}
        disabled={busy}
        title="브라우저에서 PDF로 저장"
      >
        {busy ? (
          <LoaderCircle className="presentation-print-spinner" size={18} />
        ) : (
          <FileDown size={18} />
        )}
        <span>{busy ? 'PDF 준비 중' : 'PDF로 저장'}</span>
      </button>
      <output className="presentation-print-status">{message}</output>
      {prepared &&
        createPortal(
          <div className="presentation-print-root" aria-hidden="true">
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
