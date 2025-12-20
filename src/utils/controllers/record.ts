'use strict'

import helper from '../common.js'

import Api from '../api.js'
import Model from '../model.js'
import Recorder from '../recorder.js'

import { ServerResponse, UserSetting } from '../../interfaces/index.js'
import type { LiveDetail } from 'chzzk'
import type { Request, Response } from 'express'

const REQUEST_INTERVAL_SEC = 2

export default class RecordController {
  constructor(private api: Api, private recorder: Recorder, private model: Model) {}

  recordLives = async (req: Request, res: Response) => {
    try {
      const { channelIds: ch } = req.body

      if (!ch || !Array.isArray(ch) || ch.length === 0) {
        throw Error('no channel ids available')
      }

      const userChannelIds = ch as string[]

      // 新增使用者
      const newUsers: Record<string, UserSetting> = {}

      for (const channelId of userChannelIds) {
        try {
          const user = this.model.userList[channelId]
          if (user) continue

          helper.msg(`new user channel id found: ${channelId}`)

          const channelInfoRes = await this.api.chzzk.channel(channelId)

          const setting = Object.assign(
            new UserSetting({
              channelId,
              username: `unknownUser${Date.now()}`,
              channelName: channelInfoRes.channelName,
            }),
            this.model.appSetting.userSettingOverride || {}
          )

          newUsers[channelId] = setting

          await helper.wait(REQUEST_INTERVAL_SEC)
        } catch (error) {
          helper.msg(`fail to fetch live details from channel id: ${channelId}; error: ${String(error)}`, 'error')
        }
      }

      if (Object.values(newUsers).length) {
        await this.model.setUserList(newUsers)
      }

      // 實況資料請求
      const liveDetails = new Map<string, LiveDetail | null>()

      for (const channelId of userChannelIds) {
        if (this.model.recordingList[channelId]) {
          helper.msg(`channel ${channelId} is recording, skip recording`)
          continue
        }

        try {
          const res = await this.api.getLiveDetail(channelId)

          const isStreaming = res?.status === 'OPEN'

          const payload = isStreaming ? res : null
          liveDetails.set(channelId, payload)

          if (isStreaming) continue

          helper.msg(`no live stream in channel: ${channelId}`, 'warn')
        } catch (error) {
          helper.msg(`fail to fetch live details from channel id: ${channelId}; error: ${String(error)}`, 'error')

          liveDetails.set(channelId, null)
        } finally {
          await helper.wait(REQUEST_INTERVAL_SEC)
        }
      }

      // 執行錄製
      for (const channelId of userChannelIds) {
        const user = this.model.userList[channelId]
        const liveDetail = liveDetails.get(channelId)

        if (!user || !liveDetail) continue

        this.recorder.recordLiveStream(liveDetail, user)
      }

      // 回傳結果
      const data = Object.entries(liveDetails).map(([channelId, liveDetail]) => ({
        channelId,
        isRecording: !!liveDetail,
      }))

      return res.status(200).json(
        new ServerResponse({
          data,
          result: true,
          message: 'start to record channels',
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
