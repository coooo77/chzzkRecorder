'use strict'
import EventEmitter from 'events'

import { RecordEvent } from './recorder.js'

import fileSys from './fileSys.js'

import type { UsersList, AuthCookie, AppSettings, UserSetting, RecordingList } from '../interfaces/index.js'
import type { Live } from 'chzzk'

export enum ModelEvent {
  ADD_RECORD_LIST = 'model-add-record-list',
  REMOVE_RECORD_LIST = 'model-delete-record-list',
}

type Pid = number | undefined

/**
 * @see https://www.youtube.com/watch?v=Pl7pDjWd830
 * @see https://blog.makerx.com.au/a-type-safe-event-emitter-in-node-js/
 * @see https://stackoverflow.com/questions/67243592/typescript-adding-types-to-eventemitter
 */
export interface ModelEventMap {
  [RecordEvent.RECORD_LIVE]: [Live]
  [ModelEvent.ADD_RECORD_LIST]: [UserSetting, Pid]
  [ModelEvent.REMOVE_RECORD_LIST]: [UserSetting['channelId']]
}

export default class Model extends EventEmitter<ModelEventMap> {
  mutex = Promise.resolve()

  appSetting: AppSettings

  userList: UsersList = {}

  recordingList: RecordingList = {}

  MAX_REFRESH_COUNT = 2

  refreshAuthFailCount = 0

  authCookie: AuthCookie = { auth: '', session: '' }

  constructor(...args: ConstructorParameters<typeof EventEmitter>) {
    super(...args)

    this.appSetting = fileSys.getAppSettingSync()

    this.on(ModelEvent.ADD_RECORD_LIST, this.addRecordList)
    this.on(ModelEvent.REMOVE_RECORD_LIST, this.removeRecordList)
  }

  get isDisableRefreshAuth() {
    return this.refreshAuthFailCount > this.MAX_REFRESH_COUNT
  }

  //#region Record List
  async initRecordList() {
    this.recordingList = await fileSys.getRecordingList({ init: true })
  }

  setRecordList(list: RecordingList) {
    return this.addPromiseQueue(async () => {
      this.recordingList = list
      await fileSys.saveJSONFile(fileSys.recordingListPath, this.recordingList)
    })
  }

  removeRecordList(channelId: string) {
    return this.addPromiseQueue(async () => {
      delete this.recordingList[channelId]
      await this.setRecordList(this.recordingList)
    })
  }

  async addRecordList(setting: UserSetting, pid?: number) {
    return this.addPromiseQueue(async () => {
      this.recordingList[setting.channelId] = {
        pid,
        controllable: true,
        username: setting.username,
        startAt: new Date().toJSON(),
        channelName: setting.channelName,
      }

      await this.setRecordList(this.recordingList)
    })
  }
  //#endregion

  //#region Cookie
  async initCookie() {
    const cookie = await fileSys.getCookie({ init: true })
    if (cookie) this.authCookie = cookie
  }

  async setSession(session: string) {
    this.authCookie.session = session
    await fileSys.saveJSONFile(fileSys.cookiePath, this.authCookie)
  }
  //#endregion

  //#region 其他
  async addPromiseQueue<F extends (...arg: any[]) => any>(cb: F) {
    this.mutex
      .then(async () => {
        const res = await cb()
        return res
      })
      .catch(console.error)

    return this.mutex as Promise<ReturnType<F>>
  }

  async init() {
    await Promise.all([this.initCookie(), this.initUserList(), this.initRecordList(), fileSys.makeDirIfNotExist(this.appSetting.saveDirectory)])
  }

  async getAppSetting() {
    if (this.appSetting) return this.appSetting

    this.appSetting = await fileSys.getAppSetting()

    return this.appSetting
  }

  async syncModel() {
    const [userList, appSetting, authCookie] = await Promise.all([fileSys.getUsersList(), fileSys.getAppSetting(), fileSys.getCookie()])

    this.userList = userList
    this.authCookie = authCookie
    this.appSetting = appSetting
  }

  async initUserList() {
    this.userList = await fileSys.getUsersList()
  }
  //#endregion
}
