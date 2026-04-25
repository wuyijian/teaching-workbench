interface ElectronAPI {
  platform: string;
  versions: { electron: string; node: string };
}

interface Window {
  electronAPI?: ElectronAPI;
}
