'use strict'
// 外部方法
import { cloneDeep } from 'lodash-es'
import findProcess from 'find-process'

// 內部方法
import helper from './common.js'
import { RecordEvent } from './recorder.js'

// Class
import Api from './api.js'
import Model from './model.js'
import LiveVod from './liveVod.js'
import Recorder from './recorder.js'

// 型別
import type { Live, LiveDetail } from 'chzzk'
import type { RecordingList, UserSetting } from '../interfaces/setting.js'

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

  SUB_PROCESS_LOOP_TIME = 5 * 60
  SUB_PROCESS_API_REQUEST_TIME = 5 * 3

  constructor({ api, model, recorder, liveVod }: MainParams) {
    this.api = api
    this.model = model
    this.liveVod = liveVod
    this.recorder = recorder
  }

  async isLiveRunning(userName: string) {
    const result = await findProcess('name', userName)
    return !!result.length && result.some((i) => i.cmd.includes('https://chzzk.naver.com/live'))
  }

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

        await this.model.setRecordList(this.model.recordingList)
      }

      await helper.wait(appSetting.checkIntervalSec)
    } while (Object.values(disconnectRecordingList).length)

    helper.msg(`all disconnected cmd end`, 'success')
  }
  //#endregion

  //#region 主程序 檢查 tag
  async checkUsersByStreamTag() {
    const lives = await this.api.searchLives()

    await Promise.all([this.mpHandleVodCheck(lives), this.mpHandleUserRecording(lives)])
  }

  async mpHandleVodCheck(lives: Live[]) {
    const onlineUserChannelIds = lives.filter((i) => !!this.model.userList[i.channelId]).map((i) => i.channelId)
    await this.liveVod.checkUseLiveStatus(onlineUserChannelIds, 'main')
  }

  mpHandleUserRecording(lives: Live[]) {
    const livesToRecord = lives.reduce((acc, live) => {
      const { channelId } = live

      const user = this.model.userList[channelId]
      if (!user) return acc

      const recordingUser = this.model.recordingList[channelId]
      const streamUrl = this.api.getSourceUrl(channelId)

      if (recordingUser) {
        helper.msg(`Recording ${recordingUser.username} at ${streamUrl}`)
        return acc
      }

      if (user.disableRecord) {
        helper.msg(`Can not record ${user.username}'s live stream due to configuration at ${streamUrl}`)
        return acc
      }

      acc.push([live, user])
      return acc
    }, [] as [Live, UserSetting][])

    livesToRecord.forEach((payload) => this.recorder.emit(RecordEvent.RECORD_LIVE_START, ...payload))
  }

  async mainProcess() {
    helper.msg(`Checking Users at ${new Date().toLocaleString()}`, 'title')

    await this.checkUsersByStreamTag()

    const appSetting = await this.model.getAppSetting()
    await helper.wait(appSetting.checkIntervalSec)

    this.mainProcess()
    this.liveVod.checkVodList()
  }
  //#endregion

  //#region 次程序 user id
  isInvalidLiveCategory(allowCategory: string[], currentCategory?: string) {
    if (allowCategory.length === 0 || !currentCategory) return false

    const isAllowed = allowCategory.map((c) => c.toLowerCase()).includes(currentCategory.toLowerCase())

    return !isAllowed
  }

  async searchUsersById() {
    const { livesToRecord, onlineChannelIds } = await this.getUsersById()

    await Promise.all([this.spHandleUserRecording(livesToRecord), this.spHandleVodCheck(onlineChannelIds)])
  }

  async getUsersById() {
    const { proactiveSearch } = this.model.appSetting

    const onlineChannelIds: string[] = []
    const livesToRecord: [LiveDetail, UserSetting][] = []

    for (const channelId of Object.keys(this.model.userList)) {
      try {
        const streamUrl = this.api.getSourceUrl(channelId)

        const recordingUser = this.model.recordingList[channelId]

        if (recordingUser) {
          onlineChannelIds.push(channelId)

          const { username } = recordingUser
          helper.msg(`Recording ${username} at ${streamUrl}`)
          continue
        }

        const user = this.model.userList[channelId]
        const { disableRecord, enableAutoDownloadVod } = user

        if (!user) continue
        if (!proactiveSearch && (disableRecord || !enableAutoDownloadVod)) continue

        const res = await this.api.getLiveDetail(channelId)

        await helper.wait(this.SUB_PROCESS_API_REQUEST_TIME)

        if (!res || res.status !== 'OPEN') continue

        livesToRecord.push([res, user])
        onlineChannelIds.push(channelId)
      } catch (error) {
        const err = error as ErrorItem

        const errors = [err?.message, err.cause?.message].filter((e): e is string => Boolean(e))
        if (errors.some((err) => failMsg.includes(err))) {
          continue
        }

        console.error(error)
      }
    }

    return { livesToRecord, onlineChannelIds }
  }

  async spHandleVodCheck(onlineChannelIds: string[]) {
    this.liveVod.checkUseLiveStatus(onlineChannelIds, 'sub')
  }

  spHandleUserRecording(livesToRecord: [LiveDetail, UserSetting][]) {
    const payload: [LiveDetail, UserSetting][] = livesToRecord.filter((i) => {
      const [res, user] = i

      const streamUrl = this.api.getSourceUrl(user.channelId)

      if (user.disableRecord) {
        helper.msg(`Stop recording ${user.username} due to configuration. url: ${streamUrl}`)
        return false
      }

      if (this.isInvalidLiveCategory(user.allowCategory, res.liveCategory)) {
        helper.msg(`Stop record ${user.username} due to Invalid Category ${res.liveCategory}. url: ${streamUrl}`)
        return false
      }

      return true
    })

    payload.forEach((item) => this.recorder.emit(RecordEvent.RECORD_LIVE_START, ...item))
  }

  async subProcess() {
    helper.msg(`Checking Users by channelId at ${new Date().toLocaleString()}`, 'title')

    await this.searchUsersById()

    await helper.wait(this.SUB_PROCESS_LOOP_TIME)

    this.subProcess()
  }
  //#endregion

  //#region Entry
  async start() {
    helper.msg('Initializing App Settings ...')

    this.model.watchModel()
    await this.model.init()

    const disconnectRecordingList = await this.checkAliveRecord()

    this.mainProcess()
    this.subProcess()
    this.monitorDisconnectRecord(disconnectRecordingList)
  }
  //#endregion
}
