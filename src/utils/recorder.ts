'use strict'
import path from 'path'
import cp from 'child_process'
import EventEmitter from 'events'

import helper from './common.js'
import { ModelEvent } from './model.js'

import Api from './api.js'
import Model from './model.js'

import type { LiveInfo } from '../interfaces/recorder.js'
import type { UserSetting, VideoWithIsAdult, VodDownloadItem } from '../interfaces/index.js'

export enum RecordEvent {
  RECORD_LIVE_START = 'record-live-start',
  DOWNLOAD_VOD_END = 'download-vod-end',
  DOWNLOAD_VOD_START = 'download-vod-start',
}

/**
 * @see https://www.youtube.com/watch?v=Pl7pDjWd830
 * @see https://blog.makerx.com.au/a-type-safe-event-emitter-in-node-js/
 * @see https://stackoverflow.com/questions/67243592/typescript-adding-types-to-eventemitter
 */
interface EventMap {
  [RecordEvent.DOWNLOAD_VOD_END]: [VodDownloadItem]
  [RecordEvent.DOWNLOAD_VOD_START]: [VodDownloadItem]
  [RecordEvent.RECORD_LIVE_START]: [LiveInfo, UserSetting]
}

interface RecordParams {
  api: Api
  model: Model
  eventParam?: ConstructorParameters<typeof EventEmitter>
}

export default class Record extends EventEmitter<EventMap> {
  api: Api
  model: Model

  constructor({ api, model, eventParam = [] }: RecordParams) {
    super(...eventParam)

    this.api = api
    this.model = model

    this.on(RecordEvent.RECORD_LIVE_START, this.recordLiveStream)
  }

  get httpCookie() {
    const { auth, session } = this.model.authCookie
    return `--http-header Cookie="NID_SES=${session};NID_AUT=${auth}"`
  }

  //#region LIVE
  getFilename(setting: UserSetting, liveId: number) {
    return helper
      .formatDate(this.model.appSetting.filenameTemplate, new Date())
      .replace('{username}', setting.username)
      .replace('{id}', setting.channelId)
      .replace('{liveNum}', `${liveId}`)
  }

  getRecordLiveCmd(liveInfo: LiveInfo, userSetting: UserSetting) {
    const { saveDirectory, useLiveFFmpegOutput } = this.model.appSetting

    const sourceUrl = this.api.getSourceUrl(userSetting.channelId)
    let cmd = `streamlink ${sourceUrl} best `

    const filename = this.getFilename(userSetting, liveInfo.liveId)
    const filePath = path.join(saveDirectory, `${filename}.ts`)
    const output = useLiveFFmpegOutput ? '-O | ffmpeg -i pipe:0 -c copy' : '-o'
    if (liveInfo.adult) cmd += `${this.httpCookie} `

    cmd += `${output} ${filePath}`
    return cmd
  }

  async recordLiveStream(liveInfo: LiveInfo, setting: UserSetting) {
    if (this.model.recordingList[setting.channelId]) {
      helper.msg(`user ${setting.username} is recording, abort record process`, 'warn')
      return
    }

    if (liveInfo.adult && !(await this.api.isAbleToRecordAdult())) {
      helper.msg(`Can not record ${setting.username}'s live stream due to adult content`)
      return
    }

    const cmd = this.getRecordLiveCmd(liveInfo, setting)

    let task: null | cp.ChildProcess = cp.spawn(`start cmd.exe /c "${cmd}"`, [], {
      detached: true,
      shell: true,
    })

    const spawnFn = () => {
      helper.msg(`start to record user ${setting.username}`)
      this.model.emit(ModelEvent.ADD_RECORD_LIST, setting, task?.pid)
    }

    const closeFn = () => {
      helper.msg(`user ${setting.username} is offline`)

      this.model.emit(ModelEvent.REMOVE_RECORD_LIST, setting.channelId)
      task?.off('spawn', spawnFn)
      task?.off('close', closeFn)
      task = null
    }

    task.on('spawn', spawnFn)

    task.on('close', closeFn)
  }
  //#endregion

  //#region VOD
  getVodFilename(item: VodDownloadItem, targetTime: Date) {
    const { username, channelId, vodNum, duration } = item
    return helper
      .formatDate(this.model.appSetting.filenameVodTemplate, targetTime)
      .replace('{duration}', helper.formatDuration(duration))
      .replace('{vodNum}', `${vodNum}`)
      .replace('{username}', username)
      .replace('{id}', channelId)
  }

  getVodFilePath(item: VodDownloadItem) {
    const fileName = this.getVodFilename(item, new Date(item.publishDate))
    return path.join(this.model.appSetting.saveDirectory, `${fileName}.ts`)
  }

  getVodDownloadCmd(item: VodDownloadItem) {
    const filePath = this.getVodFilePath(item)
    let cmd = `streamlink ${item.vodUrl} best -f -o ${filePath}`
    if (item.adult) cmd += ` ${this.httpCookie}`
    return cmd
  }

  getVodDownloadItem(vod: VideoWithIsAdult) {
    const vodNum = vod.videoNo
    const userSetting = this.model.userList[vod.channel.channelId]

    const item: VodDownloadItem = {
      vodNum,
      tryCount: 0,
      adult: vod.adult,
      status: 'waiting',
      duration: vod.duration,
      publishDate: vod.publishDate,
      channelId: vod.channel.channelId,
      username: userSetting?.username || 'unknown_user',
      vodUrl: `https://chzzk.naver.com/video/${vodNum}`,
    }

    item.cmd = this.getVodDownloadCmd(item)

    return item
  }

  async recordVOD(item: VodDownloadItem) {
    if (item.adult && !(await this.api.isAbleToRecordAdult())) {
      helper.msg(`Can not record ${item.username}'s live stream due to adult content`)
      return
    }

    return new Promise<void>((res, rej) => {
      try {
        const cmd = this.getVodDownloadCmd(item)

        let task: null | cp.ChildProcess = cp.spawn(cmd, [], {
          detached: true,
          shell: true,
        })

        const spawnFn = () => {
          helper.msg(`start to download vod ${item.vodUrl}`)
          this.emit(RecordEvent.DOWNLOAD_VOD_START, item)
        }

        const closeFn = () => {
          helper.msg(`vod ${item.vodUrl} downloaded`)
          this.emit(RecordEvent.DOWNLOAD_VOD_END, item)

          task?.off('spawn', spawnFn)
          task?.off('close', closeFn)
          task = null

          res()
        }

        task.on('spawn', spawnFn)
        task.on('close', closeFn)
      } catch (error) {
        console.error(error)
        rej()
      }
    })
  }
  //#endregion
}
