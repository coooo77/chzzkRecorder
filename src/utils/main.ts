'use strict'
// 外部方法
import { cloneDeep } from 'lodash-es'
import findProcess from 'find-process'

// 內部方法
import helper from './common.js'

// Class
import Api from './api.js'
import Model from './model.js'
import LiveVod from './liveVod.js'
import Recorder from './recorder.js'

// 型別
import type { LiveDetail } from 'chzzk'
import type { LiveExtend } from '../interfaces/common.js'
import type { OnlineUser, RecordingList, UserSetting } from '../interfaces/setting.js'

interface ErrorItem {
  cause?: Error
  message?: string
}

interface MainParams {
  api: Api
  model: Model
  liveVod: LiveVod
  recorder: Recorder
}

const failMsg = ['ENOTFOUND', 'fetch failed']

export default class Main {
  api: Api
  model: Model
  liveVod: LiveVod
  recorder: Recorder

  artLives: LiveExtend[] = []

  SUB_PROCESS_LOOP_TIME = 5 * 60
  SUB_PROCESS_API_REQUEST_TIME = 5 * 3

  CHECK_SKIP_CHANNEL_TIME = 5 * 60
  CHECK_SKIP_LIVE_TIME = 30 * 60

  constructor({ api, model, recorder, liveVod }: MainParams) {
    this.api = api
    this.model = model
    this.liveVod = liveVod
    this.recorder = recorder
  }

  // #region 共用邏輯
  async isLiveRunning(userName: string) {
    const result = await findProcess('name', userName)
    return !!result.length && result.some((i) => i.cmd.includes('https://chzzk.naver.com/live'))
  }

  async iterationTask(task: () => Promise<void>, taskName: string, waitTime: number) {
    while (true) {
      try {
        await task()
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        helper.msg(`An error occurred in ${taskName}: ${msg}`, 'error')
      }

      await helper.wait(waitTime)
    }
  }

  onlineUserMessage(user: OnlineUser, streamUrl: string) {
    const msg = user.isSkip ? `${user.username}'s stream is skipped at ${streamUrl}` : `Recording ${user.username} at ${streamUrl}`

    helper.msg(msg)
  }

  getUsersToRecord(liveUsers: Awaited<ReturnType<typeof this.getOnlineUsers>>) {
    return liveUsers.filter(([live, user]) => {
      const streamUrl = this.api.getSourceUrl(user.channelId)

      // 如果是不合法的實況類型 略過該實況，主程序只有檢查藝術 tag，所以不用判斷
      if (!user.skipCategoryCheck && this.isInvalidLiveCategory(user.allowCategory, live.liveCategory)) {
        helper.msg(`Stop record ${user.username} due to Invalid Category ${live.liveCategory}. url: ${streamUrl}`)
        return false
      }

      if (user.disableRecord) {
        helper.msg(`Stop recording ${user.username} due to configuration. url: ${streamUrl}`)
        return false
      }

      return true
    })
  }

  async getOnlineUsers(channelIds: string[]) {
    const livesToRecord: [LiveDetail, UserSetting][] = []

    for (const channelId of channelIds) {
      try {
        const recordingUser = this.model.recordingList[channelId]

        if (recordingUser) {
          this.onlineUserMessage(recordingUser, channelId)
          continue
        }

        const user = this.model.userList[channelId]
        const { disableRecord, enableAutoDownloadVod } = user

        if (!user) continue
        if (disableRecord && !enableAutoDownloadVod) continue

        // 如果該頻道正在實況，就沒有必要再檢查
        if (this.artLiveChannelIdSet.has(channelId)) continue

        const res = await this.api.getLiveDetail(channelId)

        await helper.wait(this.SUB_PROCESS_API_REQUEST_TIME)

        if (!res || res.status !== 'OPEN') continue

        livesToRecord.push([res, user])
      } catch (error) {
        const err = error as ErrorItem

        const errors = [err?.message, err.cause?.message].filter((e): e is string => Boolean(e))
        if (errors.some((err) => failMsg.includes(err))) {
          continue
        }

        console.error(error)
      }
    }

    return livesToRecord
  }

