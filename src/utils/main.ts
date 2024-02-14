'use strict'

import path from 'path'
import cp from 'child_process'
import { ChzzkClient } from 'chzzk'

import helper from './common.js'
import fileSys from './fileSys.js'

import type { LiveStatus } from 'chzzk'
import type { RecordingList, UserSetting, UsersList } from '../interfaces/index.js'

export default class Main {
  chzzk: ChzzkClient

  constructor(arg?: ConstructorParameters<typeof ChzzkClient>) {
    const value = arg || []
    this.chzzk = new ChzzkClient(...value)
  }

  appSetting = fileSys.getAppSetting()

  _userList?: UsersList

  get userList() {
    if (!this._userList) this._userList = fileSys.getUsersList()
    return this._userList
  }

  set userList(list) {
    this._userList = list
    fileSys.saveJSONFile(fileSys.usersListPath, list)
  }

  _recordingList?: RecordingList

  get recordingList() {
    if (!this._recordingList) this._recordingList = fileSys.getRecordingList()
    return this._recordingList
  }

  set recordingList(list) {
    this._recordingList = list
    fileSys.saveJSONFile(fileSys.recordingListPath, list)
  }

  async getOnlineUsers() {
    const channelIds = Object.keys(this.userList)

    const userStatus = new Map<string, LiveStatus>()

    for (const channelId of channelIds) {
      try {
        const res = await this.chzzk.live.status(channelId)

        // TODO: verified account can watch adult content
        if (!res || res.status === 'CLOSE') continue

        userStatus.set(channelId, res)
      } catch (error) {
        console.error(error)
      }
    }

    return userStatus
  }

  getFilename(setting: UserSetting, targetTime: Date = new Date()) {
    const template = this.appSetting.filenameTemplate

    return template
      .replace('{username}', setting.username)
      .replace('{id}', setting.channelId)
      .replace('{year}', String(targetTime.getFullYear()).padStart(2, '0'))
      .replace('{month}', String(targetTime.getMonth() + 1).padStart(2, '0'))
      .replace('{day}', String(targetTime.getDate()).padStart(2, '0'))
      .replace('{hr}', String(targetTime.getHours()).padStart(2, '0'))
      .replace('{min}', String(targetTime.getMinutes()).padStart(2, '0'))
      .replace('{sec}', String(targetTime.getSeconds()).padStart(2, '0'))
  }

  getSourceUrl(channelId: string) {
    return `https://chzzk.naver.com/live/${channelId}`
  }

  getStreamlinkCmd(setting: UserSetting) {
    const filePath = path.join(this.appSetting.saveDirectory, `${this.getFilename(setting)}.ts`)
    const sourceUrl = this.getSourceUrl(setting.channelId)
    return `streamlink ${sourceUrl} best -o ${filePath}`
  }

  record(setting: UserSetting, cmd: string) {
    let task: null | cp.ChildProcess = cp.spawn(cmd, [], {
      detached: true,
      shell: true,
    })

    const spawnFn = () => {
      helper.msg(`start to record user ${setting.username}`)

      this.addRecordList(setting, task?.pid)
    }

    const closeFn = () => {
      helper.msg(`user ${setting.username} is offline`)

      task?.off('spawn', spawnFn)

      task?.off('close', closeFn)

      task = null

      this.removeRecordList(setting)
    }

    task.on('spawn', spawnFn)

    task.on('close', closeFn)
  }

  streamLinkRecord(setting: UserSetting) {
    const cmd = this.getStreamlinkCmd(setting)

    this.record(setting, cmd)
  }

  removeRecordList(setting: UserSetting) {
    const list = this.recordingList

    delete list[setting.channelId]

    this.recordingList = list
  }

  addRecordList(setting: UserSetting, pid?: number) {
    const list = this.recordingList

    list[setting.channelId] = {
      pid,
      startAt: new Date().toJSON(),
      username: setting.username,
      controllable: true,
      channelName: setting.channelName,
    }

    this.recordingList = list
  }

