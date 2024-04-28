'use strict'

import path from 'path'
import cp from 'child_process'
import { ChzzkClient } from 'chzzk'

import helper from './common.js'
import fileSys from './fileSys.js'

import type { LiveStatus, Live } from 'chzzk'
import type { RecordingList, UserSetting } from '../interfaces/index.js'

interface RecordItem {
  channelId: string
  adult: boolean
}

interface ErrorItem {
  cause?: Error
  message?: string
}

const failMsg = ['ENOTFOUND', 'fetch failed']

const searchTag = ['라이브 아트', '아트']

export default class Main {
  chzzk: ChzzkClient

  constructor(arg?: ConstructorParameters<typeof ChzzkClient>) {
    const value = arg || []
    this.chzzk = new ChzzkClient(...value)
  }

  appSetting = fileSys.getAppSetting()

  userList = fileSys.getUsersList()

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
        const recordingUser = this.recordingList[channelId]

        if (recordingUser) {
          helper.msg(`Recording User ${recordingUser.username} at ${this.getSourceUrl(channelId)}`)
          continue
        }

        const user = this.userList[channelId]

        const res = await this.chzzk.live.status(channelId)

        await helper.wait(5)

        // TODO: verified account can watch adult content
        if (!res || res.status === 'CLOSE') continue

        if (user.disableRecord) {
          helper.msg(`User ${user.username}'s record stopped due to configuration`)
          continue
        }

        if (this.isInvalidLiveCategory(user.allowCategory, res.liveCategory)) {
          helper.msg(`User ${user.username}'s record stopped due to Invalid Category ${res.liveCategory} `)
          continue
        }

        userStatus.set(channelId, res)
      } catch (error) {
        const err = error as ErrorItem

        const errors = [err?.message, err.cause?.message].filter((e): e is string => Boolean(e))
        if (errors.some((err) => failMsg.includes(err))) {
          continue
        }

        console.error(error)
      }
    }

    return userStatus
  }

  getFilename(setting: UserSetting, targetTime: Date = new Date()) {
    const template = helper.formatDate(this.appSetting.filenameTemplate, targetTime)

    return template.replace('{username}', setting.username).replace('{id}', setting.channelId)
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
    if (this.recordingList[setting.channelId]) {
      helper.msg(`user ${setting.username} is recording, abort record process`, 'warn')
      return
    }

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

  async getOnlineUserByTag(tag: string) {
    const size = 50

    let offset = 0
    let errorCount = 0
    let isOngoing = true

    const liveStreams: Live[] = []
    do {
      try {
        const resp = await this.chzzk.search.lives(tag, { size, offset })

        liveStreams.push(...resp.lives)

        offset += size
        isOngoing = resp.size !== 0

        await helper.wait(10)
      } catch (error) {
        const err = error as ErrorItem

        if (++errorCount === 5) {
          isOngoing = false
          return []
        }

        const errors = [err?.message, err.cause?.message].filter((e): e is string => Boolean(e))
        if (errors.some((err) => failMsg.includes(err))) {
          errorCount++
          continue
        }

        console.error(error)
      }
    } while (isOngoing)

    return liveStreams
  }

  async searchUsersById() {
    const userStatus = await this.getOnlineUsers()

    const items = Array.from(userStatus).map(([channelId, status]) => ({
      channelId,
      adult: status.adult,
    }))

    this.recordUSerByAdult(items)
  }

  async searchUSers() {
    const livesArray = await Promise.all(searchTag.map((tag) => this.getOnlineUserByTag(tag)))

    const lives = livesArray.flat()

    const userToRecord = new Map<string, Live>()

    for (const live of lives) {
      const { channelId } = live

      const user = this.userList[channelId]

      if (!user) continue

      const recordingUser = this.recordingList[channelId]

      if (recordingUser) {
        helper.msg(`Recording User ${recordingUser.username} at ${this.getSourceUrl(channelId)}`)
        continue
      }

      if (user.disableRecord) {
        helper.msg(`Can not record ${user.username}'s live stream due to configuration`)
        continue
      }

      userToRecord.set(channelId, live)
    }

    const items = Array.from(userToRecord).map(([channelId, status]) => ({
      channelId,
      adult: status.adult,
    }))

    this.recordUSerByAdult(items)
  }

  recordUSerByAdult(items: RecordItem[]) {
    for (const { adult, channelId } of items) {
      const user = this.userList[channelId]

      // const method = adult ? this.ffmpegRecord.bind(this) : this.streamLinkRecord.bind(this)
      // method(user)

      if (adult) {
        helper.msg(`can not record user ${user.username} from adult content`, 'warn')
        continue
      }

      this.streamLinkRecord(user)
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

    this.subProcess()
  }

  async mainProcess() {
    this.userList = fileSys.getUsersList()

    this.appSetting = fileSys.getAppSetting()

    helper.msg(`Checking Users at ${new Date().toLocaleString()}`, 'title')

    await this.searchUSers()

    await helper.wait(this.appSetting.checkIntervalSec)

    this.mainProcess()
  }

  async subProcess() {
    helper.msg(`Checking Users by channelId at ${new Date().toLocaleString()}`, 'title')

    await this.searchUsersById()

    await helper.wait(5 * 60)

    this.subProcess()
  }
}
