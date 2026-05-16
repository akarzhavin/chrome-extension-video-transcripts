export interface Subtitle {
  startTime: number;
  endTime: number;
  text: string;
}

export interface Track {
  name: string;
  subtitles: Subtitle[];
}

export interface SidebarElements {
  sidebar?: HTMLDivElement;
  settingsBtn?: HTMLDivElement;
  settingsPanel?: HTMLDivElement;
  mainSelect?: HTMLSelectElement;
  subSelect?: HTMLSelectElement;
  dualBtn?: HTMLButtonElement;
  overlayBtn?: HTMLButtonElement;
  list?: HTMLDivElement;
}

export interface AppInterface {
  updateHighlight(): void;
  seekVideo(time: number): void;
}
