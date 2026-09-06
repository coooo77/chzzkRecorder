'use strict'

export const getVodId = (vodId: string | number) => {
  if (typeof vodId === 'number') return vodId

  const vodUrlRegex = /^https:\/\/chzzk.naver.com\/video\/([0-9]*)/
  const match = vodUrlRegex.exec(vodId)

  return Number(match ? match[1] : vodId)
}
