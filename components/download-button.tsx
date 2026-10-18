'use client';
import { Monitor } from 'lucide-react';
import {
  PRODUCT_RELEASE_VERSION,
  WINDOWS_INSTALLER_FILE,
  WINDOWS_INSTALLER_URL,
} from '@/lib/windows-installer';

export function DownloadButton() {
  return (
    <a
      className="button dark"
      href={WINDOWS_INSTALLER_URL}
      download={WINDOWS_INSTALLER_FILE}
    >
      <Monitor size={17} aria-hidden="true" />
      Windows용 다운로드 v{PRODUCT_RELEASE_VERSION}
    </a>
  );
}
