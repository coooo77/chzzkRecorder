'use strict'

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { AppSettings, RecordingList, UsersList } from '../interfaces/index.js'

export default {
  recordingListPath: path.join('modal', 'modal.json'),

  usersListPath: path.join('modal', 'users.json'),

  getUsersList() {
    try {
      const modal = this.getJSONFile<UsersList>(this.usersListPath)

      if (!modal) this.saveJSONFile(this.usersListPath, {})

      return modal || {}
    } catch (error) {
      this.saveJSONFile(this.usersListPath, {})

      return {}
    }
  },

  getRecordingList() {
    try {
      const modal = this.getJSONFile<RecordingList>(this.recordingListPath)

      if (!modal) this.saveJSONFile(this.recordingListPath, {})

      return modal || {}
    } catch (error) {
      this.saveJSONFile(this.recordingListPath, {})

      return {}
    }
  },

  getAppSetting() {
    const pathToSetting = path.join('config.json')

    return this.getJSONFile(pathToSetting) as AppSettings
  },

  getJSONFile<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) return null

    const result = fs.readFileSync(filePath, 'utf8')

    return JSON.parse(result)
  },

  makeDirIfNotExist(fileLocation: string) {
    if (fs.existsSync(fileLocation)) return

    fs.mkdirSync(fileLocation, { recursive: true })
  },

  saveJSONFile(filePath: string, data: any) {
    if (filePath.length === 0) throw new Error('no file path provided')

    const { dir } = path.parse(filePath)

    this.makeDirIfNotExist(dir)

    fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
  },

  errorHandler(error: any, triggerFnName: string = '', errorLogPath = path.join('error')) {
    this.makeDirIfNotExist(errorLogPath)

    const log = JSON.parse(JSON.stringify(error || {}))

    log.date = new Date().toLocaleString()

    log.message = error?.message || 'no error message'

    log.triggerFnName = triggerFnName

    const errFilePath = path.join(errorLogPath, `${new Date().getTime()}.json`)

    this.saveJSONFile(errFilePath, log)
  },
}