  handleUserRecording(livesToRecord: [LiveDetail, UserSetting][]) {
    livesToRecord.forEach((item) => this.recorder.recordLiveStream(...item))
  }

  get idsToCheck() {
    return Object.values(this.model.userList).reduce(
      (acc, user) => {
        if (user.checkLiveByMainProcess) {
          acc.main.push(user.channelId)
        } else {
          acc.sub.push(user.channelId)
        }
        return acc
      },
      { main: [], sub: [] } as { main: string[]; sub: string[] }
    )
  }
  // #endregion

  //#region 斷線處理
  async checkAliveRecord() {
    const recordingList = this.model.recordingList

    for (const [channelId, onlineUser] of Object.entries(recordingList)) {
      const isRunning = await this.isLiveRunning(onlineUser.username)
      if (isRunning) {
        recordingList[channelId].controllable = false
      } else {
        delete recordingList[channelId]
      }
    }

    await this.model.setRecordList(recordingList)

    return cloneDeep(recordingList) as RecordingList
  }

  async monitorDisconnectRecord(disconnectRecordingList: RecordingList) {
    if (Object.values(disconnectRecordingList).length === 0) return

    const appSetting = await this.model.getAppSetting()

    helper.msg(`disconnected cmd found, check until stream end`, 'warn')

    do {
      for (const [channelId, onlineUser] of Object.entries(disconnectRecordingList)) {
        const isRunning = await this.isLiveRunning(onlineUser.username)
        if (isRunning) continue

        delete disconnectRecordingList[channelId]
        delete this.model.recordingList[channelId]

        await Promise.all([this.liveVod.updateUserVodInfo(channelId), this.model.setRecordList(this.model.recordingList)])
      }

      await helper.wait(appSetting.checkIntervalSec)
    } while (Object.values(disconnectRecordingList).length)

    helper.msg(`all disconnected cmd end`, 'success')
  }
  //#endregion

  //#region 主程序 檢查 tag
  async checkUsers() {
    const [artLives, noneArtLives] = await Promise.all([this.api.searchLives(this.model.searchTags), await this.mpHandleCheckLiveUsers()])

    this.artLives = artLives

    const validArtLiveChannelIds = artLives.filter((i) => !!this.model.userList[i.channelId]).map((i) => i.channelId)
    const validNoneArtLiveChannelIds = noneArtLives
      .map((i) => i[1])
      .filter((i) => !!this.model.userList[i.channelId])
      .map((i) => i.channelId)
    const validIds = Array.from(new Set([...validArtLiveChannelIds, ...validNoneArtLiveChannelIds]))

    await Promise.all([this.mpHandleVodCheck(validIds), this.mpHandleUserRecording(artLives)])
  }

  async mpHandleCheckLiveUsers() {
    const onlineUsers = await this.getOnlineUsers(this.idsToCheck.main)
    const usersToRecord = this.getUsersToRecord(onlineUsers)
    this.handleUserRecording(usersToRecord)
    return onlineUsers
  }

  async mpHandleVodCheck(onlineUserChannelIds: string[]) {
    await this.liveVod.checkUseLiveStatus(onlineUserChannelIds, 'main')
  }

  mpHandleUserRecording(lives: LiveExtend[]) {
    const livesToRecord = lives.reduce((acc, live) => {
      const { channelId, blindType } = live

      const user = this.model.userList[channelId]

      if (!user) return acc

      if (user.checkLiveByMainProcess) return acc

      const streamUrl = this.api.getSourceUrl(channelId)

      if (blindType) {
        helper.msg(`The live stream of ${user.username} is korea exclusive, url: ${streamUrl}`)
        return acc
      }

      const recordingUser = this.model.recordingList[channelId]

      if (recordingUser) {
        this.onlineUserMessage(recordingUser, channelId)
        return acc
      }

      if (user.disableRecord) {
        helper.msg(`Can not record ${user.username}'s live stream due to configuration at ${streamUrl}`)
        return acc
      }

      acc.push([live, user])
      return acc
    }, [] as [LiveExtend, UserSetting][])

    livesToRecord.forEach((payload) => this.recorder.recordLiveStream(...payload))
  }

