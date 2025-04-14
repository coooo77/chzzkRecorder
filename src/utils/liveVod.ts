'use strict'
import fs from 'fs'
import { DateTime } from 'luxon'
import { pickBy } from 'lodash-es'

import Api from './api.js'
import Model from './model.js'
import helper from './common.js'
import ffmpeg from './ffmpeg.js'
import Recorder from './recorder.js'

import { RecordEvent } from './recorder.js'
import type { VodCheckInfo } from '../interfaces/liveVod.js'
import type { VodDownloadItem } from '../interfaces/setting.js'
import type { VideoWithIsAdult } from '../interfaces/common.js'

interface LiveVodParam {
  api: Api
  model: Model
  recorder: Recorder
}

type LiveUserIdList = Set<string>

export default class LiveVod {
  api: Api
  model: Model
  recorder: Recorder

  MAX_RETRY_COUNT = 3
  VALID_DURATION = 60 * 2
  DOWNLOADING_ITEMS_COUNT = 0

  liveUserIdList: LiveUserIdList = new Set()
  subProcessLiveUserIdList: LiveUserIdList = new Set()

  constructor({ api, model, recorder }: LiveVodParam) {
    this.api = api
    this.model = model
    this.recorder = recorder

    this.listenRecordEvents()
  }

  // #region 更新下載項目
  get vodCheckListKeys() {
    return Object.keys(this.model.vodCheckList).map(Number).sort()
  }

  get vodCheckListValues() {
    return Object.values(this.model.vodCheckList)
  }

  async checkUseLiveStatus(onlineUserChannelIds: string[], type: 'main' | 'sub') {
    const userIdsSet = new Set(onlineUserChannelIds)

    // TODO:有兩種取得實況狀態的管道，但兩邊 id 不一定相同，需要更好的做法
    const listToCheck = type === 'main' ? this.liveUserIdList : this.subProcessLiveUserIdList

    for (const id of [...listToCheck]) {
      if (userIdsSet.has(id)) continue

      // 使用者下線
      await this.updateUserVodInfo(id)
    }

    // 更新最新資訊
    if (type === 'main') {
      this.liveUserIdList = userIdsSet
    } else {
      this.subProcessLiveUserIdList = userIdsSet
    }
  }

  /** 需要檢查 vod 的使用者離線時觸發 */
  async updateUserVodInfo(channelId: string) {
    const user = this.model.userList[channelId]
    if (!user) {
      helper.msg(`Vod Check task failed due to unknown user, id: ${channelId}`, 'error')
      return
    }

    if (!user.enableAutoDownloadVod) return

    const isPending = this.vodCheckListValues.some((i) => i.channelId === channelId)
    if (isPending) {
      helper.msg(`Vod Check task skipped due to task is already exist, id: ${channelId}`, 'warn')
      return
    }

    const videos = await this.api.getVideos(channelId)
    const lastVodNumber = Array.isArray(videos) && videos.length !== 0 ? Math.max(...videos.map((v) => v.videoNo)) : null

    const { checkUserVodMinutes } = this.model.appSetting
    const checkInterval = checkUserVodMinutes || Array.from({ length: 3 }, (_, i) => 60 * (i + 1))

    const timeNow = DateTime.now()

    const checkItems: VodCheckInfo[] = checkInterval.map((minutes) => {
      const checkTime = timeNow.plus({ minutes })
      return {
        channelId,
        lastVodNumber,
        username: user.username,
        checkTime: checkTime.toMillis(),
        localTime: checkTime.toJSDate().toLocaleString(),
      }
    })

    await this.model.setVodCheckList(checkItems)
  }
  // #endregion

  // #region 定時檢查、下載
  async checkVodList() {
    await this.addVodDownloadList()
    await this.downloadVodList()
  }

  async addVodDownloadList() {
    const timeNow = Date.now()

    for (const checkTime of this.vodCheckListKeys) {
      if (timeNow < checkTime) continue

      const vodCheckItem = this.model.vodCheckList[checkTime]
      if (!vodCheckItem) {
        helper.msg(`can not find vod info to check, check time: ${checkTime}`, 'error')
        continue
      }

      const { channelId, lastVodNumber } = vodCheckItem

      const videos = await this.api.getVideos(channelId)

      if (Array.isArray(videos) && videos.length) {
        const vidsToDl = lastVodNumber === null ? videos : videos.filter((v) => v.videoNo > lastVodNumber)

        // 找到可下載 VOD 不需再檢查相同類型的 VOD
        if (vidsToDl.length) {
          const sameChannelIdVodCheckItems = pickBy(this.model.vodCheckList, (i) => i.channelId === channelId)
          await Promise.all([this.setDownloadTask(vidsToDl), this.model.removeVodCheckList(Object.keys(sameChannelIdVodCheckItems).map(Number))])
        }
      }

      await this.model.removeVodCheckList([checkTime])
      break
    }
  }

  async setDownloadTask(vidsToDl: VideoWithIsAdult[]) {
    const items = vidsToDl.map((i) => this.recorder.getVodDownloadItem(i))
    await this.model.setVodDownloadList(items)
  }

  get ableDownloadCount() {
    const limit = this.model.appSetting.dlVodConcurrency || 1
    return limit - this.DOWNLOADING_ITEMS_COUNT
  }

  async downloadVodList() {
    if (this.ableDownloadCount <= 0) return

    const tasks = Object.values(pickBy(this.model.vodDownloadList, (i) => i.status === 'waiting'))

    for (let i = 0; i < tasks.length; i++) {
      if (this.ableDownloadCount <= 0) break
      this.DOWNLOADING_ITEMS_COUNT++
      this.vodDownloadTask(tasks[i])
    }
  }
  // #endregion

  // #region 下載操作
  async vodDownloadTask(item: VodDownloadItem) {
    let isProcessing = true

    do {
      await this.recorder.recordVOD(item)
      isProcessing = this.model.vodDownloadList[item.vodNum]?.status === 'ongoing'
      await helper.wait(3)
    } while (isProcessing)

    this.DOWNLOADING_ITEMS_COUNT--
  }
  // #endregion

  // #region 事件監聽
  async onDownloadVodStart(item: VodDownloadItem) {
    this.model.vodDownloadList[item.vodNum] = Object.assign(item, { status: 'ongoing' })
    await this.model.setVodDownloadList(Object.values(this.model.vodDownloadList))
  }

  async onDownloadVodEnd(item: VodDownloadItem) {
    const vod = this.model.vodDownloadList[item.vodNum]

    const filePath = this.recorder.getVodFilePath(item)
    if (!fs.existsSync(filePath)) {
      helper.msg(`can not find vod ${item.vodUrl} to check duration!`, 'error')
    } else {
      const videoDuration = ffmpeg.getMediaDuration(filePath)
      const isSuccess = item.duration - videoDuration <= this.VALID_DURATION
      if (isSuccess) vod.status = 'success'
    }

    if (vod.status !== 'success') {
      helper.msg(`Failed to download vod ${item.vodNum}`)
      vod.tryCount++
    }

    if (vod.tryCount >= this.MAX_RETRY_COUNT) {
      vod.status = 'failed'
    }

    await this.model.setVodDownloadList(Object.values(this.model.vodDownloadList))
  }

  listenRecordEvents() {
    this.recorder.on(RecordEvent.DOWNLOAD_VOD_END, (...arg) => this.onDownloadVodEnd(...arg))
    this.recorder.on(RecordEvent.DOWNLOAD_VOD_START, (...arg) => this.onDownloadVodStart(...arg))
  }
  // #endregion
}
