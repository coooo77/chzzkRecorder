"use strict";

export interface PuppeteerSetting {
  headless: boolean;
  executablePath: string;
}

export interface AppSettings {
  checkIntervalSec: number;
  filenameTemplate: string;
  filenameVodTemplate: string;
  saveDirectory: string;
  // use puppeteer to add、download vod
  usePuppeteer?: boolean;
  // use ffmpeg to download live stream
  useLiveFFmpegOutput?: boolean;
  // proactiveSearch=true: request user online status even record is disabled
  // proactiveSearch=false: don't request user online status, no online msg shown
  proactiveSearch?: boolean;
  puppeteerSettings?: PuppeteerSetting;
}

export interface UserSetting {
  username: string;
  channelId: string;
  channelName: string;
  disableRecord: boolean;
  allowCategory: string[];
}

export interface OnlineUser {
  pid?: number;
  startAt: string;
  username: string;
  controllable: boolean;
  channelName: UserSetting["channelName"];
}

export interface VodDownloadItem {
  pid?: number;
  publishDate: string;
  username: string;
  channelId: string;
  vodNum: number;
  vodUrl: string;
  duration: number;
  finish: boolean;
  isSuccess: boolean;
  tryCount: number;
  adult: boolean;
}

export type UsersList = Record<UserSetting["channelId"], UserSetting>;

export type RecordingList = Record<UserSetting["channelId"], OnlineUser>;
