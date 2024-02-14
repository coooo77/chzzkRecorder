'use strict'

export interface AppSettings {
  checkIntervalSec: number
  filenameTemplate: string
  saveDirectory: string
}

export interface UserSetting {
  username: string
  channelId: string
  channelName: string
  disableRecord: boolean
  allowCategory: string[]
}

export interface OnlineUser {
  pid?: number
  startAt: string
  username: string
  controllable: boolean
  channelName: UserSetting['channelName']
}

export type UsersList = Record<UserSetting['channelId'], UserSetting>

export type RecordingList = Record<UserSetting['channelId'], OnlineUser>
