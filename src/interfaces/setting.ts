'use strict'

export interface UserSettingConstructor {
  username: string
  channelId: string
  channelName: string
  // if set disableRecord true, app won't check from sub process
  disableRecord?: boolean
  allowCategory?: string[]
  // if set enableAutoDownloadVod false, app won't check from sub process
  enableAutoDownloadVod?: boolean
  // user must check vod manually and change status to "waiting" to start downloading vod
  manualCheckVod?: boolean
  // extra tags for searching users, skipping stream once users are streaming
  searchTags?: string[]
  // check live by main process
  checkLiveByMainProcess?: boolean
}

export class UserSetting {
  username: string
  channelId: string
  channelName: string
  searchTags?: string[]
  manualCheckVod?: boolean
  skipCategoryCheck?: boolean
  checkLiveByMainProcess?: boolean
  disableRecord?: boolean = true
  enableAutoDownloadVod?: boolean = false
  allowCategory: string[] = ['Live_Art', 'art']

  constructor(setting: UserSettingConstructor) {
    const { username, channelId, channelName, disableRecord, allowCategory, enableAutoDownloadVod, manualCheckVod, searchTags, checkLiveByMainProcess } =
      setting

    this.username = username
    this.channelId = channelId
    this.channelName = channelName
    if (Array.isArray(searchTags)) this.searchTags = searchTags
    if (disableRecord !== undefined) this.disableRecord = disableRecord
    if (Array.isArray(allowCategory)) this.allowCategory = allowCategory
    if (manualCheckVod !== undefined) this.manualCheckVod = manualCheckVod
    if (enableAutoDownloadVod !== undefined) this.enableAutoDownloadVod = enableAutoDownloadVod
    if (checkLiveByMainProcess !== undefined) this.checkLiveByMainProcess = checkLiveByMainProcess
  }
}

export interface PuppeteerSetting {
  headless: boolean
  executablePath: string
}

export interface DownloadVodConcurrencySchedule {
  timeStart: string
  timeEnd: string
  concurrency: number
}

export interface AppSettings {
  checkIntervalSec: number
  filenameTemplate: string
  filenameVodTemplate: string
  saveDirectory: string
  // use puppeteer to add、download vod
  usePuppeteer?: boolean
  // use ffmpeg to download live stream
  useLiveFFmpegOutput?: boolean
  // proactiveSearch=true: request user online status even record is disabled
  // proactiveSearch=false: don't request user online status, no online msg shown
  // if set proactiveSearch false, app won't check vod from sub process
  proactiveSearch?: boolean
  // download n vod videos at same time
  dlVodConcurrency?: number
  // download n vod videos by schedule
  dlVodConcurrencySchedule?: DownloadVodConcurrencySchedule[]
  // check user vod video interval
  checkUserVodMinutes?: number[]
  // overwrite user base setting
  userSettingOverride?: UserSetting
  puppeteerSettings?: PuppeteerSetting
  // path of ffmpeg.exe file, it'll be "ffmpeg" if not be provided
  ffmpeg?: string
  // path of ffprobe.exe file, it'll be "ffprobe" if not be provided
  ffprobe?: string
  // path of streamlink.exe file, it'll be "streamlink" if not be provided
  streamlink?: string
}

export interface OnlineUser {
  pid?: number
  /** skip recording online stream */
  isSkip: boolean
  startAt: string
  username: string
  controllable: boolean
  channelName: UserSetting['channelName']
}

export interface VodDownloadItem {
  pid?: number
  publishDate: string
  username: string
  channelId: string
  vodNum: number
  vodUrl: string
  duration: number
  tryCount: number
  adult: boolean
  cmd?: string
  status: 'waiting' | 'ongoing' | 'success' | 'failed' | 'check'
}

export type UsersList = Record<UserSetting['channelId'], UserSetting>

export type RecordingList = Record<UserSetting['channelId'], OnlineUser>
