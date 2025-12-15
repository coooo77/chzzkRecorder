'use strict'

import helper from '../common.js'

import Vod from '../vod.js'
import Api from '../api.js'
import Model from '../model.js'
import Recorder from '../recorder.js'

import { ServerResponse } from '../../interfaces/index.js'
import type { Request, Response } from 'express'
import type { VideoWithIsAdult } from '../../interfaces/index.js'

export default class VodController {
  constructor(private api: Api, private recorder: Recorder, private model: Model) {}

  addList = async (req: Request, res: Response) => {
    try {
      const { list } = req.body

      if (!list || !Array.isArray(list) || list.length === 0) {
        throw Error('no vod url available')
      }

      // 資料取得
      const vodNumbers = list.filter((i) => ['string', 'number'].includes(typeof i)).map(Vod.getVodId)

      const vodItems: VideoWithIsAdult[] = []

      for (const num of vodNumbers) {
        try {
          const vodItem = await this.api.getVod(num)
          if (vodItem === null) continue
          vodItems.push(vodItem)
        } catch (error) {
          helper.msg(`fail to fetch vod info from vod number: ${num}`, 'warn')
        } finally {
          helper.wait(2)
        }
      }

      if (vodItems.length === 0) {
        return res.status(400).json(
          new ServerResponse({
            result: false,
            message: 'no vod items available',
          })
        )
      }

      // 保存資料
      const dlItems = vodItems.map((i) => this.recorder.getVodDownloadItem(i))
      await this.model.setVodDownloadList(dlItems)

      return res.status(200).json(
        new ServerResponse({
          data: dlItems,
          result: true,
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      helper.msg(message, 'error')

      return res.status(500).json(
        new ServerResponse({
          message,
          result: false,
        })
      )
    }
  }
}
