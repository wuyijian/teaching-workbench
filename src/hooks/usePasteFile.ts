import { useEffect } from 'react';

const AUDIO_EXTS = new Set([
  'mp3', 'mp4', 'wav', 'm4a', 'ogg', 'webm', 'flac', 'aac', 'mpeg', 'mpga',
]);

function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTS.has(ext);
}

/**
 * 监听全局 paste 事件（⌘V / Ctrl+V），当剪贴板中包含音频文件时调用 onFile。
 * active 为 false 时不处理（如正在转写中）。
 */
export function usePasteFile(
  onFile: (file: File) => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return;

    const handler = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      const audio = Array.from(files).find(isAudioFile);
      if (!audio) return;
      e.preventDefault();
      onFile(audio);
    };

    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [active, onFile]);
}