  async mainProcess() {
    this.iterationTask(
      async () => {
        helper.msg(`Checking Users at ${new Date().toLocaleString()}`, 'title')

        if (!this.model.cookieIsAvailable) helper.msg('no cookie available', 'warn')

        await this.checkUsers()
      },
      'Main Process',
      this.model.appSetting.checkIntervalSec
    )
  }
  //#endregion

  //#region 次程序 user id
  isInvalidLiveCategory(allowCategory: string[], currentCategory?: string) {
    if (allowCategory.length === 0 || !currentCategory) return false

    const isAllowed = allowCategory.map((c) => c.toLowerCase()).includes(currentCategory.toLowerCase())

    return !isAllowed
  }

  async searchUsersById() {
    const livesToRecord = await this.getUsersToRecordById()

    await Promise.all([this.handleUserRecording(livesToRecord), this.spHandleVodCheck(this.onlineChannelIds)])
  }

  get artLiveChannelIdSet() {
    return this.artLives.reduce((set, cur) => set.add(cur.channelId), new Set<string>())
  }

  get onlineChannelIds() {
    return Object.keys(this.model.recordingList)
  }

  async getUsersToRecordById() {
    const { proactiveSearch } = this.model.appSetting

    if (!proactiveSearch) {
      helper.msg('skip sub process due to false value of proactiveSearch')
      return []
    }

    const onlineUsers = await this.getOnlineUsers(this.idsToCheck.sub)
    const usersToRecord = this.getUsersToRecord(onlineUsers)

    return usersToRecord
  }

  async spHandleVodCheck(onlineChannelIds: string[]) {
    this.liveVod.checkUseLiveStatus(onlineChannelIds, 'sub')
  }

  async subProcess() {
    this.iterationTask(
      async () => {
        helper.msg(`Checking Users by channelId at ${new Date().toLocaleString()}`, 'title')

        await this.searchUsersById()
      },
      'sub Process',
      this.SUB_PROCESS_LOOP_TIME
    )
  }
  //#endregion

  // #region 略過實況處理，清除已經結束的實況
  async checkSkipLive() {
    helper.msg('check skip live', 'title')

    const recordings = Object.entries(this.model.recordingList)

    if (recordings.length === 0) return

    const removeChannelIds: string[] = []

    for (const [channelId, record] of recordings) {
      if (!record.isSkip) continue
      if (!this.model.recordingList[channelId]) continue

      const res = await this.api.getLiveDetail(channelId)
      if (!res || res.status === 'OPEN') continue

      removeChannelIds.push(channelId)

      helper.msg(`user: ${record.username} is offline, removed from recording list`)

      await helper.wait(this.CHECK_SKIP_CHANNEL_TIME)
    }

    if (removeChannelIds.length === 0) return

    await this.model.removeRecordList(removeChannelIds)
  }

  async skipLiveProcess() {
    this.iterationTask(
      async () => {
        await this.checkSkipLive()
      },
      'Check Skip Live Process',
      this.CHECK_SKIP_LIVE_TIME
    )
  }
  // #endregion

  // #region VOD 檢查
  async vodProcess() {
    this.iterationTask(
      async () => {
        await this.liveVod.checkVodList()
      },
      'Vod Process',
      this.model.appSetting.checkIntervalSec
    )
  }
  // #endregion

  //#region Entry
  async start() {
    helper.msg('Initializing App Settings ...')

    this.model.watchModel()
    await this.model.init()

    const disconnectRecordingList = await this.checkAliveRecord()

    this.mainProcess()
    this.subProcess()
    this.vodProcess()
    this.skipLiveProcess()
    this.monitorDisconnectRecord(disconnectRecordingList)
  }
  //#endregion
}
