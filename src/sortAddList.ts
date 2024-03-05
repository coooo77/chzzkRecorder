'use strict'
import path from 'path'
import { fileURLToPath } from 'node:url'

import helper from './utils/common.js'
import fileSys from './utils/fileSys.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const userListPath = path.resolve(__dirname, '..', 'addList.json')
const newUserList = fileSys.getJSONFile<Record<string, string>>(userListPath)

if (!newUserList) process.exit(1)

const map = Object.entries(newUserList).reduce((acc, cur) => {
  const [channelId, username] = cur
  acc.set(username, channelId)
  return acc
}, new Map<string, string>())

const nameList = Object.values(newUserList).sort()

const newMap = nameList.reduce((acc, username) => {
  const channelId = map.get(username)
  if (!channelId) return acc

  acc[channelId] = username[0].toLowerCase() + username.slice(1)
  return acc
}, {} as Record<string, string>)

fileSys.saveJSONFile(userListPath, newMap)

helper.msg(`${nameList.length} users sorted`)
