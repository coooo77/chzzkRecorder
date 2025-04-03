'use strict'
import type { UserSetting, VodDownloadItem } from './setting.js'

type CheckTime = number

export type VodCheckList = Record<CheckTime, VodCheckInfo>

export interface VodCheckInfo extends Pick<UserSetting, 'username' | 'channelId'> {
  localTime: string
  checkTime: CheckTime
  lastVodNumber: number | null
}

export type VodDownloadList = Record<VodDownloadItem['vodNum'], VodDownloadItem>
