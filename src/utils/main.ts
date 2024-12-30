'use strict'
// 外部方法
import { cloneDeep } from 'lodash-es'

// 內部方法
import helper from './common.js'
import { RecordEvent } from './recorder.js'

// Class
import Api from './api.js'
import Model from './model.js'
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
  recorder: Recorder
}

const failMsg = ['ENOTFOUND', 'fetch failed']

export default class Main {
  api: Api
  model: Model
  record: Recorder

  SUB_PROCESS_LOOP_TIME = 5 * 60
  SUB_PROCESS_API_REQUEST_TIME = 5 * 3

  constructor({ api, model, recorder: record }: MainParams) {
    this.api = api
    this.model = model
    this.record = record
  }

  //#region 斷線處理
  async checkAliveRecord() {
    const recordingList = this.model.recordingList

    for (const [channelId, onlineUser] of Object.entries(recordingList)) {
      if (helper.isProcessRunning(onlineUser.pid)) {
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
        if (helper.isProcessRunning(onlineUser.pid)) continue

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

    livesToRecord.forEach((payload) => this.record.emit(RecordEvent.RECORD_LIVE, ...payload))
  }

  async mainProcess() {
    await this.model.syncModel()

    helper.msg(`Checking Users at ${new Date().toLocaleString()}`, 'title')

    await this.checkUsersByStreamTag()

    const appSetting = await this.model.getAppSetting()
    await helper.wait(appSetting.checkIntervalSec)

    this.mainProcess()
  }
  //#endregion

  //#region 次程序 user id
  isInvalidLiveCategory(allowCategory: string[], currentCategory?: string) {
    if (allowCategory.length === 0 || !currentCategory) return false

    const isAllowed = allowCategory.map((c) => c.toLowerCase()).includes(currentCategory.toLowerCase())

    return !isAllowed
  }

  async searchUsersById() {
    const { proactiveSearch } = this.model.appSetting

    const livesToRecord: [LiveDetail, UserSetting][] = []

    for (const channelId of Object.keys(this.model.userList)) {
      try {
        const streamUrl = this.api.getSourceUrl(channelId)

        const recordingUser = this.model.recordingList[channelId]

        if (recordingUser) {
          const { username } = recordingUser
          helper.msg(`Recording ${username} at ${streamUrl}`)
          continue
        }

        const user = this.model.userList[channelId]
        if (!user || (!proactiveSearch && user.disableRecord)) continue

        const res = await this.api.getLiveDetail(channelId)

        await helper.wait(this.SUB_PROCESS_API_REQUEST_TIME)

        if (!res || res.status !== 'OPEN') continue

        if (user.disableRecord) {
          helper.msg(`Stop recording ${user.username} due to configuration. url: ${streamUrl}`)
          continue
        }

        if (this.isInvalidLiveCategory(user.allowCategory, res.liveCategory)) {
          helper.msg(`Stop record ${user.username} due to Invalid Category ${res.liveCategory}. url: ${streamUrl}`)
          continue
        }

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

    livesToRecord.forEach((payload) => this.record.emit(RecordEvent.RECORD_LIVE, ...payload))
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

    await this.model.init()

    const disconnectRecordingList = await this.checkAliveRecord()

    this.mainProcess()
    this.subProcess()
    this.monitorDisconnectRecord(disconnectRecordingList)
  }
  //#endregion
}
