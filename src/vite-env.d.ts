/// <reference types="vite/client" />
interface Window { gameStore?: { openExternal(url: string): Promise<void>; saveExport(data: string): Promise<string> } }
