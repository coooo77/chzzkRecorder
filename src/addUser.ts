'use strict'

import fs from 'fs'
import path from 'path'
import { ChzzkClient } from 'chzzk'
import { fileURLToPath } from 'node:url'

import helper from './utils/common.js'
import fileSys from './utils/fileSys.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const main = async () => {
  try {
    helper.msg('Start to add Users')

    const chzzk = new ChzzkClient()

    const userListPath = path.resolve(__dirname, '..', 'addList.json')
    const newUserListJson = fs.readFileSync(userListPath, 'utf8')
    const newUserList = JSON.parse(newUserListJson) as Record<string, string>

    const userList = fileSys.getUsersList()

    let count = 0

    for (const [channelId, username] of Object.entries(newUserList)) {
      if (userList[channelId]) continue

      const res = await chzzk.channel(channelId)

      userList[channelId] = {
        username,
        channelId,
        channelName: res.channelName,
        disableRecord: false,
        allowCategory: ['Live_Art'],
      }

      helper.msg(`User ${username} added`)

      count++

      await helper.wait(1)
    }

    if (count === 0) {
      helper.msg('No users were added')
      return
    }

    fileSys.saveJSONFile(fileSys.usersListPath, userList)

    helper.msg('Add Users successfully')
  } catch (error) {
    helper.msg('Failed to add users', 'error')

    console.error(error)
  }
}

main()