  getFfmpegCmd(setting: UserSetting, m3u8: string) {
    const filePath = path.join(this.appSetting.saveDirectory, `${this.getFilename(setting)}.ts`)
    return `ffmpeg -i ${m3u8} -y -c copy ${filePath}`
  }

  async ffmpegRecord(setting: UserSetting) {
    try {
      const liveDetail = await this.chzzk.live.detail(setting.channelId)
      if (!liveDetail) throw Error('no live detail available')

      const hls = liveDetail.livePlayback.media.find((m) => m.mediaId === 'HLS')
      if (!hls) throw Error(`no hls source for streamer ${setting.username}`)

      const cmd = this.getFfmpegCmd(setting, hls.path)

      this.record(setting, cmd)
    } catch (error) {
      helper.msg(`failed to record streamer ${setting.username}`)

      fileSys.errorHandler(error, 'ffmpegRecord')

      console.error(error)
    }
  }

  isInvalidLiveCategory(allowCategory: string[], currentCategory?: string) {
    if (allowCategory.length === 0 || !currentCategory) return false

    const category = currentCategory.toLowerCase()

    const isAllowed = allowCategory.some((c) => category.indexOf(c.toLowerCase()) !== -1)

    return !isAllowed
  }

  async checkOnlineUser() {
    helper.msg(`Checking Users at ${new Date().toLocaleString()}`)

    const userStatus = await this.getOnlineUsers()

    for (const [channelId, status] of userStatus) {
      const recordingUser = this.recordingList[channelId]

      if (recordingUser) {
        helper.msg(`Recording User ${recordingUser.username} at ${this.getSourceUrl(channelId)}`)
        continue
      }

      const user = this.userList[channelId]

      if (user.disableRecord) {
        helper.msg(`User ${user.username}'s record stopped due to configuration`)
        continue
      }

      if (this.isInvalidLiveCategory(user.allowCategory, status.liveCategory)) {
        helper.msg(`User ${user.username}'s record stopped due to Invalid Category ${status.liveCategory} `)
        continue
      }

      const method = status.adult ? this.ffmpegRecord.bind(this) : this.streamLinkRecord.bind(this)
      method(this.userList[channelId])
    }
  }

  async removeProcessKilled() {
    let recordingList = this.recordingList

    const watchList: RecordingList = {}

    for (const [channelId, onlineUser] of Object.entries(this.recordingList)) {
      if (helper.isProcessRunning(onlineUser.pid)) {
        recordingList[channelId].controllable = false
        watchList[channelId] = JSON.parse(JSON.stringify(recordingList[channelId]))
      } else {
        delete recordingList[channelId]
      }
    }

    this.recordingList = recordingList

    if (Object.keys(watchList).length === 0) return

    helper.msg(`disconnected cmd found, check until stream end`, 'warn')

    await helper.wait(this.appSetting.checkIntervalSec)

    do {
      for (const [channelId, onlineUser] of Object.entries(watchList)) {
        if (helper.isProcessRunning(onlineUser.pid)) continue
        delete watchList[channelId]

        recordingList = this.recordingList
        delete recordingList[channelId]
        this.recordingList = recordingList
      }

      await helper.wait(this.appSetting.checkIntervalSec)
    } while (Boolean(Object.keys(watchList).length))

    helper.msg(`all disconnected cmd end`, 'success')
  }

  async init() {
    helper.msg('Initializing App Settings ...')

    fileSys.makeDirIfNotExist(this.appSetting.saveDirectory)

    this.removeProcessKilled()

    this.mainProcess()
  }

  async mainProcess() {
    this.appSetting = fileSys.getAppSetting()

    await this.checkOnlineUser()

    await helper.wait(this.appSetting.checkIntervalSec)

    this.mainProcess()
  }
}
