/// <reference types="vite/client" />
interface Window { gameStore?: {
  openExternal(url: string): Promise<void>;
  saveExport(data: string): Promise<string>;
  getTheGamesDbKey(): Promise<string>;
  setTheGamesDbKey(key: string): Promise<boolean>;
  findTheGamesDbArt(title: string): Promise<{url:string;gameId:number;title:string;source:string}[]>;
} }
