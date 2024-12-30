'use strict'

import fs from 'fs'
import path from 'path'
import fsPromise from 'fs/promises'

import type { AuthCookie } from '../interfaces/cookie.js'
import type { UsersList, AppSettings, RecordingList } from '../interfaces/index.js'

const fileSysOri = {
  //#region 檔案路徑
  appConfigPath: path.join('./config.json'),

  cookiePath: path.join('./model/cookie.json'),

  usersListPath: path.join('./model/users.json'),

  recordingListPath: path.join('./model/model.json'),
  //#endregion

  //#region 實況相關資料
  async getRecordingList(options?: { init: boolean }) {
    const model = await this.getOrDefaultValue<RecordingList>(this.recordingListPath, {})
    if (options?.init) await this.saveJSONFile(this.recordingListPath, model)
    return model
  },
  //#endregion

  //#region 通用資料
  async getUsersList(options?: { init: boolean }) {
    const model = await this.getOrDefaultValue<UsersList>(this.usersListPath, {})
    if (options?.init) await this.saveJSONFile(this.usersListPath, model)
    return model
  },

  async getCookie(options?: { init: boolean }) {
    const defaultCookie: AuthCookie = {
      auth: '',
      session: '',
    }

    const cookie = await this.getOrDefaultValue<AuthCookie>(this.cookiePath, defaultCookie)

    if (options?.init) await this.saveJSONFile(this.cookiePath, cookie as AuthCookie)

    return cookie
  },

  async getAppSetting() {
    const setting = await this.getJSONFile<AppSettings>(this.appConfigPath)
    if (!setting) throw Error('AppSetting file not found')

    return setting
  },

  getAppSettingSync() {
    if (!fs.existsSync(this.appConfigPath)) throw Error('AppSetting file not found')

    const result = fs.readFileSync(this.appConfigPath, 'utf8')
    return JSON.parse(result) as AppSettings
  },
  //#endregion

  //#region 通用
  async getOrDefaultValue<T>(filePath: string, defaultValue: T) {
    const model = await this.getJSONFile<T>(filePath)
    return model || defaultValue
  },

  async getJSONFile<T>(filePath: string): Promise<T | null> {
    if (!fs.existsSync(filePath)) return null

    try {
      const result = await fsPromise.readFile(filePath, 'utf8')

      return JSON.parse(result)
    } catch (error) {
      console.error(error)
      return null
    }
  },

  makeDirIfNotExist(fileLocation: string, options?: { sync?: boolean }) {
    if (fs.existsSync(fileLocation) || !fileLocation) return

    if (options?.sync) {
      fs.mkdirSync(fileLocation, { recursive: true })
    } else {
      return fsPromise.mkdir(fileLocation, { recursive: true })
    }
  },

  async saveJSONFile(filePath: string, data: any) {
    if (filePath.length === 0) throw new Error('no file path provided')

    const { dir } = path.parse(filePath)

    await this.makeDirIfNotExist(dir)

    await fsPromise.writeFile(filePath, JSON.stringify(data), 'utf8')
  },

  async errorHandler(error: any, triggerFnName: string = '', errorLogPath = path.join('error')) {
    await this.makeDirIfNotExist(errorLogPath)

    const log = JSON.parse(JSON.stringify(error || {}))

    log.date = new Date().toLocaleString()

    log.message = error?.message || 'no error message'

    log.triggerFnName = triggerFnName

    const errFilePath = path.join(errorLogPath, `${new Date().getTime()}.json`)

    await this.saveJSONFile(errFilePath, log)
  },
  //#endregion
}

type FileSysOri = typeof fileSysOri

interface FileSysOverload extends FileSysOri {
  makeDirIfNotExist(fileLocation: string): Promise<string | undefined>
  makeDirIfNotExist(fileLocation: string, options: { sync: true }): void
}

export default fileSysOri as FileSysOverload
