'use strict'

import path from 'path'
import { ChzzkClient } from 'chzzk'
import { fileURLToPath } from 'node:url'

import helper from './utils/common.js'
import fileSys from './utils/fileSys.js'
import Puppeteer from './utils/puppeteer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const main = async () => {
  const chzzk = new ChzzkClient()
  const puppeteer = new Puppeteer()

  try {
    helper.msg('Start to add Users')

    const appSetting = fileSys.getAppSetting()
    const userListPath = path.resolve(__dirname, '..', 'addList.json')
    const newUserList = fileSys.getJSONFile<Record<string, string>>(userListPath)

    if (!newUserList) {
      helper.msg('No add list found, process close')
      return
    }

    const fetchFn = appSetting.usePuppeteer ? puppeteer.getChannel.bind(puppeteer) : chzzk.channel.bind(chzzk)

    const userList = fileSys.getUsersList()

    let count = 0

    for (const [channelId, username] of Object.entries(newUserList)) {
      if (userList[channelId]) continue

      const res = await fetchFn(channelId)

      userList[channelId] = {
        username,
        channelId,
        channelName: res.channelName,
        disableRecord: true,
        allowCategory: ['Live_Art', 'art'],
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
  } finally {
    await puppeteer.close()
  }
}

main()
