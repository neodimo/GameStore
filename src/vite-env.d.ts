/// <reference types="vite/client" />
interface Window { gameStore?: {
  openExternal(url: string): Promise<void>;
  saveExport(data: string): Promise<string>;
  getTheGamesDbKey(): Promise<string>;
  setTheGamesDbKey(key: string): Promise<boolean>;
  findTheGamesDbArt(title: string): Promise<{url:string;gameId:number;title:string;source:string}[]>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  restartToUpdate(): Promise<void>;
  onUpdateStatus(listener:(status:UpdateStatus)=>void):()=>void;
} }
type UpdateStatus = {state:'idle'|'checking'|'available'|'downloading'|'ready'|'current'|'unsupported'|'error';version?:string;percent?:number;message?:string};
