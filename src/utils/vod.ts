import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

import helper from './common.js'
import ffmpeg from './ffmpeg.js'
import fileSys from './fileSys.js'
import { RecordEvent } from './recorder.js'

import Api from './api.js'
import Model from './model.js'
import Recorder from './recorder.js'
import Puppeteer from './puppeteer.js'

import type { VodDownloadItem } from '../interfaces/setting.js'

interface DownloadVodParam {
  api: Api
  model: Model
  recorder: Recorder
  puppeteer: Puppeteer
}

export default class DownloadVod {
  api: Api
  model: Model
  recorder: Recorder
  puppeteer: Puppeteer

  MAX_RETRY_COUNT = 3

  VALID_DURATION = 60 * 2

  vodListPath = path.join('./vodList.json')

  vodDownloadListPath = path.join('./vodDownloadList.json')

  vodDownloadList: Record<number, VodDownloadItem> = {}
  constructor({ api, model, recorder, puppeteer }: DownloadVodParam) {
    this.api = api
    this.model = model
    this.recorder = recorder
    this.puppeteer = puppeteer
  }

  //#region 資料存取
  async getVodList() {
    return await fileSys.getOrDefaultValue<number[]>(this.vodListPath, [])
  }

  async saveVodDownloadList(data: Record<number, VodDownloadItem>) {
    await fileSys.saveJSONFile(this.vodDownloadListPath, data)
  }
  //#endregion

  //#region 資料請求
  async getVodItem(vodNum: number): Promise<VodDownloadItem | null> {
    try {
      const method = this.model.appSetting.usePuppeteer ? this.puppeteer.getVodData.bind(this.puppeteer) : this.api.getVod.bind(this.api)

      const vod = await method(vodNum)
      if (!vod) return null

      const userSetting = this.model.userList[vod.channel.channelId]

      return {
        vodNum,
        tryCount: 0,
        finish: false,
        adult: vod.adult,
        isSuccess: false,
        duration: vod.duration,
        publishDate: vod.publishDate,
        channelId: vod.channel.channelId,
        username: userSetting?.username || 'unknown_user',
        vodUrl: `https://chzzk.naver.com/video/${vodNum}`,
      }
    } catch (error) {
      helper.msg(`fetch failed, vodNum: ${vodNum}`, 'fail')
      console.error(error)
      return null
    }
  }

  async reduceGetVodItems(vodList: number[]) {
    const result = []

    for (const vodId of vodList) {
      const res = await this.getVodItem(vodId)
      if (res) result.push(res)
      await helper.wait(1)
    }

    return result
  }

  async onDownloadVodStart(item: VodDownloadItem) {
    this.vodDownloadList[item.vodNum] = item
    await this.saveVodDownloadList(this.vodDownloadList)
  }

  async onDownloadVodEnd(item: VodDownloadItem) {
    const vod = this.vodDownloadList[item.vodNum]

    const filePath = this.recorder.getVodFilePath(item)
    if (!fs.existsSync(filePath)) {
      helper.msg(`can not find vod ${item.vodUrl} to check duration!`, 'error')
    } else {
      const videoDuration = ffmpeg.getMediaDuration(filePath)
      const isSuccess = item.duration - videoDuration <= this.VALID_DURATION
      vod.finish = isSuccess
      vod.isSuccess = isSuccess
    }

    if (!vod.isSuccess) {
      helper.msg(`Failed to download vod ${item.vodNum}`)
      vod.tryCount++
    }

    if (vod.tryCount >= this.MAX_RETRY_COUNT) {
      vod.finish = true
    }

    await this.saveVodDownloadList(this.vodDownloadList)
  }

  listenRecordEvents() {
    this.recorder.on(RecordEvent.DOWNLOAD_VOD_END, (...arg) => this.onDownloadVodEnd(...arg))
    this.recorder.on(RecordEvent.DOWNLOAD_VOD_START, (...arg) => this.onDownloadVodStart(...arg))
  }
  //#endregion

  //#region Entry
  async start() {
    helper.msg('Start DownloadVod')

    this.listenRecordEvents()
    await this.model.init()
    await this.model.syncModel()

    const vodList = await this.getVodList()
    const vodItems = await this.reduceGetVodItems(vodList)

    if (this.puppeteer.isInit) this.puppeteer.close()

    for (const item of vodItems) {
      let isProcessing = true

      do {
        await this.recorder.recordVOD(item)
        isProcessing = !this.vodDownloadList[item.vodNum].finish
      } while (isProcessing)
    }

    const failList = Object.values(this.vodDownloadList).filter((i) => !i.isSuccess)
    if (failList.length) {
      failList.forEach((i) => helper.msg(`Failed to download vod ${i.vodNum}`))
    } else {
      helper.msg('Download Vod Successfully', 'success')
    }
  }
  //#endregion
}
